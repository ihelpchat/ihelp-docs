import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishedGuideCatalog, routeMessage } from './closed-router.mjs';

/*
 * Perguntas que pessoas fazem de verdade no widget (jornada real de 14/11/2026
 * e sugestões do próprio widget). A triagem recusava o roteiro publicado em
 * todas elas porque nenhuma âncora casava; os negativos garantem que âncoras
 * novas não puxem perguntas vizinhas para o roteiro de cadastro ou de recado.
 */
const root = new URL('../', import.meta.url).pathname;
const catalog = await publishedGuideCatalog(root);
const dir = await mkdtemp(join(tmpdir(), 'widget-starters-'));
const budget = { file: join(dir, 'budget.json'), dailyLimitUsd: 100, reserveUsd: 0.01 };
const provider = (choice) => ({ responses: { create: async () => ({ status: 'completed',
  output_text: JSON.stringify({ choice }), usage: { input_tokens: 1, output_tokens: 1 } }) } });

const positives = {
  'usuario-acesso': [
    'Como cadastro um novo usuário e defino o acesso dele?',
    'Como criar um usuário?',
    'Como cadastro alguém da minha equipe?',
    'Quero adicionar um atendente novo',
    'Como cadastrar usuário?',
  ],
  'recado-fora-do-horario': [
    'Como coloco um recado automático para quando estivermos fora do horário?',
    'Onde altero a mensagem fora de horário?',
    'Como configuro os horários de atendimento?',
    'Como mudo o horário de atendimento?',
  ],
};
const negatives = {
  'usuario-acesso': [
    'Como desativo o acesso de um usuário?',
    'Como funcionam perfis e permissões?',
    'Como funcionam os departamentos?',
    'Esqueci minha senha',
  ],
  'recado-fora-do-horario': [
    'Como envio uma campanha?',
    'Como vejo o histórico de atendimento?',
  ],
};

try {
  for (const [guideId, questions] of Object.entries(positives)) {
    for (const question of questions) {
      const routed = await routeMessage(question, { catalog, client: provider(guideId), budget });
      assert.deepEqual(routed, { kind: 'guide', guideId }, `deveria oferecer ${guideId}: ${question}`);
    }
  }
  for (const [guideId, questions] of Object.entries(negatives)) {
    for (const question of questions) {
      const routed = await routeMessage(question, { catalog, client: provider(guideId), budget });
      assert.notDeepEqual(routed, { kind: 'guide', guideId }, `não deveria oferecer ${guideId}: ${question}`);
    }
  }
  console.log('ok closed-router-widget-starters');
} finally {
  await rm(dir, { recursive: true, force: true });
}
