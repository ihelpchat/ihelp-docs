// Gera static/content-index.json com título, URL, trecho e conteúdo completo
// de docs/, tutoriais/ e blog/ para uso pelo AITutorialSearch.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'static', 'content-index.json');

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const obj = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) obj[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return obj;
}

function cleanText(content) {
  const body = content.replace(/^---[\s\S]*?---\r?\n/, '');
  return body
    .replace(/<[^>]+>/g, ' ')        // remove tags JSX/HTML
    .replace(/```[\s\S]*?```/g, ' ') // remove blocos de código
    .replace(/`[^`]+`/g, ' ')        // remove inline code
    .replace(/^#{1,6}\s+/gm, '')     // remove # de headings
    .replace(/[*_[\]]/g, '')         // remove markdown bold/italic/links
    .replace(/\{[^}]+\}/g, ' ')      // remove expressões JSX
    .replace(/!?\[.*?\]\(.*?\)/g, '') // remove links markdown
    .replace(/\n{3,}/g, '\n\n')      // normaliza espaços em branco
    .trim();
}

function extractExcerpt(content) {
  return cleanText(content).replace(/\n+/g, ' ').slice(0, 600);
}

function extractContent(content) {
  // Texto completo limpo, preservando quebras de linha para leitura estruturada
  return cleanText(content).slice(0, 8000);
}

function extractHeadings(content) {
  const body = content.replace(/^---[\s\S]*?---\r?\n/, '');
  const headings = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^#{2,6}\s+(.+)$/);
    if (m) headings.push(m[1].trim());
  }
  return headings;
}

function scanDocs(dir, base, section, pages) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDocs(full, base, section, pages);
    } else if (/\.mdx?$/.test(entry.name)) {
      const raw = fs.readFileSync(full, 'utf8');
      const fm = parseFrontmatter(raw);
      if (!fm.title) continue;

      const rel = path.relative(path.join(ROOT, base), full)
        .replace(/\\/g, '/')
        .replace(/\.mdx?$/, '');

      const urlPath = fm.slug
        ? `/${base}/${fm.slug}`
        : `/${base}/${rel.replace(/\/index$/, '') || ''}`.replace(/\/$/, '') || `/${base}`;

      pages.push({
        title: fm.title,
        url: urlPath,
        section,
        excerpt: extractExcerpt(raw),
        content: extractContent(raw),
        headings: extractHeadings(raw),
      });
    }
  }
}

function scanBlog(dir, pages) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (!entry.isFile() || !/\.mdx?$/.test(entry.name)) continue;
    const raw = fs.readFileSync(path.join(dir, entry.name), 'utf8');
    const fm = parseFrontmatter(raw);
    if (!fm.title) continue;

    let urlPath;
    if (fm.slug) {
      urlPath = `/blog/${fm.slug}`;
    } else {
      const m = entry.name.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)\.mdx?$/);
      urlPath = m ? `/blog/${m[1]}/${m[2]}/${m[3]}/${m[4]}` : `/blog/${entry.name.replace(/\.mdx?$/, '')}`;
    }

    pages.push({
      title: fm.title,
      url: urlPath,
      section: 'Novidades',
      excerpt: extractExcerpt(raw),
      content: extractContent(raw),
      headings: extractHeadings(raw),
    });
  }
}

const pages = [];
scanDocs(path.join(ROOT, 'docs'), 'docs', 'Central de Ajuda', pages);
scanDocs(path.join(ROOT, 'tutoriais'), 'tutoriais', 'Tutoriais Guiados', pages);
scanBlog(path.join(ROOT, 'blog'), pages);

fs.writeFileSync(OUTPUT, JSON.stringify(pages, null, 2));

const totalChars = pages.reduce((s, p) => s + p.content.length, 0);
console.log(`✅ content-index.json: ${pages.length} páginas indexadas (${Math.round(totalChars / 1024)}KB de conteúdo)`);
