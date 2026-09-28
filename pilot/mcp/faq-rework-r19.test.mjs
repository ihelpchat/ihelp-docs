import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicFaqAnswer, faqTasksWithoutFacts, missingFaqTaskSteps,
  missingFreeFaqTaskSteps } from './faq-editorial.mjs';

const sha = 'a'.repeat(40);
const fact = (text, line) => ({ kind: 'action', text, repository: 'ihelpchat/front-react',
  path: 'src/Fixture.tsx', lineStart: line, lineEnd: line, sha });

test('pedido completo exige ativar o robô mesmo com details genérico', () => {
  const request = { topic: 'Robô', description: 'Criar e ativar um robô.', details: 'Para iniciantes.' };
  const facts = [fact('Criar novo robô', 2), fact('Publicar', 3)];
  const steps = [{ tarefa: 'Criar', passos: [{ text: 'Clique em **Criar novo robô**.' }] }];
  assert.deepEqual(missingFreeFaqTaskSteps(request, facts, steps), ['tarefa sem passo: ativar']);
  assert.deepEqual(missingFaqTaskSteps(request, facts, [{ citations: [{ repository: facts[0].repository,
    path: facts[0].path, lineStart: 2, lineEnd: 2, sha }] }]), ['tarefa sem passo: ativar']);
  assert.match(deterministicFaqAnswer(request, facts)?.text ?? '', /criar e publicar/u);
});

test('topic Buscar/Exportar relatórios alimenta plano, completude e resposta', () => {
  const request = { topic: 'Buscar/Exportar relatórios', description: 'Guia para iniciantes.', details: 'Passos simples.' };
  const facts = [{ ...fact('Relatórios', 3), kind: 'route' },
    fact('Buscar relatório', 4), fact('Exportar relatório', 5)];
  assert.deepEqual(faqTasksWithoutFacts(request, facts.slice(0, 2)), ['Exportar']);
  assert.deepEqual(missingFreeFaqTaskSteps(request, facts, [
    { tarefa: 'Buscar', passos: [{ text: 'Clique em **Buscar relatório**.' }] },
  ]), ['tarefa sem passo: exportar']);
  assert.match(deterministicFaqAnswer(request, facts)?.text ?? '', /buscar e exportar uma lista/u);
});
