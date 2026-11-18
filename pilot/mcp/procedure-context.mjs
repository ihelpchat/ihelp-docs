// Procedure retrieval requires subject evidence in the article/section identity, not incidental body words.
const plain = (s) => String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const singular = (s) => s.replace(/s$/u, '');
const generic = new Set('como quero preciso posso para pelo pela uma meu minha meus minhas voce fazer passo passos guia guie criar novo nova adicionar cadastrar editar alterar mudar corrigir buscar procurar filtrar exportar importar transferir configurar usar abrir acessar salvar publicar confirmar encontrar enviar receber excluir remover habilitar desabilitar iniciar encerrar definir do da de em no na um os as ao ou e o a que acesso'.split(' '));
const words = (s) => [...new Set(plain(s).replace(/respostas? rapidas?/gu, 'atalho').match(/[a-z0-9]+/gu) ?? [])].map(singular);
const intent = (s) => {
  const t = plain(s);
  return /\btransfer/gu.test(t) ? 'transfer' : /\b(?:criar|adicionar|cadastrar|novo|nova)\b/u.test(t) ? 'create'
    : /\b(?:editar|alterar|mudar|corrigir)\b/u.test(t) ? 'edit' : /\b(?:buscar|procurar|encontrar)\b/u.test(t) ? 'search'
    : /\bfiltrar\b/u.test(t) ? 'filter' : /\bexportar\b/u.test(t) ? 'export' : /\bimportar\b/u.test(t) ? 'import' : null;
};
export function selectProcedureSection(raw, question, title, description) {
  const topics = words(question).filter((w) => w.length > 2 && !generic.has(w) && !generic.has(`${w}s`));
  if (!topics.length) return null;
  const body = raw.replace(/^---[\s\S]*?---\s*/u, '');
  const sections = [...body.matchAll(/^##\s+(.+)\r?$/gmu)].map((match, i, all) => ({
    heading: match[1], body: body.slice(match.index, all[i + 1]?.index ?? body.length),
  }));
  const requestIntent = intent(question);
  const hasTopics = (text) => { const tokens = new Set(words(text)); return topics.every((topic) => tokens.has(topic)); };
  const identity = `${title} ${description}`;
  if (!hasTopics(title) && !sections.some(({ heading }) => hasTopics(heading))) return null;
  if (requestIntent && intent(title) && intent(title) !== requestIntent) return null;
  const matching = sections.filter(({ heading }) => hasTopics(`${identity} ${heading}`)
    && topics.some((topic) => words(heading).includes(topic))
    && (!requestIntent || intent(heading) === requestIntent));
  if (matching.length) return matching.sort((a, b) => words(b.heading).filter((w) => topics.includes(w)).length - words(a.heading).filter((w) => topics.includes(w)).length)[0];
  // Single-purpose articles may have neutral headings; never borrow a different operation from a multi-procedure article.
  if (!hasTopics(identity) || (requestIntent && sections.some(({ heading }) => intent(heading)) && intent(title) !== requestIntent)) return null;
  return { heading: title, body };
}

export function isProcedureRequest(question) {
  return intent(question) !== null || /\b(?:passo|guiar|guie|configurar|conectar|reconectar|publicar|salvar|enviar|excluir|remover|habilitar|desabilitar|iniciar|encerrar|definir|abrir|acessar)\b/u.test(plain(question));
}
