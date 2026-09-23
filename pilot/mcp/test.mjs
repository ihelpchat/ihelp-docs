import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { answerQuestion, retrieveContext } from './assistant-service.mjs';
import { renderArticle } from './content-service.mjs';

const projectRoot = new URL('../', import.meta.url).pathname;
const testRoot = await mkdtemp(join(tmpdir(), 'ihelp-docs-mcp-'));
await cp(join(projectRoot, 'architecture'), join(testRoot, 'architecture'), { recursive: true });
await cp(join(projectRoot, 'content'), join(testRoot, 'content'), { recursive: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(projectRoot, 'mcp/server.mjs')],
  cwd: projectRoot,
  env: { ...process.env, DOCS_ROOT: testRoot },
  stderr: 'pipe',
});
const client = new Client({ name: 'ihelp-docs-test', version: '1.0.0' });

const article = {
  path: 'docs/teste/como-validar-o-mcp',
  title: 'Como validar o MCP',
  description: 'Passo a passo seguro para validar o MCP de documentação do iHelp.',
  source: 'produto',
  contentType: 'faq',
  body: 'Use a ferramenta de validação antes de enviar o conteúdo. Depois, confira o draft e abra um pull request para revisão humana.',
};

try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ['docs_inventory', 'docs_search', 'docs_submit_article', 'docs_validate_article']);

  const validation = await client.callTool({ name: 'docs_validate_article', arguments: article });
  assert.match(validation.content[0].text, /"valid": true/);

  const inventory = await client.callTool({ name: 'docs_inventory', arguments: {} });
  assert.match(inventory.content[0].text, /"modules": 22/);

  const search = await client.callTool({ name: 'docs_search', arguments: { query: 'transferir atendimento' } });
  assert.match(search.content[0].text, /Atendimento/);

  const submission = await client.callTool({ name: 'docs_submit_article', arguments: { ...article, mode: 'draft' } });
  assert.match(submission.content[0].text, /"status": "draft"/);
  const written = await readFile(join(testRoot, '.drafts/docs/teste/como-validar-o-mcp.mdx'), 'utf8');
  assert.match(written, /contentType: faq/);

  const unsafe = await client.callTool({ name: 'docs_submit_article', arguments: { ...article, path: '../segredo', mode: 'draft' } });
  assert.equal(unsafe.isError, true);

  const context = await retrieveContext(testRoot, 'como transferir um atendimento');
  assert.match(context[0].title, /Atendimento/);
  const fakeClient = {
    responses: {
      create: async (request) => {
        assert.equal(request.store, false);
        assert.match(request.input[1].content, /Atendimento/);
        return { output_text: 'Abra o atendimento e use a opção de transferência.\n\nFontes: Atendimento (/docs/sobre-o-sistema/atendimento)', model: 'gpt-test' };
      },
    },
  };
  const assistant = await answerQuestion(testRoot, 'como transferir um atendimento', { client: fakeClient });
  assert.equal(assistant.model, 'gpt-test');
  assert.match(assistant.answer, /transferência/);
  const withTango = renderArticle({ ...article, tangoUrl: 'https://app.tango.us/app/embed/c547fbf6-a68a-4f30-9cf4-bbf79f6f65d1' });
  assert.match(withTango, /app\/workflow\/Como-validar-o-MCP-c547fbf6a68a4f309cf4bbf79f6f65d1/);
  assert.doesNotMatch(withTango, /embedUrl=/);
  const workflowUrl = 'https://app.tango.us/app/workflow/Como-validar-o-MCP-c547fbf6a68a4f309cf4bbf79f6f65d1';
  assert.match(renderArticle({ ...article, tangoUrl: workflowUrl }), new RegExp(workflowUrl));
  console.log('MCP smoke passou: inventário, busca, validação, draft, bloqueio de path e contexto do assistente.');
} finally {
  await client.close();
}
