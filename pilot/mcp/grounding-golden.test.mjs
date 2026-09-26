import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import golden from './grounding-golden.json' with { type: 'json' };
import { searchLocalProductContext } from './local-product-context.mjs';

const front = await realpath(await mkdtemp(join(tmpdir(), 'm530-golden-front-')));
const back = await realpath(await mkdtemp(join(tmpdir(), 'm530-golden-back-')));
async function fixture(root, files) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  git('add', '-A');
  git('commit', '-qm', 'golden fixture');
}
const frontFiles = {
  'src/components/pages/Robots/index.tsx': 'export function Robots() { return <Button labelText="Criar novo robô" />; }',
  'src/components/pages/Configuration/pages/ChannelById/components/ChannelDetails/index.tsx': 'export function ChannelDetails() { return <Button labelText="Conectar QR" />; }',
  'src/components/pages/Configuration/components/TabUser/index.tsx': 'export function TabUser() { return <Button labelText="Novo usuário" />; }',
  'src/components/pages/Configuration/pages/DepartmentById/components/DepartmentConfigExtras/index.tsx': 'export function DepartmentConfigExtras() { return <Title>Mensagem automática fora de horário de atendimento</Title>; }',
};
for (let index = 0; index < 12; index++) {
  frontFiles[`src/components/pages/Configuration/components/TabGeneral/Peripheral${index}.tsx`] = 'export function Peripheral() { // Cadastrar atendente; Criar usuário; Usuários; equipe; Novo usuário\n return null; }';
}
const backFiles = {
  'Comzada.Application/Controllers/V2/BotController.cs': 'public class BotController { public void CreateBot() {} }',
  'Comzada.Application/Controllers/V2/ChannelController.cs': 'public class ChannelController { public void ReconnectChannel() {} }',
  'Comzada.Application/Controllers/V2/ConfigurationsUsersController.cs': 'public class ConfigurationsUsersController { public void CreateUser() {} }',
  'Comzada.Application/Controllers/V2/ConfigurationsDepartmentsController.cs': 'public class ConfigurationsDepartmentsController { public void UpdateDepartmentHours() {} }',
};
await fixture(front, frontFiles);
await fixture(back, backFiles);
const original = [process.env.PRODUCT_LOCAL_CHECKOUT, process.env.BACKEND_LOCAL_CHECKOUT];
process.env.PRODUCT_LOCAL_CHECKOUT = front;
process.env.BACKEND_LOCAL_CHECKOUT = back;
try {
  for (const { topic, module, frontend, backend } of golden.cases) {
    const result = await searchLocalProductContext(topic, module, { cache: false });
    for (const [role, causal] of [['frontend', frontend], ['backend', backend]]) {
      const source = result.code.find((item) => item.role === role);
      assert.equal(source?.available, true, `${topic} ${role}: ${source?.reason}`);
      assert.ok(source.matches.slice(0, 3).some(({ path }) => path === causal), `${topic} ${role}: causal fora do top 3`);
    }
  }
} finally {
  for (const [key, value] of [['PRODUCT_LOCAL_CHECKOUT', original[0]], ['BACKEND_LOCAL_CHECKOUT', original[1]]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
console.log('M5.30 golden: cinco temas, frontend e backend no top 3.');
