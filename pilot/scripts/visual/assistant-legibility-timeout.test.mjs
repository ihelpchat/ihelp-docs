import assert from 'node:assert/strict';
import test from 'node:test';

const timeoutModule = await import('./assistant-legibility-timeout.mjs').catch((error) => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return null;
});

test('timeout do probe usa o padrão e aceita um valor configurado', () => {
  assert.ok(timeoutModule, 'módulo de parsing do timeout ausente');
  assert.equal(timeoutModule.parseProbeTimeout({}), 120_000);
  assert.equal(timeoutModule.parseProbeTimeout({ ASSISTANT_LEGIBILITY_PROBE_TIMEOUT_MS: '300000' }), 300_000);
});

test('timeout do probe rejeita valores inválidos', () => {
  assert.ok(timeoutModule, 'módulo de parsing do timeout ausente');
  for (const value of ['abc', '59999', '900001', '120000.5', '']) {
    assert.throws(
      () => timeoutModule.parseProbeTimeout({ ASSISTANT_LEGIBILITY_PROBE_TIMEOUT_MS: value }),
      /ASSISTANT_LEGIBILITY_PROBE_TIMEOUT_MS.*60000.*900000/,
    );
  }
  assert.equal(timeoutModule.parseProbeTimeout({ ASSISTANT_LEGIBILITY_PROBE_TIMEOUT_MS: '60000' }), 60_000);
  assert.equal(timeoutModule.parseProbeTimeout({ ASSISTANT_LEGIBILITY_PROBE_TIMEOUT_MS: '900000' }), 900_000);
});
