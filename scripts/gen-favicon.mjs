// Gera static/img/favicon.ico (+ favicon.png 256 e apple-touch-icon 180)
// a partir do icone oficial do iHelp (SVG). Uso unico; sharp/png-to-ico via --no-save.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const SVG = 'C:/Users/Gian Peres/Downloads/logotipo-icon.svg';
const OUT = path.resolve('static/img');
const svg = fs.readFileSync(SVG);

// renderiza o SVG num quadrado transparente no tamanho pedido
async function render(size) {
  return sharp(svg, {density: 384})
    .resize(size, size, {fit: 'contain', background: {r: 0, g: 0, b: 0, alpha: 0}})
    .png()
    .toBuffer();
}

const ICO_SIZES = [16, 32, 48, 64];
const icoBuffers = await Promise.all(ICO_SIZES.map(render));
const ico = await pngToIco(icoBuffers);
fs.writeFileSync(path.join(OUT, 'favicon.ico'), ico);

fs.writeFileSync(path.join(OUT, 'favicon.png'), await render(256));
fs.writeFileSync(path.join(OUT, 'apple-touch-icon.png'), await render(180));

console.log('OK: favicon.ico (16/32/48/64), favicon.png (256), apple-touch-icon.png (180)');
