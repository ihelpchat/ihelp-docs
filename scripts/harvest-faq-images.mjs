// Recupera as imagens reais do FAQ antigo (GitBook) a partir do site AO VIVO.
//
// O export GitBook referencia imagens como /files/<id> (URLs mortas, 404). Mas o site
// renderizado em faq.ihelpchat.com serve cada imagem via o proxy do GitBook
// (/~gitbook/image?url=<CDN assinado>). Este script:
//   1. lê MEDIA.md (catálogo página -> lista ordenada de file ids)
//   2. baixa o HTML de cada página ao vivo
//   3. extrai as URLs de imagem de conteúdo (segmento /uploads/) em ordem de DOM
//   4. casa file-id[i] <-> cdn-url[i] (mesma ordem) e valida a contagem por página
//   5. (sem --dry) baixa cada imagem para static/img/help/<id>.<ext>
//   6. grava scripts/faq-image-map.json  { "<fileId>": "/img/help/<id>.<ext>" }
//
// Uso: node scripts/harvest-faq-images.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const MEDIA = 'C:/Users/Gian Peres/Documents/ihelp-docs-export/ihelp-docs-md/MEDIA.md';
const IMG_OUT = path.resolve('static/img/help');
const BASE = 'https://faq.ihelpchat.com/ihelp-docs/';

// ---------- 1. parse MEDIA.md ----------
// Seções "## <relpath>" seguidas de linhas "- (imagem) https://faq.ihelpchat.com/files/<id>"
function parseMedia() {
  const txt = fs.readFileSync(MEDIA, 'utf8');
  const pages = []; // {rel, ids: [..]}
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+\.md)\s*$/);
    if (h) {
      cur = {rel: h[1].trim(), ids: []};
      pages.push(cur);
      continue;
    }
    const img = line.match(/^-\s+\(imagem\)\s+https:\/\/faq\.ihelpchat\.com\/files\/([A-Za-z0-9]+)/);
    if (img && cur) cur.ids.push(img[1]);
  }
  return pages.filter((p) => p.ids.length > 0);
}

// ---------- 2+3. extrai imagens de conteúdo de uma página ao vivo ----------
function liveUrlFor(rel) {
  // rel é caminho do export (ex.: sobre-o-sistema/atendimento.md) -> URL do GitBook sem .md
  return BASE + rel.replace(/\.md$/, '');
}

// Decodifica o param url do proxy /~gitbook/image?url=... e devolve a CDN url crua.
function extractContentImages(html) {
  const re = /\/~gitbook\/image\?url=([^"'&\s)]+)/g;
  const seen = new Set();
  const urls = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    let cdn;
    try {
      cdn = decodeURIComponent(m[1]);
    } catch {
      continue;
    }
    // só imagens de conteúdo (uploads dos espaços); ignora ícones/favicon/logo do site
    // (após um decode, os separadores do object name continuam como %2F, não /)
    if (!/uploads(?:%2F|\/)/i.test(cdn)) continue;
    // dedup pelo uploadId (srcset repete a mesma imagem em vários tamanhos)
    const idM = cdn.match(/uploads(?:%2F|\/)([A-Za-z0-9]+)/i);
    const key = idM ? idM[1] : cdn;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(cdn);
  }
  return urls;
}

const EXT_BY_CT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

async function main() {
  const pages = parseMedia();
  const totalIds = pages.reduce((n, p) => n + p.ids.length, 0);
  console.log(`Páginas com imagem: ${pages.length} | file ids no MEDIA.md: ${totalIds}`);
  console.log('');

  const pairs = []; // {fileId, cdn, rel}
  const problems = [];

  for (const p of pages) {
    const url = liveUrlFor(p.rel);
    let html;
    try {
      const res = await fetch(url, {redirect: 'follow', headers: {'user-agent': 'Mozilla/5.0'}});
      if (!res.ok) throw new Error('HTTP ' + res.status);
      html = await res.text();
    } catch (err) {
      problems.push(`FETCH FALHOU ${p.rel}: ${err.message}`);
      console.log(`  ✗ ${p.rel}  (fetch falhou: ${err.message})`);
      continue;
    }
    const imgs = extractContentImages(html);
    const status = imgs.length === p.ids.length ? 'OK' : 'DIVERGE';
    console.log(`  ${status === 'OK' ? '✓' : '!'} ${p.rel}  esperado=${p.ids.length} encontrado=${imgs.length}`);
    if (status !== 'OK') {
      problems.push(`CONTAGEM DIVERGE ${p.rel}: esperado ${p.ids.length}, encontrado ${imgs.length}`);
    }
    const n = Math.min(imgs.length, p.ids.length);
    for (let i = 0; i < n; i++) pairs.push({fileId: p.ids[i], cdn: imgs[i], rel: p.rel});
  }

  console.log('');
  console.log(`Pares casados: ${pairs.length} / ${totalIds}`);
  if (problems.length) {
    console.log('\nProblemas:');
    for (const pr of problems) console.log('  - ' + pr);
  }

  if (DRY) {
    console.log('\n[dry] nenhum download feito.');
    return;
  }

  // ---------- 5. download ----------
  fs.mkdirSync(IMG_OUT, {recursive: true});
  const map = {};
  let ok = 0;
  let fail = 0;
  const BATCH = 6;
  for (let i = 0; i < pairs.length; i += BATCH) {
    const slice = pairs.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async ({fileId, cdn}) => {
        try {
          const res = await fetch(cdn, {redirect: 'follow', headers: {'user-agent': 'Mozilla/5.0'}});
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
          const ext = EXT_BY_CT[ct] || 'png';
          const buf = Buffer.from(await res.arrayBuffer());
          fs.writeFileSync(path.join(IMG_OUT, `${fileId}.${ext}`), buf);
          map[fileId] = `/img/help/${fileId}.${ext}`;
          ok++;
        } catch (err) {
          fail++;
          problems.push(`DOWNLOAD FALHOU ${fileId}: ${err.message}`);
        }
      }),
    );
    process.stdout.write(`\r  baixando: ${ok + fail}/${pairs.length} (ok ${ok}, falhou ${fail})`);
  }
  process.stdout.write('\n');

  fs.writeFileSync(path.resolve('scripts/faq-image-map.json'), JSON.stringify(map, null, 2) + '\n');
  fs.writeFileSync(
    path.resolve('scripts/harvest-report.txt'),
    `baixadas: ${ok}\nfalhas: ${fail}\nmapeadas: ${Object.keys(map).length}\n\n` + problems.join('\n') + '\n',
  );
  console.log(`\nOK. Baixadas ${ok}, falhas ${fail}. Mapa: scripts/faq-image-map.json`);
}

main();
