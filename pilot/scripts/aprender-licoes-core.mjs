import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { EDITORIAL_CRITERIA } from '../mcp/faq-editorial-judge.mjs';

export function chooseHeldReview(id) {
  return createHash('sha256').update(`M5.79:revisao:${id}`).digest()[0] < 128;
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

export function safeCandidate(candidate, comments) {
  if (!candidate || !EDITORIAL_CRITERIA.includes(candidate.criterio)
    || typeof candidate.texto !== 'string' || candidate.texto.length < 24 || candidate.texto.length > 220) return false;
  const normalized = (s) => s.normalize('NFKC').toLocaleLowerCase('pt-BR').replaceAll(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const text = normalized(candidate.texto);
  // O destino é público. Candidatas com identificadores ou nomes próprios são recusadas.
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(candidate.texto)
    || /\d{4,}/u.test(candidate.texto)
    || /(?:\+?\d[\d\s().-]*){10,}/u.test(candidate.texto)
    || /\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{3,}\b/u.test(candidate.texto)
    || /\b[\p{L}\p{N}]+[-_][\p{L}\p{N}]+\b/iu.test(candidate.texto)) return false;
  const privateNames = comments.flatMap((comment) => [...comment.matchAll(/\b\p{Lu}[\p{L}]+(?:\s+(?:da|de|do|dos|das))?\s+\p{Lu}[\p{L}]+\b/gu)]
    .map(([name]) => normalized(name)));
  if (privateNames.some((name) => text.includes(name))) return false;
  const privateProperWords = new Set(comments.flatMap((comment) => [...comment.matchAll(/\b\p{Lu}[\p{L}]{2,}\b/gu)]
    .map(([word]) => normalized(word))));
  if (text.split(' ').some((word) => privateProperWords.has(word))) return false;
  if (/\b\p{Lu}[\p{L}]+\s+\p{Lu}[\p{L}]+\b/gu.test(candidate.texto)) return false;
  return comments.every((comment) => {
    const words = normalized(comment).split(' ');
    return !words.some((_, i) => i + 4 <= words.length && text.includes(words.slice(i, i + 4).join(' ')));
  });
}

export async function resolveReviewSection(review, dir) {
  const page = String(review.pagina ?? '').trim();
  const originalTitle = String(review.titulo ?? '').trim();
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
    .filter((id) => judge.notas[id] !== null).map((id) => Math.abs(bruno.notas[id] - judge.notas[id])));
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

export function publicLearningReport(results) {
  const accepted = results.filter((item) => item.accepted);
  return { aceitas: accepted.length, recusadas: results.length - accepted.length,
    concordanciaAntes: results.map((item) => item.before?.agreement ?? null),
    concordanciaDepois: results.map((item) => item.after?.agreement ?? null),
    totalGuardado: results.map((item) => item.after?.total ?? null),
    erroMedioAntes: results.map((item) => item.before?.meanError ?? null),
    erroMedioDepois: results.map((item) => item.after?.meanError ?? null) };
}
