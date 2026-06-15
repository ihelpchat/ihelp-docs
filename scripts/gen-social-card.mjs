// Gera static/img/ihelp-social-card.jpg (1200x630) usado como og:image / twitter card.
// Compoe: fundo branco + barra laranja + wordmark oficial (paths do logo) + titulo/subtitulo.
// Uso unico; sharp via --no-save.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const FULL = 'C:/Users/Gian Peres/Downloads/logotipo-full.svg';
const OUT = path.resolve('static/img/ihelp-social-card.jpg');

// Paths internos do wordmark (entre <svg ...> e </svg>), viewBox 0 0 1300 546
const fullSvg = fs.readFileSync(FULL, 'utf8');
const inner = fullSvg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '').trim();

const NAVY = '#2D2A4D';
const ORANGE = '#EB5F3E';
const MUTED = '#6E6B86';

// wordmark: largura ~470 -> escala 470/1300; centralizado em x
const wmW = 470;
const scale = wmW / 1300;
const wmH = 546 * scale; // ~197
const wmX = (1200 - wmW) / 2;
const wmY = 120;

const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#FFFFFF"/>
  <rect x="0" y="0" width="16" height="630" fill="${ORANGE}"/>
  <g transform="translate(${wmX}, ${wmY}) scale(${scale})">
    ${inner}
  </g>
  <text x="600" y="${wmY + wmH + 95}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="700" fill="${NAVY}">Documentação</text>
  <rect x="555" y="${wmY + wmH + 120}" width="90" height="6" rx="3" fill="${ORANGE}"/>
  <text x="600" y="${wmY + wmH + 180}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="30" fill="${MUTED}">Central de Ajuda · API · Novidades</text>
</svg>`;

await sharp(Buffer.from(svg), {density: 144})
  .resize(1200, 630)
  .jpeg({quality: 88, chromaSubsampling: '4:4:4'})
  .toFile(OUT);

const {size} = fs.statSync(OUT);
console.log(`OK: ${OUT} (${Math.round(size / 1024)} KB)`);
