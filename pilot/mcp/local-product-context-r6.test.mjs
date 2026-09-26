import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchLocalProductContext } from './local-product-context.mjs';
import { containsSensitiveData } from './sensitive-data.mjs';

const department = 'src/components/pages/Configuration/pages/DepartmentById/components/DepartmentConfigExtras/index.tsx';
const channels = 'src/components/pages/Configuration/pages/Channels/index.tsx';
const users = 'src/components/pages/Configuration/pages/Users/index.tsx';
const identifier = 'mensagemForaHorarioAtendimento';
const files = {
  [department]: `import MessageText from '../../../../../../shared/Chat/components/MessageText';
import DistribuicaoAtendimentos from '../DistribuicaoAtendimentos';
export function DepartmentConfigExtras() {
  // Configurar horário de atendimento e recado fora do horário.
  const ${identifier} = 'Mensagem automática fora de horário';
  return ${identifier};
}`,
  [channels]: `export function Channels() {
  // Reconectar QR do canal de WhatsApp na tela de canais.
  return 'Reconectar canal';
}`,
  [users]: `export function Users() {
  // Criar usuário para a equipe com permissão no departamento.
  return 'Adicionar usuário';
}`,
  'src/components/ui/SkeletonSchedules/index.tsx': '// Configurar horário de atendimento: skeleton sem formulário.',
  'src/components/ui/ChannelBadge/index.tsx': '// Reconectar QR: badge sem ação.',
  'src/components/ui/UserAvatar/index.tsx': '// Criar usuário: avatar sem formulário.',
};

assert.equal(containsSensitiveData(identifier, { detectOpaque: true }), false, 'identificador camelCase não é segredo');
assert.equal(containsSensitiveData(files[department], { detectOpaque: true }), false, 'componente com identificador camelCase é elegível');
assert.equal(containsSensitiveData("const value = '/AbcDefGhiJklMnoPqrStuVwxYz';", { detectOpaque: true }), false,
  'barra de caminho separa segmentos e não caracteriza token');

const checkout = await realpath(await mkdtemp(join(tmpdir(), 'm530-r6-')));
const git = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
git('init', '-q');
git('config', 'user.email', 'test@example.invalid');
git('config', 'user.name', 'Fixture');
for (const [path, content] of Object.entries(files)) {
  await mkdir(join(checkout, path, '..'), { recursive: true });
  await writeFile(join(checkout, path), content);
}
git('add', '-A');
git('commit', '-qm', 'tracked fixture');

const original = process.env.PRODUCT_LOCAL_CHECKOUT;
process.env.PRODUCT_LOCAL_CHECKOUT = checkout;
try {
  for (const [topic, module, causal] of [
    ['Configurar horário de atendimento', 'Departamentos', department],
    ['Reconectar QR', 'Canais', channels],
    ['Criar usuário', 'Usuários', users],
  ]) {
    const result = await searchLocalProductContext(topic, module, { repositoryIds: ['frontend'] });
    assert.equal(result.code[0].available, true, result.code[0].reason);
    assert.ok(result.matches.slice(0, 3).some(({ path }) => path === causal), `${topic}: arquivo causal deve aparecer entre os primeiros resultados`);
    assert.ok(result.matches.every(({ excerpt }) => !containsSensitiveData(excerpt, { detectOpaque: true })),
      `${topic}: trecho devolvido deve passar na varredura sensível`);
  }
  const result = await searchLocalProductContext('Configurar horário de atendimento', 'Departamentos', { repositoryIds: ['frontend'] });
  assert.ok(result.matches.some(({ path, excerpt }) => path === department && excerpt.includes(identifier)), 'identificador camelCase deve chegar ao match');
} finally {
  if (original === undefined) delete process.env.PRODUCT_LOCAL_CHECKOUT;
  else process.env.PRODUCT_LOCAL_CHECKOUT = original;
}
console.log('M5.30 r6: identificador legítimo e três arquivos causais preservados.');
