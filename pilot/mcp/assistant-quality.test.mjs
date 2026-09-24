import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerQuestion } from './assistant-service.mjs';

const projectRoot = new URL('../', import.meta.url).pathname;
const testRoot = await mkdtemp(join(tmpdir(), 'ihelp-docs-quality-'));
await cp(join(projectRoot, 'architecture'), join(testRoot, 'architecture'), { recursive: true });
await cp(join(projectRoot, 'content'), join(testRoot, 'content'), { recursive: true });

let internalCalls = 0;
const internalReply = await answerQuestion(testRoot, 'Tem MCP?', {
  client: { responses: { create: async () => { internalCalls += 1; throw new Error('não deveria chamar o modelo'); } } },
});
assert.equal(internalCalls, 0, 'MCP interno não deve entrar no RAG público');
assert.equal(internalReply.found, false);
assert.match(internalReply.answer, /MCP do iHelp.*em breve/i);
assert.doesNotMatch(internalReply.answer, /documentaç|Node\.js|Git/i);

const actionDir = join(testRoot, 'content/docs/docs/teste');
await mkdir(actionDir, { recursive: true });
await writeFile(join(actionDir, 'importar-contatos.mdx'), `---\ntitle: "Importar contatos"\ndescription: "Aprenda a importar contatos pela tela correta do iHelp."\nsource: produto\ncontentType: tutorial\n---\n\nAbra a lista de contatos e use o menu de opções para iniciar a importação.\n\n<ProductAction id="importar-contatos" label="Ir para importar contatos" route="/contact" target="contacts-more-options" />\n`);

const beginnerClient = {
  responses: {
    create: async (request) => {
      const prompt = request.input[0].content;
      assert.match(prompt, /primeiros 30 segundos|acabou de acessar/i);
      assert.match(prompt, /onde começar/i);
      assert.match(request.input.at(-1).content, /AÇÃO importar-contatos/);
      return {
        model: 'gpt-test',
        output_text: JSON.stringify({
          answer: 'Comece abrindo Contatos no menu lateral.',
          sections: [],
          steps: [
            { text: 'Abra Contatos no menu lateral.', actionId: 'importar-contatos' },
            { text: 'Abra Contatos no menu lateral.', actionId: 'importar-contatos' },
            { text: 'Clique em Mais opções e escolha Importar contatos.', actionId: null },
          ],
          code: null,
          sources: ['/docs/teste/importar-contatos'],
          suggestions: [],
          resolution: 'complete',
          found: true,
        }),
      };
    },
  },
};
const beginnerReply = await answerQuestion(testRoot, 'como importar contatos', { client: beginnerClient });
assert.equal(beginnerReply.steps.length, 2, 'passos repetidos devem ser consolidados');
assert.deepEqual(beginnerReply.steps[0], {
  text: 'Abra Contatos no menu lateral.',
  action: {
    id: 'importar-contatos',
    label: 'Ir para importar contatos',
    route: '/contact',
    target: 'contacts-more-options',
  },
});

console.log("Claricia para iniciantes passou.");
