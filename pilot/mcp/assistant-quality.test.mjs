import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerQuestion, parseAnswer, retrieveContext } from './assistant-service.mjs';
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
await writeFile(join(actionDir, 'busca-central.mdx'), `---\ntitle: "Busca da Central"\ndescription: "Preciso de ajuda com busca da Central."\nsource: produto\ncontentType: faq\n---\n\nPreciso de ajuda: use a busca da Central.\n`);
await writeFile(join(actionDir, 'sugestoes.mdx'), `---\ntitle: "Roteiro editorial de sugestões"\ndescription: "Teste das sugestões do assistente."\nassistantSuggestions: "Primeira dúvida | Segunda dúvida | Primeira dúvida"\n---\n\nRoteiro editorial de sugestões.\n`);
const suggestionSource = (await retrieveContext(testRoot, 'roteiro editorial de sugestões'))
  .find((source) => source.path === '/docs/teste/sugestoes');
assert.deepEqual(suggestionSource?.assistantSuggestions, ['Primeira dúvida', 'Segunda dúvida'], 'lista do frontmatter deve ser lida com separador e sem duplicatas');
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
          answer: 'Basta criar uma saudação e encaminhar para um atendente. Use o bloco Condição para ramificar.',
          sections: [{ title: 'O caminho', items: ['Saudação', 'Condição', 'Encaminhamento'] }],
          steps: [],
          code: null,
          sources: ['/docs/sobre-o-sistema/robo-de-atendimento'],
          suggestions: ['Quer que eu acompanhe você...'],
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
assert.match(guidedRequests[0].input[0].content, /explique.*termo/i, 'resposta para iniciante deve explicar termos do produto quando aparecem');
assert.equal(guidedReply.steps.length, 3, 'primeira resposta ampla deve mostrar os três passos iniciais documentados');
assert.match(guidedReply.steps[0].text, /Robôs[\s\S]*Criar novo Robô/i);
assert.match(guidedReply.steps[1].text, /Título do Robô/i);
assert.match(guidedReply.steps[2].text, /Canais[\s\S]*número[\s\S]*Adicionar robô/i);
assert.match(guidedReply.answer, /Menu de opções/i, 'visão geral deve explicar a possibilidade de ramificação');
assert.match(guidedReply.answer, /^Você pode montar um robô como uma árvore de atendimento:/, 'visão deve começar pela possibilidade do produto');
assert.match(guidedReply.answer, /(?:caminhos|ramifica|árvore)/i);
assert.match(guidedReply.answer, /(?:mais simples|exemplo básico)/i, 'saudação e encaminhamento são apenas um exemplo');
assert.doesNotMatch(JSON.stringify(guidedReply), /Condição|filtro/i, 'bloco inativo não pode aparecer na resposta');
assert.doesNotMatch(JSON.stringify(guidedReply), /\b(?:Continuar|Testar robô|Ativo)\b/i, 'visão não pode inventar botões ou status');
assert.ok(guidedReply.answer.length < 300, 'introdução deve permanecer curta');
assert.equal(guidedReply.steps[0].action?.id, 'abrir-robos');
assert.equal(guidedReply.steps[0].action?.route, '/bot', 'primeira ação deve levar diretamente à tela correta');
assert.equal(guidedReply.steps[0].action?.target, 'robots-create', 'ação deve carregar o alvo do tour no app');
assert.equal(`/bot?ihelpGuide=${guidedReply.steps[0].action.id}`, '/bot?ihelpGuide=abrir-robos');
assert.deepEqual(guidedReply.suggestions, [
  'Pode me guiar etapa por etapa',
  'Quero ver todos os passos',
  'Quero montar um menu com opções',
], 'visão ampla deve trazer a terceira sugestão da fonte, sem sugestão do modelo');

const shownSteps = guidedReply.steps.map((step, index) => `${index + 1}. ${step.text}`).join('\n');
const fullRobotSteps = (await retrieveContext(testRoot, 'como criar chatbot'))
  .find((source) => source.path === '/docs/sobre-o-sistema/robo-de-atendimento').documentedSteps;
const guidedHistory = [
  { role: 'user', content: 'Como criar um chatbot?' },
  { role: 'assistant', content: `${guidedReply.answer}\n${shownSteps}\nFonte usada: /docs/sobre-o-sistema/robo-de-atendimento` },
];
const nextReply = await answerQuestion(testRoot, 'próximo passo', { client: guidedClient, history: guidedHistory });
assert.equal(nextReply.steps.length, 1, 'continuação entrega uma ação por vez');
assert.match(nextReply.steps[0].text, /Iniciar Fluxo[\s\S]*Mensagem do Cliente/i, 'próximo passo deve avançar após os três já mostrados');
const restartedReply = await answerQuestion(testRoot, 'sim, pode me guiar', { client: guidedClient, history: guidedHistory });
assert.equal(restartedReply.answer, 'Vamos começar pelo primeiro passo.', 'entrada no guia não deve anunciar avanço antes de começar');
assert.equal(restartedReply.steps.length, 1, 'entrada no guia entrega uma única ação');
assert.match(restartedReply.steps[0].text, /Criar novo Robô/i, 'aceitar guia progressivo começa pelo primeiro passo');
assert.ok(restartedReply.steps[0].image, 'primeira etapa guiada deve manter o screenshot documentado');
// Guidance do coordenador após avaliação independente: cada confirmação deve servir também para campos, canais e publicação.
const guideSuggestions = ['Concluí este passo', 'Preciso de ajuda'];
assert.deepEqual(restartedReply.suggestions, guideSuggestions);
const afterFirstReply = await answerQuestion(testRoot, 'Concluí este passo', {
  client: guidedClient,
  history: [guidedHistory[0], { role: 'assistant', content: `1. ${restartedReply.steps[0].text}\nFonte usada: /docs/sobre-o-sistema/robo-de-atendimento` }],
});
assert.equal(afterFirstReply.answer, 'Vamos para a próxima ação.', 'confirmação deve anunciar avanço');
assert.match(afterFirstReply.steps[0].text, /Título do Robô/i, 'confirmação no guia avança uma ação');
assert.equal(afterFirstReply.steps[0].image?.src, '/img/help/Vc7GpOtHK4rebqsNycJs.png', 'Título usa o screenshot do formulário, não a lista de Robôs');
assert.deepEqual(afterFirstReply.suggestions, guideSuggestions);
const fieldHelp = await answerQuestion(testRoot, 'Preciso de ajuda', {
  client: guidedClient,
  history: [guidedHistory[0], { role: 'assistant', content: `1. ${afterFirstReply.steps[0].text}\nFonte usada: /docs/sobre-o-sistema/robo-de-atendimento` }],
});
assert.equal(fieldHelp.steps[0].text, afterFirstReply.steps[0].text, 'ajuda com campo não avança');
assert.equal(fieldHelp.steps[0].action, undefined, 'campo sem CTA não deve herdar atalho');
assert.deepEqual(fieldHelp.steps[0].image, afterFirstReply.steps[0].image, 'ajuda mantém o screenshot contextual do campo');
assert.doesNotMatch(fieldHelp.answer, /atalho/i, 'ajuda sem CTA não promete atalho');
const stuckReply = await answerQuestion(testRoot, 'Preciso de ajuda', {
  client: guidedClient,
  history: [guidedHistory[0], { role: 'assistant', content: `1. ${restartedReply.steps[0].text}\nFonte usada: /docs/sobre-o-sistema/robo-de-atendimento` }],
});
assert.equal(stuckReply.steps[0].text, restartedReply.steps[0].text, 'ajuda deve retomar exatamente a etapa atual');
assert.equal(stuckReply.steps[0].action?.id, 'abrir-robos', 'ajuda ao travar deve manter CTA contextual');
assert.deepEqual(stuckReply.steps[0].image, restartedReply.steps[0].image, 'ajuda deve manter screenshot contextual');
assert.match(stuckReply.answer, /Qual botão, campo ou texto aparece na sua tela/i);
assert.match(stuckReply.answer, /(?:botão|campo|controle)[\s\S]*texto/i, 'ajuda pergunta qual controle ou texto aparece');
assert.match(stuckReply.answer, /imagem/i, 'ajuda orienta usar o screenshot disponível');

let currentGuideReply = restartedReply;
for (let stepIndex = 1; stepIndex < 8; stepIndex += 1) {
  const history = [guidedHistory[0], { role: 'assistant', content: `1. ${currentGuideReply.steps[0].text}\nFonte usada: /docs/sobre-o-sistema/robo-de-atendimento` }];
  const next = await answerQuestion(testRoot, 'Concluí este passo', { client: guidedClient, history });
  assert.equal(next.steps.length, 1, `etapa ${stepIndex + 1} deve vir sozinha`);
  assert.equal(next.steps[0].text, fullRobotSteps[stepIndex], `etapa ${stepIndex + 1} não pode ser pulada`);
  assert.deepEqual(next.suggestions, guideSuggestions);
  currentGuideReply = next;
}
assert.match(currentGuideReply.steps[0].text, /Salvar[\s\S]*Publicar/i, 'guia deve chegar ao último passo documentado');
assert.ok(currentGuideReply.steps[0].image, 'passo final deve ter screenshot documentado');
assert.doesNotMatch(JSON.stringify(currentGuideReply), /Testar robô|status Ativo/i);
const finalHelp = await answerQuestion(testRoot, 'Preciso de ajuda', {
  client: guidedClient,
  history: [guidedHistory[0], { role: 'assistant', content: `1. ${currentGuideReply.steps[0].text}\nFonte usada: /docs/sobre-o-sistema/robo-de-atendimento` }],
});
assert.equal(finalHelp.steps[0].text, currentGuideReply.steps[0].text);
assert.deepEqual(finalHelp.steps[0].image, currentGuideReply.steps[0].image);
assert.equal(finalHelp.steps[0].action, undefined, 'ajuda no passo final não deve prometer atalho de criação');
assert.doesNotMatch(finalHelp.answer, /atalho/i, 'sem CTA não deve prometer atalho');
const finishedReply = await answerQuestion(testRoot, 'Concluí este passo', {
  client: guidedClient,
  history: [guidedHistory[0], { role: 'assistant', content: `1. ${currentGuideReply.steps[0].text}\nFonte usada: /docs/sobre-o-sistema/robo-de-atendimento` }],
});
assert.deepEqual(finishedReply.steps, [], 'após Salvar/Publicar o guia não reinicia no primeiro passo');
assert.match(finishedReply.answer, /Publicar[\s\S]*online/i);
assert.match(finishedReply.answer, /Salvar[\s\S]*inativo/i);
assert.doesNotMatch(JSON.stringify(finishedReply), /Testar robô|status Ativo/i);
const falseActivationClient = { responses: { create: async () => ({
  model: 'gpt-test', output_text: JSON.stringify({
    answer: 'Clique em Ativar robô para deixar o status Ativo.', sections: [],
    steps: [{ text: 'Clique em Ativar robô.', actionId: null, imagePath: null }],
    code: null, sources: ['/docs/sobre-o-sistema/robo-de-atendimento'], suggestions: [], resolution: 'complete', found: true,
  }),
}) } };
for (const alias of ['Concluí', 'feito', 'terminei', 'pronto', 'preenchi os campos']) {
  const aliasReply = await answerQuestion(testRoot, alias, {
    client: falseActivationClient,
    history: [guidedHistory[0], { role: 'assistant', content: `1. ${currentGuideReply.steps[0].text}\nFonte usada: /docs/sobre-o-sistema/robo-de-atendimento` }],
  });
  assert.deepEqual(aliasReply.steps, [], `${alias}: último passo não pode reiniciar`);
  assert.match(aliasReply.answer, /Publicar[\s\S]*online/i, `${alias}: conclusão deve ser grounded`);
  assert.match(aliasReply.answer, /Salvar[\s\S]*inativo/i, `${alias}: conclusão deve distinguir salvar`);
  assert.doesNotMatch(JSON.stringify(aliasReply), /Ativar robô|status Ativo/i);
}

const hostileGuideClient = { responses: { create: async (request) => {
  const helping = /Pergunta: Preciso de ajuda/.test(request.input.at(-1).content);
  return { model: 'gpt-test', output_text: JSON.stringify({
    answer: helping ? 'Use a busca da Central.' : 'Ativar robô deixa o status Ativo.',
    sections: [],
    steps: [
      { text: 'Abra Robôs e depois me diga se encontrou o botão.', actionId: null, imagePath: null },
      { text: 'Clique em Testar robô.', actionId: null, imagePath: null },
    ],
    code: null,
    sources: [helping ? '/docs/teste/busca-central' : '/docs/sobre-o-sistema/robo-de-atendimento'],
    suggestions: [], resolution: 'complete', found: true,
  }) };
} } };
const hostileHistory = [guidedHistory[0], { role: 'assistant', content: 'Fonte usada: /docs/sobre-o-sistema/robo-de-atendimento' }];
let hostileReply = await answerQuestion(testRoot, 'sim, pode me guiar', { client: hostileGuideClient, history: hostileHistory });
assert.deepEqual(hostileReply.steps.map(({ text }) => text), [fullRobotSteps[0]], 'entrada no guia usa passo documental mesmo sem histórico numerado');
assert.equal(hostileReply.steps[0].action?.id, 'abrir-robos');
assert.equal(hostileReply.steps[0].image?.src, '/img/help/q4tBz2R7cevwT94eUQKB.png');
const hostileHelp = await answerQuestion(testRoot, 'Preciso de ajuda', {
  client: hostileGuideClient,
  history: [hostileHistory[0], { role: 'assistant', content: `1. ${hostileReply.steps[0].text}\nFonte usada: /docs/sobre-o-sistema/robo-de-atendimento` }],
});
assert.deepEqual(hostileHelp.steps.map(({ text }) => text), [fullRobotSteps[0]], 'ajuda não aceita passo reescrito pelo modelo');
assert.equal(hostileHelp.steps[0].action?.id, 'abrir-robos');
assert.equal(hostileHelp.steps[0].image?.src, '/img/help/q4tBz2R7cevwT94eUQKB.png');
assert.deepEqual(hostileHelp.sources.map(({ path }) => path), ['/docs/sobre-o-sistema/robo-de-atendimento'], 'ajuda mantém fonte do histórico');
assert.doesNotMatch(hostileHelp.answer, /busca da Central|Ativar robô/i);
for (let index = 1; index < fullRobotSteps.length; index += 1) {
  hostileReply = await answerQuestion(testRoot, 'Concluí este passo', {
    client: hostileGuideClient,
    history: [hostileHistory[0], { role: 'assistant', content: `1. ${hostileReply.steps[0].text}\nFonte usada: /docs/sobre-o-sistema/robo-de-atendimento` }],
  });
  assert.deepEqual(hostileReply.steps.map(({ text }) => text), [fullRobotSteps[index]], `modelo não pode dividir/pular o passo ${index + 1}`);
}
assert.match(hostileReply.steps[0].text, /Salvar[\s\S]*Publicar/i);

const continuedReply = await answerQuestion(testRoot, 'sim, pode me guiar', {
  client: guidedClient,
  history: [
    { role: 'user', content: 'Como criar um chatbot?' },
    { role: 'assistant', content: 'Vamos criar juntos.\nFonte usada: /docs/sobre-o-sistema/robo-de-atendimento' },
  ],
});
assert.match(guidedRequests.at(-1).input.at(-1).content, /FONTE 1: Robô de Atendimento/, 'continuação curta deve recuperar a fonte usada na conversa');
assert.equal(continuedReply.steps.length, 1, 'continuação guiada deve entregar uma etapa pequena por vez');
assert.deepEqual(
  continuedReply.suggestions,
  ['Concluí este passo', 'Preciso de ajuda'],
  'continuação guiada deve oferecer confirmações simples para um iniciante',
);
const verboseGuideClient = { responses: { create: async () => ({
  model: 'gpt-test', output_text: JSON.stringify({
    answer: 'Vamos por etapas.', sections: [],
    steps: [
      { text: fullRobotSteps[0], actionId: 'abrir-robos', imagePath: null },
      { text: fullRobotSteps[1], actionId: null, imagePath: null },
    ],
    code: null, sources: ['/docs/sobre-o-sistema/robo-de-atendimento'], suggestions: [], resolution: 'complete', found: true,
  }),
}) } };
const boundedGuideReply = await answerQuestion(testRoot, 'sim, pode me guiar', {
  client: verboseGuideClient,
  history: [guidedHistory[0], { role: 'assistant', content: 'Fonte usada: /docs/sobre-o-sistema/robo-de-atendimento' }],
});
assert.equal(boundedGuideReply.steps.length, 1, 'guia limita a uma ação mesmo quando o modelo oferece várias');

const changedTopicRequests = [];
const changedTopicClient = {
  responses: {
    create: async (request) => {
      changedTopicRequests.push(request);
      return {
        model: 'gpt-test',
        output_text: JSON.stringify({
          answer: 'Vamos preparar sua primeira campanha.',
          sections: [],
          steps: [],
          code: null,
          sources: ['/docs/sobre-o-sistema/campanhas/como-criar-uma-nova-campanha'],
          suggestions: ['Como preparo a planilha?'],
          resolution: 'complete',
          found: true,
        }),
      };
    },
  },
};
const changedTopicReply = await answerQuestion(testRoot, 'Pode explicar como criar uma campanha?', {
  client: changedTopicClient,
  history: [
    { role: 'user', content: 'Como criar um robô?' },
    { role: 'assistant', content: 'Fonte usada: /docs/sobre-o-sistema/robo-de-atendimento' },
  ],
});
assert.doesNotMatch(changedTopicRequests[0].input[0].content, /MODO: acompanhamento guiado/i, 'troca de assunto não pode continuar o guia anterior');
assert.match(changedTopicRequests[0].input[0].content, /MODO: visão geral conversacional/i, 'novo procedimento amplo deve iniciar uma nova visão geral');
assert.equal(changedTopicReply.steps.length, 1, 'procedimento em prosa deve fornecer a primeira ação mesmo se o modelo omitir steps');
assert.match(changedTopicReply.steps[0].text, /antes de|prepare|acesse/i, 'fallback deve começar por uma ação documentada da campanha');
assert.equal(changedTopicReply.steps[0].image, undefined, 'fallback não pode associar um print só pela posição no artigo');
assert.deepEqual(
  changedTopicReply.suggestions,
  ['Pode me guiar etapa por etapa', 'Quero ver todos os passos'],
  'sem sugestões no artigo, a visão geral deve ignorar a proposta do modelo',
);
assert.doesNotMatch(
  continuedReply.answer,
  /Na lista de Robôs, clique em “Criar novo Robô”/i,
  'a introdução não deve repetir a instrução exibida no passo',
);

const fullGuideReply = await answerQuestion(testRoot, 'mostre todos os passos para criar um robô', { client: guidedClient });
assert.match(guidedRequests.at(-1).input[0].content, /passo a passo completo/i, 'pedido explícito deve ativar o modo detalhado');
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
const screenshotReply = await answerQuestion(testRoot, 'mostre todos os passos para criar um robô', { client: screenshotClient });
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
const omittedScreenshotReply = await answerQuestion(testRoot, 'mostre todos os passos para criar um robô', { client: omittedScreenshotClient });
const robotArticle = await readFile(join(testRoot, 'content/docs/docs/sobre-o-sistema/robo-de-atendimento.mdx'), 'utf8');
assert.equal([...robotArticle.matchAll(/\/img\/help\/Vc7GpOtHK4rebqsNycJs\.png/g)].length, 1, 'screenshot do formulário aparece uma só vez no artigo');
assert.match(robotArticle, /Encaminhar atendimento/i, 'guia básico precisa ensinar um destino funcional para o fluxo');
assert.match(robotArticle, /Salvar[\s\S]{0,240}Publicar/i, 'guia precisa explicar a diferença entre salvar e publicar');
assert.match(robotArticle, /Canais[\s\S]{0,180}números/i, 'guia precisa explicar o que são canais');
assert.match(robotArticle, /Gatilho[\s\S]{0,220}inicia/i, 'guia precisa explicar o que é gatilho');
assert.match(robotArticle, /Departamento[\s\S]{0,260}fila/i, 'guia precisa explicar a diferença de destino para iniciantes');
assert.match(robotArticle, /<ProductAction id="abrir-robos"/i, 'guia precisa levar a pessoa diretamente para a tela de robôs');
assert.match(robotArticle, /Menu de opções[\s\S]{0,240}(?:ramifica|árvore|caminhos)/i, 'artigo deve explicar a ramificação para iniciantes');
const menuPath = '/docs/sobre-o-sistema/menu-de-opcoes-do-robo';
const menuQuestion = 'Quero montar um menu com opções';
const menuSources = await retrieveContext(testRoot, menuQuestion);
assert.equal(menuSources[0]?.path, menuPath, 'pergunta editorial exata deve priorizar o procedimento do Menu de opções');
const menuArticle = await readFile(join(testRoot, 'content/docs', `${menuPath.slice(1)}.mdx`), 'utf8');
assert.match(menuArticle, /Adicionar bloco[\s\S]*Menu de opções/i);
assert.match(menuArticle, /título do bloco[\s\S]*Bloco de pergunta/i);
assert.match(menuArticle, /Adicionar opção \+[\s\S]*rótulo/i);
assert.match(menuArticle, /Adicionar bloco[\s\S]*ramificaç[\s\S]*Publicar/i);
assert.match(menuArticle, /\/img\/help\/mBfKLzgI06X5bYCR0z2i\.png/);
assert.doesNotMatch(menuArticle, /Condição|Testar robô/i);
const menuReply = await answerQuestion(testRoot, menuQuestion, { client: guidedClient });
assert.deepEqual(menuReply.sources.map(({ path }) => path), [menuPath], 'resposta exata não mistura o guia genérico');
assert.match(menuReply.answer, /Menu de opções/i);
assert.match(menuReply.steps[1].text, /Menu de opções/i);
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
assert.doesNotMatch(actionComponent, /Abre a tela Contatos no iHelp/i, 'descrição do CTA não pode ficar presa à ação de Contatos');
assert.doesNotMatch(actionComponent, /destaca onde começar/i, 'CTA público não pode prometer tour antes do handler chegar ao app');
assert.match(actionComponent, /Abre.*no iHelp/i, 'CTA deve explicar apenas a navegação já disponível em produção');

console.log("Claricia para iniciantes passou.");
