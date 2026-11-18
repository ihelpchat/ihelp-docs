import { randomBytes } from 'node:crypto';
import { createBudgetedResponse, responseCostUsd } from './provider-budget.mjs';
import { SOURCES } from './kb-chunk.mjs';
import { logStep } from './agent-session.mjs';
import { runGates } from './agent-gates.mjs';
import { baseHash } from './agent-publish.mjs';
import { factSchema } from './faq-generator-v2.mjs';
import { FAQ_WRITER_GLOSSARY } from './faq-editorial-judge.mjs';
import { learnedWriterContract } from './learned-editorial-guide.mjs';

// Agente editor: um loop de modelo com ferramentas. O modelo decide o que buscar, ler e perguntar;
// as regras abaixo (ordem, tetos, validação do plano) são fixas em código, não em prompt.

const MAX_STEPS = () => Number(process.env.AGENT_MAX_STEPS ?? 24);
const SESSION_BUDGET_USD = () => Number(process.env.AGENT_SESSION_BUDGET_USD ?? 1.5);
const FAQ_PATH = /^docs\/[a-z0-9][a-z0-9/-]*$/;
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const text = { type: 'string' };

const perguntaSchema = object({
  texto: text, tipo: { type: 'string', enum: ['decisao', 'fato', 'sugestao'] },
  opcoes: nullable({ type: 'array', items: text }), obrigatoria: { type: 'boolean' },
});

const fn = (name, description, parameters) => ({ type: 'function', name, description, strict: true, parameters });
export const TOOLS = [
  fn('buscar', 'Busca na base de conhecimento do iHelp (FAQ publicado, API, blog, contexto de negócio, sinais de suporte). Use antes de qualquer outra coisa e sempre que precisar de um fato.',
    object({ query: text, sources: nullable({ type: 'array', items: { type: 'string', enum: SOURCES } }), module: nullable(text) })),
  fn('ler_pagina', 'Lê uma página publicada inteira pelo caminho (ex.: docs/sobre-o-sistema/campanhas).', object({ path: text })),
  fn('ler_codigo', 'Procura no código do produto como uma tela ou regra funciona. Use quando a base não explica o comportamento.',
    object({ topic: text, module: nullable(text) })),
  fn('perguntar', 'Pergunta a quem pediu o FAQ o que a base e o código não respondem (decisão, fato de negócio ou sugestão). Encerra o turno.',
    object({ perguntas: { type: 'array', items: perguntaSchema } })),
  fn('propor_plano', 'Propõe o que fazer: FAQ novo, tópico novo em FAQ existente, atualização ou nada. Encerra o turno.',
    object({
      acao: { type: 'string', enum: ['novo_faq', 'novo_topico', 'atualizar', 'nada'] },
      destino: nullable(object({ path: text, anchor: nullable(text) })),
      relacionados: { type: 'array', items: object({ path: text, motivo: text }) },
      alternativas: { type: 'array', items: object({ path: text, motivo: text }) },
      secoes: { type: 'array', items: object({ titulo: text, tipo: { type: 'string', enum: ['conceito', 'passo_a_passo', 'duvidas', 'erros'] },
        evidencias: { type: 'array', items: text } }) },
      telasAObservar: { type: 'array', items: object({ route: text, objetivo: text }) },
      confirmar: { type: 'boolean' }, perguntas: nullable({ type: 'array', items: perguntaSchema }), motivo: text,
    })),
];

const READ_TOOLS = TOOLS.filter(({ name }) => ['buscar', 'ler_pagina', 'ler_codigo', 'perguntar'].includes(name));
export const WRITE_TOOLS = [...READ_TOOLS,
  fn('escrever', 'Entrega o texto para os juízes (fatos, editorial, segurança). Encerra o turno se aprovado; se reprovado, devolve o que corrigir.',
    object({
      title: text, description: text,
      secoes: { type: 'array', items: object({ titulo: text, unidades: { type: 'array', items: object({
        texto: text, tipo: { type: 'string', enum: ['contexto', 'passo', 'depois'] }, evidencias: { type: 'array', items: text } }) } }) },
    })),
];

const SYSTEM_WRITE = `Você é o redator da central de ajuda do iHelp (plataforma de atendimento por WhatsApp). O plano já foi aceito por quem pediu.
Escreva o conteúdo para clientes iniciantes e entregue com "escrever".

Como trabalhar:
1. Em tópico novo ou atualização, leia a página de destino com "ler_pagina" antes de escrever. Não repita o que ela já diz e mantenha o tom dela.
2. Busque e leia o que faltar. As evidências do plano vêm no pedido; use "buscar", "ler_pagina" e "ler_codigo" para completar.
3. Cada unidade é uma ou poucas frases com "evidencias": ids da busca, caminhos de páginas lidas, ids "autor:..." (o que quem pediu disse) ou "codigo:...".
   - "contexto": explica o que é, para que serve, quando usar, cuidados.
   - "passo": uma ação na tela, na ordem. Não numere; a montagem numera.
   - "depois": o que acontece depois da ação.
4. Em tópico novo ou atualização, entregue só as seções que entram ou mudam. Seção com título igual ao de uma existente substitui a existente. Em "title" e "description" repita os da página.
5. Em FAQ novo, "title" tem de 8 a 120 caracteres e "description" de 40 a 180.

Limites:
- Seu conhecimento geral pode explicar conceito (ex.: o que é bloqueio no WhatsApp). Como o iHelp se comporta, só com evidência. Passo de tela sem evidência não se escreve: pergunte a quem pediu ou deixe fora.
- Frase sem evidência suficiente sai marcada como "a confirmar" e impede publicar em produção. Prefira não escrever.
- Nunca cite fonte, material interno, teste, ambiente de homologação nem dúvida da equipe. Sem dado de teste (nomes, números, contas de ensaio).
- Diga por que e quando usar e o que acontece depois; listar botões não basta. Traga exemplo concreto quando houver evidência.
- Se os juízes reprovarem, corrija só o que foi apontado e chame "escrever" de novo. Há uma única correção.
- Sempre termine o turno com "escrever" ou "perguntar".

${learnedWriterContract()}
Glossário do redator: ${JSON.stringify(FAQ_WRITER_GLOSSARY)}. Use os termos preferidos, preservando rótulos literais de controles do produto.`;

const FACTS_JUDGE = 'Julgue cada afirmação usando somente as evidências. Responda cada id uma vez, em ordem. Para "sustentada", informe os ids exatos das evidências que a sustentam. Explicação de conceito geral, que não afirma como o iHelp se comporta, pode ser "sustentada" sem evidência (evidenceIds vazio). Afirmação sobre comportamento do iHelp, passo de tela ou efeito de uma ação sem evidência que a sustente fica "a confirmar". Se a evidência diz o contrário, "contradiz a fonte". Evidência do tipo "autor" é o que quem pediu o conteúdo disse: sustenta regra de negócio, público e ênfase, mas não sequência de cliques. Rótulo de botão não prova sequência nem funcionamento. Se a frase atribui a informação a fontes internas, documentos ou material de apoio, sourceMention=true. Indicar ao leitor outra página pública da central de ajuda, com ou sem link, é orientação normal: sourceMention=false. "reason" com até 300 caracteres, sem copiar trecho de evidência interna. Não reescreva.';

const SYSTEM = `Você é o editor da central de ajuda do iHelp (plataforma de atendimento por WhatsApp).
Alguém pediu um conteúdo de ajuda em linguagem livre. Seu trabalho neste turno é entender o pedido e chegar a um plano.

Como trabalhar:
1. Comece por "buscar". Descubra o que já existe sobre o assunto antes de qualquer decisão. Faça mais de uma busca, com palavras diferentes das do pedido.
2. Leia as páginas candidatas com "ler_pagina" antes de dizer que cobrem ou não o assunto. Título parecido não basta: "importar contatos" e "exportar contatos" são assuntos diferentes.
3. Decida a ação:
   - "nada": uma página existente já responde o pedido inteiro.
   - "novo_topico": existe uma página do assunto, e o pedido cabe como seção nela.
   - "atualizar": a página existe, mas está errada ou incompleta no que já trata.
   - "novo_faq": não existe página do assunto. Aponte as relacionadas.
4. Se a base não explica como o produto se comporta, use "ler_codigo". Só liste "telasAObservar" quando nem a base nem o código derem os passos da tela.
5. Pergunte a quem pediu quando faltar decisão ou conhecimento de negócio (público, regra, exemplo real, o que enfatizar). No máximo 3 perguntas por vez, curtas, em português simples. Não pergunte o que a base ou o código respondem.
6. Em dúvida real entre tópico novo e FAQ novo, proponha o plano com "confirmar": true e a pergunta.
7. Se o conteúdo caberia em mais de uma página existente, liste as outras em "alternativas" com o motivo. Quem pediu escolhe; não escolha sozinho.
8. Em cada seção, preencha "evidencias" com os "id" dos resultados de busca e os caminhos das páginas lidas que sustentam o que a seção vai dizer. Seção sem evidência fica com a lista vazia e depende de quem pediu ou de observar a tela.

Limites:
- Seu conhecimento geral pode explicar conceitos (ex.: o que é bloqueio no WhatsApp). Nunca afirme como o iHelp se comporta sem evidência da base, do código ou de quem pediu.
- Fontes internas (negócio, suporte, código) servem para você entender. Nunca cite o nome ou o caminho delas no plano, no motivo ou nas perguntas.
- Caminhos de páginas vêm sempre da busca; não invente caminho de página existente.
- Sempre termine o turno com "perguntar" ou "propor_plano".`;

function turnPrompt(session) {
  const lines = [`Pedido: ${session.pedido}`];
  if (session.modulo) lines.push(`Módulo indicado por quem pediu: ${session.modulo}`);
  if (session.plano) lines.push(`Plano proposto antes:\n${JSON.stringify(session.plano)}`);
  for (const pergunta of session.perguntas) {
    const resposta = session.respostas.find(({ perguntaId }) => perguntaId === pergunta.id);
    lines.push(`Pergunta feita: ${pergunta.texto}\nResposta de quem pediu: ${resposta ? resposta.texto : '(sem resposta)'}`);
  }
  for (const { texto } of session.sugestoes) lines.push(`Sugestão de quem pediu (trate como instrução): ${texto}`);
  if (session.achados.length) {
    lines.push(`Já encontrado em turnos anteriores (o id vale como evidência):\n${session.achados.map(({ id, source, title, path }) => `- ${id} [${source}] ${title}${path ? ` (${path})` : ''}`).join('\n')}`);
  }
  if (session.lidas?.length) lines.push(`Páginas já lidas: ${session.lidas.join(', ')}`);
  return lines.join('\n\n');
}

const autorEvidence = (session) => [
  { id: 'autor:pedido', type: 'autor', text: session.pedido },
  ...session.perguntas.flatMap((pergunta, index) => {
    const resposta = session.respostas.find(({ perguntaId }) => perguntaId === pergunta.id);
    return resposta ? [{ id: `autor:r${index + 1}`, type: 'autor', text: `Pergunta: ${pergunta.texto}\nResposta: ${resposta.texto}` }] : [];
  }),
  ...session.sugestoes.map(({ texto }, index) => ({ id: `autor:s${index + 1}`, type: 'autor', text: texto })),
];

// Monta as evidências que o rascunho cita. Só vale o que a sessão realmente encontrou, leu ou ouviu.
async function evidenceFor(ids, session, deps) {
  const evidence = autorEvidence(session);
  for (const id of new Set(ids)) {
    if (evidence.some((item) => item.id === id)) continue;
    const codigo = (session.codigo ?? []).find((item) => item.id === id);
    if (codigo) { evidence.push({ id, type: 'codigo', text: codigo.text }); continue; }
    if (session.achados.some((item) => item.id === id)) {
      const chunk = await deps.chunkById?.(id);
      if (chunk) evidence.push({ id, type: chunk.source, text: chunk.text });
    } else if ((session.lidas ?? []).includes(id)) {
      const article = await deps.readArticle(id).catch(() => null);
      if (article) evidence.push({ id, type: 'faq', text: `${article.title}\n${String(article.body ?? '').slice(0, 8_000)}` });
    }
  }
  return evidence;
}

async function writePrompt(session, deps) {
  const lines = [`Pedido: ${session.pedido}`, `Plano aceito:\n${JSON.stringify(session.plano)}`];
  const cited = [...new Set(session.plano.secoes.flatMap(({ evidencias }) => evidencias ?? []))];
  const evidence = await evidenceFor(cited, session, deps);
  lines.push(`Evidências (use o id em "evidencias"):\n${evidence.map(({ id, type, text }) => `- ${id} [${type}] ${text.slice(0, 1_500)}`).join('\n')}`);
  if (session.lidas?.length) lines.push(`Páginas já lidas (o caminho vale como evidência; releia se precisar do texto): ${session.lidas.join(', ')}`);
  if (session.rascunho && !session.rascunho.gates.aprovado) lines.push(`Rascunho anterior reprovado. Corrija:\n${(session.rascunho.motivos ?? []).join('\n')}`);
  else if (session.rascunho) lines.push(`Rascunho anterior (quem pediu quer ajuste; veja as sugestões "autor:s..."):\n${session.rascunho.mdx.slice(0, 6_000)}`);
  return lines.join('\n\n');
}

const cleanPath = (path) => String(path ?? '').trim().replace(/^\//, '').replace(/#.*$/, '');
const newId = () => randomBytes(6).toString('hex');

function toPerguntas(list) {
  if (!Array.isArray(list) || !list.length) return { erro: 'envie ao menos uma pergunta' };
  if (list.length > 5) return { erro: 'no máximo 5 perguntas por vez' };
  if (list.some(({ texto }) => typeof texto !== 'string' || texto.trim().length < 8 || texto.length > 400)) return { erro: 'pergunta vazia ou longa demais' };
  return { perguntas: list.map(({ texto, tipo, opcoes, obrigatoria }) => ({
    id: newId(), texto: texto.trim(), tipo, obrigatoria: obrigatoria !== false,
    ...(opcoes?.length ? { opcoes: opcoes.slice(0, 6).map((rotulo, index) => ({ id: String(index + 1), rotulo: String(rotulo).slice(0, 120) })) } : {}),
  })) };
}

async function validatePlan(plano, exists, session) {
  const problems = [];
  const known = new Set([...session.achados.map(({ id }) => id), ...(session.lidas ?? [])]);
  const alternativas = (plano.alternativas ?? []).map((item) => ({ ...item, path: cleanPath(item.path) }));
  for (const { path } of alternativas) if (!(await exists(path))) problems.push(`alternativa não existe: ${path}`);
  const secoes = plano.secoes.map((secao) => ({ ...secao, evidencias: [...new Set((secao.evidencias ?? []).map((item) => /^[a-f0-9]{24}$/.test(item) ? item : cleanPath(item)))] }));
  for (const { titulo, evidencias } of secoes) {
    const unknown = evidencias.filter((item) => !known.has(item));
    if (unknown.length) problems.push(`seção "${titulo}": evidência desconhecida (${unknown.join(', ')}); use ids da busca ou caminhos de páginas lidas`);
  }
  const destino = plano.destino ? { ...plano.destino, path: cleanPath(plano.destino.path) } : null;
  const relacionados = plano.relacionados.map((item) => ({ ...item, path: cleanPath(item.path) }));
  for (const { path } of relacionados) if (!(await exists(path))) problems.push(`relacionado não existe: ${path}`);
  if (plano.acao === 'novo_faq') {
    if (!destino || !FAQ_PATH.test(destino.path)) problems.push('novo_faq precisa de destino.path no formato docs/<seção>/<slug>');
    else if (await exists(destino.path)) problems.push(`já existe página em ${destino.path}; use novo_topico ou atualizar`);
    if (!plano.secoes.length) problems.push('liste as seções do FAQ novo');
  } else if (plano.acao === 'novo_topico' || plano.acao === 'atualizar') {
    if (!destino || !(await exists(destino.path))) problems.push('destino.path precisa ser uma página existente, vinda da busca');
    if (!plano.secoes.length) problems.push('liste as seções que entram ou mudam');
  } else if (!relacionados.length && !destino) problems.push('"nada" precisa apontar a página que já responde o pedido');
  if (plano.motivo.trim().length < 20) problems.push('explique o motivo em uma ou duas frases');
  return { problems, plano: { ...plano, destino, relacionados, alternativas, secoes } };
}

// Executa uma chamada de ferramenta. Devolve { output, done? }; done encerra o turno.
async function execute(name, args, session, deps) {
  if (name === 'buscar') {
    try {
      const { hits, degraded } = await deps.search({ query: args.query, sources: args.sources ?? undefined, module: args.module ?? undefined, limit: 8 });
      session.buscas++;
      for (const { chunk } of hits) {
        if (session.achados.length >= 150 || session.achados.some(({ id }) => id === chunk.id)) continue;
        session.achados.push({ id: chunk.id, source: chunk.source, title: chunk.title, path: chunk.visibility === 'publica' ? chunk.ref.path : null });
      }
      logStep(session, 'buscar', `"${args.query}" → ${hits.length} resultado(s)${degraded ? ' (só por palavra)' : ''}`);
      return { output: { degraded, hits: hits.map(({ chunk, why }) => ({ id: chunk.id, source: chunk.source, module: chunk.module,
        title: chunk.title, path: chunk.ref.path ?? null, anchor: chunk.ref.anchor ?? null, text: chunk.text.slice(0, 600), why })) } };
    } catch (error) { return { output: { erro: error.message } }; }
  }
  if (name === 'ler_pagina') {
    try {
      const article = await deps.readArticle(cleanPath(args.path));
      session.lidas ??= [];
      if (!session.lidas.includes(cleanPath(args.path))) session.lidas.push(cleanPath(args.path));
      logStep(session, 'ler_pagina', cleanPath(args.path));
      return { output: { path: cleanPath(args.path), title: article.title, description: article.description, body: String(article.body ?? '').slice(0, 8_000) } };
    } catch (error) { return { output: { erro: error.message } }; }
  }
  if (name === 'ler_codigo') {
    try {
      const context = await deps.searchCode(args.topic, args.module ?? session.modulo ?? '');
      session.codigo ??= [];
      const matches = (context.matches ?? []).slice(0, 8).map(({ repository, path, line, excerpt }) => {
        const item = { id: `codigo:${session.codigo.length + 1}`, repository, path, line, excerpt: String(excerpt ?? '').slice(0, 1_200) };
        if (session.codigo.length < 40) session.codigo.push({ id: item.id, text: `${path}:${line}\n${item.excerpt}` });
        return item;
      });
      logStep(session, 'ler_codigo', `"${args.topic}" → ${matches.length} trecho(s)`);
      return { output: matches.length ? { matches } : { erro: 'código do produto indisponível ou sem trecho sobre isso neste ambiente' } };
    } catch { return { output: { erro: 'código do produto indisponível neste ambiente' } }; }
  }
  if (!session.buscas) return { output: { erro: 'busque na base antes de perguntar ou propor plano' } };
  if ((name === 'escrever') !== (session.modo === 'escrever') && name !== 'perguntar') return { output: { erro: `"${name}" não vale nesta etapa` } };
  if (name === 'escrever') return write(args, session, deps);
  if (name === 'perguntar') {
    const result = toPerguntas(args.perguntas);
    if (result.erro) return { output: result };
    session.perguntas.push(...result.perguntas);
    session.estado = 'aguardando_usuario';
    logStep(session, 'perguntar', `${result.perguntas.length} pergunta(s) para quem pediu`);
    return { output: { ok: true }, done: true };
  }
  if (name === 'propor_plano') {
    const { perguntas: asked, ...raw } = args;
    const { problems, plano } = await validatePlan(raw, deps.pageExists, session);
    if (problems.length) return { output: { erro: 'plano recusado', problemas: problems } };
    let perguntas = [];
    if (asked?.length) {
      const result = toPerguntas(asked);
      if (result.erro) return { output: result };
      perguntas = result.perguntas;
    } else if (plano.alternativas.length && !session.destinoConfirmado) {
      // Mais de um destino possível: quem pediu escolhe, não o agente.
      perguntas = [{ id: newId(), texto: 'Onde este conteúdo deve entrar?', tipo: 'decisao', obrigatoria: true,
        opcoes: [plano.destino, ...plano.alternativas].filter(Boolean).slice(0, 6).map(({ path }, index) => ({ id: String(index + 1), rotulo: path })) }];
      session.destinoConfirmado = true;
    } else if (plano.confirmar) {
      perguntas = [{ id: newId(), texto: 'Posso seguir com este plano?', tipo: 'decisao', obrigatoria: true,
        opcoes: [{ id: '1', rotulo: 'Sim, seguir' }, { id: '2', rotulo: 'Ajustar (diga o que mudar)' }] }];
    }
    session.plano = plano;
    session.perguntas.push(...perguntas);
    session.estado = perguntas.length ? 'aguardando_usuario' : 'plano_pronto';
    logStep(session, 'propor_plano', `${plano.acao}${plano.destino ? ` em ${plano.destino.path}` : ''}${perguntas.length ? ' (aguarda confirmação)' : ''}`);
    return { output: { ok: true }, done: true };
  }
  return { output: { erro: `ferramenta desconhecida: ${name}` } };
}

const judgeModel = (deps) => deps.judgeModel ?? process.env.AGENT_JUDGE_MODEL ?? deps.model ?? process.env.AGENT_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-6-luna';

// Chamada de juiz: resposta estruturada, cobrada na sessão mesmo se o resultado vier inválido.
async function judgeCall(session, deps, name, schema, instructions, content) {
  const response = await callModel({ model: judgeModel(deps), store: false, reasoning: { effort: 'medium' }, max_output_tokens: 8_000,
    instructions, input: [{ role: 'user', content }], text: { format: { type: 'json_schema', name, strict: true, schema } } }, deps);
  session.custoUsd += responseCostUsd(response.usage, deps.budget) ?? 0;
  if (response.status && response.status !== 'completed') throw new Error('Um juiz não concluiu a leitura. Chame faq_responder para tentar de novo.');
  return response;
}

async function write(args, session, deps) {
  const { plano } = session;
  if (!plano || plano.acao === 'nada') return { output: { erro: 'não há plano de escrita nesta sessão' } };
  const unidade = ({ texto, tipo, evidencias }) => ({ texto, tipo,
    evidenceIds: [...new Set((evidencias ?? []).map((id) => /^(?:[a-f0-9]{24}|autor:|codigo:)/.test(id) ? id : cleanPath(id)))] });
  const rascunho = { path: plano.destino.path, acao: plano.acao, title: args.title, description: args.description,
    secoes: (args.secoes ?? []).map(({ titulo, unidades }) => ({ titulo, unidades: (unidades ?? []).map(unidade) })) };
  const evidence = await evidenceFor(rascunho.secoes.flatMap(({ unidades }) => unidades.flatMap(({ evidenceIds }) => evidenceIds)), session, deps);
  const existingRaw = plano.acao === 'novo_faq' ? null : await deps.readRaw(plano.destino.path).catch(() => null);
  const result = await runGates(rascunho, { evidence, existingRaw, module: session.modulo, providers: {
    judgeFacts: async (claims, facts) => JSON.parse((await judgeCall(session, deps, 'faq_agent_facts', factSchema, FACTS_JUDGE,
      JSON.stringify({ claims, evidence: facts.map(({ id, type, text }) => ({ id, type, text })) }))).output_text),
    editorial: async ({ instructions, input, schema }) => {
      const response = await judgeCall(session, deps, 'faq_agent_editorial', schema, instructions, input);
      return { output_text: response.output_text, usage: response.usage };
    },
  } });
  // Problema de forma (evidência desconhecida, tamanho) não gasta a correção: o agente ajusta e reenvia.
  if (!result.gates.estrutura.ok) return { output: { erro: 'rascunho recusado antes dos juízes', problemas: result.motivos } };
  session.tentativasEscrita = (session.tentativasEscrita ?? 0) + 1;
  session.rascunho = { revisao: result.revisao, mdx: result.mdx, gates: result.gates, pendencias: result.pendencias, motivos: result.motivos, previewUrl: null,
    baseSha256: baseHash(existingRaw) };
  const resumo = `${result.gates.fatos.sustentadas} frase(s) sustentada(s), ${result.gates.fatos.aConfirmar.length} a confirmar, ${result.gates.fatos.contradicoes.length} contradição(ões)`;
  if (result.gates.aprovado) {
    session.estado = 'rascunho_pronto';
    logStep(session, 'escrever', `aprovado pelos juízes: ${resumo}`);
    return { output: { ok: true }, done: true };
  }
  if (session.tentativasEscrita >= 2) {
    session.estado = 'reprovado';
    session.motivo = 'Os juízes reprovaram o texto duas vezes. Veja faq_rascunho e mande uma sugestão por faq_responder para nova tentativa.';
    logStep(session, 'escrever', `reprovado de novo: ${resumo}`);
    return { output: { ok: false }, done: true };
  }
  logStep(session, 'escrever', `reprovado, uma correção: ${resumo}`);
  return { output: { reprovado: true, corrija: result.motivos } };
}

async function callModel(payload, deps) {
  if (deps.client && !deps.budget) return deps.client.responses.create(payload);
  const result = await createBudgetedResponse(deps.client, payload, { ...deps.budget, acceptToolCalls: true });
  if (result.kind !== 'ok') throw new Error(result.kind === 'budget_exhausted' ? 'Orçamento diário da IA esgotado' : 'Resposta da IA indisponível');
  return result.response;
}

function pause(session, motivo) {
  session.estado = 'aguardando_usuario';
  session.motivo = motivo;
  logStep(session, 'pausa', motivo);
}

/**
 * Roda um turno do agente até ele perguntar, propor plano ou bater num teto.
 * No modo "escrever" (session.modo), o turno vai até o texto passar pelos juízes ou ser reprovado.
 * deps: { client, budget?, model?, judgeModel?, search, readArticle, readRaw, chunkById, pageExists, searchCode, save, maxSteps?, sessionBudgetUsd? }
 */
export async function runTurn(session, deps) {
  const maxSteps = deps.maxSteps ?? MAX_STEPS();
  const budgetUsd = deps.sessionBudgetUsd ?? SESSION_BUDGET_USD();
  const writing = session.modo === 'escrever';
  const closing = writing ? '"escrever" ou "perguntar"' : '"perguntar" ou "propor_plano"';
  const input = [{ role: 'user', content: writing ? await writePrompt(session, deps) : turnPrompt(session) }];
  session.estado = 'trabalhando';
  session.motivo = null;
  let idle = 0;
  for (;;) {
    if (session.passos >= maxSteps) { pause(session, `Parei no limite de ${maxSteps} passos. Diga como seguir ou refine o pedido.`); break; }
    if (session.custoUsd >= budgetUsd) { pause(session, `Parei no limite de custo da sessão (US$ ${budgetUsd.toFixed(2)}).`); break; }
    const response = await callModel({
      model: deps.model ?? process.env.AGENT_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-6-luna',
      store: false, reasoning: { effort: 'medium' }, include: ['reasoning.encrypted_content'],
      max_output_tokens: writing ? 12_000 : 6_000, instructions: writing ? SYSTEM_WRITE : SYSTEM, input, tools: writing ? WRITE_TOOLS : TOOLS, parallel_tool_calls: true,
    }, deps);
    session.passos++;
    session.custoUsd += responseCostUsd(response.usage, deps.budget) ?? 0;
    const output = response.output ?? [];
    const calls = output.filter((item) => item.type === 'function_call');
    input.push(...output);
    if (!calls.length) {
      if (++idle >= 2) { pause(session, writing ? 'Não consegui fechar o texto. Mande uma sugestão para eu tentar de novo.' : 'Não consegui fechar um plano. Reescreva o pedido com mais detalhes.'); break; }
      input.push({ role: 'user', content: `Termine o turno chamando ${closing}.` });
      continue;
    }
    let done = false;
    for (const call of calls) {
      let args;
      try { args = JSON.parse(call.arguments || '{}'); } catch { args = null; }
      const result = done ? { output: { erro: 'turno já encerrado' } }
        : args ? await execute(call.name, args, session, deps) : { output: { erro: 'argumentos inválidos' } };
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result.output) });
      done ||= result.done === true;
    }
    await deps.save(session);
    if (done) break;
  }
  await deps.save(session);
  return session;
}
