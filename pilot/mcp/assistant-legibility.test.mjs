import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';

const css = postcss.parse(await readFile(process.env.ASSISTANT_LEGIBILITY_CSS
  ?? new URL('../app/global.css', import.meta.url), 'utf8'));
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
let measuredStates = 0;
const rules = [];
css.walkRules((rule) => {
  if (!/(?:\.ih-ai-|\.ih-assistant-)/.test(rule.selector)) return;
  measuredRules++;
  const declarations = Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]));
  rules.push({ selector: rule.selector, declarations, nodes: rule.nodes.filter((node) => node.type === 'decl'), line: rule.source.start.line });
  if (declarations['font-size']) {
    measuredType++;
    const size = pixels(declarations['font-size']);
    if (!Number.isFinite(size) || size < 16) failures.push(`${rule.source.start.line}: ${rule.selector} font-size ${declarations['font-size']}`);
  }
  const clickable = rule.selector.split(',').some((part) => /(?:\bbutton|\ba|\bsummary|\.ih-ai-launcher|\.ih-ai-send|\.ih-ai-new|\.ih-ai-product-action|\.ih-ai-human-action|\.ih-ai-chip|\.ih-button|\.ih-chip)$/.test(part.trim()))
    && !/(?:\bsvg\b|::|:hover|:disabled|:focus|\[aria-|\[data-compact\])/.test(rule.selector);
  if (clickable) {
    measuredTargets++;
    const inherited = rules.find((item) => item.selector === rule.selector && (item.declarations.height || item.declarations['min-height']));
    const height = Math.max(...[declarations.height, declarations['min-height'], inherited?.declarations.height, inherited?.declarations['min-height']]
      .map((value) => pixels(value ?? '')).filter(Number.isFinite));
    if (!Number.isFinite(height) || height < 44) failures.push(`${rule.source.start.line}: ${rule.selector} target ${height || 'sem altura'}px`);
  }
});

// Remove todos os pseudos do último composto, inclusive funções aninhadas como :hover:not(:disabled).
const withoutLastPseudos = (selector) => {
  let start = 0;
  let brackets = 0;
  let parentheses = 0;
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === '[') brackets++;
    else if (selector[i] === ']') brackets--;
    else if (selector[i] === '(') parentheses++;
    else if (selector[i] === ')') parentheses--;
    else if (!brackets && !parentheses && /[\s>+~]/.test(selector[i])) start = i + 1;
  }
  const prefix = selector.slice(0, start);
  const last = selector.slice(start);
  let base = '';
  const states = [];
  for (let i = 0; i < last.length;) {
    if (last[i] === '[') {
      const end = last.indexOf(']', i);
      if (end < 0) { failures.push(`atributo sem fechamento: ${selector}`); break; }
      base += last.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (last[i] !== ':') { base += last[i++]; continue; }
    const begin = i++;
    if (last[i] === ':') i++;
    while (i < last.length && /[\w-]/.test(last[i])) i++;
    if (last[i] === '(') {
      let depth = 0;
      do {
        if (last[i] === '(') depth++;
        else if (last[i] === ')') depth--;
        i++;
      } while (i < last.length && depth > 0);
      if (depth) failures.push(`pseudo sem fechamento: ${selector}`);
    }
    states.push(last.slice(begin, i));
  }
  return { base: prefix + base, states };
};
const normalized = (selector) => selector.replace(/\s+/g, ' ').trim();
const pairs = new Map();
for (const rule of rules) {
  for (const selector of postcss.list.comma(rule.selector)) {
    const { base: baseSelector, states } = withoutLastPseudos(selector);
    const key = JSON.stringify([normalized(baseSelector), states.join('')]);
    if (!pairs.has(key)) pairs.set(key, { selector: normalized(selector), base: normalized(baseSelector), state: states.join(''), declarations: new Map(), hasColor: false, line: rule.line });
    const pair = pairs.get(key);
    for (const node of rule.nodes) {
      const prop = node.prop === 'background-color' ? 'background' : node.prop;
      if (!['color', 'background', 'content'].includes(prop)) continue;
      if (prop === 'color' || prop === 'background') pair.hasColor = true;
      const prior = pair.declarations.get(prop);
      if (!prior || !prior.important || node.important) pair.declarations.set(prop, { value: node.value, important: node.important });
    }
    pair.line = rule.line;
  }
}
const expectedPairs = [...pairs.values()].filter((pair) => pair.hasColor).length;
let measuredPairs = 0;
for (const pair of pairs.values()) {
  if (!pair.hasColor) continue;
  measuredPairs++;
  const { selector, state, declarations, line } = pair;
  if (/\bsvg\b|avatar|icon|dot/.test(selector)) continue;
  if (/::(?:before|after)\b/.test(selector) && /^(['"])\1$/.test(declarations.get('content')?.value ?? '')) continue;
  if (!state && !declarations.has('color')) continue;
  const base = state ? pairs.get(JSON.stringify([pair.base, ''])) : null;
  const effective = (prop) => {
    const own = declarations.get(prop);
    const inherited = base?.declarations.get(prop);
    return inherited?.important && !own?.important ? inherited.value : own?.value ?? inherited?.value;
  };
  if (state && !base && !declarations.has('color')) { failures.push(`${line}: estado sem regra base: ${selector}`); continue; }
  const inheritedColor = base?.declarations.get('color')?.value;
  const foreground = effective('color') === 'inherit'
    ? inheritedColor && inheritedColor !== 'inherit' ? inheritedColor : 'var(--ih-slate-700)'
    : effective('color') ?? 'var(--ih-slate-700)';
  const parentBackground = selector.includes('.ih-ai-code') ? '#0b1220'
      : selector.includes('.ih-ai-user') ? '#0f172a'
      : selector.includes('.ih-ai-error') ? '#fef2f2'
      : selector.includes('.ih-ai-support-cta') || selector.includes('.ih-ai-media-guide') ? '#fef7f5'
      : '#ffffff';
  const background = effective('background') ?? parentBackground;
  const front = rgb(foreground);
  const back = rgb(background === 'transparent' ? parentBackground : background);
  if (!front || !back) { failures.push(`${line}: cores não resolvidas em ${selector}`); continue; }
  measuredContrast++;
  if (state) measuredStates++;
  if (contrast(front, back) < 4.5) failures.push(`${line}: ${selector} contraste ${contrast(front, back).toFixed(2)}:1`);
}
assert.equal(measuredPairs, expectedPairs, 'todos os pares (seletor, estado) com cor ou fundo foram medidos');
assert.ok(measuredRules > 100 && measuredType > 50 && measuredTargets > 10 && measuredContrast > 50,
  `varredura incompleta: ${measuredRules} regras, ${measuredType} fontes, ${measuredTargets} alvos, ${measuredContrast} contrastes`);
assert.ok(measuredStates >= 8, `Estados medidos: ${measuredStates}`);
assert.ok(rules.some((rule) => rule.selector === '.ih-ai-human-action'), 'link humano tem estilo medido');
assert.deepEqual(failures, [], `Legibilidade do assistente:\n${failures.join('\n')}`);
console.log(`Legibilidade: ${measuredRules} regras, ${measuredType} fontes, ${measuredTargets} alvos, ${measuredContrast} contrastes, ${measuredStates} estados.`);
