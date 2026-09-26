import { stem } from './closed-router.mjs';
import { diagnosisFor, intentOf } from './real-state.mjs';

export const PROCEDURE_ACTIONS = Object.freeze([
  'criar', 'adicionar', 'conectar', 'reconectar', 'excluir', 'editar', 'configurar',
  'transferir', 'importar', 'exportar', 'ativar', 'desativar', 'encontrar',
]);
const actionStems = new Map(PROCEDURE_ACTIONS.map((action) => [stem(action), action]));
const plain = (value) => String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const procedure = /\b(?:como|onde|qual o caminho|e possivel|tem como|consigo|da para|passo a passo)\b/u;

/** Only a single known procedure verb is a usable equivalence key. */
export function actionForQuestion(question) {
  const found = new Set((plain(question).match(/[a-z0-9]+/gu) ?? []).map(stem)
    .map((word) => actionStems.get(word)).filter(Boolean));
  return found.size === 1 ? [...found][0] : undefined;
}

/** An unrecognized symptom is reviewed by a person, never assumed to be usage. */
export function issueForQuestion(question, context) {
  const cause = diagnosisFor(question, context, intentOf(question, context)).cause;
  if (cause === 'permission') return 'permission';
  if (cause === 'bug_incident') return 'incident';
  if (cause !== 'usage') return 'account_state';
  return procedure.test(plain(question)) ? 'usage' : 'unknown';
}
