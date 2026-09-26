import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { parseGuide } from '../architecture/conversation-v1.mjs';
import { diagnoseState, escalationFor, sanitizeWidgetContext } from './real-state.mjs';
import { guideStateToken, validGuideStateToken } from './opaque-id.mjs';

const plain = (value) => String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
const human = (value) => /(?:falar com (?:uma )?pessoa|falar com (?:um )?humano|atendimento|suporte)/.test(value);
const failure = (value) => /(?:deu certo\? nao|nao deu certo|nao funcionou)/.test(value);

async function publishedGuide(root, guideId) {
  const base = join(root, 'content/docs');
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await visit(file);
        if (found) return found;
      } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
        const raw = await readFile(file, 'utf8');
        const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatter) continue;
        const parsed = parseDocument(frontmatter[1]);
        if (parsed.errors.length) continue;
        const metadata = parsed.toJS();
        if (metadata?.guide?.guideId !== guideId) continue;
        return { guide: parseGuide(metadata.guide), title: metadata.title, path: `/${file.slice(base.length + 1).replace(/\/index\.mdx$|\.mdx$/u, '')}` };
      }
    }
    return null;
  }
  return visit(base);
}

function predecessor(guide, stepId) {
  const direct = guide.steps.findIndex((step) => step.stepId === stepId);
  const choice = guide.steps.find((step) => step.choices?.some((item) => item.nextStepId === stepId));
  return choice ?? guide.steps[direct - 1];
}

function reply(source, step, answer, options = {}) {
  const state = {
    guideId: source.guide.guideId, stepId: step.stepId,
    version: source.guide.version, mode: source.guide.mode,
    ...(step.choices?.length ? { pendingChoiceId: step.stepId } : {}),
    stateToken: guideStateToken(source.guide.guideId, source.guide.version, step.stepId),
  };
  return {
    answer,
    steps: [{ text: step.text }],
    sources: [{ title: source.title, path: source.path }],
    suggestions: step.choices?.map((choice) => choice.label) ?? ['Concluí este passo', 'Preciso de ajuda'],
    resolution: 'complete', found: true, guide: state,
    ...options,
  };
}

export async function answerGuide(root, question, state, options = {}) {
  const command = plain(question);
  const source = await publishedGuide(root, state.guideId);
  const context = sanitizeWidgetContext(options.widgetContext);
  const guide = source?.guide;
  const current = guide?.steps.find((step) => step.stepId === state.stepId);
  if (human(command) || failure(command)) {
    const subject = state.guideId.replaceAll('-', ' ');
    const diagnosis = diagnoseState(subject, context);
    const escalation = escalationFor(subject, diagnosis, context, []);
    escalation.attempts = failure(command) ? ['documented_guide', 'reported_stuck'] : ['documented_guide'];
    const answer = 'Vou passar seu caso a uma pessoa com o guia e o passo em que você parou.';
    if (!source || !current || state.version !== guide.version || state.mode !== guide.mode) {
      return { answer, steps: [], suggestions: [], resolution: 'partial', found: false, diagnosis, escalation };
    }
    return reply(source, current, answer, {
      steps: [], suggestions: [], resolution: 'partial', diagnosis, escalation,
    });
  }
  const safe = { answer: 'Não consegui continuar este guia. Você pode recomeçar ou falar com uma pessoa.', steps: [],
    suggestions: ['Recomeçar', 'Falar com uma pessoa'], resolution: 'not_found', found: false };
  if (!source || !current || state.version !== guide.version || state.mode !== guide.mode) return safe;
  const tokenValid = validGuideStateToken(state.stateToken, guide.guideId, guide.version, current.stepId);
  if ((state.stateToken && !tokenValid) || (current.stepId !== guide.initialStepId && !tokenValid)) return safe;
  const advancing = /(?:avancar|proximo|conclui|feito)/.test(command);
  const concluding = /(?:deu certo\? sim|deu certo|finalizar|concluir guia)/.test(command);
  if ((advancing || concluding || state.choiceId) && !tokenValid) return safe;
  if (state.choiceId && (!state.pendingChoiceId || state.pendingChoiceId !== current.stepId)) {
    return safe;
  }
  if (state.pendingChoiceId && state.pendingChoiceId !== current.stepId) {
    return safe;
  }
  if (command === 'preciso de ajuda' || /nao encontrei/.test(command)) {
    return reply(source, current, 'Vamos conferir esta etapa. Veja a ação abaixo e me diga onde parou.');
  }
  if (command === 'voltar' || command === 'passo anterior') {
    const previous = predecessor(guide, current.stepId) ?? current;
    options.onResolvedStep?.({ guideId: guide.guideId, stepId: previous.stepId });
    return reply(source, previous, 'Voltamos ao passo anterior.');
  }
  if (current.choices?.length) {
    const choice = current.choices.find((item) => item.id === state.choiceId && state.pendingChoiceId === current.stepId);
    if (!choice) return reply(source, current, 'Escolha uma das opções deste passo.');
    const selected = guide.steps.find((step) => step.stepId === choice.nextStepId) ?? current;
    options.onResolvedStep?.({ guideId: guide.guideId, stepId: selected.stepId });
    return reply(source, selected, 'Vamos seguir pela opção escolhida.');
  }
  if (state.choiceId) return safe;
  const index = guide.steps.findIndex((step) => step.stepId === current.stepId);
  const branched = guide.steps.some((step) => step.choices?.some((choice) => choice.nextStepId === current.stepId));
  const next = branched ? null : guide.steps[index + 1];
  if (concluding) {
    if (next) return safe;
    return reply(source, current, 'Você concluiu o guia.', { steps: [], suggestions: [] });
  }
  if (!next || !advancing) {
    return reply(source, current, next ? 'Este é o passo atual.' : 'Você chegou ao último passo. Deu certo?');
  }
  options.onResolvedStep?.({ guideId: guide.guideId, stepId: next.stepId });
  return reply(source, next, 'Vamos para o próximo passo.');
}
