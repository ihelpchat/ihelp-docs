import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';

const css = postcss.parse(await readFile(new URL('../app/global.css', import.meta.url), 'utf8'));
const variables = new Map();
css.walkRules(':root', (rule) => rule.walkDecls(/^--/, (decl) => variables.set(decl.prop, decl.value)));
const resolve = (value) => value.replace(/var\((--[\w-]+)\)/g, (_, name) => variables.get(name) ?? `UNRESOLVED:${name}`);
// em/rem no CSS do assistente usam a base de 16 px; clamp usa o mínimo declarado.
const pixels = (value) => {
  const resolved = resolve(value);
  const match = resolved.match(/^(?:clamp\()?\s*([\d.]+)(px|rem|em)/);
  return match ? Number(match[1]) * (match[2] === 'px' ? 1 : 16) : NaN;
};
const rgb = (value) => {
  const color = resolve(value).trim();
  if (!/^#[0-9a-f]{6}$/i.test(color)) return null;
  return [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16) / 255);
};
const luminance = (color) => color.map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
const contrast = (front, back) => {
  const [a, b] = [luminance(front), luminance(back)].sort((x, y) => y - x);
  return (a + .05) / (b + .05);
};

const failures = [];
let measuredRules = 0;
let measuredType = 0;
let measuredTargets = 0;
let measuredContrast = 0;
const rules = [];
css.walkRules((rule) => {
  if (!/(?:\.ih-ai-|\.ih-assistant-)/.test(rule.selector)) return;
  measuredRules++;
  const declarations = Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]));
  rules.push({ selector: rule.selector, declarations, line: rule.source.start.line });
  if (declarations['font-size']) {
    measuredType++;
    const size = pixels(declarations['font-size']);
    if (!Number.isFinite(size) || size < 16) failures.push(`${rule.source.start.line}: ${rule.selector} font-size ${declarations['font-size']}`);
  }
  const clickable = rule.selector.split(',').some((part) => /(?:\bbutton|\ba|\bsummary|\.ih-ai-launcher|\.ih-ai-send|\.ih-ai-new|\.ih-ai-product-action|\.ih-ai-chip|\.ih-button|\.ih-chip)$/.test(part.trim()))
    && !/(?:\bsvg\b|::|:hover|:disabled|:focus|\[aria-|\[data-compact\])/.test(rule.selector);
  if (clickable) {
    measuredTargets++;
    const height = Math.max(...[declarations.height, declarations['min-height']].map((value) => pixels(value ?? '')).filter(Number.isFinite));
    if (!Number.isFinite(height) || height < 44) failures.push(`${rule.source.start.line}: ${rule.selector} target ${height || 'sem altura'}px`);
  }
});

for (const rule of rules) {
  const foreground = rule.declarations.color;
  if (!foreground || foreground === 'inherit' || foreground === 'transparent' || /\bsvg\b|avatar|icon|dot/.test(rule.selector)) continue;
  const front = rgb(foreground);
  if (!front) { failures.push(`${rule.line}: cor não resolvida em ${rule.selector}: ${foreground}`); continue; }
  const ownBackground = rule.declarations.background ?? rule.declarations['background-color'];
  const parentBackground = rule.selector.includes('.ih-ai-code') ? '#0b1220'
    : rule.selector.includes('.ih-ai-user') ? '#0f172a'
    : rule.selector.includes('.ih-ai-error') ? '#fef2f2'
    : rule.selector.includes('.ih-ai-support-cta') || rule.selector.includes('.ih-ai-media-guide') ? '#fef7f5'
    : '#ffffff';
  const back = rgb(!ownBackground || ownBackground === 'transparent' ? parentBackground : ownBackground);
  if (!back) { failures.push(`${rule.line}: fundo não resolvido em ${rule.selector}: ${ownBackground}`); continue; }
  measuredContrast++;
  if (contrast(front, back) < 4.5) failures.push(`${rule.line}: ${rule.selector} contraste ${contrast(front, back).toFixed(2)}:1`);
}
assert.ok(measuredRules > 100 && measuredType > 50 && measuredTargets > 10 && measuredContrast > 50,
  `varredura incompleta: ${measuredRules} regras, ${measuredType} fontes, ${measuredTargets} alvos, ${measuredContrast} contrastes`);
assert.deepEqual(failures, [], `Legibilidade do assistente:\n${failures.join('\n')}`);
console.log(`Legibilidade: ${measuredRules} regras, ${measuredType} fontes, ${measuredTargets} alvos, ${measuredContrast} contrastes.`);
