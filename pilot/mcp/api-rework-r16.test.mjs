import test from 'node:test';
import assert from 'node:assert/strict';
import { renderApiReference } from './api-reference-render.mjs';
import { generateContentPackage } from './content-ai-service.mjs';

const render = (fields) => renderApiReference({ verb: 'GET', route: '/api/v2/example', authorization: 'authenticated',
  parameters: [], responseEnvelope: 'dados', responseFields: fields }, [], { sections: ['Resposta'], components: ['Fields', 'Field'] }).body;
const json = (body) => JSON.parse(body.match(/```json\n([\s\S]*?)\n```/u)[1]).dados;

test('numero usa irmãos do mesmo objeto para distinguir endereço e telefone', () => {
  const address = render([{ name: 'rua', path: 'dados.endereco.rua', type: 'string' },
    { name: 'numero', path: 'dados.endereco.numero', type: 'string' },
    { name: 'telefone', path: 'dados.endereco.telefone', type: 'string' },
    { name: 'numero', path: 'dados.numero', type: 'string' }]);
  assert.equal(json(address).endereco.numero, '123');
  assert.equal(json(address).endereco.telefone, '5500000000000');
  assert.equal(json(address).numero, '5500000000000');
  assert.match(address, /"numero": "123"/u);
});

test('tipos de data e hora concordam entre tabela pública e JSON', () => {
  for (const [type, label, expected] of [
    ['DateTime', 'data e hora', '2026-09-27T00:00:00Z'],
    ['DateTimeOffset?', 'data e hora (opcional)', '2026-09-27T00:00:00Z'],
    ['DateOnly', 'data', '2026-09-27'],
    ['TimeSpan', 'duração', '01:30:00'],
    ['TimeOnly?', 'hora (opcional)', '09:30:00'],
    ['List<DateTimeOffset>', 'lista de datas', ['2026-09-27T00:00:00Z']],
  ]) {
    const body = render([{ name: 'valor', path: 'dados.valor', type }]);
    assert.match(body, new RegExp(`>${label} — valor</Field>`), type);
    assert.deepEqual(json(body).valor, expected, type);
  }
});

test('três páginas são geradas isoladamente; corte repete só uma e respeita teto', async () => {
  const endpoints = ['a', 'b', 'c'].map((name) => ({ verb: 'GET', route: `/api/v2/${name}`, public: true,
    documented: true, authorization: 'authenticated', parameters: [], responseFields: [] }));
  const calls = [];
  const unit = (text) => ({ text, citations: [], refs: [] });
  const result = await generateContentPackage(process.cwd(), { module: 'api', topic: 'Exemplo' }, {
    productContext: { groundingRequired: false, matches: [], code: [], endpoints,
      apiExamples: [{ sections: ['Resposta'], components: ['Fields', 'Field'] }] }, plan: { status: 'ready' },
    client: { responses: { create: async (payload) => {
      calls.push(payload);
      assert.ok(calls.length <= 8, 'teto global: 2 por página mais 2');
      const facts = JSON.parse(payload.input.at(-1).content.match(/FATOS ESTRUTURADOS DE ENDPOINTS[^\n]*:\n([^\n]+)/u)[1]);
      assert.equal(facts.length, 1, 'uma página por chamada');
      const name = facts[0].route.split('/').at(-1);
      if (name === 'b' && calls.filter((item) => item.input.at(-1).content.includes('"/api/v2/b"')).length === 1)
        return { status: 'incomplete', output_text: '', model: 'fixture' };
      return { output_text: JSON.stringify({ status: 'ready', summary: [unit('Referência de exemplo.')], questions: [], articles: [
        { path: `api/exemplo/${name}`, endpoint: `GET /${name}`, title: `Página ${name}`,
          description: unit('Consulta os dados disponíveis neste endpoint público.'), intro: unit('Use para consultar os dados.'), notas: [] },
      ] }), model: 'fixture' };
    } } },
  });
  assert.equal(result.status, 'ready', result.summary);
  assert.equal(result.articles.length, 3);
  assert.equal(calls.length, 4);
});
