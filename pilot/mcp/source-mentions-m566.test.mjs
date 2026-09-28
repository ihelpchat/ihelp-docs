import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFreeFaqSections } from './faq-editorial.mjs';

const context = { request: { topic: 'Robô', module: 'Robôs' }, screenFacts: [], existing: [] };
const sections = (text) => ({ oQueE: [{ text }], passos: [{ tarefa: 'Ativar', passos: [{ text: 'Clique em **Publicar**.' }] }] });

test('replay do revisor: omite atribuição ao contexto em O que é', () => {
  const result = validateFreeFaqSections(sections('Segundo o contexto, o robô recebe o cliente.'), context);
  assert.deepEqual(result.sections.oQueE, []);
  assert.match(result.pending.join(' '), /menção à fonte/u);
});

test('omite variantes com acento, caixa e nome do arquivo, preserva frase normal', () => {
  for (const phrase of ['Conforme o CONTEXTO de negócio, o robô responde.',
    'De acordo com o contexto, o robô responde.', 'Segundo o material, o robô responde.',
    'Segundo a fonte, o robô responde.', 'Conforme a documentação interna, o robô responde.',
    'O segundo cérebro descreve o robô.', 'O arquivo robos.md descreve o robô.',
    'Leia business-context para entender o robô.']) {
    const result = validateFreeFaqSections(sections(phrase), context);
    assert.deepEqual(result.sections.oQueE, [], phrase);
    assert.match(result.pending.join(' '), /menção à fonte/u);
  }
  assert.equal(validateFreeFaqSections(sections('O robô recebe o cliente.'), context).sections.oQueE.length, 1);
});
