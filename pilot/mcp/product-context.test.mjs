import assert from 'node:assert/strict';
import { getIhelpContext, searchProductContext } from './product-context-service.mjs';

const files = {
  'src/components/core/components/Router/utils/pagesData.tsx': 'export const pages = [{ path: "/contact", title: "Contatos" }];',
  'src/components/pages/Contacts/ContactsList/index.tsx': '<button aria-label="Mais opções">...</button><button>Importar Contatos</button> // suporte: (11) 98765-4321; CPF 123.456.789-09',
  'src/components/pages/Contacts/CPF-123.456.789-09-phone-11987654321.tsx': 'export const title = "Importar contatos";',
  'src/components/pages/Contacts/contato11987654321X.tsx': 'export const title = "Importar contatos"; const sample = "sk-proj-abcdefghijklmnop1234567890";',
  'src/components/pages/Tasks/index.tsx': '<h1>Tarefas</h1>',
};
const fakeFetch = async (url) => {
  const value = String(url);
  if (value.includes('/git/trees/')) {
    return { ok: true, json: async () => ({ tree: Object.keys(files).map((path) => ({ type: 'blob', path })) }) };
  }
  const path = decodeURIComponent(value.match(/\/contents\/(.+?)\?ref=/)?.[1] ?? '');
  if (!Object.prototype.hasOwnProperty.call(files, path)) return { ok: false, status: 404, text: async () => '' };
  return { ok: true, json: async () => ({ content: Buffer.from(files[path]).toString('base64'), encoding: 'base64' }) };
};

const context = await searchProductContext('Importar contatos', 'Contatos', {
  fetch: fakeFetch,
  token: 'token-test',
  repository: 'ihelpchat/front-react',
  ref: 'master',
});
assert.equal(context.repository, 'ihelpchat/front-react');
assert.equal(context.ref, 'master');
assert.match(JSON.stringify(context.matches), /\/contact/);
assert.match(JSON.stringify(context.matches), /Importar Contatos/);
assert.ok(context.matches.every(({ path }) => path.startsWith('src/')));
assert.doesNotMatch(JSON.stringify(context.matches), /98765-4321|123\.456\.789-09/, 'telefone e CPF do codebase não podem chegar ao prompt');
assert.ok(context.matches.some(({ path }) => path.includes('[dado removido]')), 'path com PII deve continuar identificável sem revelar o valor');
assert.doesNotMatch(JSON.stringify(context.matches), /11987654321|123\.456\.789-09/, 'telefone e CPF no path do codebase precisam de redaction');
assert.doesNotMatch(JSON.stringify(context.matches), /contato11987654321X|sk-proj-abcdefghijklmnop1234567890/, 'telefone adjacente e sk-proj não podem sair do codebase');

const backendFiles = {
  'Comzada.Application/Controllers/V2/ContactsController.cs': 'public class ContactsController { public void ImportContacts() {} private string token = "abcdefghijklmnop123456"; }',
};
const bothFetch = async (url) => {
  const source = String(url).includes('/olah-ihelp/') ? backendFiles : files;
  if (String(url).includes('/git/trees/')) return { ok: true, json: async () => ({ tree: Object.keys(source).map((path) => ({ type: 'blob', path })) }) };
  const path = decodeURIComponent(String(url).match(/\/contents\/(.+?)\?ref=/)?.[1] ?? '');
  return { ok: true, json: async () => ({ content: Buffer.from(source[path]).toString('base64'), encoding: 'base64' }) };
};
const full = await getIhelpContext(new URL('../', import.meta.url).pathname, 'Importar contatos', 'Contatos', {
  fetch: bothFetch, token: 'token-test', repositories: [
    { repository: 'ihelpchat/front-react', ref: 'test-front', role: 'frontend' },
    { repository: 'ihelpchat/olah-ihelp', ref: 'test-back', role: 'backend' },
  ],
});
assert.ok(full.matches.some(({ repository }) => repository === 'ihelpchat/front-react'));
assert.ok(full.matches.some(({ repository }) => repository === 'ihelpchat/olah-ihelp'));
assert.ok(full.support.categories.length > 0);
assert.doesNotMatch(JSON.stringify(full.matches), /abcdefghijklmnop123456/);

console.log('Contexto de produto passou: rotas e componentes reais entram na IA editorial.');
