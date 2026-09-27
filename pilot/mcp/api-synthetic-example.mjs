// Reuse the same synthetic values that M5.56 checks in API request examples.
export const valueFor = (parameter) => /^(?:int|long|double|decimal|float|short|number)$/iu.test(parameter.type) ? '1'
  : /^bool(?:ean)?$/iu.test(parameter.type) ? 'false'
    : /(?:^|_)(?:id|idref|uuid|contactid)(?:$|_)/iu.test(parameter.name) || /id$/iu.test(parameter.name) ? 'id-exemplo-1'
      : /(?:phone|telefone|celular|whatsapp)/iu.test(parameter.name) ? '5500000000000' : 'exemplo';

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
