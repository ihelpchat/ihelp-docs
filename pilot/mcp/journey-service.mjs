import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { containsSensitiveData } from './sensitive-data.mjs';
import { captureFailureLog } from './capture-diagnostics.mjs';

export const JOURNEY_POLICY_VERSION = 'm571-2';
const sha = /^[a-f0-9]{40}$/u;
const taskId = /^(?:contatos|robos)\.[a-z_]+$/u;
const modules = new Set(['contatos', 'robos']);
const forbidden = /\b(?:enviar|disparar|campanha|publicar|ativar|conectar|desconectar|excluir|deletar|remover|pagar|pagamento|cobrança|convidar|convite|senha|permiss(?:ã|a)o|integra(?:ç|c)(?:ã|a)o|webhook|agendar|agendamento)\b/iu;
const normalized = (value) => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const deny = (reason) => ({ allowed: false, reason });
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// 20255501NN is in the NANP 555-0100..0199 fictional range. Never dial it.
export function fixtureValue(kind, n = 1, marker = '') {
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new Error('índice fictício inválido');
  if (marker && !/^[a-f0-9]{8}$/u.test(marker)) throw new Error('marcador fictício inválido');
  const suffix = String(n).padStart(2, '0');
  const tag = marker ? ` · ${marker}` : '';
  if (kind === 'contactName') return `Contato Exemplo ${suffix}${tag}`;
  if (kind === 'editedName') return `Contato Exemplo ${suffix} Editado${tag}`;
  if (kind === 'robotName') return `Robô Exemplo ${suffix}${tag}`;
  if (kind === 'tagName') return `Tag Exemplo ${suffix}${tag}`;
  if (kind === 'email') return `contato${suffix}@example.com`;
  if (kind === 'phone') return `+1 202 555 01${suffix}`;
  throw new Error('tipo fictício inválido');
}
const generatedValues = () => new Set(['contactName', 'editedName', 'robotName', 'tagName', 'email', 'phone']
  .flatMap((kind) => Array.from({ length: 99 }, (_, index) => fixtureValue(kind, index + 1))));
const fixtureValues = generatedValues();
class SanitizationError extends Error {}

export function journeyFailureCategory(error) {
  const message = String(error?.message ?? '');
  if (/sanitiza|máscara|mascara|sensitive/iu.test(message)) return 'sanitização';
  if (/login|credencia|sessão|senha|password/iu.test(message)) return 'login';
  if (/host|destino|URL|homologação deve/iu.test(message)) return 'host';
  if (/modelo|model|openai|api.key/iu.test(message)) return 'modelo';
  if (/timeout|tempo|timed out/iu.test(message)) return 'tempo';
  if (/preparo|fixture|fictício|fatos da tela|SHA do front/iu.test(message)) return 'dado de preparo';
  return 'trava';
}
export function journeyFailureLog(error, env = process.env) {
  const category = journeyFailureCategory(error);
  const detail = captureFailureLog(error, env).replace(/^capturar_telas: [^:]*: /u, '');
  return `gravar_jornada: ${category}: ${containsSensitiveData(detail, { detectOpaque: true }) ? '[detalhe removido]' : detail}`;
}
export function journeyCoverage(records) {
  const eligible = records.filter((record) => !['contatos.agendar_mensagem', 'robos.publicar_ativar'].includes(record.task));
  const completed = eligible.filter((record) => record.status === 'concluída').length;
  return { completed, eligible: eligible.length, percent: eligible.length ? Math.round(completed * 100 / eligible.length) : 0 };
}

export function policyDecision(action, generated = fixtureValues) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return deny('ação inválida');
  if (!['click', 'fill', 'select', 'finish', 'upload_csv'].includes(action.type)) return deny('tipo inválido');
  if (action.type === 'finish') return { allowed: true };
  if (action.type === 'upload_csv') return action.role == null && action.name == null && action.value == null
    ? { allowed: true } : deny('upload inválido');
  if (!['button', 'link', 'menuitem', 'textbox', 'combobox', 'option', 'checkbox', 'tab'].includes(action.role)
    || typeof action.name !== 'string' || !action.name.trim() || action.name.length > 100) return deny('alvo inválido');
  const name = normalized(action.name);
  if (forbidden.test(name)) return deny('ação proibida');
  if (action.type === 'fill' && (action.role !== 'textbox' || !generated.has(action.value))) return deny('valor fora do gerador');
  if (action.type === 'select' && (action.role !== 'combobox' || !generated.has(action.value))) return deny('valor fora do gerador');
  if (action.type === 'click' && !['button', 'link', 'menuitem', 'checkbox', 'tab'].includes(action.role)) return deny('clique inválido');
  return { allowed: true };
}

function safeString(value) {
  if (typeof value !== 'string' || value.length > 180 || /[\r\n<>]/u.test(value)
    || !fixtureValues.has(value) && !/^(?:Contato|Robô|Tag) Exemplo \d{2}(?: Editado)? · [a-f0-9]{8}$/iu.test(value)
      && containsSensitiveData(value, { detectOpaque: true })) throw new Error('sanitização falhou');
  return value;
}
const commonLabels = new Set(['Adicionar Contato', 'Importar Contatos', 'Exportar Contatos', 'Criar novo Robô',
  'Listar Contatos', 'Proprietário do Contato', 'Menu de opções', 'Encaminhar atendimento']);
const personLike = /\b[\p{Lu}][\p{Ll}]{2,}\s+[\p{Lu}][\p{Ll}]{2,}\b/u;
function screenString(value, allowedLabels) {
  if (typeof value !== 'string' || value.length > 180 || /[\r\n<>]/u.test(value)) throw new Error('sanitização falhou');
  return !fixtureValues.has(value) && !/^(?:Contato|Robô|Tag) Exemplo \d{2}(?: Editado)? · [a-f0-9]{8}$/iu.test(value)
    && (containsSensitiveData(value, { detectOpaque: true })
      || personLike.test(value) && !allowedLabels.has(value) && !commonLabels.has(value))
    ? '[conteúdo oculto]' : value;
}
function sanitizeScreen(raw, allowedLabels) {
  if (!raw || typeof raw !== 'object' || !Buffer.isBuffer(raw.screenshot)) throw new Error('sanitização falhou');
  const clean = (value) => screenString(value, allowedLabels);
  const path = clean(raw.path);
  if (!/^\/[a-z0-9/_-]*$/iu.test(path)) throw new Error('sanitização falhou');
  const controls = (raw.controls ?? []).slice(0, 40).map((item) => ({
    role: clean(item.role), name: clean(item.name), enabled: Boolean(item.enabled),
    checked: item.checked == null ? null : Boolean(item.checked),
  }));
  const fields = (raw.fields ?? []).slice(0, 20).map((item) => ({
    role: clean(item.role), name: clean(item.name), required: Boolean(item.required),
  }));
  const messages = (raw.messages ?? []).slice(0, 10).map(clean);
  const state = {};
  for (const [key, value] of Object.entries(raw.state ?? {}).slice(0, 15)) state[clean(key)] = clean(value);
  return { title: clean(raw.title), path, controls, fields, messages, state,
    screenshot: raw.screenshot };
}
function safeJourney(record) {
  const copy = structuredClone(record);
  const check = (value) => {
    if (typeof value === 'string' && !sha.test(value) && !/^[a-f0-9]{64}$/u.test(value)
      && !fixtureValues.has(value) && !/^(?:Contato|Robô|Tag) Exemplo \d{2}(?: Editado)? · [a-f0-9]{8}$/iu.test(value)
      && containsSensitiveData(value, { detectOpaque: true })) throw new Error('sanitização falhou');
    if (Array.isArray(value)) value.forEach(check);
    else if (value && typeof value === 'object') Object.values(value).forEach(check);
  };
  check(copy);
  return copy;
}
function orderTasks(tasks) {
  const priority = { 'contatos.cadastrar': 0, 'robos.criar': 0 };
  return [...tasks].sort((a, b) => (priority[a.id] ?? 1) - (priority[b.id] ?? 1));
}
function prerequisites(id, prepared) {
  if (id.startsWith('contatos.') && id !== 'contatos.cadastrar' && !prepared.contact) return false;
  if (id.startsWith('robos.') && id !== 'robos.criar' && !prepared.robot) return false;
  return true;
}
function actionEvidence(id, actions, fixtureFor = fixtureValue) {
  const fills = actions.filter((action) => action.type === 'fill').map((action) => action.value);
  const clickedSave = actions.some((action) => action.type === 'click' && /^(?:salvar|criar|cadastrar)$/iu.test(action.name));
  if (id === 'contatos.cadastrar') return fills.includes(fixtureFor('contactName'))
    && fills.includes(fixtureFor('phone')) && clickedSave;
  if (id === 'contatos.editar') return fills.includes(fixtureFor('editedName')) && clickedSave;
  if (id === 'robos.criar') return fills.includes(fixtureFor('robotName')) && clickedSave;
  if (id === 'contatos.buscar') return fills.includes(fixtureFor('contactName'));
  if (id === 'contatos.definir_responsavel') return actions.some((action) => action.type === 'select') && clickedSave;
  if (id === 'contatos.marcar_tags') return fills.includes(fixtureFor('tagName'))
    && actions.some((action) => action.type === 'click' && /criar|adicionar|salvar/iu.test(action.name));
  if (id === 'contatos.importar') return actions.some((action) => action.type === 'upload_csv')
    && actions.some((action) => action.type === 'click' && /importar/iu.test(action.name));
  if (id === 'contatos.exportar') return actions.some((action) => action.type === 'click' && /exportar contatos/iu.test(action.name));
  if (id === 'robos.montar_menu') return actions.some((action) => action.type === 'click' && /bloco|menu/iu.test(action.name)) && clickedSave;
  if (id === 'robos.encaminhar') return actions.some((action) => action.type === 'click' && /encaminhar/iu.test(action.name)) && clickedSave;
  if (id === 'robos.salvar') return clickedSave;
  if (id === 'robos.editar') return fills.includes(fixtureFor('robotName', 2)) && clickedSave;
  return actions.length > 0;
}
const fileFor = (root, module, id, key) => join(root, module, `${id}.${key}.json`);
async function loadCache(root, module, id, key) {
  try {
    const data = JSON.parse(await readFile(fileFor(root, module, id, key), 'utf8'));
    if (data.cacheKey !== key || data.task !== id) throw new Error('cache incompatível');
    for (const { screenshotId } of data.screens ?? []) {
      if (!/^[a-f0-9]{64}$/u.test(screenshotId)
        || createHash('sha256').update(await readFile(join(root, module, `${screenshotId}.png`))).digest('hex') !== screenshotId)
        throw new Error('print do cache inválido');
    }
    return safeJourney(data);
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function save(root, module, record, images) {
  const dir = join(root, module);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const [id, bytes] of images) await writeFile(join(dir, `${id}.png`), bytes, { flag: 'wx', mode: 0o600 }).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const name = fileFor(root, module, record.task, record.cacheKey);
  await writeFile(name, JSON.stringify(safeJourney(record), null, 2), { mode: 0o600 });
  await writeFile(join(dir, `${record.task}.latest`), record.cacheKey, { mode: 0o600 });
}

export async function readJourney({ root = resolve(process.env.MCP_STATE_DIR ?? '/data', 'journeys'), module, task }) {
  if (!modules.has(module) || !taskId.test(task) || !task.startsWith(`${module}.`)) throw new Error('tarefa inválida');
  const key = await readFile(join(root, module, `${task}.latest`), 'utf8');
  if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error('cache inválido');
  return loadCache(root, module, task, key);
}

export async function runJourneys({ module, tasks, root = resolve(process.env.MCP_STATE_DIR ?? '/data', 'journeys'), marker = '',
  frontSha, backSha = 'unavailable', profile, browser, model, sanitize = async (value) => value,
  allowedScreenLabels = new Set(),
  maxActionsPerTask = 30, maxActionsPerModule = 300, maxMs = 900_000, maxCostUsd = 5 }) {
  if (!modules.has(module) || !Array.isArray(tasks) || tasks.some((item) => !taskId.test(item.id) || item.modulo !== module)
    || !sha.test(frontSha) || !(sha.test(backSha) || backSha === 'unavailable') || !profile || !browser || !model
    || marker && !/^[a-f0-9]{8}$/u.test(marker))
    throw new Error('configuração de jornada inválida');
  const fixtureFor = (kind, n = 1) => fixtureValue(kind, n, marker);
  const generated = marker ? new Set([...fixtureValues, ...['contactName', 'editedName', 'robotName', 'tagName']
    .flatMap((kind) => Array.from({ length: 99 }, (_, index) => fixtureFor(kind, index + 1)))]) : fixtureValues;
  const results = [];
  const prepared = {};
  let moduleActions = 0;
  let costUsd = 0;
  const started = Date.now();
  try {
  for (const task of orderTasks(tasks)) {
    const key = digest({ task: task.id, frontSha, backSha, profile, prepared, marker, policy: JOURNEY_POLICY_VERSION });
    const cached = await loadCache(root, module, task.id, key);
    if (cached) { results.push(cached); Object.assign(prepared, cached.created ?? {}); continue; }
    const record = { task: task.id, module, objective: task.tarefa, prerequisites: task.preRequisitos,
      profile, versions: { frontSha, backSha, note: backSha === 'unavailable' ? 'SHA do back indisponível; recapturar quando disponível' : null },
      fixtures: Object.values(prepared), marker, actions: [], screens: [], before: null, after: null,
      expected: task.resultadoEsperadoObservavel, observed: null, verification: null, created: {},
      status: 'inconclusiva', reason: null, limits: { maxActionsPerTask, maxActionsPerModule, maxMs, maxCostUsd },
      usage: { actions: 0, costUsd: 0, elapsedMs: 0 }, cacheKey: key, policyVersion: JOURNEY_POLICY_VERSION };
    const images = [];
    if (task.acaoProibidaAoAgente?.startsWith('sim:') || task.id === 'robos.publicar_ativar' || task.id === 'contatos.agendar_mensagem') {
      record.status = 'bloqueada'; record.reason = 'ação proibida pela política';
    } else if (!prerequisites(task.id, prepared)) {
      record.reason = 'sem dado de preparo';
    } else {
      let opened = false;
      try {
        await browser.open(task, prepared); opened = true;
        for (let index = 0; index < maxActionsPerTask; index++) {
          if (moduleActions >= maxActionsPerModule || Date.now() - started > maxMs || costUsd >= maxCostUsd) {
            record.reason = 'limite da execução atingido'; break;
          }
          let raw;
          try { raw = await browser.observe(); }
          catch { throw new SanitizationError('observação ou máscara falhou'); }
          let sanitized;
          try { sanitized = sanitizeScreen(await sanitize(raw), allowedScreenLabels); }
          catch { throw new SanitizationError('sanitização falhou'); }
          const screenshotId = createHash('sha256').update(sanitized.screenshot).digest('hex');
          const screen = { title: sanitized.title, path: sanitized.path, controls: sanitized.controls,
            fields: sanitized.fields, messages: sanitized.messages, state: sanitized.state, screenshotId,
            controlsOffered: sanitized.controls };
          if (record.before == null) record.before = sanitized.state;
          if (record.screens.length) screen.controlsOffered = sanitized.controls.filter((control) =>
            !record.screens.at(-1).controls.some((old) => old.role === control.role && old.name === control.name));
          record.screens.push(screen);
          images.push([screenshotId, sanitized.screenshot]);
          const decision = await model.decide({ task: { id: task.id, objective: task.tarefa, expected: record.expected,
            verification: task.verificacaoM571 }, screen, actions: record.actions,
          });
          const charge = Number(decision.costUsd ?? 0);
          if (!Number.isFinite(charge) || charge < 0) { record.reason = 'custo inválido'; break; }
          costUsd += charge;
          if (costUsd > maxCostUsd) { record.reason = 'limite de custo atingido'; break; }
          const action = { type: decision.type, role: decision.role, name: decision.name, value: decision.value };
          if (action.type === 'upload_csv' && task.id !== 'contatos.importar') {
            record.status = 'bloqueada'; record.reason = 'upload fora da tarefa'; break;
          }
          const policy = policyDecision(action, generated);
          if (!policy.allowed) { record.status = 'bloqueada'; record.reason = policy.reason; break; }
          if (action.type === 'finish') {
            if (!actionEvidence(task.id, record.actions, fixtureFor)) { record.reason = 'ações necessárias não observadas'; break; }
            const checked = await browser.verify(task, prepared, record.actions);
            record.verification = { confirmed: Boolean(checked.confirmed), observed: safeString(checked.observed ?? '') };
            record.observed = record.verification.observed;
            record.after = sanitized.state;
            record.status = checked.confirmed ? 'concluída' : 'inconclusiva';
            record.reason = checked.confirmed ? null : 'resultado não conferido';
            if (!checked.confirmed && task.modulo === 'contatos') {
              const validation = screen.messages.find((message) => /telefone|número|numero/iu.test(message)
                && /inválid|invalid|formato|aceit|recus/iu.test(message));
              if (validation) {
                record.reason = 'formato de telefone recusado';
                record.observed = validation;
              }
            }
            if (checked.confirmed && checked.created) {
              if (Object.values(checked.created).some((value) => !generated.has(value))) throw new SanitizationError('dado de preparo inválido');
              record.created = checked.created;
            }
            break;
          }
          if (action.type !== 'upload_csv' && !sanitized.controls.some((control) => control.role === action.role && control.name === action.name && control.enabled)
            && !sanitized.fields.some((field) => field.role === action.role && field.name === action.name)) {
            record.reason = 'alvo ausente da tela'; break;
          }
          await browser.act(action);
          record.actions.push(action);
          moduleActions++;
          record.usage.actions++;
        }
        if (!record.reason && record.status === 'inconclusiva') record.reason = 'limite de ações por tarefa';
      } catch (error) {
        record.status = /escrita bloqueada pela política/iu.test(String(error?.message ?? '')) ? 'bloqueada' : 'inconclusiva';
        record.reason = record.status === 'bloqueada' ? 'escrita bloqueada pela política' : journeyFailureCategory(error);
        if (error instanceof SanitizationError) {
          record.screens = []; record.before = null; record.after = null; images.length = 0;
        }
        console.error(journeyFailureLog(error));
      } finally { await browser.close().catch(() => {}); }
    }
    record.usage.costUsd = costUsd;
    record.usage.elapsedMs = Date.now() - started;
    // The caller cannot bypass this final privacy gate with an injected sanitizer.
    safeJourney(record);
    await save(root, module, record, images);
    Object.assign(prepared, record.created);
    results.push(record);
  }
  } catch (error) {
    if (error && typeof error === 'object') error.results = results;
    throw error;
  }
  return results;
}
