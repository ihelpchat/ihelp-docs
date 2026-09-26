import assert from 'node:assert/strict';
import canonicalGuideIds from '../architecture/guide-ids.json' with { type: 'json' };
import { parseAssistantRequest, parseGuide, resolveGuideId, resolveGuideLink } from '../architecture/conversation-v1.mjs';

assert.deepEqual(canonicalGuideIds, [
  'guia-importar-contatos',
  'robo-de-atendimento',
  'usuario-acesso',
  'reconectar-canal-qr',
  'recado-fora-do-horario',
  'campanhas',
  'permissoes-departamentos',
  'arquivos',
  'crm',
]);
for (const guideId of canonicalGuideIds) {
  assert.deepEqual(resolveGuideLink(guideId), { kind: 'guide', guideId }, `link canônico ${guideId} inicia guia`);
  assert.equal(resolveGuideId(guideId), guideId, `guideId canônico ${guideId}`);
  assert.equal(parseGuide({ schemaVersion: 1, guideId, version: 1, mode: 'real', initialStepId: 'inicio', steps: [{ stepId: 'inicio', text: 'Início.' }] }).guideId, guideId);
}
assert.deepEqual(resolveGuideLink('importar-contatos'), { kind: 'navigation', actionId: 'importar-contatos' }, 'alias compartilhado só navega');
assert.equal(resolveGuideId('importar-contatos'), null);

const requestWithHistory = (length) => ({ question: 'Como importar contatos?', history: [{ role: 'assistant', content: 'a'.repeat(length) }] });
assert.equal(parseAssistantRequest(requestWithHistory(3_000)).history[0].content.length, 3_000, 'limite de saída é preservado');
assert.equal(parseAssistantRequest(requestWithHistory(3_001)).history[0].content, 'a'.repeat(3_000), 'histórico da UI é truncado');
assert.equal(parseAssistantRequest(requestWithHistory(20_000)).history[0].content.length, 3_000, 'teto de entrada ainda trunca');
assert.throws(() => parseAssistantRequest(requestWithHistory(20_001)), 'item acima do teto de entrada é recusado');
console.log('Correção M5.02 r2: todos os guideIds canônicos e limites do history passaram.');
