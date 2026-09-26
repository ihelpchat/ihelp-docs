import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { sensitiveKinds } from '../mcp/sensitive-data.mjs';
import ts from 'typescript';
import { readCsharpEndpoints } from './csharp-endpoints.mjs';

const safe = (value, pattern = /^[\p{L}\p{N} ._:/-]{1,100}$/u) => {
  if (!pattern.test(value) || Object.values(sensitiveKinds(value)).some(Boolean)) return null;
  return value;
};
const ordered = (items) => [...new Map(items.map((item) => [JSON.stringify(item), item])).values()]
  .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'));

async function files(root, extensions) {
  const found = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'bin', 'obj', 'dist', 'build', 'coverage', '__tests__', 'tests'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) found.push(path);
    }
  }
  await visit(root);
  return found.sort();
}

function differences(before, after, kind, key) {
  if (!before) return [];
  const old = new Map(before.map((item) => [key(item), item]));
  const now = new Map(after.map((item) => [key(item), item]));
  return ordered([...new Set([...old.keys(), ...now.keys()])].filter((id) =>
    JSON.stringify(old.get(id)) !== JSON.stringify(now.get(id))).map((id) => `${kind}: ${id}: ${JSON.stringify(old.get(id) ?? null)} -> ${JSON.stringify(now.get(id) ?? null)}`));
}

export async function buildProductMap({ frontRoot, backRoot, guides, actions, baseline }) {
  const routes = [];
  const markers = [];
  const labels = [];
  const permissions = [];
  const pending = [];
  for (const file of await files(join(frontRoot, 'src'), ['.tsx', '.jsx'])) {
    const source = await readFile(file, 'utf8');
    const path = relative(frontRoot, file);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
    const visit = (node) => {
      if (ts.isJsxAttribute(node) && /^(data-tour-id|data-help-id)$/u.test(node.name.text)) {
        const kind = node.name.text === 'data-tour-id' ? 'tour' : 'help';
        if (node.initializer && ts.isStringLiteral(node.initializer)) {
          const id = safe(node.initializer.text, /^[A-Za-z0-9_-]{1,80}$/u);
          if (id) markers.push({ kind, id });
          else pending.push(`expressão ou marcador inseguro: ${path}`);
        } else pending.push(`marcador dinâmico: ${path}`);
      }
      if (ts.isJsxElement(node) && /^(button|Button)$/u.test(node.openingElement.tagName.getText(ast))) {
        for (const child of node.children) if (ts.isJsxText(child)) {
          const label = safe(child.getText(ast).trim());
          if (label) labels.push({ label });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    if (file.endsWith('pagesData.tsx') || file.endsWith('pagesData.jsx')) {
      for (const match of source.matchAll(/\bpath:\s*(["'])(\/[A-Za-z0-9_/:.-]+)\1(?:(?!\bpath:)[\s\S]){0,700}?\btitle:\s*(["'])([^"']+)\3/gu)) {
        const route = safe(match[2], /^\/[A-Za-z0-9_/:.-]{1,120}$/u);
        const label = safe(match[4]);
        if (route && label) routes.push({ path: route, label });
        else pending.push(`rota ou rótulo inseguro: ${path}`);
      }
      for (const match of source.matchAll(/\bpath:\s*([^,\n]+)/gu)) {
        if (!/^["']\/[A-Za-z0-9_/:.-]+["']$/u.test(match[1].trim())) pending.push(`rota não resolvida: ${path}`);
      }
    }
  }
  for (const file of await files(backRoot, ['.cs'])) {
    const source = await readFile(file, 'utf8');
    for (const endpoint of readCsharpEndpoints(source, relative(backRoot, file))) {
      const fields = [endpoint.controller, endpoint.method, endpoint.verb, endpoint.route, endpoint.policy];
      if (fields.every((value) => safe(value, /^[A-Za-z0-9_.:\/[\]-]{1,120}$/u))) permissions.push(endpoint);
      else pending.push(`permissão não resolvida: ${relative(backRoot, file)}`);
    }
  }
  const manifest = {
    routes: ordered(routes), markers: ordered(markers), labels: ordered(labels), permissions: ordered(permissions),
  };
  const markerIds = new Set(manifest.markers.map(({ id }) => id));
  const routeIds = new Set(manifest.routes.map(({ path }) => path));
  const oldPermissions = new Map((baseline?.permissions ?? []).map((item) => [`${item.controller}.${item.method}:${item.verb}:${item.route}`, item]));
  const newPermissions = new Map(manifest.permissions.map((item) => [`${item.controller}.${item.method}:${item.verb}:${item.route}`, item]));
  for (const { guide } of guides) {
    for (const step of guide.steps) {
      const action = actions[step.actionId];
      if (!action) continue;
      if (action.target && !markerIds.has(action.target)) pending.push(`${guide.guideId}: marcador ausente ${action.target}`);
      if (action.route && !routeIds.has(action.route)) pending.push(`${guide.guideId}: rota ausente ${action.route}`);
      const area = action.route?.split('/').at(-1)?.toLowerCase();
      for (const [key, old] of oldPermissions) {
        if (!area || !old.controller.toLowerCase().includes(area)) continue;
        const now = newPermissions.get(key);
        if (old.policy !== 'anonymous' && (!now || now.policy === 'anonymous' || (old.policy !== 'authenticated' && now.policy !== old.policy))) {
          pending.push(`${guide.guideId}: autorização perdida ${key}`);
        }
      }
    }
  }
  const changes = [
    ...differences(baseline?.routes, manifest.routes, 'route', (item) => item.path),
    ...differences(baseline?.markers, manifest.markers, 'marker', (item) => `${item.kind}:${item.id}`),
    ...differences(baseline?.labels, manifest.labels, 'label', (item) => item.label),
    ...differences(baseline?.permissions, manifest.permissions, 'permission', (item) => `${item.controller}.${item.method}:${item.verb}:${item.route}`),
  ];
  return { manifest, changes: ordered(changes), pending: ordered(pending) };
}
