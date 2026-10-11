import { createHash } from 'node:crypto';
import { EDITORIAL_CRITERIA } from '../mcp/faq-editorial-judge.mjs';

export function chooseHeldReview(id) {
  return createHash('sha256').update(`M5.79:revisao:${id}`).digest()[0] < 128;
}

export function safeCandidate(candidate, comments) {
  if (!candidate || !EDITORIAL_CRITERIA.includes(candidate.criterio)
    || typeof candidate.texto !== 'string' || candidate.texto.length < 24 || candidate.texto.length > 220) return false;
  const normalized = (s) => s.normalize('NFKC').toLocaleLowerCase('pt-BR').replaceAll(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const text = normalized(candidate.texto);
  return comments.every((comment) => {
    const words = normalized(comment).split(' ');
    if (text.includes(normalized(comment)) && words.length >= 5) return false;
    return !words.some((_, i) => i + 7 <= words.length && text.includes(words.slice(i, i + 7).join(' ')));
  });
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
  return { accepted: proposed.agreement >= baseline.agreement
    && proposed.severeApproved === 0
    && (baseline.meanError === null || proposed.meanError <= baseline.meanError)
    && (proposed.agreement > baseline.agreement
      || (baseline.meanError !== null && proposed.meanError < baseline.meanError)),
  before: baseline, after: proposed };
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
