import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const cents = (value) => Math.round(value * 1_000_000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function locked(file, operation) {
  const lock = `${file}.lock`;
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await mkdir(lock, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (attempt === 99) throw new Error('Ledger indisponível');
      await sleep(20);
    }
  }
  try {
    let ledger;
    try { ledger = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ledger = { day: '', spent: 0, reservations: {} };
    }
    const result = await operation(ledger);
    if (result.write) {
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(ledger), { mode: 0o600, flag: 'wx' });
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
    }
    return result.value;
  } finally { await rm(lock, { recursive: true, force: true }); }
}

function settings(options) {
  const numeric = (value, fallback) => value === undefined ? fallback : Number(value);
  const config = {
    file: options.file ?? process.env.ASSISTANT_BUDGET_FILE ?? (process.env.RAILWAY_ENVIRONMENT_NAME
      ? '/data/claricia-budget.json' : `/tmp/claricia-budget-dev-${process.pid}.json`),
    dailyLimit: cents(numeric(options.dailyLimitUsd ?? process.env.ASSISTANT_DAILY_LIMIT_USD,
      process.env.RAILWAY_ENVIRONMENT_NAME ? 1 : 100)),
    reserve: cents(numeric(options.reserveUsd ?? process.env.ASSISTANT_RESERVE_USD, 1)),
    inputRate: numeric(options.inputUsdPerMillion ?? process.env.ASSISTANT_INPUT_USD_PER_MILLION, 10),
    outputRate: numeric(options.outputUsdPerMillion ?? process.env.ASSISTANT_OUTPUT_USD_PER_MILLION, 10),
    now: options.now ?? (() => new Date()),
  };
  if (![config.dailyLimit, config.reserve, config.inputRate, config.outputRate].every(Number.isFinite)
    || config.dailyLimit < 0 || config.reserve <= 0 || config.inputRate < 0 || config.outputRate < 0) {
    throw new Error('Configuração de orçamento inválida');
  }
  return config;
}

function usageCost(usage, config) {
  const input = Number(usage?.input_tokens);
  const output = Number(usage?.output_tokens);
  if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) return null;
  return Math.ceil(input * config.inputRate + output * config.outputRate);
}

/** Reserva antes da chamada; timeout e usage inválido mantêm o valor inteiro reservado. */
export async function createBudgetedResponse(client, payload, options = {}) {
  const config = settings(options);
  const day = config.now().toISOString().slice(0, 10);
  const reserve = Math.max(config.reserve, Math.ceil(
    Buffer.byteLength(JSON.stringify(payload), 'utf8') * config.inputRate
      + Number(payload.max_output_tokens ?? 0) * config.outputRate,
  ));
  for (let attempt = 0; attempt < 2; attempt++) {
    if (options.signal?.aborted) return { kind: 'provider_failed' };
    const id = randomUUID();
    const admitted = await locked(config.file, (ledger) => {
      if (ledger.day !== day) { ledger.day = day; ledger.spent = 0; ledger.reservations = {}; }
      const reserved = Object.values(ledger.reservations).reduce((total, value) => total + value, 0);
      if (!options.bypassAdmission && ledger.spent + reserved + reserve > config.dailyLimit) return { value: false, write: true };
      ledger.reservations[id] = reserve;
      return { value: true, write: true };
    });
    if (!admitted) return { kind: 'budget_exhausted' };
    let response;
    try { response = await client.responses.create(payload, { signal: options.signal }); }
    catch (error) {
      // 4xx de requisição inválida não foram processados; timeout, 408, 429 e 5xx podem ter sido cobrados.
      const invalidRequest = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
        && error.status !== 408 && error.status !== 429;
      await locked(config.file, (ledger) => {
        if (ledger.day === day && ledger.reservations[id] !== undefined) {
          if (!invalidRequest) ledger.spent += ledger.reservations[id];
          delete ledger.reservations[id];
        }
        return { write: true };
      });
      throw error;
    }
    const actual = usageCost(response.usage, config);
    await locked(config.file, (ledger) => {
      if (ledger.day === day && ledger.reservations[id] !== undefined) {
        ledger.spent += actual ?? ledger.reservations[id]; delete ledger.reservations[id];
      }
      return { write: true };
    });
    if (response.status === 'completed' && typeof response.output_text === 'string' && response.output_text.trim()) {
      return { kind: 'ok', response };
    }
    if (options.signal?.aborted || response.status !== 'incomplete') return { kind: 'provider_failed' };
  }
  return { kind: 'provider_failed' };
}

export async function budgetState(options = {}) {
  const config = settings(options);
  const day = config.now().toISOString().slice(0, 10);
  return locked(config.file, (ledger) => {
    const reserved = ledger.day === day ? Object.values(ledger.reservations).reduce((total, value) => total + value, 0) : 0;
    const spent = ledger.day === day ? ledger.spent : 0;
    return { value: spent + reserved + config.reserve > config.dailyLimit ? 'exhausted' : 'available', write: false };
  });
}
