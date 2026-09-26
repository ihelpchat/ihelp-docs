import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchLocalProductContext } from './local-product-context.mjs';
import { sensitiveKinds } from './sensitive-data.mjs';

const route = 'api/v{version:apiVersion}/configurations/departments';
const token = 'Q8mF2vN7pL4xR9cT3kB6zY1hW5sD0jA8uE2gP4nV';
for (const value of [route, `[Route("${route}")]`, 'Comzada.Application.Controllers.V2.ConfigurationsDepartmentsController']) {
  assert.equal(sensitiveKinds(value, { detectOpaque: true }).credential, false, 'rota ou namespace não é credencial');
}
assert.equal(sensitiveKinds(token, { detectOpaque: true }).credential, true, 'token sintético deve ser barrado');

const checkout = await realpath(await mkdtemp(join(tmpdir(), 'm530-r8-back-')));
const files = {
  'Comzada.Application/Controllers/V2/ConfigurationsDepartmentsController.cs':
    `[Route("${route}")]\npublic class ConfigurationsDepartmentsController { public void UpdateDepartmentHours() {} }`,
  'Comzada.Application/Controllers/V2/BotController.cs':
    `// Criar robô ${token}\npublic class BotController { public void CreateBot() {} }`,
};
for (const [path, content] of Object.entries(files)) {
  await mkdir(join(checkout, path, '..'), { recursive: true });
  await writeFile(join(checkout, path), content);
}
const git = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' });
git('init', '-q');
git('config', 'user.email', 'fixture@example.invalid');
git('config', 'user.name', 'Fixture');
git('add', '-A');
git('commit', '-qm', 'r8 fixture');
const previous = process.env.BACKEND_LOCAL_CHECKOUT;
process.env.BACKEND_LOCAL_CHECKOUT = checkout;
try {
  const hours = await searchLocalProductContext('Configurar horário de atendimento', 'Departamentos', { repositoryIds: ['backend'], cache: false });
  assert.equal(hours.code[0].available, true, hours.code[0].reason);
  assert.ok(hours.matches.slice(0, 3).some(({ path }) => path.endsWith('/ConfigurationsDepartmentsController.cs')),
    'controller com rota versionada deve aparecer no top 3');
  const robots = await searchLocalProductContext('Criar robô', 'Robôs', { repositoryIds: ['backend'], cache: false });
  assert.ok(!robots.matches.some(({ path }) => path.endsWith('/BotController.cs')),
    'controller com token sintético não deve aparecer');
} finally {
  if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
  else process.env.BACKEND_LOCAL_CHECKOUT = previous;
}
