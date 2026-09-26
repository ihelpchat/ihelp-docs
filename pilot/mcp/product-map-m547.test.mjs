import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProductMap } from '../lib/product-map.mjs';
import { calculateGuideImpact } from '../lib/guide-impact.mjs';

const dir = await mkdtemp(join(tmpdir(), 'product-map-m547-'));
const front = join(dir, 'front');
const back = join(dir, 'back');
const file = 'src/Screen.tsx';
const expected = [
  'Mensagem automática fora de horário de atendimento',
  'Aparelhos conectados',
  'Conectar um aparelho',
  'Conectado',
  'Desconectado',
  'Conectar',
  'Novo usuário',
  'Visualizar Departamentos',
  'Apenas administradores podem criar usuários',
  'Departamentos',
  'Buscar usuários',
  'Ajuda',
];
const sources = { fixture: expected.map((target, index) => ({ side: 'front', file, line: index + 1, stepId: `step-${index}`, target })) };
const guides = [{ guide: { guideId: 'fixture', steps: expected.map((_, index) => ({ stepId: `step-${index}` })) } }];
try {
  await mkdir(join(front, 'src'), { recursive: true });
  await mkdir(back);
  await writeFile(join(front, file), `
    const tooltip = (() => { if (blocked) return "Apenas administradores podem criar usuários."; return ""; })();
    const tabs = [{ name: "Departamentos", href: "/configuracoes/department" }];
    export const Screen = () => <>
      <Title>Mensagem automática fora de horário de atendimento</Title>
      <strong>WhatsApp → Aparelhos conectados → Conectar um aparelho</strong>
      <span>{connected ? "Conectado" : "Desconectado"}</span>
      <Button labelText={connected ? "Desconectar" : "Conectar"} />
      <Button labelText="Novo usuário" />
      <Title>Visualizar Departamentos</Title>
      <CustomTooltip title={tooltip} />
      <Input placeholder="Buscar usuários" aria-label="Ajuda" />
    </>;
  `);
  const manifest = (await buildProductMap({ frontRoot: front, backRoot: back, guides, actions: {} })).manifest;
  const snapshot = { frontSha: 'a'.repeat(40), backSha: 'b'.repeat(40), manifest };
  const impact = calculateGuideImpact({ before: snapshot, after: snapshot, guides, actions: {}, sources });
  assert.deepEqual(impact.pending.filter((item) => item.includes('rótulo da fonte não encontrado')), []);
  assert.ok(!manifest.labels.some(({ label }) => label.includes('const ') || label.includes('=>')));
} finally { await rm(dir, { recursive: true, force: true }); }
console.log('Product map M5.47 test OK');
