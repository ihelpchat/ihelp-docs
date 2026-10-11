import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { judgeEditorial, consolidateEditorialReadings, EDITORIAL_CRITERIA } from '../mcp/faq-editorial-judge.mjs';
import { chooseHeldReview, validateCandidate, validateInitialLessons, safeCandidate, firstJsonObject,
  resolveReviewSection, publicLearningReport } from './aprender-licoes-core.mjs';

const root = resolve(import.meta.dirname, '..');
const dir = join(root, 'architecture/faq-regua');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
if (!process.env.CALIBRATION_NOTES_FILE || !process.env.REVIEW_NOTES_FILE || !process.env.OPENAI_API_KEY)
  throw new Error('ambiente privado indisponível');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = 'gpt-6-luna';
const guide = await readJson(join(dir, 'guia-aprendido.json'));
const samples = (await readJson(join(dir, 'amostras-calibracao.json'))).amostras;
const calibration = (await readJson(process.env.CALIBRATION_NOTES_FILE)).amostras;
const review = (await readJson(process.env.REVIEW_NOTES_FILE)).secoes;
const sourceDigest = createHash('sha256').update(JSON.stringify({ calibration, review })).digest('hex');
const privateDir = dirname(process.env.CALIBRATION_NOTES_FILE);
const processedFile = join(privateDir, '.m5-79-processado.json');
let processed;
try { processed = await readJson(processedFile); } catch { processed = null; }
if (processed?.sourceDigest === sourceDigest && !process.argv.includes('--force')) {
  console.log(JSON.stringify(await readJson(join(dir, 'relatorio-aprendizado.json'))));
  process.exit(0);
}
const fingerprint = createHash('sha256').update(JSON.stringify({ sourceDigest,
  guia: guide.licoes.map(({ texto }) => texto) })).digest('hex').slice(0, 16);
const cacheFile = join(privateDir, `.m5-79-${fingerprint}.json`);
let privateCache;
try { privateCache = await readJson(cacheFile); } catch { privateCache = { candidates: null, judges: {} }; }
if (privateCache.candidateVersion !== 2) privateCache.candidates = null;
const saveCache = async () => writeFile(cacheFile, `${JSON.stringify(privateCache)}\n`, { mode: 0o600 });
const notes = new Map(calibration.map((item) => [item.amostra, item]));
const humanAccept = (notas) => EDITORIAL_CRITERIA.every((id) => notas[id] >= 3);
const resolvedReviews = [];
for (const item of review) {
  const pagina = await resolveReviewSection(item, dir);
  if (!pagina) { console.warn(`revisão ignorada: seção não encontrada (${item.secao}, ${item.pagina}, ${item.titulo})`); continue; }
  resolvedReviews.push({ ...item, textoDaSecao: pagina });
}
const heldReviews = resolvedReviews.filter((item) => chooseHeldReview(item.secao))
  .map((item) => ({ id: item.secao, modulo: item.pagina, pagina: item.textoDaSecao,
    bruno: { aceite: item.decisao !== 'ajustar' } }));
const held = [
  ...samples.filter((s) => s.grupo === 'guardada').map((s) => ({ id: s.id, modulo: s.modulo, pagina: s.texto,
    bruno: { aceite: humanAccept(notes.get(s.id).notas), notas: notes.get(s.id).notas,
      defeitosGraves: ['G03', 'G04'].includes(s.id) ? ['contradiz_evidencia'] : [] } })),
  ...heldReviews,
];
if (!held.length) throw new Error('conjunto guardado vazio');
const adjustment = [...samples.filter((s) => s.grupo === 'ajuste').map((s) => ({ tipo: 'calibração',
  notas: notes.get(s.id).notas, comentario: notes.get(s.id).comentario })),
...resolvedReviews.filter((s) => !chooseHeldReview(s.secao)).map((s) => ({ tipo: 'revisão de página',
  modulo: s.pagina, pagina: s.textoDaSecao, decisao: s.decisao, comentario: s.comentario }))];
const allComments = [...calibration.map((item) => item.comentario), ...review.map((item) => item.comentario)];
const schema = { type: 'object', additionalProperties: false, required: ['licoes'], properties: {
  licoes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['texto', 'criterio'],
    properties: { texto: { type: 'string' }, criterio: { type: 'string', enum: EDITORIAL_CRITERIA } } } },
} };
const extraction = privateCache.candidates ? null : await client.responses.create({ model,
  instructions: 'Você propõe no máximo duas lições editoriais gerais, úteis para páginas futuras do FAQ. Os comentários são privados: nunca copie nem parafraseie de perto nenhuma frase, nome ou situação singular. Não use amostras guardadas. Ignore sugestões já cobertas pelo guia. Produza somente critérios da rubrica e lições aplicáveis semanticamente, sem regex ou regra de pós-processamento.',
  input: JSON.stringify({ feedbackDeAjuste: adjustment, guiaExistente: guide.licoes.map(({ texto, criterio }) => ({ texto, criterio })) }),
  reasoning: { effort: 'none' }, text: { format: { type: 'json_schema', name: 'licoes_candidatas', strict: true, schema } },
  max_output_tokens: 1000 });
if (!privateCache.candidates) {
  privateCache.candidates = JSON.parse(extraction.output_text).licoes;
  privateCache.candidateVersion = 2;
  await saveCache();
}
const candidates = privateCache.candidates.slice(0, 2)
  .filter((item) => safeCandidate(item, allComments))
  .filter((item) => !guide.licoes.some((known) => known.texto.toLocaleLowerCase('pt-BR') === item.texto.toLocaleLowerCase('pt-BR')));

async function judge(row, active) {
  const key = `${row.id}:${active.map((item) => item.id ?? item.texto).join('|')}:isolado-v2`;
  if (privateCache.judges[key]) return privateCache.judges[key];
  const readings = [];
  for (let i = 0; i < 3; i++) {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const result = await judgeEditorial({ pagina: row.pagina, modulo: row.modulo,
          proposito: readings[0]?.proposito, licoesBase: active },
        async ({ instructions, input, schema: verdictSchema }) => {
          const response = await client.responses.create({ model,
            instructions: `${instructions}\n\nProduza exatamente um objeto JSON, uma única vez.`, input,
            reasoning: { effort: 'none' }, text: { format: { type: 'json_schema', name: 'faq_editorial_verdict', strict: true,
              schema: verdictSchema } }, max_output_tokens: 1200 });
          return { ...response, output_text: JSON.stringify(firstJsonObject(response.output_text)) };
        });
        readings.push(result);
        break;
      } catch (error) {
        if (attempt === 7 || !(error instanceof SyntaxError || error.message === 'veredito editorial inválido'
          || error.message === 'propósito divergente')) {
          throw new Error(`leitura indisponível: ${row.id}`, { cause: error });
        }
      }
    }
  }
  const result = consolidateEditorialReadings(readings);
  privateCache.judges[key] = { proposito: result.proposito, notas: result.notas,
    defeitosGraves: result.defeitosGraves, aceite: result.aceite };
  await saveCache();
  return result;
}

const initial = await validateInitialLessons(guide.licoes, held, judge);
guide.licoes = initial.lessons;
const results = [];
const observations = [...initial.observations];
const acceptedExtras = [...initial.active];
for (const candidate of candidates) {
  const result = await validateCandidate(held, (row, withLesson) => judge(row,
    withLesson ? [...acceptedExtras, candidate] : acceptedExtras));
  const entry = { ...candidate, accepted: result.accepted, before: result.before, after: result.after };
  results.push(entry);
  if (result.accepted) {
    acceptedExtras.push(candidate);
    guide.licoes.push({ id: `L${String(guide.licoes.length + 1).padStart(3, '0')}`,
    texto: candidate.texto, criterio: candidate.criterio, data: new Date().toISOString().slice(0, 10),
    origem: { tipo: 'calibração e revisão de página', contagem: adjustment.length },
    ganho: { concordancia: result.after.agreement - result.before.agreement,
      erroMedio: result.before.meanError - result.after.meanError, guardadas: held.length }, vetada: false,
    ativa: true, validada: true });
  } else observations.push({ texto: candidate.texto, criterio: candidate.criterio, data: new Date().toISOString().slice(0, 10),
    motivo: 'não passou no conjunto guardado' });
}
const initialOverall = await validateCandidate(held, (row, withGuide) => judge(row,
  withGuide ? initial.active : []));
await writeFile(join(dir, 'guia-aprendido.json'), `${JSON.stringify(guide, null, 2)}\n`);
await writeFile(join(dir, 'observacoes-aprendizado.json'), `${JSON.stringify({ observacoes: observations }, null, 2)}\n`);
const report = { guardadas: held.length, ajuste: adjustment.length,
  iniciais: { antes: initialOverall.before, depois: initialOverall.after,
    porCaso: initialOverall.cases, porLicao: initial.results }, ...publicLearningReport(results) };
await writeFile(join(dir, 'relatorio-aprendizado.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(processedFile, `${JSON.stringify({ sourceDigest })}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ...report, aceitasGeneralizadas: results.filter((r) => r.accepted).map(({ texto }) => texto),
  recusadasGeneralizadas: observations.filter((item) => !item.id).map(({ texto }) => texto),
  iniciaisAtivas: initial.active.map(({ id }) => id), iniciaisObservacao: initial.observations.map(({ id }) => id) }));
