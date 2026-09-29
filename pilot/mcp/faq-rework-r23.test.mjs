import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRenderedFaq } from './content-ai-service.mjs';
import { faqSubtitle } from './faq-editorial.mjs';

test('MDX do modelo não executa expressões nem aceita ESM ou JSX estranho', async () => {
  delete globalThis.__faqProbe;
  for (const body of [
    '{globalThis.__faqProbe = 1}',
    'Texto {globalThis.__faqProbe = 1} no parágrafo.',
    'export const x = 1',
    '<script>globalThis.__faqProbe = 1</script>',
    '<img onError="globalThis.__faqProbe = 1" />',
  ]) {
    await assert.rejects(validateRenderedFaq(body), /MDX|expressão|elemento|ESM|inválido/u, body);
    assert.equal(globalThis.__faqProbe, undefined, body);
  }
  await assert.doesNotReject(validateRenderedFaq('Use \\{nome\\} para indicar o campo.'));
});

test('subtítulo usa texto simples de Markdown sustentado, inclusive link', () => {
  const sections = { oQueE: [{ text: 'O módulo **Robôs** organiza o [atendimento](https://example.com/ajuda). Ele segue um fluxo.' }] };
  assert.equal(faqSubtitle(sections, { topic: 'Robôs' }, []), 'O módulo Robôs organiza o atendimento.');
  assert.equal(sections.oQueE[0].text, 'Ele segue um fluxo.');
});
