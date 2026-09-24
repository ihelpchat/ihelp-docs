const FIELDS = ['assistantQuestion', 'assistantOverview', 'assistantInitialSteps', 'assistantSuggestions'];
const ACTION = /\b(?:abra|acesse|clique|escolha|selecione|confira|verifique|corrija|configure|crie|digite|insira|envie|importe|pesquise|revise|localize|inicie|conclua|adicione)\b/i;
const normalized = (value) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim();

export function conversationalIssues(article) {
  const issues = [];
  if (!FIELDS.some((field) => Object.hasOwn(article, field))) return issues;
  for (const field of FIELDS) if (!Object.hasOwn(article, field) || article[field] === undefined || article[field] === null) issues.push(`${field} obrigatório no contrato conversacional`);
  const question = article.assistantQuestion;
  if (typeof question !== 'string' || question.trim().length < 10 || question.trim().length > 120 || !question.trim().endsWith('?')) issues.push('assistantQuestion precisa ser uma pergunta canônica não vazia');
  const overview = article.assistantOverview;
  if (typeof overview !== 'string' || overview.trim().length < 45 || overview.trim().length > 200 || !ACTION.test(overview)) issues.push('assistantOverview precisa ser curta e orientar iniciante com ação concreta');
  const count = article.assistantInitialSteps;
  if (!Number.isInteger(count) || count < 1 || count > 3) issues.push('assistantInitialSteps precisa ser inteiro entre 1 e 3');
  const numbered = [...String(article.body ?? '').matchAll(/^\s*\d+\.\s+(.+)$/gm)].map((match) => match[1].trim());
  const prose = String(article.body ?? '').split(/[.!?](?:\s|$)/).map((part) => part.trim()).filter((part) => ACTION.test(part));
  const steps = numbered.length ? numbered : prose;
  if (Number.isInteger(count) && count >= 1 && count <= 3) {
    const initial = steps.slice(0, count);
    if (initial.length < count || initial.some((step) => step.length < 20 || !ACTION.test(step)) || new Set(initial.map(normalized)).size !== initial.length) issues.push('assistantInitialSteps exige passos iniciais concretos, suficientes e sem duplicação no body');
  }
  const suggestions = article.assistantSuggestions;
  if (!Array.isArray(suggestions) || suggestions.length < 1 || suggestions.length > 3 || suggestions.some((item) => typeof item !== 'string' || item.trim().length < 15 || item.trim().length > 100 || !(/\?$/.test(item.trim()) || ACTION.test(item))) || new Set((Array.isArray(suggestions) ? suggestions : []).filter((item) => typeof item === 'string').map(normalized)).size !== suggestions?.length) issues.push('assistantSuggestions precisa ter de 1 a 3 sugestões distintas e acionáveis');
  return issues;
}
