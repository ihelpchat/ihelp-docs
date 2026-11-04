// Prova por pixels do helper de captura mascarada: cor real da máscara (#E2E8F0) opaca, filtros PNG 0–4, RGB e RGBA,
// alfa parcial e cores uniformes de tema não contam, limites de formato/dimensão, captura útil não é descartada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePng } from './fixtures/png-fixture.mjs';
import { maskedShare, MASKED_SHARE_LIMIT, MASK_COLOR_RGB } from './screenshot-mask.mjs';

const mask = [...MASK_COLOR_RGB, 255];
const content = (x, y) => (x * 7 + y * 3) % 11 === 0 ? [20, 40, 60, 255] : mask;

test('captura toda coberta pela cor da máscara é 1,0 em RGBA e RGB, com os filtros 0 a 4', () => {
  for (const filter of [0, 1, 2, 3, 4]) {
    assert.equal(maskedShare(encodePng(48, 24, () => mask, { filter })), 1, `RGBA filtro ${filter}`);
    assert.equal(maskedShare(encodePng(48, 24, () => mask, { filter, channels: 3 })), 1, `RGB filtro ${filter}`);
  }
});

test('o limite conservador omite só a captura praticamente toda mascarada; a útil fica', () => {
  assert.equal(MASKED_SHARE_LIMIT, 0.98);
  const useful = maskedShare(encodePng(64, 64, content, { filter: 4 }));
  assert.ok(useful > 0.85 && useful < MASKED_SHARE_LIMIT, `captura com conteúdo (${useful}) não atinge o limite`);
  const almost = maskedShare(encodePng(100, 100, (x, y) => y === 0 && x < 1 ? [20, 40, 60, 255] : mask));
  assert.ok(almost >= MASKED_SHARE_LIMIT, `99,99% mascarada (${almost}) atinge o limite`);
  const screenshot = maskedShare(encodePng(80, 50, (x, y) => (y > 10 && y < 40 && x > 5 && x < 70) ? [255, 255, 255, 255] : mask));
  assert.ok(screenshot < MASKED_SHARE_LIMIT, `janela útil sobre fundo mascarado (${screenshot}) não é descartada`);
});

test('cor da máscara com alfa parcial e outras cores uniformes não contam como máscara', () => {
  assert.equal(maskedShare(encodePng(32, 32, () => [...MASK_COLOR_RGB, 128])), 0, 'alfa parcial não é máscara');
  assert.equal(maskedShare(encodePng(32, 32, () => [255, 255, 255, 255])), 0, 'tela branca uniforme não é máscara');
  assert.equal(maskedShare(encodePng(32, 32, () => [0xe2, 0xe8, 0xf1, 255])), 0, 'cor vizinha não é máscara');
  // RGB com tRNS cuja chave é a própria cor da máscara: esses pixels são transparentes, não máscara opaca; o formato
  // com transparência fica fora do decodificador suportado e a captura segue sem omissão.
  assert.equal(maskedShare(encodePng(32, 32, () => [...MASK_COLOR_RGB], { channels: 3, trns: [...MASK_COLOR_RGB] })), 0, 'tRNS com a cor da máscara não é máscara opaca');
});

test('formato fora do suportado, PNG truncado ou dimensões fora de escala devolvem 0 (sem prova, sem omissão)', () => {
  assert.equal(maskedShare(Buffer.from('não é png')), 0);
  const valid = encodePng(16, 16, () => mask);
  assert.equal(maskedShare(valid.subarray(0, 48)), 0, 'truncado');
  const gray = Buffer.from(valid); gray[8 + 8 + 9] = 0; // IHDR colorType 0 (tons de cinza) não é suportado
  assert.equal(maskedShare(gray), 0, 'tipo de cor não suportado');
  const huge = Buffer.from(valid); huge.writeUInt32BE(100_000, 16); huge.writeUInt32BE(100_000, 20); // 10 Gpx declarados
  assert.equal(maskedShare(huge), 0, 'dimensões fora de escala');
});
