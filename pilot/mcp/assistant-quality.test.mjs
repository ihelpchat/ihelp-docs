import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerQuestion, parseAnswer } from './assistant-service.mjs';
import { renderArticle, validateArticle } from './content-service.mjs';
import allowedActions from '../architecture/product-actions.json' with { type: 'json' };

const projectRoot = new URL('../', import.meta.url).pathname;
const testRoot = await mkdtemp(join(tmpdir(), 'ihelp-docs-quality-'));
await cp(join(projectRoot, 'architecture'), join(testRoot, 'architecture'), { recursive: true });
await cp(join(projectRoot, 'content'), join(testRoot, 'content'), { recursive: true });

let internalCalls = 0;
const internalReply = await answerQuestion(testRoot, 'Tem MCP?', {
  client: { responses: { create: async () => { internalCalls += 1; throw new Error('não deveria chamar o modelo'); } } },
});
assert.equal(internalCalls, 0, 'MCP interno não deve entrar no RAG público');
assert.equal(internalReply.found, false);
assert.match(internalReply.answer, /MCP do iHelp.*em breve/i);
assert.doesNotMatch(internalReply.answer, /documentaç|Node\.js|Git/i);

const actionDir = join(testRoot, 'content/docs/docs/teste');
await mkdir(actionDir, { recursive: true });
await writeFile(join(actionDir, 'importar-contatos.mdx'), `---\ntitle: "Importar contatos"\ndescription: "Aprenda a importar contatos pela tela correta do iHelp."\nsource: produto\ncontentType: tutorial\n---\n\nAbra a lista de contatos e use o menu de opções para iniciar a importação.\n\n<ProductAction id="importar-contatos" label="Ir para importar contatos" route="/contact" target="contacts-more-options" />\n`);

const beginnerClient = {
  responses: {
    create: async (request) => {
      const prompt = request.input[0].content;
      assert.match(prompt, /primeiros 30 segundos|acabou de acessar/i);
      assert.match(prompt, /onde começar/i);
      assert.match(request.input.at(-1).content, /AÇÃO importar-contatos/);
      return {
        model: 'gpt-test',
        output_text: JSON.stringify({
          answer: 'Comece abrindo Contatos no menu lateral.',
          sections: [],
          steps: [
            { text: 'Abra Contatos no menu lateral.', actionId: 'importar-contatos' },
            { text: 'Acesse Contatos pelo menu lateral.', actionId: 'importar-contatos' },
            { text: 'Clique em Mais opções e escolha Importar contatos.', actionId: null },
            { text: 'Acesse Contatos pelo menu lateral e escolha Exportar.', actionId: null },
          ],
          code: null,
          sources: ['/docs/teste/importar-contatos'],
          suggestions: [],
          resolution: 'complete',
          found: true,
        }),
      };
    },
  },
};
const beginnerReply = await answerQuestion(testRoot, 'como importar contatos', { client: beginnerClient });
assert.equal(beginnerReply.steps.length, 3, 'verbos equivalentes devem consolidar o mesmo destino sem apagar resultado diferente');
assert.match(beginnerReply.steps[2].text, /Exportar/, 'ação com resultado diferente deve permanecer');
assert.doesNotMatch(beginnerReply.answer, /comece abrindo contatos no menu lateral/i, 'answer não pode repetir a instrução do primeiro passo');
assert.ok(beginnerReply.answer.trim(), 'a conclusão precisa continuar legível após deduplicar');
assert.deepEqual(beginnerReply.steps[0], {
  text: 'Abra Contatos no menu lateral.',
  action: {
    id: 'importar-contatos',
    label: 'Abrir a tela Contatos',
    route: '/contact',
    target: 'contacts-more-options',
  },
});
assert.doesNotMatch(beginnerReply.steps[0].action.label, /importar contatos/i, 'CTA não pode prometer a importação quando só abre Contatos');

const guidedRequests = [];
const guidedClient = {
  responses: {
    create: async (request) => {
      guidedRequests.push(request);
      return {
        model: 'gpt-test',
        output_text: JSON.stringify({
          answer: 'Vamos criar seu primeiro robô juntos.',
          sections: [],
          steps: [],
          code: null,
          sources: ['/docs/sobre-o-sistema/robo-de-atendimento'],
          suggestions: [],
          resolution: 'complete',
          found: true,
        }),
      };
    },
  },
};
const guidedReply = await answerQuestion(testRoot, 'como criar um chatbot?', { client: guidedClient });
assert.equal(guidedRequests[0].reasoning.effort, 'medium', 'perguntas guiadas precisam de raciocínio suficiente para usar a fonte inteira');
assert.match(guidedRequests[0].input.at(-1).content, /PASSOS DOCUMENTADOS:/);
assert.match(guidedRequests[0].input.at(-1).content, /TELAS DOCUMENTADAS:/);
assert.match(guidedRequests[0].input.at(-1).content, /MÍDIA DISPONÍVEL: vídeo/i);
assert.match(guidedRequests[0].input[0].content, /visão geral conversacional/i, 'pedido amplo deve iniciar com visão geral, sem despejar o manual');
assert.equal(guidedReply.steps.length, 0, 'primeira resposta ampla deve convidar a pessoa para o guia, sem despejar todos os passos');
assert.ok(guidedReply.suggestions.some((suggestion) => /passo a passo/i.test(suggestion)), 'resposta procedural deve convidar continuação guiada');

const continuedReply = await answerQuestion(testRoot, 'sim, pode me guiar', {
  client: guidedClient,
  history: [
    { role: 'user', content: 'Como criar um chatbot?' },
    { role: 'assistant', content: 'Vamos criar juntos.\nFonte usada: /docs/sobre-o-sistema/robo-de-atendimento' },
  ],
});
assert.match(guidedRequests[1].input.at(-1).content, /FONTE 1: Robô de Atendimento/, 'continuação curta deve recuperar a fonte usada na conversa');
assert.equal(continuedReply.steps.length, 1, 'continuação guiada deve entregar uma etapa pequena por vez');
assert.ok(continuedReply.suggestions.some((suggestion) => /concluí|encontrei/i.test(suggestion)), 'continuação guiada deve perguntar pelo resultado do passo');

const fullGuideReply = await answerQuestion(testRoot, 'mostre todos os passos para criar um chatbot', { client: guidedClient });
assert.match(guidedRequests[2].input[0].content, /passo a passo completo/i, 'pedido explícito deve ativar o modo detalhado');
assert.ok(fullGuideReply.steps.length >= 5, 'modo detalhado deve recuperar o procedimento documentado completo');
assert.ok(fullGuideReply.steps.some((step) => step.image), 'modo detalhado deve incluir telas documentadas relevantes');

const screenshotClient = {
  responses: {
    create: async () => ({
      model: 'gpt-test',
      output_text: JSON.stringify({
        answer: 'Abra a criação do robô.', sections: [],
        steps: [
          { text: 'Clique em Criar novo robô.', actionId: null, imagePath: '/img/help/q4tBz2R7cevwT94eUQKB.png' },
          { text: 'Ignore esta imagem inventada.', actionId: null, imagePath: '/img/help/inventada.png' },
        ],
        code: null, sources: ['/docs/sobre-o-sistema/robo-de-atendimento'], suggestions: [], resolution: 'complete', found: true,
      }),
    }),
  },
};
const screenshotReply = await answerQuestion(testRoot, 'como criar um robô', { client: screenshotClient });
assert.equal(screenshotReply.steps[0].image?.src, '/img/help/q4tBz2R7cevwT94eUQKB.png');
assert.equal(screenshotReply.steps[1].image, undefined, 'imagem que não pertence à fonte não pode chegar à interface');

const omittedScreenshotClient = {
  responses: {
    create: async () => ({
      model: 'gpt-test',
      output_text: JSON.stringify({
        answer: 'Vamos criar o robô juntos.', sections: [],
        steps: [
          { text: 'Acesse o menu Robô.', actionId: null, imagePath: null },
          { text: 'Clique em Criar novo robô.', actionId: null, imagePath: null },
          { text: 'Defina o nome do robô.', actionId: null, imagePath: null },
        ],
        code: null, sources: ['/docs/sobre-o-sistema/robo-de-atendimento'], suggestions: [], resolution: 'complete', found: true,
      }),
    }),
  },
};
const omittedScreenshotReply = await answerQuestion(testRoot, 'como criar um chatbot?', { client: omittedScreenshotClient });
const robotArticle = await readFile(join(testRoot, 'content/docs/docs/sobre-o-sistema/robo-de-atendimento.mdx'), 'utf8');
assert.match(robotArticle, /Encaminhar atendimento/i, 'guia básico precisa ensinar um destino funcional para o fluxo');
assert.match(robotArticle, /Salvar[\s\S]{0,240}Publicar/i, 'guia precisa explicar a diferença entre salvar e publicar');
assert.match(robotArticle, /<ProductAction id="abrir-robos"/i, 'guia precisa levar a pessoa diretamente para a tela de robôs');
const robotScreenshotPaths = new Set([...robotArticle.matchAll(/!\[[^\]]*\]\((\/img\/[^)]+)\)/g)].map((match) => match[1]));
assert.ok(omittedScreenshotReply.steps.some((step) => step.image), 'quando o modelo omitir todas as telas, o servidor deve anexar um print relevante');
assert.ok(
  omittedScreenshotReply.steps.every((step) => !step.image || robotScreenshotPaths.has(step.image.src)),
  'fallback de telas continua restrito aos arquivos da fonte recuperada',
);

const keyedSteps = (texts) => parseAnswer(JSON.stringify({ answer: 'Veja os passos.', steps: texts.map((text) => ({ text, actionId: null })) })).steps.map(({ text }) => text);
assert.deepEqual(keyedSteps(['Abra Contatos no menu lateral.', 'Acesse Contatos pelo menu lateral.']), ['Abra Contatos no menu lateral.']);
assert.deepEqual(keyedSteps(['Abra o item 1 no menu lateral.', 'Acesse o item 2 pelo menu lateral.']), ['Abra o item 1 no menu lateral.', 'Acesse o item 2 pelo menu lateral.']);
assert.deepEqual(keyedSteps(['Abra a opção A.', 'Acesse a opção B.']), ['Abra a opção A.', 'Acesse a opção B.']);
assert.deepEqual(keyedSteps(['Abra a opção A.', 'Acesse opção A.']), ['Abra a opção A.'], 'artigo a não deve virar seletor');
assert.deepEqual(keyedSteps(['Abra Contatos e escolha Importar.', 'Acesse Contatos e escolha Exportar.']), ['Abra Contatos e escolha Importar.', 'Acesse Contatos e escolha Exportar.']);
assert.deepEqual(keyedSteps(['Abra o botão OK.', 'Acesse o botão Ir.']), ['Abra o botão OK.', 'Acesse o botão Ir.']);
assert.deepEqual(keyedSteps(['Abra UI.', 'Acesse Ir.']), ['Abra UI.', 'Acesse Ir.']);
assert.deepEqual(keyedSteps(['Abra o plano A.', 'Acesse o plano B.']), ['Abra o plano A.', 'Acesse o plano B.']);
assert.deepEqual(keyedSteps(['Abra o seletor A.', 'Acesse o seletor B.']), ['Abra o seletor A.', 'Acesse o seletor B.']);
assert.deepEqual(keyedSteps(['Abra a coluna A.', 'Acesse a coluna E.', 'Abra a coluna O.']), ['Abra a coluna A.', 'Acesse a coluna E.', 'Abra a coluna O.']);
assert.deepEqual(keyedSteps(['Abra a coluna A.', 'Acesse coluna A.']), ['Abra a coluna A.'], 'artigo minúsculo a permanece descartável');
assert.deepEqual(keyedSteps(['Abra a opção A.', 'Acesse opção A.']), ['Abra a opção A.']);

const trustedAction = { id: 'importar-contatos', ...allowedActions['importar-contatos'] };
const articleWithAction = {
  path: 'docs/teste/acao-confiavel', title: 'Ação confiável',
  description: 'Procedimento seguro para abrir a tela de Contatos na documentação do iHelp.',
  source: 'produto', contentType: 'tutorial',
  body: 'Abra Contatos pelo menu lateral e confira a lista antes de continuar. Veja as opções disponíveis na tela e escolha a operação que precisa realizar. Revise o resultado mostrado pelo produto antes de confirmar qualquer mudança. Se alguma informação estiver incorreta, volte para a lista e faça a correção necessária. Ao terminar, pesquise um contato para confirmar que a tela apresenta os dados esperados. Repita a consulta com outro contato se precisar comparar os resultados.',
  productActions: [trustedAction],
};
assert.equal(validateArticle(articleWithAction).valid, true, 'ação idêntica ao catálogo deve ser aceita');
for (const action of [
  { ...trustedAction, id: 'acao-inventada' },
  { ...trustedAction, route: '/reports' },
  { ...trustedAction, target: 'wrong-target' },
  { ...trustedAction, label: 'Importar contatos automaticamente' },
]) {
  const invalid = { ...articleWithAction, productActions: [action] };
  assert.equal(validateArticle(invalid).valid, false, `ação divergente deve falhar: ${JSON.stringify(action)}`);
  assert.throws(() => renderArticle(invalid), /productActions/, 'ação inválida não pode ser renderizada');
}

const modelWithAction = (actionId, path) => ({ responses: { create: async () => ({
  model: 'gpt-test', output_text: JSON.stringify({ answer: 'Abra Contatos.', sections: [], steps: [{ text: 'Abra Contatos.', actionId }], code: null, sources: [path], suggestions: [], resolution: 'complete', found: true }),
}) } });
const invented = await answerQuestion(testRoot, 'importar contatos', { client: modelWithAction('acao-inventada', '/docs/teste/importar-contatos') });
assert.equal(invented.steps[0].action, undefined, 'actionId inventado não pode usar a primeira ação da fonte');

for (const [slug, route, target] of [['rota-divergente', '/reports', 'contacts-more-options'], ['alvo-divergente', '/contact', 'wrong-target']]) {
  await writeFile(join(actionDir, `${slug}.mdx`), `---\ntitle: "${slug}"\ndescription: "Guia para verificar ação de produto com ${slug}."\nsource: produto\ncontentType: tutorial\n---\n\nAbra Contatos para ${slug.replace('-', ' ')}.\n\n<ProductAction id="importar-contatos" label="Abrir Contatos" route="${route}" target="${target}" />\n`);
  const reply = await answerQuestion(testRoot, slug.replace('-', ' '), { client: modelWithAction('importar-contatos', `/docs/teste/${slug}`) });
  assert.equal(reply.steps[0].action, undefined, `${slug} não pode virar ação`);
}
await writeFile(join(actionDir, 'sem-acao.mdx'), `---\ntitle: "Importar contatos sem ação"\ndescription: "Artigo de importação sem CTA de produto."\nsource: produto\ncontentType: faq\n---\n\nAbra Contatos e veja as opções de importação.\n`);
const wrongSource = await answerQuestion(testRoot, 'importar contatos', { client: modelWithAction('importar-contatos', '/docs/teste/sem-acao') });
assert.equal(wrongSource.steps[0].action, undefined, 'ação de outra fonte não pode acompanhar a fonte citada');
const actionComponent = await readFile(join(projectRoot, 'components/product-action.tsx'), 'utf8');
assert.doesNotMatch(actionComponent, /exatamente na tela deste passo/i, 'CTA ainda promete abertura exata antes da integração no app');

console.log("Claricia para iniciantes passou.");
