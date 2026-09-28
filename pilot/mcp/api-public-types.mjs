export const publicTypes = new Map([
  ['DateTime', { label: 'data e hora', example: '2026-09-27T00:00:00Z', listLabel: 'datas' }],
  ['DateTimeOffset', { label: 'data e hora', example: '2026-09-27T00:00:00Z', listLabel: 'datas' }],
  ['DateOnly', { label: 'data', example: '2026-09-27', listLabel: 'datas' }],
  ['TimeSpan', { label: 'duração', example: '01:30:00', listLabel: 'durações' }],
  ['TimeOnly', { label: 'hora', example: '09:30:00', listLabel: 'horas' }],
  ['int', { label: 'número' }], ['long', { label: 'número' }], ['short', { label: 'número' }],
  ['byte', { label: 'número' }], ['uint', { label: 'número' }], ['ulong', { label: 'número' }],
  ['ushort', { label: 'número' }], ['double', { label: 'número' }], ['float', { label: 'número' }],
  ['number', { label: 'número' }], ['decimal', { label: 'número' }],
  ['bool', { label: 'verdadeiro ou falso' }], ['boolean', { label: 'verdadeiro ou falso' }],
  ['string', { label: 'texto' }], ['Guid', { label: 'texto' }],
]);

export function publicScalarType(raw) {
  const type = String(raw ?? '').trim().replace(/\?$/u, '');
  const collection = type.match(/^(?:List|IEnumerable|ICollection|IList)<\s*(.+)\s*>$|^(.+)\[\]$/u);
  const scalar = (collection ? collection[1] ?? collection[2] : type).trim().replace(/\?$/u, '');
  return publicTypes.has(scalar) ? scalar : null;
}

export function publicType(raw) {
  const type = String(raw ?? '').trim();
  const optional = type.endsWith('?');
  const base = optional ? type.slice(0, -1) : type;
  const collection = base.match(/^(?:List|IEnumerable|ICollection|IList)<\s*(.+)\s*>$|^(.+)\[\]$/u);
  let label;
  if (collection) {
    const itemType = (collection[1] ?? collection[2]).trim().replace(/\?$/u, '');
    const item = publicTypes.get(itemType);
    label = `lista de ${item?.listLabel ?? (item?.label === 'número' ? 'números' : item?.label === 'objeto' ? 'objetos' : item?.label ?? 'objetos')}`;
  } else label = publicTypes.get(base)?.label ?? (['double', 'float', 'short', 'number'].includes(base) ? 'número' : 'objeto');
  return `${label}${optional ? ' (opcional)' : ''}`;
}
