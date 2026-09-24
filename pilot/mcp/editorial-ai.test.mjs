import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const projectRoot = new URL('../', import.meta.url).pathname;
const testRoot = await mkdtemp(join(tmpdir(), 'ihelp-docs-ai-'));
await cp(join(projectRoot, 'architecture'), join(testRoot, 'architecture'), { recursive: true });
await cp(join(projectRoot, 'content'), join(testRoot, 'content'), { recursive: true });
await cp(join(projectRoot, 'mcp'), join(testRoot, 'mcp'), { recursive: true });
await symlink(join(projectRoot, 'node_modules'), join(testRoot, 'node_modules'), 'dir');
const catalogPath = join(testRoot, 'architecture/product-actions.json');
const fixtureCatalog = JSON.parse(await readFile(catalogPath, 'utf8'));
fixtureCatalog['abrir-relatorios'] = { label: 'Abrir Relatórios', route: '/relatorio', target: null };
await writeFile(catalogPath, JSON.stringify(fixtureCatalog));
const { generateContentPackage, planContent, normalizeCatalogLabel } = await import(new URL(`file://${join(testRoot, 'mcp/content-ai-service.mjs')}`));
const { renderArticle } = await import(new URL(`file://${join(testRoot, 'mcp/content-service.mjs')}`));
assert.deepEqual(normalizeCatalogLabel({ id: 'abrir-relatorios', label: 'Label inventado', route: '/relatorio', target: null }), { id: 'abrir-relatorios', label: 'Abrir Relatórios', route: '/relatorio', target: null });
for (const divergent of [
  { id: 'importar-contatos', label: 'Label inventado', route: '/relatorio', target: 'contacts-more-options' },
  { id: 'importar-contatos', label: 'Label inventado', route: '/contact', target: 'outro-alvo' },
]) assert.deepEqual(normalizeCatalogLabel(divergent), divergent, 'destino divergente não pode receber label confiável');

const aiClient = {
  responses: {
    create: async (request) => {
      assert.doesNotMatch(request.input.at(-1).content, /11987654321|123\.456\.789-09|sk-proj-abcdefghijklmnop1234567890|alphaBetaGammaDeltaEpsilon|bravoCharlieDeltaEchoFoxtrot|charlieDeltaEchoFoxtrotGolf/, 'PII e credenciais não podem entrar no prompt');
      if (request.text.format.name === 'plano_documentacao') {
        return { model: 'gpt-test', output_text: JSON.stringify({
          status: 'ready',
          guidance: 'Crie uma FAQ curta e um tutorial para iniciantes.',
          questions: [],
          risks: ['Confirmar a extensão aceita pela importação.'],
          suggestedActions: [
            { id: 'importar-contatos', label: 'Ir para importar contatos', route: '/contact', target: 'contacts-more-options' },
            { id: 'abrir-relatorios', label: 'Label inventado', route: '/relatorio', target: null },
          ],
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
            productActions: [{ id: 'importar-contatos', label: 'Ir para importar contatos', route: '/contact', target: 'contacts-more-options' }, { id: 'abrir-relatorios', label: 'Label inventado', route: '/relatorio', target: null }],
          },
          {
            path: 'tutoriais/contatos/importar-contatos',
            title: 'Importar contatos passo a passo',
            description: 'Siga cada etapa para importar sua primeira lista de contatos no iHelp.',
            source: 'produto',
            contentType: 'tutorial',
            body: 'Antes de começar, deixe a planilha pronta com nome e telefone. Abra Contatos pelo menu lateral. No canto superior direito, abra Mais opções e escolha Importar contatos. Selecione o arquivo e confira as colunas reconhecidas. Ajuste o mapeamento quando necessário e avance para a validação. Revise as linhas sinalizadas e corrija os dados antes de confirmar. Inicie a importação e acompanhe o progresso na tela. Quando terminar, pesquise um contato da planilha para confirmar que o cadastro foi criado corretamente. Caso algum contato não apareça, revise o telefone e o código do país.',
            productActions: [{ id: 'importar-contatos', label: 'Começar no iHelp', route: '/contact', target: 'contacts-more-options' }, { id: 'abrir-relatorios', label: 'Outra label inventada', route: '/relatorio', target: null }],
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
for (const details of ['OPENAI_API_KEY="alphaBetaGammaDeltaEpsilon"', 'GITHUB_TOKEN="bravoCharlieDeltaEchoFoxtrot"', "access_token='charlieDeltaEchoFoxtrotGolf'"]) {
  const noModel = { responses: { create: async () => { throw new Error('modelo foi chamado'); } } };
  await assert.rejects(planContent(testRoot, { ...request, details }, { client: noModel }), /credencial/i);
  await assert.rejects(generateContentPackage(testRoot, { ...request, details }, { client: noModel }), /credencial/i);
}
const plan = await planContent(testRoot, request, { client: aiClient });
assert.equal(plan.status, 'ready');
assert.equal(plan.suggestedActions[0].route, '/contact');
assert.deepEqual(plan.suggestedActions[0], { id: 'importar-contatos', label: 'Abrir a tela Contatos', route: '/contact', target: 'contacts-more-options' }, 'plano precisa canonizar label sem alterar destino');
assert.deepEqual(plan.suggestedActions[1], { id: 'abrir-relatorios', label: 'Abrir Relatórios', route: '/relatorio', target: null }, 'plano precisa canonizar cada ação sem sobrescrever route/target');
await planContent(testRoot, request, { client: aiClient, productContext: {
  code: [], matches: [{ repository: 'ihelpchat/front-react', ref: 'test', role: 'frontend', path: 'src/Contacts/CPF-123.456.789-09-phone-11987654321.tsx', excerpt: 'Tela Contatos // sk-proj-abcdefghijklmnop1234567890' }],
  support: { categories: [], rules: [] }, coverage: [],
} });
const secretContext = {
  code: [], matches: [{ repository: 'ihelpchat/front-react', ref: 'test', role: 'frontend', path: 'src/Contacts/index.tsx', excerpt: 'const config = { "OPENAI_API_KEY": "alphaBetaGammaDeltaEpsilon", "GITHUB_TOKEN": "bravoCharlieDeltaEchoFoxtrot" }; access_token = charlieDeltaEchoFoxtrotGolf;' }],
  support: { categories: [], rules: [] }, coverage: [],
};
await planContent(testRoot, request, { client: aiClient, productContext: secretContext });
await generateContentPackage(testRoot, request, { client: aiClient, productContext: secretContext });
const generated = await generateContentPackage(testRoot, request, { client: aiClient });
assert.equal(generated.articles.length, 2);
assert.deepEqual(generated.articles.map(({ contentType }) => contentType), ['faq', 'tutorial']);
assert.ok(generated.articles.every(({ productActions }) => productActions.length === 2));
assert.ok(generated.articles.every(({ productActions }) => {
  assert.deepEqual(productActions[0], { id: 'importar-contatos', label: 'Abrir a tela Contatos', route: '/contact', target: 'contacts-more-options' }, 'pacote precisa canonizar label sem alterar id, route ou target');
  assert.deepEqual(productActions[1], { id: 'abrir-relatorios', label: 'Abrir Relatórios', route: '/relatorio', target: null }, 'pacote precisa canonizar a segunda ação sem alterar destino');
  return true;
}));

const rendered = renderArticle(generated.articles[0]);
assert.match(rendered, /<ProductAction id="importar-contatos"/);
assert.doesNotMatch(rendered, /VideoEmbed|video/i);


console.log("Planejamento e geração editorial passaram.");
