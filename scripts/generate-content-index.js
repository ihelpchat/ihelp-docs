// Gera static/content-index.json com título, URL e trecho de todas as páginas
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

function extractExcerpt(content) {
  const body = content.replace(/^---[\s\S]*?---\r?\n/, '');
  const plain = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`[\]]/g, '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  return plain.slice(0, 250);
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
      const content = fs.readFileSync(full, 'utf8');
      const fm = parseFrontmatter(content);
      if (!fm.title) continue;

      const rel = path.relative(path.join(ROOT, base), full)
        .replace(/\\/g, '/')
        .replace(/\.mdx?$/, '');

      let urlPath;
      if (fm.slug) {
        urlPath = `/${base}/${fm.slug}`;
      } else {
        urlPath = `/${base}/${rel.replace(/\/index$/, '') || ''}`.replace(/\/$/, '') || `/${base}`;
      }

      pages.push({
        title: fm.title,
        url: urlPath,
        section,
        excerpt: extractExcerpt(content),
        headings: extractHeadings(content),
      });
    }
  }
}

function scanBlog(dir, pages) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (!entry.isFile() || !/\.mdx?$/.test(entry.name)) continue;
    const content = fs.readFileSync(path.join(dir, entry.name), 'utf8');
    const fm = parseFrontmatter(content);
    if (!fm.title) continue;

    let urlPath;
    if (fm.slug) {
      urlPath = `/blog/${fm.slug}`;
    } else {
      // YYYY-MM-DD-slug.md → /blog/YYYY/MM/DD/slug
      const m = entry.name.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)\.mdx?$/);
      urlPath = m ? `/blog/${m[1]}/${m[2]}/${m[3]}/${m[4]}` : `/blog/${entry.name.replace(/\.mdx?$/, '')}`;
    }

    pages.push({
      title: fm.title,
      url: urlPath,
      section: 'Novidades',
      excerpt: extractExcerpt(content),
      headings: extractHeadings(content),
    });
  }
}

const pages = [];
scanDocs(path.join(ROOT, 'docs'), 'docs', 'Central de Ajuda', pages);
scanDocs(path.join(ROOT, 'tutoriais'), 'tutoriais', 'Tutoriais Guiados', pages);
scanBlog(path.join(ROOT, 'blog'), pages);

fs.writeFileSync(OUTPUT, JSON.stringify(pages, null, 2));
console.log(`✅ content-index.json: ${pages.length} páginas indexadas`);
