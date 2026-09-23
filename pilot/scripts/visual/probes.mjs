/**
 * Pontos de controle do teste visual.
 *
 * Cada ponto diz onde achar o mesmo elemento no protótipo do Claude Design (`design`, expressão JS
 * avaliada na página do protótipo com os helpers de `designHelpers`) e no app (`app`, seletor CSS),
 * e quais medidas comparar. O protótipo em si NÃO é versionado: `design-baseline.mjs` roda contra ele
 * e grava só as medidas em `fixtures/design-baseline.json`.
 */

export const viewports = {
  desktop: { width: 1440, height: 1000 },
  mobile: { width: 390, height: 844 },
};

/** Helpers injetados no protótipo para localizar elementos por texto. */
export const designHelpers = `
  window.__byText = (text, root = document, nth = 0) => {
    const hits = [...root.querySelectorAll('body *')].filter((el) => {
      if (!el.getClientRects().length) return false;
      const own = el.textContent.replace(/\\s+/g, ' ').trim();
      if (own !== text) return false;
      return ![...el.children].some((child) => child.textContent.replace(/\\s+/g, ' ').trim() === text);
    });
    return hits[nth] ?? null;
  };
  window.__up = (el, test) => {
    let node = el;
    while (node && node !== document.body) {
      const r = node.getBoundingClientRect();
      if (test(r, node)) return node;
      node = node.parentElement;
    }
    return null;
  };
  window.__main = () => [...document.querySelectorAll('aside')].find((a) => a.getBoundingClientRect().left < 5)?.nextElementSibling ?? document.body;
`;

// Atalhos para escrever os localizadores do protótipo.
const t = (text, nth = 0) => `__byText(${JSON.stringify(text)}, document, ${nth})`;
const up = (inner, test) => `__up(${inner}, (r, n) => ${test})`;
// Caixa com fundo próprio (ignora os invólucros transparentes do protótipo).
const filled = 'getComputedStyle(n).backgroundColor !== "rgba(0, 0, 0, 0)"';

const layout = ['left', 'top', 'width', 'height'];
const type = ['fontSize', 'fontWeight', 'color'];

/** Telas: como chegar nelas no protótipo e no app, e o que medir. */
export const screens = [
  {
    name: 'home',
    viewports: ['desktop', 'mobile'],
    app: '/',
    design: [],
    checks: [
      { id: 'header', design: up(t('documentação'), `r.height >= 56 && ${filled}`), app: '.ih-header', props: ['top', 'height', 'background'] },
      { id: 'logo', design: `document.querySelector('img[alt=ihelp]')`, app: '.ih-brand img', props: ['left', 'top', 'height'] },
      { id: 'nav-ativo', only: 'desktop', design: up(t('Central de ajuda'), 'r.height >= 28'), app: '.ih-nav-link[data-active]', props: ['left', 'width', 'height', 'background', 'fontWeight'] },
      { id: 'busca-topo', only: 'desktop', design: up(t('Buscar ou perguntar'), 'r.height >= 30'), app: '.ih-header-search', props: ['left', 'width', 'height', 'background'] },
      { id: 'cta-topo', only: 'desktop', design: up(t('Falar com o suporte'), 'r.height >= 30'), app: '.ih-header-cta', props: ['left', 'width', 'height'] },
      { id: 'hero', design: up(`document.querySelector('h1')`, `r.height > 400 && ${filled}`), app: '.design-hero', props: ['top', 'height', 'background'] },
      { id: 'selo-ia', design: up(t('Assistente de IA treinado na documentação do ihelp'), 'r.height >= 24'), app: '.design-badge', props: [...layout] },
      { id: 'titulo', design: `document.querySelector('h1')`, app: '.design-hero h1', props: ['left', 'top', 'width', 'height', ...type] },
      { id: 'busca-hero', design: up(t('Como faço para transferir um atendimento?'), 'r.height >= 50 && r.width > 300'), app: '.home-search', props: [...layout] },
      { id: 'sugestao', design: up(t('Como transferir um atendimento?'), 'r.height >= 24'), app: '.search-suggestions button', props: ['left', 'top', 'height', 'fontSize'] },
      { id: 'card-ajuda', design: up(t('Acessar a ajuda'), 'r.height > 200'), app: '.design-portal-card', props: [...layout, 'background'] },
      { id: 'card-api', design: up(t('Ver a API'), 'r.height > 200'), app: '.design-portal-api', props: ['left', 'top', 'width', 'background'] },
      { id: 'comece', design: t('Comece por aqui'), app: '#start-title', props: ['left', 'top', 'fontSize', 'fontWeight'] },
      { id: 'passo-1', design: up(t('Acessar a plataforma'), 'r.height > 60'), app: '.design-start-grid > a', props: [...layout] },
      { id: 'duvidas', design: up(t('Dúvidas mais buscadas'), 'r.height > 200'), app: '.design-list-card', props: ['left', 'top', 'width'] },
      { id: 'suporte', design: up(t('Não achou o que precisava?'), 'r.height > 100 && r.width > 320'), app: '.design-support', props: ['left', 'width'] },
    ],
  },
  {
    name: 'artigo',
    viewports: ['desktop', 'mobile'],
    app: '/docs/sobre-o-sistema/atendimento/',
    design: [{ click: 'Central de ajuda' }],
    checks: [
      { id: 'header', design: up(t('documentação'), `r.height >= 56 && ${filled}`), app: '.ih-header', props: ['top', 'height', 'background'] },
      { id: 'lateral', only: 'desktop', design: `document.querySelector('aside')`, app: '.ih-sidebar-wrap', props: ['left', 'top', 'width', 'background'] },
      { id: 'lateral-rotulo', only: 'desktop', design: `document.querySelector('aside > div')`, app: '.ih-side-kicker', props: ['left', 'top', ...type] },
      { id: 'lateral-ativo', only: 'desktop', design: up(t('Atendimento', 0), 'r.width > 200'), app: '.ih-side-link[data-active]', props: ['left', 'width', 'height', 'background', 'color', 'fontWeight'] },
      { id: 'trilha', only: 'desktop', design: up(t('Sobre o sistema', 1), 'r.width > 200'), app: '.ih-breadcrumb', props: ['left', 'top', 'fontSize'] },
      { id: 'titulo', design: `document.querySelector('article h1')`, app: '.ih-title', props: ['left', 'top', ...type] },
      { id: 'abertura', design: `document.querySelector('article h1 + p')`, app: '.ih-lead', props: ['left', 'top', 'fontSize', 'color'] },
      { id: 'meta', only: 'desktop', design: up(t('4 min de leitura'), 'r.width > 400'), app: '.ih-meta', props: ['left', 'fontSize', 'color'] },
      { id: 'indice', only: 'desktop', design: `[...document.querySelectorAll('aside')][1]`, app: '.ih-toc', props: ['left', 'top', 'width'] },
      { id: 'indice-rotulo', only: 'desktop', design: t('Nesta página'), app: '.ih-toc-kicker', props: ['left', 'top', ...type] },
      { id: 'texto', design: `document.querySelector('article h2 + p')`, app: '.ih-prose > p', props: ['fontSize', 'lineHeight', 'color'] },
    ],
  },
  {
    name: 'aviso',
    viewports: ['desktop'],
    // Compara só o estilo do aviso: no protótipo ele está no artigo, no app a página com aviso é o FAQ.
    // Por isso a grade de cor (que compara a tela inteira) não se aplica aqui.
    grid: false,
    app: '/docs/principais-duvidas/',
    design: [{ click: 'Central de ajuda' }],
    checks: [
      { id: 'aviso-atencao', design: up(t('Atenção'), `r.width > 300 && ${filled}`), app: '.ih-callout[data-type="warn"]', props: ['background', 'borderColor', 'borderRadius'] },
      { id: 'aviso-titulo', design: t('Atenção'), app: '.ih-callout[data-type="warn"] .ih-callout-title', props: type },
    ],
  },
  {
    name: 'faq',
    viewports: ['desktop', 'mobile'],
    app: '/docs/principais-duvidas/',
    design: [{ click: 'Ver FAQ' }],
    checks: [
      { id: 'trilha', design: t('Central de ajuda · Dúvidas e dicas'), app: '.ih-crumb-text', props: ['left', 'top', 'fontSize', 'color'] },
      { id: 'titulo', design: 'document.querySelector("h1")', app: '.ih-title', props: ['left', 'top', ...type] },
      { id: 'abertura', design: 'document.querySelector("h1 + p")', app: '.ih-lead', props: ['left', 'top', 'fontSize', 'color'] },
      { id: 'filtro', design: up(`document.querySelector('input[placeholder="Filtrar dúvidas"]')`, 'r.height >= 38'), app: '.ih-faq-filter', props: ['left', 'width', 'height', 'borderColor'] },
      { id: 'chip-ativo', design: up(t('Todas'), 'r.height >= 24'), app: '.ih-chip[aria-pressed="true"]', props: ['height', 'background', 'color', 'fontSize'] },
      { id: 'lista', design: up(t('Como transferir um atendimento para outro departamento ou atendente?'), 'r.height > 300'), app: '.ih-faq-list', props: ['left', 'width', 'background'] },
      { id: 'pergunta', only: 'desktop', design: up(t('Esqueci minha senha e não consigo acessar o ihelp. O que fazer?'), 'r.height >= 50'), app: '.ih-faq-item:nth-child(2) button', props: ['left', 'width', 'height'] },
      { id: 'categoria', only: 'desktop', design: up(t('Acesso'), 'r.height >= 18'), app: '.ih-faq-item:nth-child(2) .ih-faq-cat', props: ['width', 'height', 'fontSize', 'background', 'color'] },
      { id: 'pergunta-texto', design: t('Esqueci minha senha e não consigo acessar o ihelp. O que fazer?'), app: '.ih-faq-item:nth-child(2) .ih-faq-q', props: type },
    ],
  },
  {
    name: 'api',
    viewports: ['desktop', 'mobile'],
    app: '/api/',
    design: [{ click: 'Referência da API' }],
    checks: [
      { id: 'header', design: up(`document.querySelector('img[alt=ihelp]')`, `r.height >= 50 && ${filled}`), app: '.ih-header', props: ['top', 'height', 'background'] },
      { id: 'selo-api', design: up(t('API'), 'r.height >= 18'), app: '.ih-brand-tag', props: ['left', 'width', 'height', 'color'] },
      { id: 'nav-ativo', only: 'desktop', design: up(t('Referência da API'), 'r.height >= 28'), app: '.ih-nav-link[data-active]', props: ['left', 'width', 'background', 'color'] },
      { id: 'cta-token', only: 'desktop', design: up(t('Pegar meu token'), 'r.height >= 30'), app: '.ih-header-cta-primary', props: ['left', 'width', 'height', 'background'] },
      { id: 'lateral', only: 'desktop', design: `document.querySelector('aside')`, app: '.ih-sidebar-wrap', props: ['left', 'top', 'width'] },
      { id: 'busca-endpoint', only: 'desktop', design: up(t('Buscar endpoint'), 'r.height >= 30'), app: '.ih-side-search', props: [...layout] },
      { id: 'grupo', only: 'desktop', design: up(t('Começar'), 'r.width > 200'), app: '.ih-side-title', props: ['left', 'top', ...type] },
      { id: 'item-ativo', only: 'desktop', design: up(t('Visão geral'), 'r.height >= 28'), app: '.ih-side-link[data-active]', props: [...layout, 'background'] },
      { id: 'selo-metodo', only: 'desktop', design: up(t('DOC'), 'r.width >= 30'), app: '.ih-method', props: ['left', 'width', 'height', 'background', 'color', 'fontSize'] },
      { id: 'endereco', design: t('api.ihelpchat.com / v2'), app: '.ih-mono-kicker', props: ['left', 'top', 'fontSize', 'color'] },
      { id: 'titulo', design: 'document.querySelector("h1")', app: '.ih-title', props: ['left', 'top', ...type] },
      { id: 'cartao-base', only: 'desktop', design: up(t('Base URL'), 'r.height > 50'), app: '.ih-facts > div', props: ['left', 'height', 'background'] },
    ],
  },
  {
    name: 'endpoint',
    viewports: ['desktop'],
    app: '/api/atendimentos/buscar-atendimento-por-telefone/',
    design: [{ click: 'Referência da API' }, { click: 'Buscar por telefone' }, { click: 'B · Coluna única' }],
    // A barra “Variante de layout em avaliação” é controle do protótipo, não parte do produto.
    designHide: 'Variante de layout em avaliação',
    checks: [
      { id: 'metodo', design: `[...document.querySelectorAll('span')].find((s) => s.textContent === 'GET' && s.getBoundingClientRect().left > 280)`, app: '.ih-endpoint-kicker .ih-method', props: [...layout, 'background', 'color'] },
      { id: 'titulo', design: 'document.querySelector("h1")', app: '.ih-title', props: ['left', 'top', ...type] },
      { id: 'abertura', design: 'document.querySelector("h1 + p")', app: '.ih-lead', props: ['left', 'top', 'fontSize', 'color'] },
      { id: 'indice', design: up(t('Nesta página'), 'r.height > 100'), app: '.ih-toc', props: ['left', 'width'] },
      { id: 'item-ativo', design: up(t('Buscar por telefone'), 'r.height >= 28'), app: '.ih-side-link[data-active]', props: ['left', 'top', 'width', 'background', 'color'] },
    ],
  },
  {
    name: 'tutoriais',
    viewports: ['desktop', 'mobile'],
    app: '/tutoriais/',
    design: [{ click: 'Ver todos os tutoriais' }],
    checks: [
      { id: 'titulo', design: 'document.querySelector("h1")', app: '.ih-title', props: ['left', 'top', ...type] },
      { id: 'abertura', design: 'document.querySelector("h1 + p")', app: '.ih-lead', props: ['left', 'fontSize', 'color'] },
      { id: 'contador', only: 'desktop', design: up(t('14 guias publicados no Tango'), 'r.height >= 30'), app: '.ih-status-pill', props: ['right', 'height', 'background'] },
      { id: 'player', design: up(t('Iniciar no app'), 'r.height > 400'), app: '.ih-player', props: ['left', 'width', 'background'] },
      { id: 'lista-rotulo', only: 'desktop', design: t('Guias disponíveis'), app: '.ih-guide-column .ih-eyebrow', props: ['left', ...type] },
      { id: 'guia-ativo', only: 'desktop', design: up(t('Responder e transferir um atendimento', 1), 'r.height >= 50'), app: '.ih-guide[aria-pressed="true"]', props: ['left', 'width', 'background'] },
    ],
  },
  {
    name: 'novidades',
    viewports: ['desktop', 'mobile'],
    app: '/blog/',
    design: [{ click: 'Ver tudo' }],
    checks: [
      { id: 'titulo', design: 'document.querySelector("h1")', app: '.ih-title', props: ['left', 'top', ...type] },
      { id: 'abertura', design: 'document.querySelector("h1 + p")', app: '.ih-lead', props: ['left', 'top', 'fontSize', 'color'] },
      { id: 'filtro-ativo', design: up(t('Tudo'), 'r.height >= 24'), app: '.ih-chip[aria-pressed="true"]', props: ['left', 'top', 'height', 'background', 'color'] },
      { id: 'data', only: 'desktop', design: up(t('24 abr 2026'), 'r.width >= 90'), app: '.ih-timeline time', props: ['left', 'top', 'fontSize', 'color'] },
      { id: 'titulo-post', design: 'document.querySelector("h2")', app: '.ih-timeline h2', props: ['left', 'fontSize', 'fontWeight'] },
    ],
  },
  {
    name: 'busca',
    viewports: ['desktop'],
    app: '/',
    appOpenSearch: true,
    design: [{ click: 'Buscar ou perguntar' }],
    checks: [
      { id: 'painel', design: up(`document.querySelector('input[placeholder^="Buscar artigos"]')`, 'r.width >= 600 && r.height > 300'), app: '.ih-search', props: [...layout.filter((p) => p !== 'height'), 'background'] },
      { id: 'campo', design: up(`document.querySelector('input[placeholder^="Buscar artigos"]')`, 'r.height >= 50'), app: '.ih-search-input', props: ['height'] },
      { id: 'aba-ativa', design: up(t('Tudo'), 'r.height >= 24'), app: '.ih-search-tabs [aria-selected="true"]', props: ['left', 'height', 'background', 'fontWeight'] },
      { id: 'rotulo', design: t('Mais acessados'), app: '.ih-search-results .ih-eyebrow', props: ['left', 'top', ...type] },
      { id: 'resultado', design: up(t('Transferir um atendimento'), 'r.height >= 50'), app: '.ih-search-result', props: [...layout] },
    ],
  },
];

/**
 * Cores do protótipo que não passam em contraste WCAG AA (4,5:1) e foram trocadas pelo tom acessível
 * mais próximo. O teste aceita o tom acessível, mas lista cada ocorrência no relatório.
 */
export const accessibleColors = [
  { design: [148, 163, 184], app: [100, 116, 139], motivo: 'texto #94a3b8 → #64748b' },
  { design: [235, 95, 62], app: [197, 72, 43], motivo: 'botão #eb5f3e → #c5482b (texto branco)' },
  { design: [212, 86, 56], app: [197, 72, 43], motivo: 'link #d45638 → #c5482b' },
  { design: [100, 116, 139], app: [71, 85, 105], motivo: 'selo sobre cinza #64748b → #475569' },
];

/** Tolerâncias por tipo de medida. */
export const tolerance = {
  left: 8,
  top: 12,
  right: 10,
  width: 12,
  height: 8,
  fontSize: 0.6,
  lineHeight: 2,
  borderRadius: 1,
  color: 18,
};
