import { parseArticle } from '../mcp/editorial-standard.mjs';
import { guideSchema } from '../architecture/conversation-v1.mjs';

const sourcePattern = /\{\/\* fonte: ([a-z0-9-]+) \| (front|back)@([a-f0-9]{12}):([^\s|]+):(\d+) \| alvo: ([^\n]+) \*\/\}/gu;
const approvedOfflineMessageSentences = [
  'As mensagens enviadas enquanto o WhatsApp estava desconectado podem não aparecer no iHelp.',
  'Se for importante, confira no celular.',
];

const canonical = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('pt-BR').replace(/\s+/gu, ' ').trim();
const approvedSentences = new Set(approvedOfflineMessageSentences.map(canonical));
const messageTopic = /\b(?:mensag\w*|convers\w*|recad\w*|atendimentos? recebidos?|nada se perde)\b/u;
const disconnectedPeriod = /\b(?:desconect\w*|desconex\w*|offline|fora do ar|sem conexao|caiu|queda|enquanto o celular)\b/u;

function renderedSentences(text) {
  const visible = text
    .replace(/\{\/\*[\s\S]*?\*\/\}/gu, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/[`*_>#|]/gu, ' ')
    .replace(/\s+/gu, ' ');
  return visible.split(/(?<=[.!?])(?:\s+|$)/u).map((sentence) => sentence.trim()).filter(Boolean);
}

function publishedText(metadata, body) {
  const fields = [body, metadata.title, metadata.description, metadata.assistantQuestion,
    metadata.assistantOverview, ...(metadata.assistantSuggestions ?? [])];
  for (const step of metadata.guide.steps) {
    fields.push(step.text, ...(step.choices ?? []).map((choice) => choice.label));
  }
  return fields.filter((value) => typeof value === 'string');
}

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
  for (const text of publishedText(metadata, body)) {
    for (const sentence of renderedSentences(text)) {
      const normalized = canonical(sentence);
      if (messageTopic.test(normalized) && disconnectedPeriod.test(normalized) && !approvedSentences.has(normalized)) {
        throw new Error(`${expectedId}: frase sobre mensagens do período desconectado não aprovada: ${sentence}`);
      }
    }
  }
  return guide;
}
