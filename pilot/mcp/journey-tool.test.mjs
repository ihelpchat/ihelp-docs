import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { requestIdentity } from './access-control.mjs';
import { buildServer } from './server.mjs';

test('gravar_jornada devolve categoria segura em vez de engolir o erro', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-tool-'));
  const originalRegister = McpServer.prototype.registerTool;
  const originalSha = process.env.CAPTURE_FRONT_SHA;
  let handler;
  try {
    McpServer.prototype.registerTool = function (name, config, callback) {
      if (name === 'gravar_jornada') handler = callback;
      return originalRegister.call(this, name, config, callback);
    };
    buildServer(root);
    process.env.CAPTURE_FRONT_SHA = 'invalid-sha';
    const result = await requestIdentity.run({ actor: 'user:journey-test', role: 'writer' }, () =>
      handler({ module: 'contatos', tasks: ['contatos.cadastrar'], requestedBy: 'user:journey-test' }));
    const body = JSON.parse(result.content[0].text);
    assert.equal(result.isError, true);
    assert.equal(body.error, 'dado de preparo');
    assert.deepEqual(body.tasks, []);
    assert.notEqual(body.error, 'execução indisponível');
  } finally {
    McpServer.prototype.registerTool = originalRegister;
    if (originalSha === undefined) delete process.env.CAPTURE_FRONT_SHA;
    else process.env.CAPTURE_FRONT_SHA = originalSha;
    await rm(root, { recursive: true, force: true });
  }
});
