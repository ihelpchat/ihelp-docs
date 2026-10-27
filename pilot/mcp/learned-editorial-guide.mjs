import guide from '../architecture/faq-regua/guia-aprendido.json' with { type: 'json' };

export function learnedLessons(extra = [], base = guide.licoes.filter((item) => item.ativa && !item.vetada)) {
  return [...base, ...extra].map(({ texto, criterio }) => ({ criterio, texto }));
}

export function learnedWriterContract(base = guide.licoes) {
  const allowed = base.filter((item) => !item.vetada && (item.ativa || item.origem === 'regra-do-dono' || item.origem?.classe === 'regra-do-dono'));
  return `Contrato de lições editoriais aprendidas: ${JSON.stringify(learnedLessons([], allowed))}. Aplique apenas quando pertinente à tarefa. Não copie exemplos nem invente fatos do produto.`;
}

export function learnedJudgeAnchors(extra = [], base) {
  return `Âncoras de lições editoriais aprendidas: ${JSON.stringify(learnedLessons(extra,
    base?.filter((item) => item.ativa && !item.vetada)))}. Use para interpretar os critérios pertinentes da rubrica; não altere a escala nem as regras de aceite.`;
}
