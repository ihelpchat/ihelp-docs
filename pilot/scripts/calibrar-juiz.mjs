import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import OpenAI from 'openai';
import { judgeEditorial, aggregateCalibration, publicCalibrationReport, EDITORIAL_CRITERIA } from '../mcp/faq-editorial-judge.mjs';
import { loadBusinessContext } from '../mcp/faq-editorial.mjs';

const root = resolve(import.meta.dirname, '..');
const rubricDir = join(root, 'architecture/faq-regua');
const notesFile = process.env.CALIBRATION_NOTES_FILE;
if (!notesFile || !process.env.OPENAI_API_KEY) throw new Error('ambiente de calibração indisponível');

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const samples = (await readJson(join(rubricDir, 'amostras-calibracao.json'))).amostras;
const privateNotes = (await readJson(notesFile)).amostras;
const notesById = new Map(privateNotes.map((item) => [item.amostra, item]));
const approved = (await readJson(join(root, 'product-map/approved.json'))).manifest;
const moduleFiles = { Contatos: 'Contact', Robôs: 'Robot', Departamentos: 'Department', Canais: 'Channel' };
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Classificação do gabarito de validação, aplicada só após as decisões do juiz.
// Não entra no prompt, nas evidências ou no ajuste.
const heldOutSerious = { G03: ['tarefa_incompleta'], G04: ['produto_sem_evidencia'] };
const rates = {
  'gpt-6-luna': [0.10, 0.50], 'gpt-6-sol': [2, 10], 'gpt-6-astra': [10, 50],
}; // USD por milhão, Standard; https://developers.openai.com/api/docs/pricing

function evidenceFor(module) {
  const filePart = moduleFiles[module];
  const routes = approved.routes.filter((item) => item.label === module);
  const labels = approved.labels.filter((item) => filePart && item.file.includes(filePart))
    .map(({ label, file }) => ({ label, file }));
  return { front: { routes, labels }, jornadas: [] };
}

async function run(model) {
  let inputTokens = 0, outputTokens = 0;
  const rows = [];
  for (const sample of samples) {
    const note = notesById.get(sample.id);
    if (!note || note.grupo !== sample.grupo || !EDITORIAL_CRITERIA.every((id) => Number.isInteger(note.notas[id])))
      throw new Error('notas incompletas');
    const evidence = evidenceFor(sample.modulo);
    const business = await loadBusinessContext(root, sample.modulo, process.env.BUSINESS_CONTEXT_DIR);
    evidence.negocio = business.map(({ body }) => body);
    let judge;
    try {
      judge = await judgeEditorial({ pagina: sample.texto, modulo: sample.modulo, evidencias: evidence },
        async ({ instructions, input, schema }) => client.responses.create({ model, instructions, input,
        reasoning: { effort: model === 'gpt-6-luna' ? 'none' : 'medium' },
        text: { format: { type: 'json_schema', name: 'faq_editorial_verdict', strict: true, schema } },
        max_output_tokens: model === 'gpt-6-astra' ? 4000 : 1800 }));
    } catch (error) {
      error.sampleId = sample.id;
      throw error;
    }
    inputTokens += judge.usage.input_tokens;
    outputTokens += judge.usage.output_tokens;
    rows.push({ id: sample.id, grupo: sample.grupo,
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
  console.log('| Amostra | Grupo | Bruno × juiz | Notas Bruno | Notas juiz | Defeitos graves juiz |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const row of report.amostras) {
    const compact = ({ notas }) => EDITORIAL_CRITERIA.map((id) => `${id}:${notas[id]}`).join(', ');
    console.log(`| ${row.id} | ${row.grupo} | ${row.bruno.aceite ? 'aceite' : 'recusa'} × ${row.juiz.aceite ? 'aceite' : 'recusa'} | ${compact(row.bruno)} | ${compact(row.juiz)} | ${row.juiz.defeitosGraves.join(', ') || 'nenhum'} |`);
  }
  console.log(JSON.stringify({ metricas: report.metricas, uso: report.uso }));
}

const selected = process.argv.find((arg) => arg.startsWith('--model='))?.slice('--model='.length)
  ?? process.env.OPENAI_MODEL ?? 'gpt-6-luna';
const reports = [];
try {
  const first = await run(selected);
  reports.push(first);
  display(first);
  if (!first.metricas.passou && selected !== 'gpt-6-astra') {
    const second = await run('gpt-6-astra');
    reports.push(second);
    display(second);
  }
  const directory = join(rubricDir, 'calibracao');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'resultado.json'), `${JSON.stringify({ execucoes: reports }, null, 2)}\n`);
} catch (error) {
  const safeReason = error.message === 'veredito editorial inválido' ? 'schema' : error instanceof SyntaxError ? 'json' : 'outro';
  console.error(`Calibração interrompida: ${error.name ?? 'erro'}; motivo=${safeReason}; amostra=${error.sampleId ?? '?'}; status=${error.status ?? '?'}; code=${error.code ?? '?'}; param=${error.param ?? '?'}. Nenhum dado privado foi registrado.`);
  process.exitCode = 1;
}
