import { parseArticle } from '../mcp/editorial-standard.mjs';
import { guideSchema } from '../architecture/conversation-v1.mjs';

const sourcePattern = /\{\/\* fonte: ([a-z0-9-]+) \| (front|back)@([a-f0-9]{12}):([^\s|]+):(\d+) \| alvo: ([^\n]+) \*\/\}/gu;
export const approvedGuideSentences = {
  'reconectar-canal-qr': [
    'Volte a Canais e confira se aparece Conectado.',
    'As mensagens enviadas enquanto o WhatsApp estava desconectado podem não aparecer no iHelp.',
  ],
  'usuario-acesso': [
    'Não envie a senha no chat.',
  ],
  'recado-fora-do-horario': [
    'O recado fora do horário é configurado por departamento.',
    'Escolha o departamento que recebe essas mensagens.',
    'Ative Mensagem automática fora de horário de atendimento.',
    'Escreva um recado curto, por exemplo: “Olá!',
    'Responderemos quando a equipe voltar.”',
    'Volte ao departamento e confira se o horário e o recado continuam preenchidos.',
    'O horário e o recado aparecem ao abrir o departamento novamente.',
    'O envio real do recado precisa ser conferido em homologação com uma conta de teste, fora do horário configurado.',
    'Colocar um recado fora do horário',
    'Escolha o horário do departamento e escreva o recado para quando ele estiver fechado.',
    'Abra Departamentos para configurar o horário e escrever o recado que aparece quando a equipe está fechada.',
    'Onde escrevo o recado fora do horário?',
    'Escolha o setor que receberá o recado.',
    'Ative Mensagem automática fora de horário de atendimento e escreva o recado.',
    'Confira se o horário e o recado continuam na tela.',
  ],
};

const confusables = new Map(Object.entries({
  А: 'a', В: 'b', Е: 'e', І: 'i', К: 'k', М: 'm', Н: 'h', О: 'o', Р: 'p', С: 'c', Т: 't', У: 'y', Х: 'x',
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', м: 'm', н: 'h', к: 'k', т: 't', в: 'b',
  Α: 'a', Β: 'b', Ε: 'e', Ζ: 'z', Η: 'h', Ι: 'i', Κ: 'k', Μ: 'm', Ν: 'n', Ο: 'o', Ρ: 'p', Τ: 't', Υ: 'y', Χ: 'x',
  α: 'a', ο: 'o', ρ: 'p', ι: 'i', ν: 'v', τ: 't',
}));
const canonical = (text) => [...text.normalize('NFKD').replace(/\p{Default_Ignorable_Code_Point}/gu, '')]
  .map((char) => confusables.get(char) ?? char).join('')
  .normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/\s+/gu, ' ').trim();
const approvedSentences = Object.fromEntries(Object.entries(approvedGuideSentences)
  .map(([id, sentences]) => [id, new Set(sentences.map(canonical))]));
const controlledTerm = /\b(?:mensag\w*|convers\w*|recad\w*|chat\w*|notifica\w*|perd\w*|recuper\w*|volt\w*|reaparec\w*|sincroniz\w*|chega[m]? depois|aparece[m]? depois|se perde|nao perde)\b/u;

function renderedSentences(text) {
  const visible = text
    .replace(/\{\/\*[\s\S]*?\*\/\}/gu, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/[`*_>#|]/gu, '');
  return visible.split(/\n+/u)
    .flatMap((line) => line.replace(/^\s*\d+\.\s*/u, '').replace(/\s+/gu, ' ').trim()
      .split(/(?<=[.!?])(?:\s+|$)/u))
    .map((sentence) => sentence.trim()).filter(Boolean);
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
      if (controlledTerm.test(normalized) && !approvedSentences[expectedId]?.has(normalized)) {
        throw new Error(`${expectedId}: frase com termo controlado não aprovada: ${sentence}`);
      }
    }
  }
  return guide;
}
