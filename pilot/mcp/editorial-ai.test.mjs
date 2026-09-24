import assert from 'node:assert/strict';
import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateContentPackage, planContent } from './content-ai-service.mjs';
import { renderArticle } from './content-service.mjs';

const projectRoot = new URL('../', import.meta.url).pathname;
const testRoot = await mkdtemp(join(tmpdir(), 'ihelp-docs-ai-'));
await cp(join(projectRoot, 'architecture'), join(testRoot, 'architecture'), { recursive: true });
await cp(join(projectRoot, 'content'), join(testRoot, 'content'), { recursive: true });

const aiClient = {
  responses: {
    create: async (request) => {
      assert.doesNotMatch(request.input.at(-1).content, /11987654321|123\.456\.789-09/, 'PII no path não pode entrar no prompt');
      if (request.text.format.name === 'plano_documentacao') {
        return { model: 'gpt-test', output_text: JSON.stringify({
          status: 'ready',
          guidance: 'Crie uma FAQ curta e um tutorial para iniciantes.',
          questions: [],
          risks: ['Confirmar a extensão aceita pela importação.'],
          suggestedActions: [{ id: 'importar-contatos', label: 'Ir para importar contatos', route: '/contact', target: 'contacts-more-options' }],
        }) };
      }
      return { model: 'gpt-test', output_text: JSON.stringify({
        status: 'ready',
        summary: 'Pacote pronto para revisão.',
        questions: [],
        articles: [
          {
            path: 'docs/sobre-o-sistema/importar-contatos',
            title: 'Como importar contatos',
            description: 'Aprenda a preparar e importar contatos na sua conta do iHelp.',
            source: 'produto',
            contentType: 'faq',
            body: 'Abra o menu Contatos e confira se a planilha contém nome e telefone. No canto superior direito, abra Mais opções e selecione Importar contatos. Escolha o arquivo, confira o mapeamento das colunas e avance para validar os dados. Corrija linhas inválidas antes de concluir. Ao finalizar, confirme se os contatos aparecem na lista. Se algum item não entrar, confira o código do país e tente novamente com apenas as linhas corrigidas. Esse processo mantém os contatos válidos e mostra o andamento da importação na própria tela.',
            productActions: [{ id: 'importar-contatos', label: 'Abrir a tela Contatos', route: '/contact', target: 'contacts-more-options' }],
          },
          {
            path: 'tutoriais/contatos/importar-contatos',
            title: 'Importar contatos passo a passo',
            description: 'Siga cada etapa para importar sua primeira lista de contatos no iHelp.',
            source: 'produto',
            contentType: 'tutorial',
            body: 'Antes de começar, deixe a planilha pronta com nome e telefone. Abra Contatos pelo menu lateral. No canto superior direito, abra Mais opções e escolha Importar contatos. Selecione o arquivo e confira as colunas reconhecidas. Ajuste o mapeamento quando necessário e avance para a validação. Revise as linhas sinalizadas e corrija os dados antes de confirmar. Inicie a importação e acompanhe o progresso na tela. Quando terminar, pesquise um contato da planilha para confirmar que o cadastro foi criado corretamente. Caso algum contato não apareça, revise o telefone e o código do país.',
            productActions: [{ id: 'importar-contatos', label: 'Abrir a tela Contatos', route: '/contact', target: 'contacts-more-options' }],
          },
        ],
      }) };
    },
  },
};

const request = {
  topic: 'Importar contatos',
  module: 'Contatos',
  description: 'Ensinar um cliente novo a importar a primeira planilha.',
  details: 'A tela atual fica em /contact e a importação começa no menu Mais opções.',
  audience: 'Cliente em trial sem treinamento',
};
await assert.rejects(planContent(testRoot, { ...request, details: 'Cliente bruno@example.com perguntou sobre a importação.' }, { client: { responses: { create: async () => { throw new Error('modelo foi chamado'); } } } }), /dado pessoal/i);
await assert.rejects(generateContentPackage(testRoot, { ...request, details: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456' }, { client: { responses: { create: async () => { throw new Error('modelo foi chamado'); } } } }), /credencial/i);
const plan = await planContent(testRoot, request, { client: aiClient });
assert.equal(plan.status, 'ready');
assert.equal(plan.suggestedActions[0].route, '/contact');
await planContent(testRoot, request, { client: aiClient, productContext: {
  code: [], matches: [{ repository: 'ihelpchat/front-react', ref: 'test', role: 'frontend', path: 'src/Contacts/CPF-123.456.789-09-phone-11987654321.tsx', excerpt: 'Tela Contatos' }],
  support: { categories: [], rules: [] }, coverage: [],
} });
const generated = await generateContentPackage(testRoot, request, { client: aiClient });
assert.equal(generated.articles.length, 2);
assert.deepEqual(generated.articles.map(({ contentType }) => contentType), ['faq', 'tutorial']);
assert.ok(generated.articles.every(({ productActions }) => productActions.length === 1));

const rendered = renderArticle(generated.articles[0]);
assert.match(rendered, /<ProductAction id="importar-contatos"/);
assert.doesNotMatch(rendered, /VideoEmbed|video/i);


console.log("Planejamento e geração editorial passaram.");
