export function parseProbeTimeout(env) {
  const raw = env.ASSISTANT_LEGIBILITY_PROBE_TIMEOUT_MS;
  if (raw === undefined) return 120_000;

  const timeout = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(timeout) || timeout < 60_000 || timeout > 900_000) {
    throw new Error('ASSISTANT_LEGIBILITY_PROBE_TIMEOUT_MS deve ser um inteiro entre 60000 e 900000');
  }
  return timeout;
}
