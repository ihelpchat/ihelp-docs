import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve, sep } from 'node:path';
import { once } from 'node:events';

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

export async function startQaSite(out, basePath) {
  const root = await mkdtemp(join(tmpdir(), 'qa-site-'));
  const prefix = basePath.replace(/^\/+|\/+$/g, '');
  const siteRoot = prefix ? root : resolve(out);
  if (prefix) {
    const mount = join(root, prefix);
    await mkdir(join(mount, '..'), { recursive: true });
    await symlink(resolve(out), mount, 'dir');
  }
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const filePath = resolve(siteRoot, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
      const withinRoot = relative(siteRoot, filePath);
      if (withinRoot === '..' || withinRoot.startsWith(`..${sep}`) || (prefix && !pathname.startsWith(`/${prefix}/`))) throw new Error('path inválido');
      let file = filePath;
      if (!(await stat(file).catch(() => null))?.isFile()) file = join(filePath, 'index.html');
      const data = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
      response.end(data);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function createSitePage(browser) {
  return browser.newPage();
}
