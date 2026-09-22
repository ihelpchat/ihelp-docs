import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

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
  console.log('MCP smoke passou: inventário, busca, validação, draft e bloqueio de path.');
} finally {
  await client.close();
}
