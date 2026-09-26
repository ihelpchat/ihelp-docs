import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(new URL('../app/global.css', import.meta.url), 'utf8');
const checker = fileURLToPath(new URL('./assistant-legibility.test.mjs', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'assistant-legibility-'));

try {
  const cases = [
    ['regra base posterior troca só o fundo', `${source}\n.ih-ai-human-action { background: #ffffff; }\n`],
    ['regra hover posterior troca só a cor', `${source}\n.ih-ai-human-action:hover { color: #b0472f; }\n`],
    ['!important anterior vence regra posterior', source.replace(
      '\n.ih-ai-human-action {\n',
      '\n.ih-ai-human-action { background: #ffffff !important; }\n.ih-ai-human-action {\n',
    )],
  ];
  for (const [name, css] of cases) {
    const fixture = join(directory, 'fixture.css');
    writeFileSync(fixture, css);
    const result = spawnSync(process.execPath, [checker], {
      encoding: 'utf8',
      env: { ...process.env, ASSISTANT_LEGIBILITY_CSS: fixture },
    });
    assert.notEqual(result.status, 0, `${name}: contraste inválido passou`);
    assert.match(result.stderr, /ih-ai-human-action.*contraste/, `${name}: falhou por outro motivo`);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log('Cascata de contraste: três regressões detectadas.');
