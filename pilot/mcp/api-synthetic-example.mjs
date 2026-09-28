// Reuse the same synthetic values that M5.56 checks in API request examples.
import { publicTypes } from './api-public-types.mjs';

export function valueFor(parameter, { typed = false } = {}) {
  const name = String(parameter.name ?? '');
  const type = String(parameter.type ?? 'string').replace(/\?$/u, '');
  const list = /^(?:List|IEnumerable|ICollection|IList)\s*<\s*(.+)\s*>$|^(.+)\[\]$/iu.exec(type);
  if (list) {
    const scalar = (list[1] ?? list[2]).trim();
    if (Object.hasOwn(parameter, 'default') && Array.isArray(parameter.default) && parameter.default.length)
      return parameter.default.map((item) => valueFor({ ...parameter, type: scalar, default: item }, { typed }));
    if (/^(?:int|long|double|decimal|float|short|number)$/iu.test(scalar))
      return [1, 2].map((item) => valueFor({ ...parameter, type: scalar, default: item }, { typed }));
    return [valueFor({ ...parameter, type: scalar }, { typed })];
  }
  if (Object.hasOwn(parameter, 'default') && parameter.default !== '' && parameter.default !== null)
    return typed && /^(?:int|long|double|decimal|float|short|number)$/iu.test(type) ? Number(parameter.default)
      : typed && /^bool(?:ean)?$/iu.test(type) ? parameter.default === true || parameter.default === 'true'
        : String(parameter.default);
  if (/^(?:int|long|double|decimal|float|short|number)$/iu.test(type)) return typed ? 1 : '1';
  if (/^bool(?:ean)?$/iu.test(type)) return typed ? false : 'false';
  const temporal = publicTypes.get(type)?.example;
  if (temporal) return temporal;
  if (typed && !/^(?:string|Guid|DateTime(?:Offset)?)$/iu.test(type)) return {};
  if (/(?:^|_)(?:idref)(?:$|_)/iu.test(name) || /idref$/iu.test(name)) return 'id-exemplo-1';
  if (/(?:^|_)(?:id|uuid|contactid)(?:$|_)/iu.test(name) || /id$/iu.test(name)) return 'id-exemplo-1';
  if (/(?:phone|telefone|celular|whatsapp)/iu.test(name)) return '5500000000000';
  if (/^(?:numero|número|number|num)$/iu.test(name)) return parameter.addressSiblings ? '123' : '5500000000000';
  if (/email|e-mail/iu.test(name)) return 'pessoa@exemplo.com';
  if (/^(?:data|date)|atualizadoEm|createdAt|updatedAt/iu.test(name) || /^DateTime(?:Offset)?$/iu.test(type))
    return /^DateTime(?:Offset)?$/iu.test(type) ? '2026-09-27T00:00:00Z' : '27/09/2026';
  if (/^(?:nome|name)$/iu.test(name)) return 'Maria Exemplo';
  if (/^searchData$/iu.test(name)) return '9969';
  return 'exemplo';
}

export function syntheticResponseExample(endpoint) {
  if (!endpoint.responseFields?.length) return null;
  const fields = {};
  const addressName = /^(?:rua|logradouro|endereco|endereço|bairro|cidade|cep|complemento|street|city|zip)$/iu;
  const groupOf = (field) => String(field.path ?? field.name).replace(/^dados(?:\[\])?\./u, '').replace(/^\[\]\./u, '').split('.').slice(0, -1).join('.');
  for (const field of endpoint.responseFields) {
    const type = String(field.type ?? 'string').replace(/\?$/u, '');
    const addressSiblings = endpoint.responseFields.some((other) => other !== field && groupOf(other) === groupOf(field)
      && addressName.test(other.name));
    const value = valueFor({ ...field, addressSiblings }, { typed: true });
    const path = String(field.path ?? field.name).replace(/^dados(?:\[\])?\./u, '').replace(/^\[\]\./u, '').split('.');
    let target = fields;
    for (const part of path.slice(0, -1)) {
      const key = part.replace(/\[\]$/u, '');
      if (!(key in target) || typeof target[key] !== 'object') target[key] = part.endsWith('[]') ? [{}] : {};
      target = part.endsWith('[]') ? target[key][0] : target[key];
    }
    const last = path.at(-1), key = last.replace(/\[\]$/u, '');
    if (path.length === 1 && endpoint.responseFields.some((item) => item.path?.startsWith(`${field.path}[].`) || item.path?.startsWith(`${field.path}.`)))
      target[key] = last.endsWith('[]') || /^(?:List|IEnumerable|ICollection|IList)</u.test(type) ? [{}] : {};
    else target[key] = value;
  }
  const payload = endpoint.responseList ? [fields] : fields;
  return endpoint.responseEnvelope ? { [endpoint.responseEnvelope]: payload } : payload;
}
