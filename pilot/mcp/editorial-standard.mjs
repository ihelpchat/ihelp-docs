import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';
import { conversationalIssues, parseAssistantSuggestions } from './conversational-contract.mjs';
import { parseDocument, stringify } from 'yaml';

const GENERIC_DESCRIPTION = /^(?:Entenda .+ e veja como usar esse recurso no iHelp\.|Referência técnica da API do iHelp para .+\.)$/i;
const LEGACY_TUTORIAL = /\n+(?:(?:\*\*\*|---)\n+\n+)?## Tutorial Guiado\n+\n+Prefere seguir o passo a passo interativo\?[^\n]*(?:\n|$)/gi;
const HEADING_EMOJI = /[🔹👁️🤖📁📌✅❌⚠️📝⚙️📊🚀❓🚫🔇📴💾]/gu;

const DESCRIPTION_BY_PATH = new Map([
  ['docs/sobre-o-ihelp/contato-e-suporte', 'Consulte os canais e horários do suporte do iHelp para pedir ajuda com acesso, configuração ou uso da plataforma.'],
  ['docs/primeiros-passos/acessando-a-plataforma', 'Entre no iHelp, troque sua senha inicial e saiba como recuperar o acesso quando necessário.'],
  ['docs/sobre-o-sistema/configuracoes/configuracoes-gerais', 'Conheça as automações e regras gerais que alteram a distribuição, a visualização e o encerramento dos atendimentos.'],
  ['docs/sobre-o-sistema/configuracoes/atalhos', 'Crie respostas rápidas com texto, mídia ou áudio para agilizar mensagens repetidas durante o atendimento.'],
  ['docs/sobre-o-sistema/dashboard', 'Acompanhe volume, desempenho e tempos de atendimento usando os filtros e indicadores do Dashboard.'],
  ['docs/sobre-o-sistema/robo-de-atendimento', 'Crie e mantenha fluxos de pré-atendimento, opções automáticas e regras de transferência para a equipe.'],
  ['docs/sobre-o-sistema/agenda-de-contatos', 'Cadastre, importe, pesquise, organize e carteirize contatos na agenda do iHelp.'],
  ['docs/sobre-o-sistema/crm', 'Organize oportunidades em pipelines, estágios e cards, com filtros, tarefas, automações e permissões.'],
  ['docs/sobre-o-sistema/crm/como-criar-uma-nova-pipeline', 'Crie uma pipeline, defina visibilidade, estágios e automações e confira o resultado antes de começar a usá-la.'],
  ['docs/sobre-o-sistema/campanhas', 'Prepare contatos, configure mensagens e acompanhe disparos em massa feitos pelo iHelp.'],
  ['docs/sobre-o-sistema/campanhas/o-que-e-uma-campanha', 'Entenda quando usar uma campanha para enviar a mesma comunicação a uma lista de contatos.'],
  ['docs/sobre-o-sistema/campanhas/como-criar-uma-nova-campanha', 'Prepare a lista, configure a mensagem e revise o envio antes de iniciar uma campanha no iHelp.'],
  ['docs/sobre-o-sistema/campanhas/preparando-a-planilha-de-campanhas', 'Monte a planilha de contatos no formato aceito pelo iHelp e evite erros durante a importação da campanha.'],
  ['docs/sobre-o-sistema/campanhas/campanhas-na-api-oficial', 'Veja como templates, variáveis e janela de atendimento afetam campanhas enviadas pela API Oficial.'],
  ['docs/sobre-o-sistema/configuracoes', 'Encontre orientações para administrar canais, usuários, departamentos, atalhos e regras gerais do iHelp.'],
  ['docs/sobre-o-sistema/configuracoes/departamentos', 'Configure departamentos, horários, feriados, mensagens e motivos de encerramento dos atendimentos.'],
  ['docs/sobre-o-sistema/configuracoes/departamentos/feriados-e-eventos', 'Cadastre feriados e eventos pontuais para ajustar o funcionamento dos departamentos em datas específicas.'],
  ['docs/sobre-o-sistema/configuracoes/alterar-senha', 'Altere sua senha pelo perfil ou recupere o acesso usando o código enviado pelo iHelp.'],
  ['docs/duvidas-e-dicas/download-de-lista-de-contatos', 'Escolha seu aparelho e siga o procedimento correto para exportar contatos antes de importá-los no iHelp.'],
  ['docs/duvidas-e-dicas/download-de-lista-de-contatos/android', 'Exporte contatos do Android pelo celular ou pelo Google Contatos e gere um arquivo para importação.'],
  ['docs/duvidas-e-dicas/download-de-lista-de-contatos/iphone', 'Exporte contatos do iPhone usando iCloud e Outlook para preparar uma lista compatível com a importação.'],
  ['docs/whatsapp-business-api', 'Entenda custos, migração, configuração e regras de funcionamento da API Oficial do WhatsApp.'],
  ['docs/whatsapp-business-api/o-basico', 'Comece pelos conceitos, benefícios e principais diferenças da API Oficial do WhatsApp.'],
  ['docs/whatsapp-business-api/antes-de-migrar', 'Confira requisitos, prazos e mudanças de acesso antes de migrar um número para a API Oficial.'],
  ['docs/whatsapp-business-api/configuracao', 'Veja as etapas e decisões necessárias para configurar a API Oficial do WhatsApp.'],
  ['docs/whatsapp-business-api/funcionamento', 'Conheça janela de atendimento, templates e motivos comuns de mensagens não entregues.'],
  ['docs/whatsapp-business-api/configuracao/gupshup', 'Acesse orientações sobre conta, créditos e consumo do provedor Gupshup.'],
  ['docs/whatsapp-business-api/configuracao/gupshup/como-criar-conta', 'Saiba quais dados reunir e como solicitar ao suporte a criação assistida de uma conta Gupshup.'],
  ['docs/whatsapp-business-api/configuracao/gupshup/como-adicionar-creditos', 'Adicione saldo à carteira Gupshup, escolha a forma de pagamento e configure um alerta de saldo baixo.'],
  ['docs/whatsapp-business-api/configuracao/gupshup/relatorios-de-consumo', 'Consulte o uso da carteira Gupshup e reúna as informações necessárias para conferir cobranças.'],
]);

function stripMarkdown(value) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstUsefulParagraph(body) {
  const blocks = body.split(/\n\s*\n/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || /^(?:#{1,6}|[-*+] |\d+\. |<|!\[|\|)/.test(trimmed)) continue;
    const clean = stripMarkdown(trimmed);
    if (clean.length >= 45 && !/^Prefere seguir/i.test(clean)) return clean;
  }
  return '';
}

function sentenceDescription(text) {
  const sentence = text.match(/^.{45,170}?(?:[.!?](?=\s|$)|$)/)?.[0] ?? text.slice(0, 170);
  return sentence.replace(/\s+/g, ' ').trim().replace(/[,;:]$/, '.')
}

export function inferContentType(path, title, body) {
  if (path.startsWith('api/')) return 'referencia';
  if (path.startsWith('blog/')) return 'guia';
  if (/\/(?:como-|preparando-|acessando-|alterar-senha|feriados-e-eventos|android|iphone)/.test(`/${path}`)) return 'tutorial';
  if (/^(?:Como|Preparando|Acessando|Alterar|Downgrade)/i.test(title)) return 'tutorial';
  const questionHeadings = [...body.matchAll(/^#{2,4}\s+.*\?\s*$/gm)].length;
  if (title.endsWith('?') || questionHeadings >= 3 || path.endsWith('principais-duvidas')) return 'faq';
  return 'guia';
}

export function descriptionFor(path, title, body) {
  const curated = DESCRIPTION_BY_PATH.get(path);
  if (curated) return curated;
  if (path.startsWith('api/')) {
    const action = /^(?:Buscar|Criar|Enviar|Mover|Obter|Pegar|Resumir|Transcrever|Trocar)\b/i.test(title) ? 'Veja como' : 'Consulte';
    return `${action} ${title.toLocaleLowerCase('pt-BR')}, com parâmetros e exemplos de requisição e resposta na API do iHelp.`;
  }
  const paragraph = firstUsefulParagraph(body);
  if (paragraph) return sentenceDescription(paragraph);
  return `Encontre orientações práticas sobre ${title.toLocaleLowerCase('pt-BR')} e os próximos passos relacionados no iHelp.`;
}

function cleanHeading(line) {
  const match = line.match(/^(#{2,6})\s+(.+)$/);
  if (!match) return line;
  let text = match[2]
    .replace(HEADING_EMOJI, '')
    .replace(/^\s*\d+[a-z]?\.\s*/, '')
    .replace(/^\*\*(.+)\*\*$/, '$1')
    .replace(/\*\*/g, '')
    .trim();
  return `${match[1]} ${text}`;
}

function altTextForHeading(title, heading) {
  const context = stripMarkdown(heading || title).replace(/[.!?]+$/, '');
  return `Tela do iHelp: ${context}`;
}

/** Aplica `transform` só no texto fora de blocos de código cercados por ```. */
export function outsideCode(text, transform) {
  return text
    .split(/(^```[^\n]*\n[\s\S]*?^```[^\n]*$)/m)
    .map((part, index) => (index % 2 === 1 ? part : transform(part)))
    .join('');
}

export function normalizeBody(body, title, description, path = '') {
  let normalized = body.replaceAll('\r', '').replace(LEGACY_TUTORIAL, '\n');
  // Blocos de código ficam intactos: a barra no fim da linha ali é continuação de comando (cURL), não quebra de Markdown.
  normalized = outsideCode(normalized, (text) => text
    .replaceAll('](/api/category/templates)', '](/api/templates/template-enviar-chat-existente)')
    .replace(/^\s*(?:\*\*\*|---)\s*$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\\\n/g, '\n\n'));

  let lastHeading = title;
  let lines = normalized.split('\n').map((line) => {
    const cleaned = cleanHeading(line);
    const heading = cleaned.match(/^#{2,6}\s+(.+)$/)?.[1];
    if (heading) lastHeading = heading;
    return cleaned.replace(/!\[\]\(([^)]+)\)/g, `![${altTextForHeading(title, lastHeading)}]($1)`);
  });

  // O renderer da página principal de FAQ interpreta h3 como pergunta e h2 como seção.
  if (path === 'docs/principais-duvidas') {
    lines = lines.map((line) => /^##\s+.*\?\s*$/.test(line) ? `#${line}` : line);
  }

  const depths = lines.flatMap((line) => {
    const match = line.match(/^(#{2,6})\s/);
    return match ? [match[1].length] : [];
  });
  if (path !== 'docs/principais-duvidas' && depths.length && Math.min(...depths) >= 3) {
    lines = lines.map((line) => line.startsWith('###') ? line.slice(1) : line);
  }

  normalized = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (path === 'docs/principais-duvidas' && normalized.startsWith(`${description}\n\n`)) {
    normalized = normalized.slice(description.length).trimStart();
  }
  const firstMeaningful = normalized.split('\n').find((line) => line.trim()) ?? '';
  if (path !== 'docs/principais-duvidas' && /^(?:#{2,6}\s|<VideoEmbed\b|<TutorialCard\b|!\[)/.test(firstMeaningful)) {
    normalized = `${description}\n\n${normalized}`;
  }
  return `${normalized}\n`;
}

export function parseArticle(raw, path) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { path, metadata: {}, body: raw };
  const document = parseDocument(match[1]);
  if (document.errors.length) throw new Error('frontmatter YAML inválido');
  const metadata = document.toJS() ?? {};
  return { path, metadata, body: raw.slice(match[0].length).trim() };
}

export function renderNormalizedArticle(article) {
  const title = article.metadata.title || 'Documentação do iHelp';
  const currentDescription = article.metadata.description ?? '';
  const invalidDescription = currentDescription.length < 40
    || currentDescription.length > 180
    || GENERIC_DESCRIPTION.test(currentDescription)
    || /(?:https?:|```|\\|\b(?:GET|POST|PUT|PATCH|DELETE)\b|^(?:Body|Response|Request|Endpoints?|Rota base|text message)|^Consulte como|[{}])/i.test(currentDescription);
  const description = (invalidDescription
    ? descriptionFor(article.path, title, article.body)
    : currentDescription).replace(/\s+([.,;:!?])/g, '$1').replace(/\bihelp\b/gi, 'iHelp');
  const source = article.path.startsWith('api/') ? 'api' : article.path === 'docs/principais-duvidas' ? 'suporte' : article.metadata.source || 'produto';
  const contentType = inferContentType(article.path, title, article.body);
  const reserved = new Set(['title', 'description', 'source', 'contentType']);
  const extra = Object.entries(article.metadata).filter(([key]) => !reserved.has(key));
  const frontmatter = { title, description, source, contentType, ...Object.fromEntries(extra) };
  return `---\n${stringify(frontmatter, { lineWidth: 0 })}---\n\n${normalizeBody(article.body, title, description, article.path)}`;
}

export function auditArticle(raw, path) {
  const { metadata, body } = parseArticle(raw, path);
  const issues = [];
  const conversation = { ...metadata, body };
  if (Object.hasOwn(conversation, 'assistantInitialSteps')) conversation.assistantInitialSteps = Number(conversation.assistantInitialSteps);
  if (Object.hasOwn(conversation, 'assistantSuggestions') && !Array.isArray(conversation.assistantSuggestions)) conversation.assistantSuggestions = parseAssistantSuggestions(conversation.assistantSuggestions);
  issues.push(...conversationalIssues(conversation));
  if (!metadata.title || metadata.title.length < 4) issues.push('title ausente ou curto');
  if (!metadata.description || metadata.description.length < 40) issues.push('description ausente ou curta');
  if ((metadata.description?.length ?? 0) > 180) issues.push('description longa demais');
  if (GENERIC_DESCRIPTION.test(metadata.description ?? '')) issues.push('description genérica');
  if (/(?:https?:|```|\\|\b(?:GET|POST|PUT|PATCH|DELETE)\b|^(?:Body|Response|Request|Endpoints?|Rota base|text message)|^Consulte como|[{}])/i.test(metadata.description ?? '')) issues.push('description contém código ou URL');
  if (!['produto', 'suporte', 'api'].includes(metadata.source)) issues.push('source inválido');
  if (!['faq', 'tutorial', 'guia', 'referencia'].includes(metadata.contentType)) issues.push('contentType inválido');
  if (stripMarkdown(body).split(/\s+/).filter(Boolean).length < 60) issues.push('conteúdo insuficiente');
  if (/!\[\]\(/.test(body)) issues.push('imagem sem texto alternativo');
  if (/ihelpchat\.github\.io\/ihelp-docs/.test(body)) issues.push('link legado');
  if (/^## Tutorial Guiado$/m.test(body)) issues.push('rodapé genérico de tutorial');
  if (new RegExp(`^#{2,6}\\s+.*${HEADING_EMOJI.source}`, 'mu').test(body)) issues.push('emoji decorativo em heading');
  if (/^#{2,6}\s+\*\*/m.test(body)) issues.push('heading com negrito redundante');
  if (/^\s*\*\*\*\s*$/m.test(body)) issues.push('separador visual redundante');
  return issues;
}

async function walk(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await walk(target));
    else if (entry.name.endsWith('.mdx')) output.push(target);
  }
  return output;
}

export async function auditContent(root) {
  const contentRoot = join(root, 'content/docs');
  const files = await walk(contentRoot);
  const records = [];
  for (const file of files) {
    const path = relative(contentRoot, file).replace(/\.mdx$/, '');
    const raw = await readFile(file, 'utf8');
    records.push({ path, raw, issues: auditArticle(raw, path) });
  }

  const routes = new Set(['/']);
  for (const { path } of records) {
    routes.add(`/${path}`);
    if (path.endsWith('/index')) routes.add(`/${path.slice(0, -'/index'.length)}`);
  }
  for (const record of records) {
    const targets = [...record.raw.matchAll(/(?:!?)\[[^\]]*\]\(([^)]+)\)|<(?:VideoEmbed|TutorialCard)[^>]+(?:url|embedUrl)="([^"]+)"/g)]
      .map((match) => (match[1] ?? match[2]).trim().split(/\s+["']/)[0])
      .filter((target) => !/^(?:https?:|mailto:|tel:|#)/.test(target));
    for (const target of targets) {
      const rawPath = target.split(/[?#]/)[0].replace(/\.mdx?$/, '');
      const pathname = (rawPath.startsWith('/') ? rawPath : normalize(join('/', dirname(record.path), rawPath))).replace(/\/$/, '') || '/';
      if (pathname.startsWith('/img/') || pathname.startsWith('/videos/')) {
        try {
          await readFile(join(root, 'public', decodeURIComponent(pathname.slice(1))));
        } catch {
          record.issues.push(`asset inexistente: ${pathname}`);
        }
      } else if (/^\/(?:docs|api|blog|tutoriais)(?:\/|$)/.test(pathname) && !routes.has(pathname)) {
        record.issues.push(`link interno inexistente: ${pathname}`);
      }
    }
  }

  const articles = records.filter((record) => record.issues.length).map(({ path, issues }) => ({ path, issues }));
  return { total: files.length, valid: files.length - articles.length, invalid: articles.length, articles };
}

export async function readArticle(root, contentPath) {
  if (!/^(?:docs|api|blog|tutoriais)\/[a-z0-9][a-z0-9/-]*$/.test(contentPath) || contentPath.includes('..')) {
    throw new Error('path inválido');
  }
  const contentRoot = join(root, 'content/docs');
  const file = join(contentRoot, `${contentPath}.mdx`);
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') throw new Error('artigo não encontrado');
    throw error;
  }
  const article = parseArticle(raw, contentPath);
  return { path: contentPath, ...article.metadata, body: article.body };
}
