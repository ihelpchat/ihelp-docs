// Reuse the same synthetic values that M5.56 checks in API request examples.
export function valueFor(parameter) {
  const name = String(parameter.name ?? '');
  const type = String(parameter.type ?? 'string').replace(/\?$/u, '');
  const list = /^(?:List|IEnumerable)\s*<\s*(.+)\s*>$|^(.+)\[\]$/iu.exec(type);
  if (list) {
    const scalar = (list[1] ?? list[2]).trim();
    if (Object.hasOwn(parameter, 'default') && Array.isArray(parameter.default) && parameter.default.length)
      return parameter.default.map(String);
    return /^(?:int|long|double|decimal|float|short|number)$/iu.test(scalar) ? ['1', '2'] : ['exemplo'];
  }
  if (Object.hasOwn(parameter, 'default') && parameter.default !== '' && parameter.default !== null)
    return String(parameter.default);
  if (/^(?:int|long|double|decimal|float|short|number)$/iu.test(type)) return '1';
  if (/^bool(?:ean)?$/iu.test(type)) return 'false';
  if (/(?:^|_)(?:idref)(?:$|_)/iu.test(name) || /idref$/iu.test(name)) return 'id-exemplo-1';
  if (/(?:^|_)(?:id|uuid|contactid)(?:$|_)/iu.test(name) || /id$/iu.test(name)) return 'id-exemplo-1';
  if (/(?:phone|telefone|celular|whatsapp|numero|número)/iu.test(name)) return '5500000000000';
  if (/email|e-mail/iu.test(name)) return 'pessoa@exemplo.com';
  if (/^(?:data|date)|atualizadoEm|createdAt|updatedAt/iu.test(name) || /^DateTime(?:Offset)?$/iu.test(type))
    return /^DateTime(?:Offset)?$/iu.test(type) ? '2026-09-27T00:00:00Z' : '27/09/2026';
  if (/^(?:nome|name)$/iu.test(name)) return 'Maria Exemplo';
  if (/^searchData$/iu.test(name)) return '9969';
  return 'exemplo';
}

export function syntheticResponseExample(endpoint) {
  if (!endpoint.responseFields?.length) return null;
  const fields = Object.fromEntries(endpoint.responseFields.map((field) => {
    const type = String(field.type ?? 'string').replace(/\?$/u, '');
    const list = type.endsWith('[]');
    const scalarType = list ? type.slice(0, -2) : type;
    const raw = valueFor({ ...field, type: scalarType });
    const value = /^(?:int|long|double|decimal|float|short|number)$/iu.test(scalarType) ? Number(raw)
      : /^bool(?:ean)?$/iu.test(scalarType) ? raw === 'true' : raw;
    return [field.name, list ? [value] : value];
  }));
  const payload = endpoint.responseList ? [fields] : fields;
  return endpoint.responseEnvelope ? { [endpoint.responseEnvelope]: payload } : payload;
}
