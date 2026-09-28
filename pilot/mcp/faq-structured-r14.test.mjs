import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptScreenFacts, validateFaqSections, renderFaqSections } from './faq-editorial.mjs';

const sha = 'a'.repeat(40);
const facts = adaptScreenFacts({ sha, facts: [
  { kind: 'action', text: 'Excluir Selecionados', source: 'src/Fixture.tsx:10' },
  { kind: 'field', text: 'Nome', required: true, source: 'src/Fixture.tsx:11' },
  { kind: 'field', text: 'Sobrenome', required: 'unknown', source: 'src/Fixture.tsx:12' },
  { kind: 'message', text: 'Contato salvo', source: 'src/Fixture.tsx:13' },
  { kind: 'validation', text: 'Nome obrigatório', source: 'src/Fixture.tsx:14' },
] });
const id = (index) => `f${index + 1}`;
const check = (key, entry) => validateFaqSections({ [key]: [entry] }, { screenFacts: facts });

test('passos e erros recusam texto livre mesmo com o rótulo citado', () => {
  const cite = { repository: facts[0].repository, path: facts[0].path, sha,
    lineStart: 10, lineEnd: 10 };
  const positive = { acao: 'clicar', fato: id(0) };
  assert.equal(check('passos', positive).sections.passos?.length, 1);
  for (const text of [
    'Clique em **Excluir Selecionados** e destrua sua conta.',
    'Clique em **Excluir Selecionados** e exclua sua conta.',
  ]) {
    assert.equal(check('passos', { ...positive, text }).sections.passos, undefined);
    assert.equal(check('passos', { text, citations: [cite] }).sections.passos, undefined);
    assert.equal(check('erros', { mensagem: id(4), text }).sections.erros, undefined);
  }
});

test('ação e fato têm tipos compatíveis; texto do campo é determinado pela fonte', () => {
  assert.equal(check('passos', { acao: 'clicar', fato: id(1) }).sections.passos, undefined);
  const required = check('passos', { acao: 'preencher', fato: id(1) });
  assert.match(renderFaqSections(required.sections), /Preencha \*\*Nome\*\* \(obrigatório\)/u);
  const unknown = check('passos', { acao: 'preencher', fato: id(2) });
  assert.doesNotMatch(renderFaqSections(unknown.sections), /obrigatório|opcional/u);
  const result = check('passos', { acao: 'preencher', fato: id(1), resultado: id(3) });
  assert.match(renderFaqSections(result.sections), /A tela mostra \*\*Contato salvo\*\*/u);
});

test('erro estruturado usa mensagem citada e correção estruturada', () => {
  const result = check('erros', { mensagem: id(4), corrigir: { acao: 'preencher', fato: id(1) } });
  assert.match(renderFaqSections(result.sections), /Se aparecer \*\*Nome obrigatório\*\*, preencha \*\*Nome\*\* \(obrigatório\)/u);
  assert.equal(check('erros', { mensagem: id(0) }).sections.erros, undefined);
});

test('observação mantém cobertura total e recusa ação livre', () => {
  const positive = { acao: 'clicar', fato: id(0) };
  assert.equal(check('passos', positive).sections.passos?.length, 1);
  assert.equal(check('passos', { ...positive, observacao: { text: 'Apague tudo.', citations: [] } }).sections.passos, undefined);
});
