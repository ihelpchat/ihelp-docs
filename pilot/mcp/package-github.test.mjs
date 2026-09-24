import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderArticle, submitContentPackage, validateArticle } from './content-service.mjs';
import { readArticle } from './editorial-standard.mjs';

const root = await mkdtemp(join(tmpdir(), 'ihelp-package-github-'));
const body = 'Abra Contatos no menu lateral. Confira a lista antes de continuar. Selecione a opção de importar. Revise o arquivo escolhido e confirme as colunas. Corrija as linhas inválidas antes de concluir. Aguarde o resultado aparecer na tela. Pesquise um contato recém cadastrado para confirmar o sucesso. Se o contato não aparecer, revise o número e repita apenas a linha corrigida. Este procedimento mantém os demais contatos já cadastrados na conta.';
const article = (path, title) => ({ path, title, description: 'Procedimento completo para orientar a pessoa na documentação do iHelp.', source: 'produto', contentType: 'tutorial', body });
const realArticle = await readArticle(new URL('../', import.meta.url).pathname, 'api/crm/funis-e-etapas');
const realRaw = await readFile(new URL('../content/docs/api/crm/funis-e-etapas.mdx', import.meta.url), 'utf8');
assert.equal(validateArticle(realArticle).valid, true, 'artigo real com dono do token: administradores deve validar');
assert.equal((await submitContentPackage(root, [realArticle], 'dry_run', 'user:tester')).status, 'dry_run', 'artigo real deve passar no dry_run');
const leakedAliases = [
  'AWS_SECRET_ACCESS_KEY="alphaBetaGammaDeltaEpsilon"',
  'JWT_SECRET_KEY="bravoCharlieDeltaEchoFoxtrot"',
  'private_key="charlieDeltaEchoFoxtrotGolf"',
  'DB_PASS="deltaEchoFoxtrotGolfHotel"',
  'credentials="echoFoxtrotGolfHotelIndia"',
  'privateKey="administradores"',
  'awsSecretAccessKey="administradores"',
  'jwtSecretKey="administradores"',
  'dbPass="administradores"',
  'secretKey="administradores"',
  'GITHUB_TOKEN=ABCDEFGHIJKLMNOPQRSTUVWX',
  'passwd="Sup3rS3cret!"',
  'senha_admin="Adm!n2024#x"',
  'SECRET_KEY_BASE=abcdef0123456789abcdef0123456789',
  'PWD="Sup3rS3cret!"',
  'AdminPassWd="Sup3rS3cret!"',
  'DB_PASSWORD2="Sup3rS3cret!"',
  'API_KEY2="Adm!n2024#x"',
  'TOKEN2="Sup3rS3cret!"',
  'MYSQL_PWD1="Adm!n2024#x"',
];
for (const leaked of leakedAliases) {
  const unsafe = { ...realArticle, body: `${realArticle.body}\n\n${leaked}` };
  assert.ok(validateArticle(unsafe).issues.some((issue) => /credencial/i.test(issue)), `${leaked.split('=')[0]} deve falhar validateArticle`);
  await assert.rejects(submitContentPackage(root, [unsafe], 'dry_run', 'user:tester'), /credencial/i);
}
const descriptiveArticle = { ...realArticle, body: `${realArticle.body}\n\nadmin_password_hint="Sup3rS3cret!"\nsecret_name="Sup3rS3cret!"\nversion2="Sup3rS3cret!"\nstep2="Sup3rS3cret!"\ntoken_count2="Sup3rS3cret!"\npassword_hint2="Sup3rS3cret!"\nprivate_key_description2="Sup3rS3cret!"` };
assert.equal(validateArticle(descriptiveArticle).valid, true, 'campos descritivos não podem ser tratados como credenciais');
assert.equal((await submitContentPackage(await mkdtemp(join(tmpdir(), 'ihelp-descriptive-')), [descriptiveArticle], 'dry_run', 'user:tester')).status, 'dry_run');
assert.equal(validateArticle({ ...article('docs/teste/rota', 'Rota segura'), productActions: [{ id: 'abrir-rota', label: 'Abrir rota', route: '//externo' }] }).valid, false);
for (const [field, value] of [['title', 'Contato (11) 98765-4321'], ['description', 'Procedimento com CPF 123.456.789-09 que jamais pode ser publicado.'], ['body', `${body} Ligue para 11987654321.`]]) {
  const unsafe = { ...article('docs/teste/pii', 'Guia seguro'), [field]: value };
  assert.equal(validateArticle(unsafe).valid, false, `${field} com telefone ou CPF deve ser rejeitado`);
}
const trustedAction = { id: 'importar-contatos', label: 'Abrir a tela Contatos', route: '/contact', target: 'contacts-more-options' };
for (const [field, value] of [['path', 'docs/teste/11987654321'], ['tangoUrl', 'https://app.tango.us/app/workflow/11987654321'], ['productActions', [{ ...trustedAction, id: 'telefone-11987654321' }]], ['productActions', [{ ...trustedAction, label: 'Ligue para (11) 98765-4321' }]], ['productActions', [{ ...trustedAction, label: 'CPF 123.456.789-09' }]], ['productActions', [{ ...trustedAction, route: '/contact/11987654321' }]], ['productActions', [{ ...trustedAction, target: 'telefone-11987654321' }]]]) {
  const unsafe = { ...article('docs/teste/pii', 'Guia seguro'), [field]: value };
  assert.ok(validateArticle(unsafe).issues.some((issue) => /dado pessoal/i.test(issue)), `${field} com PII precisa entrar na inspeção`);
  assert.throws(() => renderArticle(unsafe), /dado pessoal/i, `${field} com PII não pode ser renderizado`);
}
const secretLabel = { ...article('docs/teste/segredo', 'Guia seguro'), productActions: [{ ...trustedAction, label: 'ghp_abcdefghijklmnopqrst' }] };
assert.ok(validateArticle(secretLabel).issues.some((issue) => /credencial/i.test(issue)), 'segredo em label precisa entrar na inspeção');
assert.throws(() => renderArticle(secretLabel), /credencial/i);
const openAiSecret = { ...article('docs/teste/segredo-openai', 'Guia sk-proj-abcdefghijklmnop1234567890') };
assert.ok(validateArticle(openAiSecret).issues.some((issue) => /credencial/i.test(issue)), 'sk-proj no título derivado da PR precisa ser barrado');
assert.throws(() => renderArticle(openAiSecret), /credencial/i);
const base = new Map([
  ['pilot/content/docs/api/crm/funis-e-etapas.mdx', realRaw],
  ['pilot/content/docs/api/crm/meta.json', '{"pages":["funis-e-etapas"]}\n'],
  ['pilot/content/docs/docs/meta.json', '{"pages":["contatos"]}\n'],
  ['pilot/content/docs/tutoriais/meta.json', '{"pages":["index"]}\n'],
  ['pilot/content/docs/docs/contatos/meta.json', '{"title":"Contatos","pages":["index","antigo","guia"]}\n'],
  ['pilot/content/docs/docs/contatos/antigo.mdx', 'artigo antigo'],
  ['pilot/content/docs/docs/contatos/guia.mdx', 'guia anterior'],
]);
const branch = new Map(base);
const mutations = [];
const originalFetch = globalThis.fetch;
const originalToken = process.env.GITHUB_TOKEN;
process.env.GITHUB_TOKEN = 'mock-token';
let pulls = 0;
let refs = 0;
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname;
  const method = init.method ?? 'GET';
  if (path.includes('/git/ref/heads/')) return { ok: true, json: async () => ({ object: { sha: 'base-sha' } }) };
  if (path.endsWith('/git/refs')) { refs += 1; return { ok: true, json: async () => ({}) }; }
  if (path.endsWith('/pulls')) { pulls += 1; return { ok: true, json: async () => ({ html_url: 'https://github.com/ihelpchat/ihelp-docs/pull/321' }) }; }
  const file = decodeURIComponent(path.split('/contents/')[1] ?? '');
  if (!file) throw Error(`Unexpected GitHub call: ${method} ${path}`);
  if (method === 'GET') return branch.has(file)
    ? { ok: true, json: async () => ({ sha: `sha-${file}`, encoding: 'base64', content: Buffer.from(branch.get(file)).toString('base64') }) }
    : { ok: false, status: 404, json: async () => ({}) };
  const payload = JSON.parse(init.body);
  mutations.push({ method, file, payload });
  if (method === 'PUT') { branch.set(file, Buffer.from(payload.content, 'base64').toString()); return { ok: true, json: async () => ({}) }; }
  if (method === 'DELETE') { branch.delete(file); return { ok: true, json: async () => ({}) }; }
  throw Error(`Unexpected method: ${method}`);
};
try {
  for (const leaked of leakedAliases) {
    await assert.rejects(submitContentPackage(root, [{ ...realArticle, body: `${realArticle.body}\n\n${leaked}` }], 'pull_request', 'user:tester'), /credencial/i);
  }
  assert.equal(pulls, 0, 'aliases de credencial não podem chegar a refs ou PR');
  assert.equal(refs, 0, 'aliases de credencial não podem criar ref');
  await assert.rejects(submitContentPackage(root, [{ ...article('docs/teste/pii', 'Guia seguro'), body: `${body} Ligue para (11) 98765-4321.` }], 'pull_request', 'user:tester'), /dado pessoal/i);
  await assert.rejects(submitContentPackage(root, [{ ...article('docs/teste/pii', 'Guia seguro'), productActions: [{ ...trustedAction, label: 'Ligue para (11) 98765-4321' }] }], 'pull_request', 'user:tester'), /dado pessoal/i);
  await assert.rejects(submitContentPackage(root, [openAiSecret], 'pull_request', 'user:tester'), /credencial/i);
  assert.equal(pulls, 0, 'PII não pode abrir PR');
  const result = await submitContentPackage(root, [article('docs/contatos/novo', 'Novo guia'), article('docs/contatos/guia', 'Guia atualizado'), article('tutoriais/contatos/primeiro', 'Primeiro tutorial')], 'pull_request', 'user:tester', ['docs/contatos/antigo']);
  assert.equal(result.status, 'pull_request');
  assert.equal(pulls, 1);
  assert.ok(mutations.some(({ method, file, payload }) => method === 'PUT' && file.endsWith('/guia.mdx') && payload.sha === 'sha-pilot/content/docs/docs/contatos/guia.mdx'));
  assert.ok(mutations.some(({ method, file, payload }) => method === 'DELETE' && file.endsWith('/antigo.mdx') && payload.sha));
  assert.deepEqual(JSON.parse(branch.get('pilot/content/docs/docs/contatos/meta.json')).pages, ['index', 'guia', 'novo']);
  assert.deepEqual(JSON.parse(branch.get('pilot/content/docs/tutoriais/contatos/meta.json')).pages, ['primeiro']);
  assert.deepEqual(JSON.parse(branch.get('pilot/content/docs/tutoriais/meta.json')).pages, ['index', 'contatos']);
  assert.equal(mutations.filter(({ file }) => file.endsWith('/meta.json')).length, 3);
  await assert.rejects(submitContentPackage(root, [article('docs/contatos/novo', 'Novo guia')], 'pull_request', undefined), /requestedBy/);
  const before = mutations.length;
  const dry = await submitContentPackage(root, [article('docs/contatos/futuro', 'Guia futuro')], 'dry_run', 'user:tester');
  assert.equal(dry.status, 'dry_run');
  assert.equal(mutations.length, before);
  assert.equal((await readdir(root)).includes('.drafts'), false);
  const audit = (await readFile(join(root, '.audit/docs-submissions.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(audit.map(({ result }) => result), [...leakedAliases.flatMap(() => ['attempt', 'failure']), 'attempt', 'failure', 'attempt', 'failure', 'attempt', 'failure', 'attempt', 'external_request', 'success']);
  assert.ok(audit.every(({ actor }) => actor === 'user:tester'));
  assert.doesNotMatch(JSON.stringify(audit), /mock-token|Novo guia|artigo antigo/);
  const updated = await submitContentPackage(root, [realArticle], 'pull_request', 'user:tester');
  assert.equal(updated.status, 'pull_request', 'mesmo caminho de docs_update_article deve aceitar o artigo real');
  assert.ok(mutations.some(({ method, file, payload }) => method === 'PUT' && file.endsWith('/api/crm/funis-e-etapas.mdx') && payload.sha === 'sha-pilot/content/docs/api/crm/funis-e-etapas.mdx'));
  await assert.rejects(submitContentPackage(root, [], 'pull_request', 'user:tester', ['docs/contatos/inexistente']), /não encontrado/i);
  const failed = (await readFile(join(root, '.audit/docs-submissions.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(failed.slice(-2).map(({ result }) => result), ['attempt', 'failure']);
} finally {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
}
console.log('Pacote GitHub: create, update, delete, meta.json e dry-run passaram.');
