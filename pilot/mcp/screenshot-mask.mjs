// Fração dos pixels de um PNG cobertos pela cor real da máscara de privacidade (#E2E8F0, RGB 226/232/240, opaca).
// Serve para omitir da geração uma captura inteiramente mascarada ("tela cinza"), que não é evidência visual.
// Decodificador mínimo, sem dependência: PNG não entrelaçado, 8 bits por canal, RGB (tipo 2) ou RGBA (tipo 6),
// filtros 0–4, sem tRNS. Qualquer outro formato, PNG truncado, dimensões acima do limite ou inflação inesperada devolvem 0:
// sem prova de máscara, a captura segue o fluxo de sempre (não é aprovação visual nem remoção de máscara).
import { inflateSync } from 'node:zlib';

export const MASK_COLOR_HEX = '#E2E8F0';
export const MASK_COLOR_RGB = Object.freeze([0xe2, 0xe8, 0xf0]);
/** Limite conservador: só captura praticamente toda coberta pela máscara é omitida. */
export const MASKED_SHARE_LIMIT = 0.98;
const SIGNATURE = '89504e470d0a1a0a';
const CHANNELS = { 2: 3, 6: 4 };
const MAX_PIXELS = 40_000_000; // 40 Mpx: muito acima de qualquer captura de tela; evita inflar dados fora de escala.

export function maskedShare(bytes, { color = MASK_COLOR_RGB } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== SIGNATURE) return 0;
  let offset = 8, width = 0, height = 0, channels = 0;
  const idat = [];
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (offset + 12 + length > bytes.length) return 0;
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      if (length !== 13) return 0;
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      const bitDepth = data[8], colorType = data[9], interlace = data[12];
      channels = bitDepth === 8 && interlace === 0 ? CHANNELS[colorType] ?? 0 : 0;
    } else if (type === 'IDAT') idat.push(data);
    // tRNS declara cor-chave transparente (RGB): pixels da cor da máscara poderiam ser transparência, não máscara opaca.
    else if (type === 'tRNS') return 0;
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!width || !height || !channels || !idat.length || width * height > MAX_PIXELS) return 0;
  const stride = width * channels;
  const expected = height * (stride + 1);
  let raw;
  try { raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected }); } catch { return 0; }
  if (raw.length !== expected) return 0;
  const pixels = Buffer.alloc(height * stride);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)];
    if (filter > 4) return 0;
    const source = row * (stride + 1) + 1, target = row * stride;
    for (let index = 0; index < stride; index++) {
      const left = index >= channels ? pixels[target + index - channels] : 0;
      const up = row > 0 ? pixels[target - stride + index] : 0;
      const upLeft = row > 0 && index >= channels ? pixels[target - stride + index - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const dLeft = Math.abs(estimate - left), dUp = Math.abs(estimate - up), dUpLeft = Math.abs(estimate - upLeft);
        predictor = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
      }
      pixels[target + index] = (raw[source + index] + predictor) & 0xff;
    }
  }
  let masked = 0;
  const total = width * height;
  for (let pixel = 0; pixel < total; pixel++) {
    const at = pixel * channels;
    // Só a cor exata da máscara, opaca: alfa parcial ou outra cor uniforme (tela branca, tema) não contam.
    if (pixels[at] === color[0] && pixels[at + 1] === color[1] && pixels[at + 2] === color[2]
      && (channels === 3 || pixels[at + 3] === 0xff)) masked += 1;
  }
  return masked / total;
}
