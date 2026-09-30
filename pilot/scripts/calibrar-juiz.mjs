import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import OpenAI from 'openai';
import { judgeEditorial, consolidateEditorialReadings, publicCalibrationReport, EDITORIAL_CRITERIA } from '../mcp/faq-editorial-judge.mjs';
import { loadBusinessContext } from '../mcp/faq-editorial.mjs';
import { loadCalibrationJourneys } from './calibration-journeys.mjs';

const root = resolve(import.meta.dirname, '..');
const rubricDir = join(root, 'architecture/faq-regua');
const notesFile = process.env.CALIBRATION_NOTES_FILE;
if (!notesFile || !process.env.OPENAI_API_KEY) throw new Error('ambiente de calibração indisponível');

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const samples = (await readJson(join(rubricDir, 'amostras-calibracao.json'))).amostras;
const sources = (await readJson(join(rubricDir, 'amostras-calibracao-fontes.json'))).fontes;
const privateNotes = (await readJson(notesFile)).amostras;
const notesById = new Map(privateNotes.map((item) => [item.amostra, item]));
const approved = (await readJson(join(root, 'product-map/approved.json'))).manifest;
const moduleFiles = { Contatos: 'Contact', Robôs: 'Robot', Departamentos: 'Department', Canais: 'Channel' };
const routeLabels = { Contatos: 'Contatos', Robôs: 'Bot', Departamentos: 'Departmento', Canais: 'Canal' };
const businessModules = { Departamentos: 'configuracoes-departamentos', Canais: 'configuracoes-canais' };
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const knownLabels = new Set(approved.labels.map(({ label }) => label));

// Classificação do gabarito de validação, aplicada só após as decisões do juiz.
// Não entra no prompt, nas evidências ou no ajuste.
const heldOutSerious = { G03: ['tarefa_incompleta'], G04: ['produto_sem_evidencia'] };
const rates = {
  'gpt-6-luna': [0.10, 0.50], 'gpt-6-sol': [2, 10], 'gpt-6-astra': [10, 50],
}; // USD por milhão, Standard; https://developers.openai.com/api/docs/pricing

async function evidenceFor(sample) {
  const moduleName = sample.modulo;
  const filePart = moduleFiles[moduleName];
  const routes = approved.routes.filter((item) => item.label === routeLabels[moduleName]);
  const labels = approved.labels.filter((item) => filePart && item.file.includes(filePart))
    .map(({ label, file }) => ({ label, file }));
  if (!routes.length && !labels.length) throw new Error(`evidência do módulo ausente: ${moduleName}`);
  const origin = sources[sample.id]?.origem ?? '';
  const paths = [...origin.matchAll(/(?:pilot\/content\/docs\/docs\/[^\s,]+?\.mdx|baseline\/[^\s,]+?\.mdx)/gu)]
    .map(([path]) => path.startsWith('baseline/') ? `architecture/faq-regua/${path}` : path.replace(/^pilot\//u, ''));
  if (!paths.length && moduleName === 'Robôs') paths.push('content/docs/docs/sobre-o-sistema/robo-de-atendimento.mdx');
  const fontes = await Promise.all([...new Set(paths)].map(async (path) => ({ nome: path,
    conteudo: await readFile(join(root, path), 'utf8') })));
  return { front: { routes, labels }, fontes };
}

async function run(model) {
  let inputTokens = 0, outputTokens = 0;
  const rows = [];
  for (const sample of samples) {
    const note = notesById.get(sample.id);
    if (!note || note.grupo !== sample.grupo || !EDITORIAL_CRITERIA.every((id) => Number.isInteger(note.notas[id])))
      throw new Error('notas incompletas');
    const evidence = await evidenceFor(sample);
    const journeyEvidence = await loadCalibrationJourneys(sample.modulo, process.env.JOURNEYS_DIR, { knownLabels });
    evidence.jornadas = journeyEvidence.jornadas;
    const business = await loadBusinessContext(root, businessModules[sample.modulo] ?? sample.modulo, process.env.BUSINESS_CONTEXT_DIR);
    evidence.negocio = business.map(({ body }) => body);
    const evidenceNames = { rotasCount: evidence.front.routes.length, labelsCount: evidence.front.labels.length,
      fontesCount: evidence.fontes.length, negocioCount: business.length,
      jornadasPorStatus: journeyEvidence.contagens, avisoJornadas: journeyEvidence.aviso };
    let judge;
    try {
      const readings = [];
      for (let i = 0; i < 3; i += 1) {
        readings.push(await judgeEditorial({ pagina: sample.texto, modulo: sample.modulo, evidencias: evidence,
          proposito: readings[0]?.proposito },
        async ({ instructions, input, schema }) => client.responses.create({ model, instructions, input,
          reasoning: { effort: 'none' },
          text: { format: { type: 'json_schema', name: 'faq_editorial_verdict', strict: true, schema } },
          max_output_tokens: 4000 })));
      }
      judge = consolidateEditorialReadings(readings);
    } catch (error) {
      error.sampleId = sample.id;
      throw error;
    }
    inputTokens += judge.usage.input_tokens;
    outputTokens += judge.usage.output_tokens;
    rows.push({ id: sample.id, grupo: sample.grupo, evidencias: evidenceNames,
      bruno: { notas: note.notas, defeitosGraves: heldOutSerious[sample.id] ?? [] }, juiz: judge });
  }
  const [inputRate, outputRate] = rates[model] ?? [Number(process.env.JUDGE_INPUT_USD_PER_MILLION),
    Number(process.env.JUDGE_OUTPUT_USD_PER_MILLION)];
  const costUsd = Number.isFinite(inputRate) && Number.isFinite(outputRate)
    ? (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000 : null;
  return publicCalibrationReport(rows, { model, inputTokens, outputTokens, costUsd });
}

function display(report) {
  console.log(`Modelo: ${report.modelo}`);
  console.log('| Amostra | Grupo | Bruno × juiz | Propósito | N/A | Notas juiz | Dispersão | Graves |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of report.amostras) {
    const compact = ({ notas }) => EDITORIAL_CRITERIA.map((id) => `${id}:${notas[id]}`).join(', ');
    console.log(`| ${row.id} | ${row.grupo} | ${row.bruno.aceite ? 'aceite' : 'recusa'} × ${row.juiz.aceite ? 'aceite' : 'recusa'} | ${row.juiz.proposito} | ${row.juiz.naoAplicaveis.join(', ') || 'nenhum'} | ${compact(row.juiz)} | ${JSON.stringify(row.juiz.dispersao)} | ${row.juiz.defeitosGraves.join(', ') || 'nenhum'} |`);
  }
  console.log(JSON.stringify({ metricas: report.metricas, uso: report.uso }));
}

const selected = 'gpt-6-luna';
const reports = [];
try {
  const first = await run(selected);
  reports.push(first);
  display(first);
  const directory = join(rubricDir, 'calibracao');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'resultado.json'), `${JSON.stringify({ execucoes: reports }, null, 2)}\n`);
} catch (error) {
  const safeReason = error.message === 'veredito editorial inválido' ? 'schema' : error instanceof SyntaxError ? 'json' : 'outro';
  console.error(`Calibração interrompida: ${error.name ?? 'erro'}; motivo=${safeReason}; amostra=${error.sampleId ?? '?'}; status=${error.status ?? '?'}; code=${error.code ?? '?'}; param=${error.param ?? '?'}. Nenhum dado privado foi registrado.`);
  process.exitCode = 1;
}
