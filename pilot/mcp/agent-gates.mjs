import { createHash } from 'node:crypto';
import { judgeClaims, splitClaims } from './faq-editorial.mjs';
import { judgeEditorial, consolidateEditorialReadings } from './faq-editorial-judge.mjs';
import { assembleFaqPage, faqFrontmatter } from './faq-generator-v2.mjs';
import { validateFaqMdx } from './faq-mdx-safety.mjs';
import { containsSensitiveData } from './sensitive-data.mjs';
import { mentionsSource } from './source-mention.mjs';

// Gates fixos do rascunho do agente: o agente propõe, isto decide. Nada aqui é novo julgamento:
// juiz de fatos (judgeClaims), juiz editorial em três leituras, segurança e montagem são os do gerador v2.

const fold = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const renderSections = (sections) => assembleFaqPage({ title: '', sections }).replace(/^# *\n\n/, '');
const unmarked = (text) => text.replace(/<\/?AConfirmar>/gu, '');

/** Tópico novo ou atualização: seção de mesmo título substitui a existente; as outras entram no fim. */
export function mergeIntoPage(raw, sections) {
  const blocks = String(raw).split(/\n(?=## )/).map((block) => block.replace(/\s+$/, ''));
  for (const section of sections) {
    const rendered = renderSections([section]);
    const index = blocks.findIndex((block, position) => position > 0
      && fold(block.split('\n', 1)[0].replace(/^## /, '')) === fold(section.heading));
    if (index > 0) blocks[index] = rendered; else blocks.push(rendered);
  }
  return `${blocks.join('\n\n')}\n`;
}

function structureProblems(rascunho, known, existingRaw) {
  const problems = [];
  const novo = rascunho.acao === 'novo_faq';
  if (!/^docs\/[a-z0-9][a-z0-9/-]*$/.test(rascunho.path ?? '')) problems.push('caminho da página inválido');
  if (!novo && !existingRaw) problems.push('página de destino indisponível');
  if (novo) {
    const title = String(rascunho.title ?? '').trim(), description = String(rascunho.description ?? '').trim();
    if (title.length < 8 || title.length > 120) problems.push('título precisa ter de 8 a 120 caracteres');
    if (description.length < 40 || description.length > 180) problems.push('descrição precisa ter de 40 a 180 caracteres');
  }
  if (!rascunho.secoes?.length) problems.push('rascunho sem seções');
  for (const secao of rascunho.secoes ?? []) {
    const titulo = String(secao.titulo ?? '').trim();
    if (titulo.length < 3 || titulo.length > 120) problems.push(`título de seção inválido: "${titulo}"`);
    if (!secao.unidades?.length) problems.push(`seção "${titulo}" sem texto`);
    for (const unidade of secao.unidades ?? []) {
      if (String(unidade.texto ?? '').trim().length < 8) problems.push(`seção "${titulo}": frase vazia ou curta demais`);
      if (/^\s*\d+[.)]\s/u.test(unidade.texto ?? '')) problems.push(`seção "${titulo}": não numere os passos; a montagem numera`);
      const unknown = (unidade.evidenceIds ?? []).filter((id) => !known.has(id));
      if (unknown.length) problems.push(`seção "${titulo}": evidência desconhecida (${unknown.join(', ')})`);
    }
  }
  return problems;
}

const emptyGates = (estrutura) => ({ aprovado: false, fatos: { sustentadas: 0, aConfirmar: [], contradicoes: [] },
  editorial: { aceite: false, notas: {}, defeitosGraves: [] }, seguranca: { ok: true, problemas: [] },
  estrutura: { ok: estrutura.length === 0, problemas: estrutura } });

/**
 * rascunho: { path, title, description, acao, secoes: [{ titulo, unidades: [{ texto, tipo, evidenceIds }] }] }
 * evidence: [{ id, type, text }]
 * providers: { judgeFacts(claims, evidence) → { claims }, editorial({ instructions, input, schema }) → { output_text, usage } }
 * Devolve { gates, mdx, revisao, motivos }. "motivos" é só para o agente corrigir; não sai pelo MCP.
 */
export async function runGates(rascunho, { evidence = [], existingRaw = null, module = null, providers }) {
  const estrutura = structureProblems(rascunho, new Set(evidence.map(({ id }) => id)), existingRaw);
  if (estrutura.length) return { gates: emptyGates(estrutura), mdx: null, revisao: null, motivos: estrutura };
  const novo = rascunho.acao === 'novo_faq';
  const title = String(rascunho.title ?? '').trim(), description = String(rascunho.description ?? '').trim();
  const units = rascunho.secoes.flatMap((secao, s) => secao.unidades.map((unidade) => ({
    text: unidade.texto.trim(), kind: unidade.tipo, field: `secoes[${s}]`, taskId: null, taskStatus: 'sem vínculo',
    s, evidenceIds: unidade.evidenceIds ?? [],
  })));
  const pageOf = (list) => rascunho.secoes.map((secao, s) => ({ heading: secao.titulo.trim(), taskId: null,
    units: list.filter((unit) => unit.s === s).map(({ text, kind }) => ({ text, kind })) })).filter(({ units: kept }) => kept.length);

  // 1. Fatos: cada frase é julgada contra as evidências.
  const owners = units.flatMap((unit) => splitClaims(unit.text).map(() => unit.evidenceIds));
  const judged = await judgeClaims({ oQueE: [], paraQueServe: [], casosDeUso: [], passos: [], duvidas: [], erros: units },
    { request: { module }, business: [] },
    (claims) => providers.judgeFacts(claims.map(({ id, text, kind }, index) => ({ id, text, kind, evidenceIds: owners[index] })), evidence));
  const contradicoes = judged.contradictions.map(({ text }) => text);
  const fatos = { sustentadas: judged.verdicts.filter(({ status }) => status === 'sustentada').length,
    aConfirmar: judged.verdicts.filter(({ status }) => status === 'a confirmar').map(({ text }) => text), contradicoes };
  const sections = pageOf(judged.sections.erros);
  const body = renderSections(sections);

  // 2. Editorial: três leituras do texto limpo, mesma régua das páginas-ouro.
  const pagina = `${novo ? `# ${title}\n\n` : ''}${renderSections(pageOf(units))}`;
  const slim = (types) => evidence.filter(({ type }) => types(type)).map(({ id, type, text }) => ({ id, type, text }));
  const evidencias = { front: slim((type) => ['codigo', 'tela'].includes(type)), negocio: slim((type) => type === 'negocio'),
    fontes: slim((type) => !['codigo', 'tela', 'negocio'].includes(type)) };
  const read = (proposito) => judgeEditorial({ pagina, modulo: module || 'geral', tipo: novo ? 'pagina' : 'trecho', evidencias,
    ...(proposito ? { proposito } : {}) }, providers.editorial);
  const first = await read();
  const editorial = consolidateEditorialReadings([first, ...await Promise.all([read(first.proposito), read(first.proposito)])]);

  // 3. Segurança e montagem.
  const problemas = [];
  if (containsSensitiveData([title, description, body].join('\n'), { detectOpaque: true })) problemas.push('dado sensível no texto');
  for (const phrase of [title, description, ...sections.flatMap((section) => [section.heading, ...section.units.flatMap(({ text }) => splitClaims(unmarked(text)))])])
    if (mentionsSource(phrase)) problemas.push(`cita a fonte: ${phrase.slice(0, 120)}`);
  try { validateFaqMdx(body); } catch (error) { problemas.push(`MDX: ${error.message}`); }
  if (!sections.length) problemas.push('nenhuma frase sobrou depois do julgamento');

  const mdx = novo ? `${faqFrontmatter({ title, description })}# ${title}\n\n${body}\n` : mergeIntoPage(existingRaw, sections);
  const gates = { aprovado: !contradicoes.length && !problemas.length && editorial.aceite, fatos,
    editorial: { aceite: editorial.aceite, notas: editorial.notas, defeitosGraves: editorial.defeitosGraves },
    seguranca: { ok: problemas.length === 0, problemas }, estrutura: { ok: true, problemas: [] } };
  const motivos = [...judged.contradictions.map(({ text, reason }) => `contradiz a evidência: ${text} — ${reason}`), ...problemas,
    ...(editorial.aceite ? [] : [
      ...Object.entries(editorial.notas).filter(([, nota]) => nota !== null && nota < 3).map(([criterio, nota]) => `critério editorial ${criterio}: nota ${nota} (mínimo 3)`),
      ...editorial.defeitosGraves.map((defeito) => `defeito grave: ${defeito}`), ...first.comentario ? [`comentário do juiz: ${first.comentario}`] : []])];
  return { gates, mdx, revisao: createHash('sha256').update(mdx).digest('hex'), motivos,
    pendencias: [...fatos.aConfirmar, ...judged.pending.filter((item) => /menção à fonte|mencionava a fonte/u.test(item))] };
}
