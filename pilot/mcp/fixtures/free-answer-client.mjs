// Mantém fixtures antigas de resposta livre quando a base também publica guias.
export const freeAnswerClient = (client) => ({ responses: { create: (request, options) =>
  request.text?.format?.name === 'triagem_fechada'
    ? Promise.resolve({ status: 'completed', output_text: '{"choice":"sem guia"}', usage: { input_tokens: 1, output_tokens: 1 } })
    : client.responses.create(request, options) } });
