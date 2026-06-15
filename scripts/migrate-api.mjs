// Migra a doc de API (MkDocs index.md) -> api/ em MDX do Docusaurus.
// - divide o index.md por H2 (uma pagina por secao)
// - EXCLUI secoes sensiveis (webhooks/IDs de suporte): "Regras da Meta" e "Ver Logs de Erro"
// - agrupa em categorias (Conceitos, Atendimentos, Mensagens, Templates)
// - escapa placeholders <x> fora de code fences (evita JSX invalido no MDX)
// - copia assets/*.png -> static/img/api e reescreve os caminhos
//
// Uso: node scripts/migrate-api.mjs
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'C:/Users/Gian Peres/Code/ihelp-docs-api/docs/index.md';
const ASSETS = 'C:/Users/Gian Peres/Code/ihelp-docs-api/docs/assets';
const OUT = path.resolve('api');
const IMG_OUT = path.resolve('static/img/api');

// Definicao das secoes (na ordem do documento). match = regex no titulo H2.
// exclude=true -> nao publica (conteudo sensivel de suporte).
const SECTIONS = [
  {match: /Regras da Meta/i, exclude: true},
  {match: /Ver Logs de Erro/i, exclude: true},
  {match: /Autentica/i, cat: 'conceitos', slug: 'autenticacao', title: 'Autenticação', pos: 1},
  {match: /obter.*token/i, cat: 'conceitos', slug: 'obter-token', title: 'Obter token de usuário', pos: 2},
  {match: /Buscar atendimento pelo telefone/i, cat: 'atendimentos', slug: 'buscar-atendimento-por-telefone', title: 'Buscar atendimento pelo telefone', pos: 1},
  {match: /Buscar metadados/i, cat: 'atendimentos', slug: 'buscar-metadados', title: 'Buscar metadados do atendimento', pos: 2},
  {match: /Resumir conversa/i, cat: 'atendimentos', slug: 'resumir-conversa', title: 'Resumir conversa', pos: 3},
  {match: /Buscar chats em massa/i, cat: 'atendimentos', slug: 'buscar-chats-em-massa', title: 'Buscar chats em massa', pos: 4},
  {match: /Buscar hist[oó]rico de mensagens/i, cat: 'atendimentos', slug: 'buscar-historico-de-mensagens', title: 'Buscar histórico de mensagens', pos: 5},
  {match: /Transcrever um [aá]udio/i, cat: 'atendimentos', slug: 'transcrever-audio', title: 'Transcrever áudio', pos: 6},
  {match: /Pegar IDs/i, cat: 'atendimentos', slug: 'pegar-ids-departamento-canal', title: 'Pegar IDs: Departamento e Canal', pos: 7},
  {match: /Mensagem Comum/i, cat: 'mensagens', slug: 'mensagem-comum', title: 'Mensagem comum', pos: 1},
  {match: /Mensagem em grupo/i, cat: 'mensagens', slug: 'mensagem-em-grupo', title: 'Mensagem em grupo', pos: 2},
  {match: /Template: Pegar JSON Body/i, cat: 'templates', slug: 'template-json-body', title: 'Template: JSON Body pronto', pos: 1},
  {match: /Template: Enviar em Chat Existente/i, cat: 'templates', slug: 'template-enviar-chat-existente', title: 'Template: enviar em chat existente', pos: 2},
  {match: /Template: Criar Novo Chat/i, cat: 'templates', slug: 'template-criar-novo-chat', title: 'Template: criar novo chat', pos: 3},
];

const CATEGORIES = {
  conceitos: {label: 'Conceitos', position: 1},
  atendimentos: {label: 'Atendimentos', position: 2},
  mensagens: {label: 'Mensagens', position: 3},
  templates: {label: 'Templates', position: 4},
};

function cleanHeadingText(t) {
  // remove emoji/variation selectors/espacos no inicio
  return t.replace(/^[\s☀-➿️\u{1F000}-\u{1FAFF}♀♂️]+/u, '').trim();
}

// Escapa placeholders <x> fora de code fences; reescreve caminho de imagem.
function transformApi(text) {
  const lines = text.split('\n');
  let inFence = false;
  const out = [];
  for (let line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (!inFence) {
      line = line.replace(/<([a-zA-Z][\w./-]*)>/g, '&lt;$1&gt;');
      line = line.replace(/<br\s*>/g, '<br/>');
      line = line.replace(/\]\(assets\//g, '](/img/api/');
      // limpa heading com lixo inicial
      const hm = line.match(/^(#{1,6})\s+(.*)$/);
      if (hm) {
        const txt = cleanHeadingText(hm[2]);
        line = txt ? `${hm[1]} ${txt}` : '';
      }
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function splitSections(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.*)$/);
    if (m) {
      if (cur) sections.push(cur);
      cur = {heading: m[1].trim(), body: []};
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) sections.push(cur);
  return sections;
}

function run() {
  const content = fs.readFileSync(SRC, 'utf8');
  const sections = splitSections(content);

  fs.mkdirSync(OUT, {recursive: true});
  fs.mkdirSync(IMG_OUT, {recursive: true});

  let published = 0;
  let excluded = 0;
  const unmatched = [];

  for (const sec of sections) {
    const def = SECTIONS.find((d) => d.match.test(sec.heading));
    if (!def) {
      unmatched.push(sec.heading);
      continue;
    }
    if (def.exclude) {
      excluded++;
      continue;
    }
    const bodyRaw = sec.body.join('\n');
    const body = transformApi(bodyRaw);
    const fm = `---\ntitle: ${JSON.stringify(def.title)}\nsidebar_position: ${def.pos}\n---\n\n`;
    const dir = path.join(OUT, def.cat);
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, def.slug + '.md'), fm + body);
    published++;
  }

  // _category_.json
  for (const [cat, meta] of Object.entries(CATEGORIES)) {
    const dir = path.join(OUT, cat);
    if (!fs.existsSync(dir)) continue;
    fs.writeFileSync(
      path.join(dir, '_category_.json'),
      JSON.stringify({label: meta.label, position: meta.position, link: {type: 'generated-index'}}, null, 2) + '\n',
    );
  }

  // copia assets
  let imgs = 0;
  if (fs.existsSync(ASSETS)) {
    for (const f of fs.readdirSync(ASSETS)) {
      if (/\.(png|jpe?g|gif|webp|svg)$/i.test(f)) {
        fs.copyFileSync(path.join(ASSETS, f), path.join(IMG_OUT, f));
        imgs++;
      }
    }
  }

  console.log(`API: ${published} paginas publicadas, ${excluded} excluidas (sensiveis), ${imgs} imagens copiadas.`);
  if (unmatched.length) {
    console.log('SECOES SEM MATCH (ignoradas):');
    unmatched.forEach((h) => console.log('  - ' + h));
  }
}

run();
