// Codificador PNG de teste (8 bits, RGB tipo 2 ou RGBA tipo 6, não entrelaçado, filtros 0–4, CRC válido), usado pelas
// provas de pixels do helper de captura mascarada e pelo teste de payload do gerador.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buffer) => { let c = 0xffffffff; for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
/** Codificador PNG de teste (8 bits, tipo 2 RGB ou 6 RGBA, não entrelaçado) aplicando o filtro pedido em todas as linhas. */
export function encodePng(width, height, pixel, { filter = 0, channels = 4 } = {}) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2;
  const stride = width * channels;
  const image = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = pixel(x, y);
    for (let c = 0; c < channels; c++) image[y * stride + x * channels + c] = value[c];
  }
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + stride); row[0] = filter;
    for (let i = 0; i < stride; i++) {
      const value = image[y * stride + i];
      const left = i >= channels ? image[y * stride + i - channels] : 0;
      const up = y > 0 ? image[(y - 1) * stride + i] : 0;
      const upLeft = y > 0 && i >= channels ? image[(y - 1) * stride + i - channels] : 0;
      const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : 0;
      row[1 + i] = (value - predictor) & 0xff;
    }
    rows.push(row);
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
