import { parseArticle } from '../mcp/editorial-standard.mjs';
import { guideSchema } from '../architecture/conversation-v1.mjs';

const sourcePattern = /\{\/\* fonte: ([a-z0-9-]+) \| (front|back)@([a-f0-9]{12}):([^\s|]+):(\d+) \| alvo: ([^\n]+) \*\/\}/gu;
const unsafePromise = /mensagens.{0,85}(?:serão|são|ficarão).{0,45}(?:recuperad|entregues|preservad)|(?:recupera|garante).{0,55}mensagens.{0,55}(?:desconectad|offline)/iu;

export function validateCanonicalGuide(raw, expectedId) {
  const { metadata, body } = parseArticle(raw, `docs/${expectedId}`);
  const guide = guideSchema.parse(metadata.guide);
  if (guide.guideId !== expectedId) throw new Error(`${expectedId}: guideId incorreto`);
  const sources = [...body.matchAll(sourcePattern)];
  const byStep = new Map();
  for (const [, stepId, , , , , target] of sources) {
    if (byStep.has(stepId)) throw new Error(`${expectedId}: fonte duplicada em ${stepId}`);
    if (!target.trim()) throw new Error(`${expectedId}: alvo vazio em ${stepId}`);
    byStep.set(stepId, target);
  }
  for (const { stepId } of guide.steps) {
    if (!byStep.has(stepId)) throw new Error(`${expectedId}: fonte ausente no passo ${stepId}`);
  }
  if (byStep.size !== guide.steps.length) throw new Error(`${expectedId}: fonte sem passo`);
  if (unsafePromise.test(raw)) throw new Error(`${expectedId}: promessa de recuperar mensagens offline`);
  return guide;
}
