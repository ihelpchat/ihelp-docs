import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeClaims, renderFreeFaqSections, validateFreeFaqSections } from './faq-editorial.mjs';

const context = { request: { module: 'Contatos' }, business: [{ module: 'Contatos', body: 'O proprietário do contato recebe a próxima conversa diretamente.' }], screenFacts: [{ text: 'Salvar', kind: 'action' }] };
const task = (overrides = {}) => ({ tarefa: 'Responsável',
  sobre: [{ text: 'Use o responsável para manter o cliente com a mesma pessoa.' }],
  passos: [{ text: 'No módulo Contatos, clique em **Salvar**.' }],
  depois: [{ text: 'A próxima conversa pode ser encaminhada diretamente ao responsável.' }],
  ...overrides });

test('contexto da tarefa fica estruturado e aparece ao redor dos passos', () => {
  const checked = validateFreeFaqSections({ passos: [task()] }, context);
  assert.equal(checked.sections.passos[0].sobre.length, 1);
  assert.equal(checked.sections.passos[0].depois.length, 1);
  const body = renderFreeFaqSections(checked.sections);
  assert.match(body, /### Responsável\n\nUse o responsável[\s\S]*1\. No módulo Contatos[\s\S]*\*\*O que acontece depois:\*\* A próxima conversa/u);
});

test('juiz recebe sobre e depois e marca afirmação inventada como a confirmar', async () => {
  const checked = validateFreeFaqSections({ passos: [task()] }, context);
  const judged = await judgeClaims(checked.sections, context, async (claims) => {
    assert.deepEqual(claims.map((claim) => claim.section), ['sobre', 'passos', 'depois']);
    return { claims: claims.map((claim) => ({ id: claim.id,
      status: claim.section === 'sobre' ? 'a confirmar' : 'sustentada', reason: 'sem fato', sourceMention: false })) };
  });
  assert.match(renderFreeFaqSections(judged.sections), /<AConfirmar>Use o responsável/u);
  assert.equal(judged.sections.passos[0].depois.length, 1);
});

test('juiz também marca depois sem sustentação', async () => {
  const checked = validateFreeFaqSections({ passos: [task()] }, context);
  const judged = await judgeClaims(checked.sections, context, async (claims) => ({ claims: claims.map((claim) => ({
    id: claim.id, status: claim.section === 'depois' ? 'a confirmar' : 'sustentada',
    reason: 'sem fato', sourceMention: false,
  })) }));
  assert.match(renderFreeFaqSections(judged.sections), /\*\*O que acontece depois:\*\* <AConfirmar>A próxima conversa/u);
});

test('juiz omite os dois contextos quando nenhum tem fonte e registra a tarefa', async () => {
  const checked = validateFreeFaqSections({ passos: [task()] }, context);
  const judged = await judgeClaims(checked.sections, context, async (claims) => ({ claims: claims.map((claim) => ({
    id: claim.id, status: claim.section === 'passos' ? 'sustentada' : 'a confirmar',
    reason: 'sem fato', sourceMention: false,
  })) }));
  const published = judged.sections.passos[0];
  assert.deepEqual(published.sobre, []);
  assert.deepEqual(published.depois, []);
  assert.match(renderFreeFaqSections(judged.sections), /### Responsável\n\n1\. No módulo Contatos/u);
  assert.doesNotMatch(renderFreeFaqSections(judged.sections), /<AConfirmar>|O que acontece depois/u);
  assert.match(judged.pending.join(' '), /contexto da tarefa Responsável sem fonte/u);
});

test('juiz conserva o contexto sustentado e marca o outro a confirmar', async () => {
  const checked = validateFreeFaqSections({ passos: [task()] }, context);
  const judged = await judgeClaims(checked.sections, context, async (claims) => ({ claims: claims.map((claim) => ({
    id: claim.id, status: claim.section === 'depois' ? 'a confirmar' : 'sustentada',
    reason: 'sem fato', sourceMention: false,
  })) }));
  const published = judged.sections.passos[0];
  assert.equal(published.sobre[0].text, task().sobre[0].text);
  assert.match(published.depois[0].text, /^<AConfirmar>A próxima conversa/u);
  assert.doesNotMatch(judged.pending.join(' '), /contexto da tarefa Responsável sem fonte/u);
});

test('juiz não confunde a tela do produto com atribuição à fonte', async () => {
  const efeito = 'A tela confirma a alteração e novos atendimentos iniciados pelo cliente podem ser encaminhados ao responsável.';
  const checked = validateFreeFaqSections({ passos: [task({ depois: [{ text: efeito }] })] }, context);
  const judged = await judgeClaims(checked.sections, context, async (claims) => ({ claims: claims.map((claim) => ({
    id: claim.id, status: 'sustentada', reason: '',
    sourceMention: claim.section === 'depois',
  })) }));
  assert.deepEqual(judged.sections.passos[0].depois, [{ text: efeito }]);
  assert.doesNotMatch(judged.pending.join(' '), /frase omitida: mencionava a fonte/u);
});

test('tarefa sem contexto sustentado registra pendência sem travar', () => {
  const checked = validateFreeFaqSections({ passos: [task({ sobre: [], depois: [] })] }, context);
  assert.match(checked.pending.join(' '), /contexto da tarefa Responsável sem fonte/u);
  assert.deepEqual(checked.blocking, []);
});

test('efeito ausente também vira pendência da tarefa', () => {
  const checked = validateFreeFaqSections({ passos: [task({ depois: [] })] }, context);
  assert.match(checked.pending.join(' '), /depois da tarefa Responsável sem fonte.*a confirmar/u);
});
