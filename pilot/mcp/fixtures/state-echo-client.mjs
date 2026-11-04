// Provedor falso que narra a partir dos fatos recebidos: no acompanhamento guiado, o serviço envia um
// ESTADO DO GUIA com a pergunta sugerida (diagnóstico, ramo opcional) ou a confirmação documentada; a
// narração "do modelo" neste fixture é exatamente esse fato, para os testes de estado continuarem
// determinísticos sem reintroduzir texto fixo no serviço.
export function stateNarration(request, fallback) {
  const prompt = request.input?.at(-1)?.content ?? '';
  const suggested = prompt.match(/Pergunta sugerida: (.+)$/m)?.[1] ?? prompt.match(/Como confirmar: (.+)$/m)?.[1];
  return suggested ? suggested.trim() : fallback;
}

const sourceChunks = (request) => (request.input?.at(-1)?.content ?? '').split(/\n\n---\n\n/);

/** URL da FONTE 1 do prompt (a fonte que o serviço colocou em primeiro). */
export function firstSourcePath(request) {
  return sourceChunks(request)[0].match(/^URL: (\S+)$/m)?.[1] ?? null;
}

/** Os primeiros passos documentados de uma fonte do prompt (por URL; sem URL, a FONTE 1), como um modelo que copia o texto da fonte. */
export function documentedSteps(request, count = 1, path = null) {
  const chunks = sourceChunks(request);
  const chunk = (path && chunks.find((item) => item.includes(`\nURL: ${path}\n`))) ?? chunks[0];
  const block = chunk.match(/PASSOS DOCUMENTADOS:\n([\s\S]*?)(?:\n(?:TELAS DOCUMENTADAS|MÍDIA DISPONÍVEL|AÇÃO )|$)/)?.[1] ?? '';
  return block.split('\n').map((line) => line.match(/^(?:\d+\.|faq-\d+-step-\d+:)\s+(.+)$/)?.[1]).filter(Boolean)
    .slice(0, count).map((text) => ({ text: text.trim(), actionId: null, imagePath: null }));
}

export function firstDocumentedStep(request) {
  return documentedSteps(request, 1);
}

/** Cliente completo: triagem "sem guia", narração pelo estado, passos conforme `steps` (ou o primeiro documentado). */
export function stateEchoClient({ answer = 'Orientação inicial.', steps = 'first', sources = [], suggestions = [], model = 'fixture', onRequest } = {}) {
  return { responses: { create: async (request) => {
    if (request.text?.format?.name === 'triagem_fechada') {
      return { status: 'completed', output_text: '{"choice":"sem guia"}', usage: { input_tokens: 1, output_tokens: 1 } };
    }
    onRequest?.(request);
    const body = {
      plan: { intent: 'execute', optionalBranch: 'unspecified' },
      answer: stateNarration(request, answer), sections: [],
      steps: steps === 'first' ? firstDocumentedStep(request) : steps,
      code: null, sources, suggestions, resolution: 'complete', found: true,
    };
    return { model, status: 'completed', usage: { input_tokens: 1, output_tokens: 1 }, output_text: JSON.stringify(body) };
  } } };
}
