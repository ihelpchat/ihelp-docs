import { access, chmod, lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { judgeEditorial, consolidateEditorialReadings, EDITORIAL_CRITERIA } from '../mcp/faq-editorial-judge.mjs';
import { chooseHeldReview, validateCandidate, validateInitialLessons, firstJsonObject, loadFeedback,
  resolveReviewSection, publicLearningReport, candidateRejectionReason } from './aprender-licoes-core.mjs';

const root = resolve(import.meta.dirname, '..');
const dir = join(root, 'architecture/faq-regua');
const repo = resolve(root, '..');
const privateReportFile = process.env.LEARNING_PRIVATE_REPORT_FILE;
if (!privateReportFile || !isAbsolute(privateReportFile))
  throw new Error('LEARNING_PRIVATE_REPORT_FILE deve ser caminho absoluto fora do repo');
const privateReport = resolve(privateReportFile);
const privateParent = await realpath(dirname(privateReport));
if (relative(repo, privateParent) === '' || !relative(repo, privateParent).startsWith('..'))
  throw new Error('LEARNING_PRIVATE_REPORT_FILE deve ficar fora do repo');
try {
  if ((await lstat(privateReport)).isSymbolicLink()) throw new Error('LEARNING_PRIVATE_REPORT_FILE não aceita symlink');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
if (!(process.env.FEEDBACK_DIR || (process.env.CALIBRATION_NOTES_FILE && process.env.REVIEW_NOTES_FILE)) || !process.env.OPENAI_API_KEY)
  throw new Error('ambiente privado indisponível');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = 'gpt-6-luna';
const guide = await readJson(join(dir, 'guia-aprendido.json'));
const samples = (await readJson(join(dir, 'amostras-calibracao.json'))).amostras;
const feedback = process.env.FEEDBACK_DIR ? await loadFeedback(process.env.FEEDBACK_DIR) : {
  calibration: (await readJson(process.env.CALIBRATION_NOTES_FILE)).amostras,
  review: (await readJson(process.env.REVIEW_NOTES_FILE)).secoes,
};
const { calibration, review } = feedback;
const resolvedReviews = [];
for (const item of review) {
  const pagina = await resolveReviewSection(item, dir);
  if (!pagina) { console.warn('revisão ignorada: seção pública não encontrada'); continue; }
  resolvedReviews.push({ ...item, textoDaSecao: pagina });
}
const sourceDigest = createHash('sha256').update(JSON.stringify({ feedback: feedback.digest ?? { calibration, review },
  paginas: resolvedReviews.map(({ secao, textoDaSecao }) => [secao, textoDaSecao]) })).digest('hex');
const privateDir = process.env.FEEDBACK_DIR || dirname(process.env.CALIBRATION_NOTES_FILE);
const processedFile = join(privateDir, '.m5-79-processado.json');
let processed;
try { processed = await readJson(processedFile); } catch { processed = null; }
let privateReportExists = false;
try { await access(privateReport); privateReportExists = true; } catch { /* o relatório privado será gerado */ }
if (processed?.sourceDigest === sourceDigest && privateReportExists && !process.argv.includes('--force')) {
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
const privateMetadata = review.flatMap((item) => [item.id, item.secao, item.titulo]).filter(Boolean);
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
const candidates = [];
const rejectedCandidates = [];
for (const item of privateCache.candidates.slice(0, 2)) {
  const reason = candidateRejectionReason(item, allComments, privateMetadata);
  if (reason) rejectedCandidates.push({ motivo: reason });
  else if (!guide.licoes.some((known) => known.texto.toLocaleLowerCase('pt-BR') === item.texto.toLocaleLowerCase('pt-BR')))
    candidates.push(item);
}

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
const observations = [...initial.observations, ...rejectedCandidates];
const acceptedExtras = [...initial.active];
const nextLessonNumber = guide.licoes.length + 1;
for (const [index, candidate] of candidates.entries()) {
  const id = `L${String(nextLessonNumber + index).padStart(3, '0')}`;
  const result = await validateCandidate(held, (row, withLesson) => judge(row,
    withLesson ? [...acceptedExtras, candidate] : acceptedExtras));
  const entry = { id, ...candidate, accepted: result.accepted, before: result.before, after: result.after,
    cases: result.cases };
  results.push(entry);
  if (result.accepted) {
    acceptedExtras.push(candidate);
    guide.licoes.push({ id,
    texto: candidate.texto, criterio: candidate.criterio, data: new Date().toISOString().slice(0, 10),
    origem: { classe: 'aprendida', tipo: 'calibração e revisão de página', contagem: adjustment.length },
    ganho: { concordancia: result.after.agreement - result.before.agreement,
      erroMedio: result.before.meanError - result.after.meanError, guardadas: held.length }, vetada: false,
    ativa: true, validada: true });
  } else observations.push({ id, texto: candidate.texto, criterio: candidate.criterio, data: new Date().toISOString().slice(0, 10),
    motivo: 'não passou no conjunto guardado' });
}
const initialOverall = await validateCandidate(held, (row, withGuide) => judge(row,
  withGuide ? initial.active : []));
await writeFile(join(dir, 'guia-aprendido.json'), `${JSON.stringify(guide, null, 2)}\n`);
await writeFile(join(dir, 'observacoes-aprendizado.json'), `${JSON.stringify({ observacoes: observations }, null, 2)}\n`);
const report = publicLearningReport({ guardadas: held.length, ajuste: adjustment.length,
  iniciais: initialOverall, lessons: initial.results, candidates: results });
const detail = { guardadas: held.length, ajuste: adjustment.length, iniciais: initialOverall,
  porLicao: initial.results, candidatas: results };
await writeFile(privateReport, `${JSON.stringify(detail, null, 2)}\n`, { mode: 0o600 });
await chmod(privateReport, 0o600);
await writeFile(join(dir, 'relatorio-aprendizado.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(processedFile, `${JSON.stringify({ sourceDigest })}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ...report, aceitasGeneralizadas: results.filter((r) => r.accepted).map(({ texto }) => texto),
  recusadasGeneralizadas: observations.filter((item) => !item.id).map(({ texto }) => texto),
  iniciaisAtivas: initial.active.map(({ id }) => id), iniciaisObservacao: initial.observations.map(({ id }) => id) }));
