import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { parseGuide } from '../architecture/conversation-v1.mjs';
import { resolveCatalogAction } from '../architecture/catalog-action.mjs';
import actions from '../architecture/product-actions.json' with { type: 'json' };
import { diagnoseState, escalationFor, sanitizeWidgetContext } from './real-state.mjs';
import { guideStateToken, guideStatePath } from './opaque-id.mjs';

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

function reply(source, step, answer, options = {}) {
  const { path = [step.stepId], ...rest } = options;
  const state = {
    guideId: source.guide.guideId, stepId: step.stepId,
    version: source.guide.version, mode: source.guide.mode,
    ...(step.choices?.length ? { pendingChoiceId: step.stepId } : {}),
    stateToken: guideStateToken(source.guide, path),
  };
  return {
    answer,
    steps: [{ text: step.text, ...(step.actionId ? { action: resolveCatalogAction({ id: step.actionId, route: actions[step.actionId].route }) } : {}) }],
    sources: [{ title: source.title, path: source.path }],
    suggestions: step.choices?.map((choice) => choice.label)
      ?? (guideLastStep(source.guide, step) ? ['Deu certo? Sim', 'Deu certo? Não', 'Preciso de ajuda'] : ['Concluí este passo', 'Preciso de ajuda']),
    resolution: 'in_progress', found: true, guide: state,
    ...(step.choices?.length ? { guideChoices: step.choices.map(({ id, label }) => ({ id, label })) } : {}),
    ...rest,
  };
}

function nextStep(guide, step) {
  if (step.choices?.length) return null;
  const parent = guide.steps.find((candidate) => candidate.choices?.some((choice) => choice.nextStepId === step.stepId));
  if (parent) {
    const lastBranch = Math.max(...parent.choices.map((choice) => guide.steps.findIndex((candidate) => candidate.stepId === choice.nextStepId)));
    return guide.steps[lastBranch + 1] ?? null;
  }
  return guide.steps[guide.steps.findIndex((candidate) => candidate.stepId === step.stepId) + 1] ?? null;
}

function guideLastStep(guide, step) {
  return !step.choices?.length && !nextStep(guide, step);
}

export async function answerGuide(root, question, state, options = {}) {
  const command = plain(question);
  const source = await publishedGuide(root, state.guideId);
  const context = sanitizeWidgetContext(options.widgetContext);
  const guide = source?.guide;
  const current = guide?.steps.find((step) => step.stepId === state.stepId);
  if (command === 'recomecar') {
    if (!source) return { answer: 'Este guia não está mais disponível. Fale com uma pessoa.', steps: [],
      suggestions: ['Falar com uma pessoa'], resolution: 'not_found', found: false };
    const initial = guide.steps.find((step) => step.stepId === guide.initialStepId);
    return reply(source, initial, 'Vamos recomeçar pelo primeiro passo.');
  }
  if (human(command) || failure(command)) {
    const subject = state.guideId.replaceAll('-', ' ');
    const diagnosis = diagnoseState(subject, context);
    const escalation = escalationFor(subject, diagnosis, context, []);
    escalation.attempts = failure(command) ? ['documented_guide', 'reported_stuck'] : ['documented_guide'];
    if (source && current) {
      escalation.guideId = guide.guideId;
      escalation.stepId = current.stepId;
    }
    const answer = 'Vou passar seu caso a uma pessoa com o guia e o passo em que você parou.';
    if (!source || !current || state.version !== guide.version || state.mode !== guide.mode) {
      return { answer, steps: [], suggestions: [], resolution: 'partial', found: false, diagnosis, escalation };
    }
    return reply(source, current, answer, {
      steps: [], suggestions: [], resolution: 'partial', diagnosis, escalation,
    });
  }
  const safeStep = current ?? guide?.steps.find((step) => step.stepId === guide.initialStepId);
  const safe = { answer: 'Não consegui continuar este guia. Você pode recomeçar ou falar com uma pessoa.', steps: [],
    suggestions: ['Recomeçar', 'Falar com uma pessoa'], resolution: 'not_found', found: false,
    ...(source && safeStep ? { guide: { guideId: guide.guideId, stepId: safeStep.stepId, version: guide.version, mode: guide.mode } } : {}) };
  if (!source || !current || state.version !== guide.version || state.mode !== guide.mode) return safe;
  const path = guideStatePath(state.stateToken, guide, current.stepId);
  const tokenValid = Boolean(path);
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
    return reply(source, current, 'Vamos conferir esta etapa. Veja a ação abaixo e me diga onde parou.', { path: path ?? [current.stepId] });
  }
  if (command === 'voltar' || command === 'passo anterior') {
    const previousPath = path?.length > 1 ? path.slice(0, -1) : [current.stepId];
    const previous = guide.steps.find((step) => step.stepId === previousPath.at(-1));
    options.onResolvedStep?.({ guideId: guide.guideId, stepId: previous.stepId });
    return reply(source, previous, 'Voltamos ao passo anterior.', { path: previousPath });
  }
  if (current.choices?.length) {
    const choice = current.choices.find((item) => item.id === state.choiceId && state.pendingChoiceId === current.stepId);
    if (!choice) return reply(source, current, 'Escolha uma das opções deste passo.', { path });
    const selected = guide.steps.find((step) => step.stepId === choice.nextStepId) ?? current;
    options.onResolvedStep?.({ guideId: guide.guideId, stepId: selected.stepId });
    return reply(source, selected, 'Vamos seguir pela opção escolhida.', { path: [...path, selected.stepId] });
  }
  if (state.choiceId) return safe;
  const next = nextStep(guide, current);
  if (concluding) {
    if (next) return safe;
    return reply(source, current, 'Você concluiu o guia.', { path, steps: [], suggestions: [], resolution: 'complete' });
  }
  if (!next || !advancing) {
    return reply(source, current, next ? 'Este é o passo atual.' : 'Você chegou ao último passo. Deu certo?', { path: path ?? [current.stepId] });
  }
  options.onResolvedStep?.({ guideId: guide.guideId, stepId: next.stepId });
  return reply(source, next, 'Vamos para o próximo passo.', { path: [...path, next.stepId] });
}
