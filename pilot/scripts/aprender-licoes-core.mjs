import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { EDITORIAL_CRITERIA } from '../mcp/faq-editorial-judge.mjs';

export function chooseHeldReview(id) {
  return createHash('sha256').update(`M5.79:revisao:${id}`).digest()[0] < 128;
}

const normalized = (s) => String(s).normalize('NFKC').toLocaleLowerCase('pt-BR').replaceAll(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (s) => normalized(s).split(' ').filter(Boolean);
let allowedWords;
function vocabulary() {
  if (allowedWords) return allowedWords;
  const pilot = resolve(import.meta.dirname, '..');
  const root = join(pilot, 'architecture/faq-regua');
  const rubric = JSON.parse(readFileSync(join(root, 'rubrica.json'), 'utf8'));
  const guide = JSON.parse(readFileSync(join(root, 'guia-aprendido.json'), 'utf8'));
  const glossary = JSON.parse(readFileSync(join(root, 'glossario-licoes.json'), 'utf8'));
  const editorial = JSON.parse(readFileSync(join(root, 'vocabulario-licoes.json'), 'utf8'));
  allowedWords = new Set([
    ...words(JSON.stringify(rubric)),
    ...guide.licoes.filter(({ ativa, validada, vetada }) => ativa && validada && !vetada)
      .flatMap(({ texto }) => words(texto)),
    ...glossary.palavras.flatMap(words),
    ...editorial.palavras.flatMap(words),
  ]);
  return allowedWords;
}

export async function loadFeedback(dir) {
  const files = (await readdir(dir, { recursive: true })).filter((file) => {
    const parts = file.split(/[\\/]/u);
    const name = parts.at(-1);
    return parts.every((part) => !part.startsWith('.')) && name.endsWith('.json')
      && name !== 'relatorio-aprendizado-privado.json';
  }).sort();
  const calibration = [], review = [], queue = [], digest = createHash('sha256');
  for (const file of files) {
    const raw = await readFile(join(dir, file), 'utf8');
    digest.update(file).update('\0').update(raw).update('\0');
    const data = JSON.parse(raw);
    if (Array.isArray(data.amostras)) calibration.push(...data.amostras);
    if (Array.isArray(data.secoes)) review.push(...data.secoes);
    if (Array.isArray(data.revisoes)) review.push(...data.revisoes);
    if (data.pagina && data.decisao) review.push(data);
    if (data.tipo === 'avaliacao-fila' && Array.isArray(data.itens)) queue.push(...data.itens);
  }
  return { calibration, review, queue, digest: digest.digest('hex') };
}

export function splitQueueFeedback(items) {
  const adjustment = [], held = [];
  for (const item of items) {
    if (typeof item.amostra !== 'string' || !item.amostra.trim()
      || typeof item.modulo !== 'string' || typeof item.texto !== 'string'
      || typeof item.comentario !== 'string' || !item.notas
      || !EDITORIAL_CRITERIA.every((id) => item.notas[id] === 'na'
        || (Number.isInteger(item.notas[id]) && item.notas[id] >= 0 && item.notas[id] <= 4)))
      throw new Error('item de avaliacao-fila inválido');
    const notas = Object.fromEntries(EDITORIAL_CRITERIA.map((id) => [id,
      item.notas[id] === 'na' ? null : item.notas[id]]));
    if (item.defeitosGraves !== undefined && (!Array.isArray(item.defeitosGraves)
      || item.defeitosGraves.some((defect) => typeof defect !== 'string' || !defect.trim())))
      throw new Error('defeitosGraves de avaliacao-fila inválido');
    const defeitosGraves = item.defeitosGraves === undefined
      ? EDITORIAL_CRITERIA.filter((criterion) => notas[criterion] === 0)
      : [...new Set(item.defeitosGraves)];
    const id = item.amostra;
    if (chooseHeldReview(id)) held.push({ id, modulo: item.modulo, pagina: item.texto,
      bruno: { aceite: defeitosGraves.length === 0
        && EDITORIAL_CRITERIA.every((criterion) => notas[criterion] === null || notas[criterion] >= 3),
        notas, defeitosGraves } });
    else adjustment.push({ tipo: 'avaliação de fila', id, modulo: item.modulo,
      pagina: item.texto, notas, comentario: item.comentario });
  }
  return { adjustment, held };
}

export function firstJsonObject(output) {
  const input = String(output ?? '').trimStart();
  if (!input.startsWith('{')) throw new SyntaxError('veredito JSON ausente');
  let depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return JSON.parse(input.slice(0, i + 1));
  }
  throw new SyntaxError('veredito JSON incompleto');
}

export function candidateRejectionReason(candidate, comments, privateMetadata = []) {
  if (!candidate || !EDITORIAL_CRITERIA.includes(candidate.criterio)
    || typeof candidate.texto !== 'string' || candidate.texto.length < 24 || candidate.texto.length > 220) return 'formato';
  const text = normalized(candidate.texto);
  if (privateMetadata.some((value) => {
    const phrase = normalized(value);
    return phrase && text.includes(phrase);
  })) return 'privacidade';
  if (words(candidate.texto).some((word) => !vocabulary().has(word))) return 'vocabulário';
  // O destino é público. Candidatas com identificadores ou nomes próprios são recusadas.
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(candidate.texto)
    || /\d{4,}/u.test(candidate.texto)
    || /(?:\+?\d[\d\s().-]*){10,}/u.test(candidate.texto)
    || /\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{3,}\b/u.test(candidate.texto)
    || /\b[\p{L}\p{N}]+[-_][\p{L}\p{N}]+\b/iu.test(candidate.texto)) return 'privacidade';
  const privateNames = comments.flatMap((comment) => [...comment.matchAll(/\b\p{Lu}[\p{L}]+(?:\s+(?:da|de|do|dos|das))?\s+\p{Lu}[\p{L}]+\b/gu)]
    .map(([name]) => normalized(name)));
  if (privateNames.some((name) => text.includes(name))) return 'privacidade';
  const privateProperWords = new Set(comments.flatMap((comment) => [...comment.matchAll(/\b\p{Lu}[\p{L}]{2,}\b/gu)]
    .map(([word]) => normalized(word))));
  if (text.split(' ').some((word) => privateProperWords.has(word))) return 'privacidade';
  if (/\b\p{Lu}[\p{L}]+\s+\p{Lu}[\p{L}]+\b/gu.test(candidate.texto)) return 'privacidade';
  if (!comments.every((comment) => {
    const words = normalized(comment).split(' ');
    return !words.some((_, i) => i + 4 <= words.length && text.includes(words.slice(i, i + 4).join(' ')));
  })) return 'privacidade';
  return null;
}

export function safeCandidate(candidate, comments) {
  return candidateRejectionReason(candidate, comments) === null;
}

export async function resolveReviewSection(review, dir) {
  const page = basename(String(review.pagina ?? '').trim(), extname(String(review.pagina ?? '').trim()));
  const originalTitle = String(review.titulo ?? review.secao ?? '').trim();
  // A revisão M5.75 registra o título anterior à edição aprovada da página.
  const title = page === 'contatos' && originalTitle === 'Definir quem cuida de um contato'
    ? 'Definir o responsável por um contato' : originalTitle;
  if (!page || !title) return null;
  const roots = [join(dir, 'ouro'), resolve(dir, '../../content/docs/docs')];
  for (const root of roots) {
    let files;
    try { files = await readdir(root, { recursive: true }); } catch { continue; }
    for (const file of files.sort()) {
      if (!/\.mdx?$/iu.test(file) || basename(file, extname(file)) !== page) continue;
      const source = await readFile(join(root, file), 'utf8');
      const headings = [...source.matchAll(/^## (.+)$/gmu)];
      const found = headings.findIndex((match) => match[1].replace(/\s+\{#.*\}$/u, '').trim() === title);
      if (found >= 0) return source.slice(headings[found].index, headings[found + 1]?.index ?? source.length).trim();
    }
  }
  return null;
}

function metrics(rows) {
  const scored = rows.filter(({ bruno }) => bruno.notas);
  const errors = scored.flatMap(({ bruno, judge }) => EDITORIAL_CRITERIA
    .filter((id) => bruno.notas[id] !== null && judge.notas[id] !== null)
    .map((id) => Math.abs(bruno.notas[id] - judge.notas[id])));
  return { total: rows.length,
    agreement: rows.filter(({ bruno, judge }) => bruno.aceite === judge.aceite).length,
    severeApproved: rows.filter(({ bruno, judge }) => judge.aceite && bruno.defeitosGraves?.length).length,
    meanError: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null };
}

export async function validateCandidate(held, runJudge) {
  if (!held.length) throw new Error('conjunto guardado vazio');
  const before = [], after = [];
  for (const row of held) {
    before.push({ bruno: row.bruno, judge: await runJudge(row, false) });
    after.push({ bruno: row.bruno, judge: await runJudge(row, true) });
  }
  const baseline = metrics(before), proposed = metrics(after);
  const cases = held.map((row, i) => ({ id: row.id,
    before: before[i].bruno.aceite === before[i].judge.aceite,
    after: after[i].bruno.aceite === after[i].judge.aceite,
    severeApprovedBefore: Boolean(before[i].bruno.defeitosGraves?.length && before[i].judge.aceite),
    severeApprovedAfter: Boolean(after[i].bruno.defeitosGraves?.length && after[i].judge.aceite) }));
  return { accepted: proposed.agreement >= baseline.agreement
    && proposed.severeApproved === 0
    && cases.every((item) => !item.before || item.after)
    && cases.every((item) => !item.severeApprovedAfter)
    && (baseline.meanError === null || proposed.meanError <= baseline.meanError)
    && (proposed.agreement > baseline.agreement
      || (baseline.meanError !== null && proposed.meanError < baseline.meanError)),
  before: baseline, after: proposed, cases };
}

export async function validateInitialLessons(lessons, held, runJudge) {
  const active = [], observations = [], results = [];
  const updated = [];
  for (const lesson of lessons) {
    const result = await validateCandidate(held, (row, withLesson) => runJudge(row,
      withLesson ? [...active, lesson] : active));
    const accepted = result.accepted && !lesson.vetada;
    const gain = { concordancia: result.after.agreement - result.before.agreement,
      erroMedio: result.before.meanError === null || result.after.meanError === null ? null
        : result.before.meanError - result.after.meanError, guardadas: held.length, medicao: 'isolada por lição' };
    const entry = { ...lesson, ganho: gain, ativa: accepted, validada: true };
    updated.push(entry);
    results.push({ id: lesson.id, accepted, before: result.before, after: result.after, cases: result.cases });
    if (accepted) active.push(entry);
    else observations.push({ id: lesson.id, texto: lesson.texto, criterio: lesson.criterio,
      data: lesson.data, motivo: lesson.vetada ? 'vetada previamente' : 'não passou no conjunto guardado' });
  }
  return { lessons: updated, active, observations, results };
}

export function publicLearningReport({ ajuste, guardadas, iniciais, lessons, candidates }) {
  const aggregate = ({ before, after, cases }) => ({
    acertosAntes: before.agreement,
    acertosDepois: after.agreement,
    regressoes: cases.filter((item) => item.before && !item.after).length,
    erroMedioAntes: before.meanError,
    erroMedioDepois: after.meanError,
  });
  return { ajuste, guardadas, iniciais: aggregate(iniciais),
    licoes: [...lessons, ...candidates].map(({ id, accepted, ...result }) => ({
      id, aceita: accepted, ...aggregate(result),
    })) };
}
