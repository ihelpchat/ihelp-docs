// Migra novidades-e-atualizacoes.md (GitBook) -> blog/ do Docusaurus.
// Divide por "## ... Atualização DD/MM/YYYY" em um post por data.
//
// Uso: node scripts/migrate-blog.mjs
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'C:/Users/Gian Peres/Documents/ihelp-docs-export/ihelp-docs-md/novidades-e-atualizacoes.md';
const OUT = path.resolve('blog');

// Metadados por data (DD/MM/YYYY)
const POSTS = {
  '24/04/2026': {slug: 'nova-tela-de-senha', title: 'Nova tela de alteração de senha', tags: ['atualizacao', 'seguranca']},
  '23/07/2025': {slug: 'encerramento-automatico-e-filtros', title: 'Encerramento automático e novos filtros', tags: ['atualizacao', 'atendimento']},
  '30/06/2025': {slug: 'listas-personalizadas', title: 'Listas personalizadas', tags: ['atualizacao', 'atendimento']},
  '27/06/2025': {slug: 'edicao-de-mensagens', title: 'Edição de mensagens', tags: ['atualizacao', 'mensagens']},
  '10/06/2025': {slug: 'citacoes-status-catalogo', title: 'Citações de Status e Catálogo no WhatsApp', tags: ['atualizacao', 'whatsapp']},
  '25/05/2025': {slug: 'calendario-agendamento-e-robo-ligacao', title: 'Calendário de agendamento e robô por ligação', tags: ['atualizacao', 'agendamento']},
};

const report = [];

function transform(src) {
  let s = src.replace(/\r\n/g, '\n');

  const hintMap = {success: 'tip', info: 'info', warning: 'warning', danger: 'danger'};
  s = s.replace(/\{%\s*hint\s+style="(\w+)"\s*%\}/g, (m, st) => '\n:::' + (hintMap[st] || 'note') + '\n');
  s = s.replace(/\{%\s*endhint\s*%\}/g, '\n:::\n');

  s = s.replace(/\{%\s*embed\s+url="<?([^">]+?)>?"\s*%\}/g, (m, url) => {
    url = url.trim();
    if (/youtube\.com|youtu\.be|tella\.tv/.test(url)) return `<VideoEmbed url="${url}" />`;
    return `[${url}](${url})`;
  });

  s = s.replace(/<img\b[^>]*?\bsrc="([^"]+)"[^>]*?>/g, (m, url) => {
    const altM = m.match(/\balt="([^"]*)"/);
    return `![${altM ? altM[1] : ''}](${url})`;
  });
  s = s.replace(/<figcaption>.*?<\/figcaption>/gs, '');
  s = s.replace(/<\/?figure>/g, '');
  s = s.replace(/<\/?div[^>]*>/g, '');

  // imagens mortas do FAQ antigo -> remove
  s = s.replace(/!\[[^\]]*\]\((?:https?:\/\/faq\.ihelpchat\.com)?\/?(?:ihelp-docs\/)?files\/[^)]*\)\n?/g, (m) => {
    report.push('IMG REMOVIDA (404): ' + m.trim());
    return '';
  });

  s = s.replace(/<mark[^>]*>(.*?)<\/mark>/gs, '$1');
  s = s.replace(/<a\b[^>]*>\s*<\/a>/g, '');
  s = s.replace(/<((?:https?:\/\/)[^>\s]+)>/g, '$1');
  s = s.replace(/<([^>\s@]+@[^>\s]+)>/g, '[$1](mailto:$1)');
  s = s.replace(/&#x20;/g, ' ');
  s = s.replace(/[​‎‏]/g, '');
  s = s.replace(/<br\s*>/g, '<br/>');

  s = s
    .split('\n')
    .map((line) => {
      if (/^#{1,6}\s*$/.test(line)) return null;
      const hm = line.match(/^(#{1,6})\s+(.*)$/);
      if (hm) {
        const title = hm[2].replace(/^[\s ️♀♂]+/, '').trim();
        return title ? `${hm[1]} ${title}` : null;
      }
      return line;
    })
    .filter((l) => l !== null)
    .join('\n');

  return s.replace(/\n{3,}/g, '\n\n').trim();
}

function addTruncate(body) {
  const blocks = body.split(/\n\n+/);
  const out = [];
  let inserted = false;
  for (const b of blocks) {
    out.push(b);
    const t = b.trim();
    const isHeading = /^#{1,6}\s/.test(t);
    const isVideo = t.startsWith('<VideoEmbed');
    if (!inserted && t && !isHeading && !isVideo) {
      out.push('{/* truncate */}');
      inserted = true;
    }
  }
  return out.join('\n\n');
}

function run() {
  fs.mkdirSync(OUT, {recursive: true});
  const raw = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

  // remove <mark> nos H2 de data antes de dividir
  const cleaned = raw.replace(/^##\s+<mark[^>]*>(.*?)<\/mark>\s*$/gm, '## $1');

  // divide por "## ... Atualização DD/MM/YYYY"
  const parts = cleaned.split(/^##\s+.*?Atualiza[çc][ãa]o\s+(\d{2}\/\d{2}\/\d{4}).*$/gm);
  // parts: [pre, date1, body1, date2, body2, ...]
  let written = 0;
  for (let i = 1; i < parts.length; i += 2) {
    const date = parts[i].trim();
    const bodyRaw = parts[i + 1] || '';
    const meta = POSTS[date];
    if (!meta) {
      report.push('DATA SEM MAPA (ignorada): ' + date);
      continue;
    }
    let body = transform(bodyRaw);

    // post do calendario: usa o video self-hosted no lugar do embed tella
    if (meta.slug === 'calendario-agendamento-e-robo-ligacao') {
      body = body.replace(/<VideoEmbed url="[^"]*tella\.tv[^"]*"\s*\/>/, '<VideoEmbed url="/videos/calendario-de-agendamento.mp4" />');
    }

    body = addTruncate(body);

    const [dd, mm, yyyy] = date.split('/');
    const iso = `${yyyy}-${mm}-${dd}`;
    const tagsYaml = '[' + meta.tags.join(', ') + ']';
    const fm =
      `---\n` +
      `title: ${JSON.stringify(meta.title)}\n` +
      `date: ${iso}\n` +
      `authors: [gian]\n` +
      `tags: ${tagsYaml}\n` +
      `slug: ${meta.slug}\n` +
      `---\n\n`;

    fs.writeFileSync(path.join(OUT, `${iso}-${meta.slug}.md`), fm + body + '\n');
    written++;
  }

  fs.writeFileSync(path.resolve('scripts/migration-report-blog.txt'), report.join('\n') + '\n');
  console.log(`Blog: ${written} posts escritos. Relatorio: scripts/migration-report-blog.txt`);
}

run();
