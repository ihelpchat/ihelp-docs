import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sanitizeCodeForModel } from './code-hygiene.mjs';
import { planContent, generateContentPackage } from './content-ai-service.mjs';

const root = process.cwd();
const sha = '71f8201dcc027b1f4b1c5266b3976a8001ae80a0';
const path = 'Comzada.Infra.Data/Repository/ContactsSqlBuilder.cs';
const request = { module: 'api', topic: 'Contatos', description: 'Criar GET /api/v2/contacts.' };
const endpoint = { verb: 'GET', route: '/api/v2/contacts', public: true, documented: true, explicit: true,
  parameters: [], responseFields: [] };
const context = { groundingRequired: true, code: [{ available: true }], endpoints: [endpoint],
  matches: [{ repository: 'ihelpchat/olah-ihelp', path, sha, ref: sha, role: 'backend', line: 412,
    excerpt: '411: before\n412: filter\n413: after' }],
  callEvidence: [{ repository: 'ihelpchat/olah-ihelp', path, sha, ref: sha, start: 329, end: 340,
    excerpt: 'if (departmentIds != null)\n    filterByDepartment();' }] };

test('prompt numera callEvidence e matches com linhas do arquivo original', async () => {
  let input;
  await planContent(root, request, { productContext: context, client: { responses: { create: async (payload) => {
    input = payload.input;
    return { output_text: JSON.stringify({ status: 'needs_information', guidance: '', questions: [], risks: [], suggestedActions: [], grounding: [] }) };
  } } } });
  const prompt = input.find((item) => item.role === 'user').content;
  assert.match(prompt, /329\| if \(departmentIds != null\)\n330\|     filterByDepartment\(\);/u);
  assert.match(prompt, /411\| before\n412\| filter\n413\| after/u);
  let generationInput;
  await generateContentPackage(root, request, { productContext: { ...context, apiExamples: [{ sections: ['Resposta'] }] },
    plan: { status: 'ready' }, client: { responses: { create: async (payload) => {
      generationInput = payload.input;
      return { output_text: '{}' };
    } } } });
  assert.match(generationInput.find((item) => item.role === 'developer').content, /faixa mais curta.*30 linhas/iu);
});

test('literal verbatim omitido de cinco linhas mantém a linha seguinte', async () => {
  const source = 'var sql = @"postgres://u:p@host/db\nsegredo 2\nsegredo 3\nsegredo 4\nsegredo 5";\nFilterByDepartment();';
  const result = sanitizeCodeForModel(source);
  assert.equal(result.literalsOmitted, 1);
  assert.equal(result.text.split('\n').length, source.split('\n').length);
  assert.equal(result.text.split('\n')[5], 'FilterByDepartment();');
  assert.doesNotMatch(result.text, /postgres|segredo/u);
  let prompt;
  await planContent(root, request, { productContext: { ...context,
    callEvidence: [{ ...context.callEvidence[0], start: 412, end: 417, excerpt: source }] },
  client: { responses: { create: async (payload) => {
    prompt = payload.input.find((item) => item.role === 'user').content;
    return { output_text: JSON.stringify({ status: 'needs_information', guidance: '', questions: [], risks: [], suggestedActions: [], grounding: [] }) };
  } } } });
  assert.match(prompt, /412\| var sql = "<literal omitido>"\n413\| \n414\| \n415\| \n416\| ;\n417\| FilterByDepartment\(\);/u);
  const interpolated = sanitizeCodeForModel(source.replace('@"', '$@"'));
  assert.equal(interpolated.literalsOmitted, 1);
  assert.equal(interpolated.text.split('\n')[5], 'FilterByDepartment();');
});

const replay = JSON.parse(await readFile(new URL('./fixtures/m557-resp3-replay.json', import.meta.url)));
const citation = { repository: 'ihelpchat/olah-ihelp', path, lineStart: 329, lineEnd: 340, sha };
const unit = { text: 'departmentIds filtra contatos vinculados a algum dos departamentos indicados.', citations: [citation] };
const replayContext = { ...context, matches: [
  ...Object.values(replay.citations).flat().filter((item) => item.repository)
    .map((item) => ({ ...item, line: item.lineStart, ref: item.sha })),
  { ...context.matches[0], line: 335 }],
  callEvidence: [{ ...context.callEvidence[0], end: 485 }],
  endpoints: [{ ...endpoint, route: '/api/v2/contacts/{letter}', optionalAliases: ['/api/v2/contacts'], authorization: 'authenticated',
    parameters: [{ name: 'letter', type: 'string', in: 'route', required: false },
      { name: 'departmentIds', type: 'integer[]', in: 'query', required: false }],
    responseFields: [{ name: 'idRef', type: 'string' }] }],
  apiExamples: [{ sections: ['Parâmetros', 'Resposta'], components: ['Params', 'Param', 'Fields', 'Field'],
    baseUrl: 'https://apiv3.ihelpchat.com' }] };
const replayRequest = { module: 'api', topic: 'Contatos',
  description: 'Criar a seção Contatos da referência da API. Uma página por endpoint. Criar GET /api/v2/contacts e uma página nova em api/contatos/buscar-contatos. Listagem sem o segmento opcional letter.',
  details: 'O idRef do detalhe e o contactId das tags vêm da listagem. Nenhum filtro é obrigatório. searchData é texto livre que casa com trecho do nome ou do número do contato. page começa em 1 e o padrão é 1. limit tem padrão 20.' };

async function replayResult(lineEnd) {
  const value = { status: 'ready', summary: replay.summary, questions: [],
    grounding: [{ text: replay.summary, citations: replay.citations.summary }], articles: [{
      path: replay.path, endpoint: replay.endpoint, title: replay.title,
      description: { text: replay.description, citations: replay.citations.description },
      intro: { text: replay.intro, citations: replay.citations.intro },
      notas: [{ ...unit, citations: [{ ...citation, lineEnd }] }], responseDescriptions: [],
    }] };
  return generateContentPackage(root, replayRequest, { productContext: replayContext,
    plan: { status: 'ready' }, client: { responses: { create: async () => ({ output_text: JSON.stringify(value), model: 'replay-offline' }) } } });
}

test('resp-3: citação 329–340 da frase de departmentIds é aceita', async () => {
  const result = await replayResult(340);
  assert.equal(result.status, 'ready', result.summary);
});

test('resp-3 com só lineEnd alterado para 485 mantém rejeição do gate', async () => {
  const result = await replayResult(485);
  assert.equal(result.status, 'needs_evidence');
  assert.match(result.summary, /linha fora do índice: Comzada\.Infra\.Data\/Repository\/ContactsSqlBuilder\.cs:329/u);
});
