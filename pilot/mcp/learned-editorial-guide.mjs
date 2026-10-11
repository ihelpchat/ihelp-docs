import guide from '../architecture/faq-regua/guia-aprendido.json' with { type: 'json' };

export function learnedLessons(extra = []) {
  return [...guide.licoes.filter((item) => !item.vetada), ...extra].map(({ texto, criterio }) => ({ criterio, texto }));
}

export function learnedWriterContract() {
  return `Contrato de lições editoriais aprendidas: ${JSON.stringify(learnedLessons())}. Aplique apenas quando pertinente à tarefa. Não copie exemplos nem invente fatos do produto.`;
}

export function learnedJudgeAnchors(extra = []) {
  return `Âncoras de lições editoriais aprendidas: ${JSON.stringify(learnedLessons(extra))}. Use para interpretar os critérios pertinentes da rubrica; não altere a escala nem as regras de aceite.`;
}
