import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { launch } from './measure.mjs';
import { createSitePage } from './serve-qa-build.mjs';

let requestStarted;
const started = new Promise((resolve) => { requestStarted = resolve; });
let releaseResponse;
const released = new Promise((resolve) => { releaseResponse = resolve; });
const server = createServer(async (_request, response) => {
  requestStarted();
  await released;
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><title>fixture</title>');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const browser = await launch();
try {
  const siteUrl = `http://127.0.0.1:${server.address().port}`;
  const page = await createSitePage(browser, siteUrl, '/ihelp-docs');
  const navigation = page.goto(`${siteUrl}/ihelp-docs/slow`).catch(() => {});
  await started;
  await page.close();
  releaseResponse();
  await navigation;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(page.isClosed(), true);
  console.log('site-close: página fechada durante pedido do site sem derrubar o processo');
} finally {
  releaseResponse();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
