// Migra o export GitBook (Central de Ajuda) -> docs/ em MDX do Docusaurus.
// - converte sintaxe GitBook (hints, embeds, figure/img, mark, ancoras)
// - aplica regra de pasta-indice (X.md com pasta irma X/ -> X/index.md)
// - gera frontmatter e _category_.json
// - baixa imagens remotas do FAQ para static/img/help (fallback: mantem hotlink)
// - injeta video self-hosted nas paginas mapeadas (substitui embed tella)
//
// Uso: node scripts/migrate-gitbook.mjs
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'C:/Users/Gian Peres/Documents/ihelp-docs-export/ihelp-docs-md';
const OUT = path.resolve('docs');
const IMG_OUT = path.resolve('static/img/help');

// Mapa id->arquivo local das imagens recuperadas do site ao vivo
// (gerado por scripts/harvest-faq-images.mjs). Sem o arquivo, cai no comportamento antigo (remove).
let IMG_MAP = {};
try {
  IMG_MAP = JSON.parse(fs.readFileSync(path.resolve('scripts/faq-image-map.json'), 'utf8'));
} catch {
  console.warn('AVISO: scripts/faq-image-map.json nao encontrado; imagens serao removidas.');
}

// Arquivos do export que NAO viram paginas
const SKIP = new Set(['README.md', 'MEDIA.md', 'novidades-e-atualizacoes.md']);

// Video self-hosted por pagina (caminho relativo no export -> slug do .mp4 em static/videos)
const VIDEO_MAP = {
  'sobre-o-sistema/atendimento.md': 'atendimento',
  'sobre-o-sistema/robo-de-atendimento.md': 'robo-de-pre-atendimento',
  'sobre-o-sistema/dashboard.md': 'dashboard',
  'sobre-o-sistema/relatorios.md': 'relatorios',
  'sobre-o-sistema/agenda-de-contatos.md': 'agenda-de-contatos',
  'sobre-o-sistema/campanhas.md': 'criando-campanhas-de-marketing',
  'sobre-o-sistema/campanhas/como-criar-uma-nova-campanha.md': 'criando-campanhas-no-ihelp',
  'sobre-o-sistema/campanhas/preparando-a-planilha-de-campanhas.md': 'como-preparar-a-planilha',
  'sobre-o-sistema/configuracoes/canais.md': 'canais',
  'sobre-o-sistema/configuracoes/departamentos.md': 'departamentos',
  'sobre-o-sistema/configuracoes/gerenciamento-de-usuarios.md': 'gerenciamento-de-usuarios',
  'sobre-o-sistema/configuracoes/configuracoes-gerais.md': 'configuracoes-gerais',
  'sobre-o-sistema/configuracoes/atalhos.md': 'atalhos',
  'sobre-o-sistema/configuracoes/alterar-senha.md': 'como-alterar-sua-senha',
};

// Rotulos e ordem das categorias (caminho relativo de pasta no docs/)
const CATEGORIES = {
  'primeiros-passos': {label: 'Primeiros Passos', position: 1},
  'sobre-o-ihelp': {label: 'Sobre o iHelp', position: 2},
  'sobre-o-sistema': {label: 'Sobre o Sistema', position: 3},
  'sobre-o-sistema/campanhas': {label: 'Campanhas', position: 2},
  'sobre-o-sistema/configuracoes': {label: 'Configurações', position: 5},
  'whatsapp-business-api': {label: 'WhatsApp Business API', position: 4},
  'whatsapp-business-api/o-basico': {label: 'O Básico', position: 1},
  'whatsapp-business-api/antes-de-migrar': {label: 'Antes de Migrar', position: 2},
  'whatsapp-business-api/funcionamento': {label: 'Funcionamento', position: 3},
  'whatsapp-business-api/configuracao': {label: 'Configuração', position: 4},
  'whatsapp-business-api/configuracao/gupshup': {label: 'Gupshup', position: 1},
  'duvidas-e-dicas': {label: 'Dúvidas e Dicas', position: 6},
  'duvidas-e-dicas/download-de-lista-de-contatos': {label: 'Download de Lista de Contatos', position: 1},
};

const report = [];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function titleCaseFromSlug(slug) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Converte o corpo GitBook -> MDX
function transform(src) {
  let s = src.replace(/\r\n/g, '\n');

  // hints -> admonitions
  const hintMap = {success: 'tip', info: 'info', warning: 'warning', danger: 'danger'};
  s = s.replace(/\{%\s*hint\s+style="(\w+)"\s*%\}/g, (m, st) => '\n:::' + (hintMap[st] || 'note') + '\n');
  s = s.replace(/\{%\s*endhint\s*%\}/g, '\n:::\n');

  // embeds -> VideoEmbed (youtube/tella) ou link
  s = s.replace(/\{%\s*embed\s+url="<?([^">]+?)>?"\s*%\}/g, (m, url) => {
    url = url.trim();
    if (/youtube\.com|youtu\.be|tella\.tv/.test(url)) return `<VideoEmbed url="${url}" />`;
    return `[${url}](${url})`;
  });

  // imgs (com ou sem fechamento) -> markdown
  s = s.replace(/<img\b[^>]*?\bsrc="([^"]+)"[^>]*?>/g, (m, url) => {
    const altM = m.match(/\balt="([^"]*)"/);
    return `![${altM ? altM[1] : ''}](${url})`;
  });
  // remove wrappers figure/figcaption/div
  s = s.replace(/<figcaption>.*?<\/figcaption>/gs, '');
  s = s.replace(/<\/?figure>/g, '');
  s = s.replace(/<\/?div[^>]*>/g, '');

  // imagens do FAQ antigo: recuperadas do site ao vivo (scripts/faq-image-map.json).
  // id no mapa -> aponta para o arquivo local em /img/help; senao -> remove (link morto).
  s = s.replace(
    /!\[([^\]]*)\]\((?:https?:\/\/faq\.ihelpchat\.com)?\/?(?:ihelp-docs\/)?files\/([A-Za-z0-9]+)[^)]*\)/g,
    (m, alt, id) => {
      const local = IMG_MAP[id];
      if (local) {
        report.push('IMG RECUPERADA: ' + id + ' -> ' + local);
        return `![${alt}](${local})`;
      }
      report.push('IMG REMOVIDA (sem versao no site): ' + m.trim());
      return '';
    },
  );

  // links internos do site antigo -> rotas novas do Docusaurus
  s = s.replace(/\]\(https?:\/\/faq\.ihelpchat\.com\/ihelp-docs\//g, '](/docs/');
  s = s.replace(/\]\(\/ihelp-docs\//g, '](/docs/');
  s = s.replace(/\]\((\/docs\/[^)#]+)\.md(#[^)]*)?\)/g, ']($1$2)');

  // email autolink <a@b> -> [a@b](mailto:a@b)  (evita erro de JSX no MDX)
  s = s.replace(/<([^>\s@]+@[^>\s]+)>/g, '[$1](mailto:$1)');

  // <mark ...>x</mark> -> x
  s = s.replace(/<mark[^>]*>(.*?)<\/mark>/gs, '$1');

  // ancoras vazias
  s = s.replace(/<a\b[^>]*>\s*<\/a>/g, '');

  // autolinks <https://...> -> url cru (evita JSX invalido no MDX)
  s = s.replace(/<((?:https?:\/\/)[^>\s]+)>/g, '$1');

  // entidades / caracteres invisiveis
  s = s.replace(/&#x20;/g, ' ');
  s = s.replace(/[​‎‏]/g, '');

  // <br> -> <br/>
  s = s.replace(/<br\s*>/g, '<br/>');

  // limpa headings: remove vazios e lixo inicial (variation selectors, nbsp, espacos)
  s = s
    .split('\n')
    .map((line) => {
      if (/^#{1,6}\s*$/.test(line)) return null;
      const hm = line.match(/^(#{1,6})\s+(.*)$/);
      if (hm) {
        const title = hm[2].replace(/^[\s ️♀♂]+/, '').trim();
        return title ? `${hm[1]} ${title}` : null;
      }
      return line;
    })
    .filter((l) => l !== null)
    .join('\n');

  // colapsa linhas em branco
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim() + '\n';
}

function run() {
  const files = walk(SRC).filter((f) => {
    const rel = path.relative(SRC, f).replace(/\\/g, '/');
    return !SKIP.has(rel);
  });

  const folderHasIndex = new Set();
  const imageUrls = new Set();
  const writes = []; // {outputPath, content}

  for (const file of files) {
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    const dirOfFile = path.dirname(file);
    const base = path.basename(file, '.md');
    const siblingDir = path.join(dirOfFile, base);
    const isIndex = fs.existsSync(siblingDir) && fs.statSync(siblingDir).isDirectory();

    const relDir = path.dirname(rel) === '.' ? '' : path.dirname(rel);
    const outRel = isIndex ? (relDir ? relDir + '/' : '') + base + '/index.md' : rel;
    const outputPath = path.join(OUT, outRel);

    if (path.basename(outRel) === 'index.md') {
      folderHasIndex.add(path.dirname(outRel).replace(/\\/g, '/'));
    }

    const raw = fs.readFileSync(file, 'utf8');
    let body = transform(raw);

    const h1 = body.match(/^#\s+(.+)$/m);
    let title = h1 ? h1[1].trim() : titleCaseFromSlug(base);
    title = title.replace(/[*_`]/g, '').trim();
    if (h1) body = body.replace(/^#\s+.+\n?/m, '').trimStart();

    const videoSlug = VIDEO_MAP[rel];
    if (videoSlug) {
      body = body.replace(/<VideoEmbed url="[^"]*tella\.tv[^"]*"\s*\/>\n?/g, '');
      body = `<VideoEmbed url="/videos/${videoSlug}.mp4" />\n\n` + body.trimStart();
    }

    for (const m of body.matchAll(/!\[[^\]]*\]\((https:\/\/faq\.ihelpchat\.com\/files\/[^)]+)\)/g)) {
      imageUrls.add(m[1]);
    }

    const fm = `---\ntitle: ${JSON.stringify(title)}\n---\n\n`;
    writes.push({outputPath, content: fm + body});
  }

  return {writes, folderHasIndex, imageUrls};
}

async function downloadImages(imageUrls) {
  fs.mkdirSync(IMG_OUT, {recursive: true});
  const extByCT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
  };
  const map = new Map();
  const urls = [...imageUrls];
  let ok = 0;
  let fail = 0;

  const BATCH = 8;
  for (let i = 0; i < urls.length; i += BATCH) {
    const slice = urls.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (url) => {
        const id = url.split('/').pop();
        try {
          const res = await fetch(url, {redirect: 'follow'});
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const ct = (res.headers.get('content-type') || '').split(';')[0].trim();
          const ext = extByCT[ct] || 'png';
          const buf = Buffer.from(await res.arrayBuffer());
          fs.writeFileSync(path.join(IMG_OUT, `${id}.${ext}`), buf);
          map.set(url, `/img/help/${id}.${ext}`);
          ok++;
        } catch (err) {
          map.set(url, null);
          fail++;
          report.push(`IMG FALHOU (mantido hotlink): ${url} -> ${err.message}`);
        }
      }),
    );
    process.stdout.write(`\r  imagens: ${ok + fail}/${urls.length} (ok ${ok}, falhou ${fail})`);
  }
  process.stdout.write('\n');
  return map;
}

function writeCategoryJsons(folderHasIndex) {
  for (const [relFolder, meta] of Object.entries(CATEGORIES)) {
    const dir = path.join(OUT, relFolder);
    if (!fs.existsSync(dir)) continue;
    const json = {label: meta.label, position: meta.position};
    if (!folderHasIndex.has(relFolder)) {
      // slug ASCII explicito (evita rota com acento derivada do label)
      json.link = {type: 'generated-index', slug: '/' + relFolder};
    }
    fs.writeFileSync(path.join(dir, '_category_.json'), JSON.stringify(json, null, 2) + '\n');
  }
}

(async () => {
  const {writes, folderHasIndex, imageUrls} = run();
  console.log(`Paginas a gerar: ${writes.length}`);
  console.log(`Imagens remotas unicas: ${imageUrls.size}`);

  const imgMap = await downloadImages(imageUrls);

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let droppedImgs = 0;
  for (const w of writes) {
    let c = w.content;
    for (const [url, local] of imgMap) {
      if (local) {
        c = c.split(url).join(local);
      } else {
        // imagem morta (404): remove o markdown da imagem em vez de deixar link quebrado
        const re = new RegExp('!\\[[^\\]]*\\]\\(' + escapeRegex(url) + '\\)\\n?', 'g');
        const before = c;
        c = c.replace(re, '');
        if (c !== before) droppedImgs++;
      }
    }
    c = c.replace(/\n{3,}/g, '\n\n');
    fs.mkdirSync(path.dirname(w.outputPath), {recursive: true});
    fs.writeFileSync(w.outputPath, c);
  }
  console.log(`Imagens removidas (mortas/404): ${droppedImgs} ocorrencias`);

  writeCategoryJsons(folderHasIndex);

  fs.writeFileSync(path.resolve('scripts/migration-report-faq.txt'), report.join('\n') + '\n');
  console.log(`OK. ${writes.length} paginas escritas. Relatorio: scripts/migration-report-faq.txt`);
  console.log(`Falhas de imagem: ${report.length}`);
})();
