import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { loadFeedback } from './aprender-licoes-core.mjs';

const secret = 'cliente-privado-100';
const script = join(import.meta.dirname, 'aprender-licoes.mjs');

async function run(env) {
  const child = spawn(process.execPath, [script], { env: { ...process.env, ...env },
    cwd: join(import.meta.dirname, '../..') });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'close');
  assert.notEqual(code, 0);
  assert.doesNotMatch(stdout + stderr, /cliente-privado-100/u);
  return { stdout, stderr };
}

test('JSON inválido e feedback malformado não expõem id em exceção ou CLI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm579-private-errors-'));
  const feedbackDir = join(root, 'feedback');
  const env = { FEEDBACK_DIR: feedbackDir, LEARNING_PRIVATE_REPORT_FILE: join(root, 'report.json'),
    OPENAI_API_KEY: 'teste' };
  try {
    await mkdir(feedbackDir);
    const file = join(feedbackDir, `${secret}.json`);
    await writeFile(file, `{ "id": "${secret}", `);
    await assert.rejects(loadFeedback(feedbackDir), (error) => {
      assert.doesNotMatch(error.message, /cliente-privado-100/u);
      return /JSON inválido no feedback: caso #1/u.test(error.message);
    });
    assert.match((await run(env)).stderr, /JSON inválido no feedback: caso #1/u);
    await writeFile(file, JSON.stringify([secret]));
    await assert.rejects(loadFeedback(feedbackDir), (error) => {
      assert.doesNotMatch(error.message, /cliente-privado-100/u);
      return /feedback malformado: caso #1/u.test(error.message);
    });
    assert.match((await run(env)).stderr, /feedback malformado: caso #1/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('falha do provider não expõe id privado em stdout, stderr ou erro', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm579-private-provider-'));
  const feedbackDir = join(root, 'feedback');
  let calls = 0;
  const server = createServer((_req, response) => {
    calls++;
    if (calls === 1) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'resp_1', object: 'response', output: [
        { type: 'message', content: [{ type: 'output_text', text: '{"licoes":[]}' }] },
      ] }));
    } else {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: secret, type: 'invalid_request_error' } }));
    }
  });
  try {
    await mkdir(feedbackDir);
    const samples = JSON.parse(await readFile(new URL('../architecture/faq-regua/amostras-calibracao.json', import.meta.url), 'utf8'));
    const notas = Object.fromEntries(['entende_modulo', 'utilidade_negocio', 'casos_concretos',
      'tarefas_completas', 'clareza', 'coerencia'].map((id) => [id, 3]));
    await writeFile(join(feedbackDir, 'feedback.json'), JSON.stringify({
      amostras: samples.amostras.map(({ id }) => ({ amostra: id, notas, comentario: 'Rever clareza.' })),
      secoes: [{ id: secret, secao: secret, pagina: 'robos', titulo: 'O que é',
        decisao: 'ajustar', comentario: `Comentário ${secret}` }],
    }));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    const result = await run({ FEEDBACK_DIR: feedbackDir,
      LEARNING_PRIVATE_REPORT_FILE: join(root, 'report.json'), OPENAI_API_KEY: 'teste',
      OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1` });
    assert.ok(calls >= 2, result.stderr);
    assert.match(result.stderr, /leitura indisponível: caso #/u);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
