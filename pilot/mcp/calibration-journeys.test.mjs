import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { loadCalibrationJourneys } = await import('../scripts/calibration-journeys.mjs').catch(() => ({}));

const rpc = (record) => ({ jsonrpc: '2.0', id: 1, result: {
  content: [{ type: 'text', text: JSON.stringify(record) }], isError: false,
} });

test('amostras de Contatos e Robôs recebem somente jornadas do próprio módulo e campos autorizados', async () => {
  assert.equal(typeof loadCalibrationJourneys, 'function');
  const dir = await mkdtemp(join(tmpdir(), 'calibration-journeys-'));
  try {
    const common = { actions: [{ type: 'click', role: 'button', name: 'Salvar', value: 'SEGREDO' }],
      screens: [{ screenshotId: 'SEGREDO', messages: ['Mensagem conhecida', 'Texto privado da tela'] }],
      verification: { confirmed: true, observed: 'Ficha reaberta', refsCount: 1 },
      reason: null, created: { id: 'SEGREDO' }, marker: 'SEGREDO' };
    await writeFile(join(dir, 'ler-contatos.cadastrar.json'), JSON.stringify(rpc({ ...common,
      module: 'contatos', task: 'contatos.cadastrar', status: 'concluída' })));
    await writeFile(join(dir, 'ler-robos.criar.json'), JSON.stringify(rpc({ ...common,
      module: 'robos', task: 'robos.criar', status: 'bloqueada', reason: 'alvo ausente da tela' })));
    const options = { knownLabels: new Set(['Salvar', 'Mensagem conhecida']) };
    const contatos = await loadCalibrationJourneys('Contatos', dir, options);
    const robos = await loadCalibrationJourneys('Robôs', dir, options);
    assert.deepEqual(contatos.jornadas.map(({ tarefa }) => tarefa), ['contatos.cadastrar']);
    assert.deepEqual(robos.jornadas.map(({ tarefa }) => tarefa), ['robos.criar']);
    assert.equal(contatos.jornadas[0].status, 'concluída');
    assert.equal(robos.jornadas[0].status, 'bloqueada');
    assert.equal(robos.jornadas[0].evidenciaDeFuncionamento, false);
    assert.deepEqual(contatos.jornadas[0].acoes, [{ tipo: 'click', papel: 'button', nome: 'Salvar' }]);
    assert.deepEqual(contatos.jornadas[0].mensagens, ['Mensagem conhecida']);
    assert.doesNotMatch(JSON.stringify(contatos), /SEGREDO|Texto privado da tela|refsCount/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('sem JOURNEYS_DIR retorna lista vazia e aviso publicável', async () => {
  assert.equal(typeof loadCalibrationJourneys, 'function');
  assert.deepEqual(await loadCalibrationJourneys('Contatos', undefined), {
    jornadas: [], aviso: 'JOURNEYS_DIR ausente', contagens: { concluída: 0, bloqueada: 0, inconclusiva: 0, falhou: 0 },
  });
});
