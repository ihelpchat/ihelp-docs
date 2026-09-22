import { createServer } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { buildServer } from './server.mjs';

const apiKey = process.env.DOCS_MCP_API_KEY;
if (!apiKey || apiKey.length < 24) throw new Error('DOCS_MCP_API_KEY precisa ter ao menos 24 caracteres');

const mcpHandler = createMcpHandler(() => buildServer());
const handler = toNodeHandler(mcpHandler);
const port = Number(process.env.PORT ?? 3100);

const httpServer = createServer(async (request, response) => {
  if (request.url !== '/mcp') {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.authorization !== `Bearer ${apiKey}`) {
    response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  await handler(request, response);
});

httpServer.listen(port, '0.0.0.0', () => console.error(`iHelp Docs MCP ouvindo na porta ${port}`));

process.on('SIGINT', async () => {
  await mcpHandler.close();
  httpServer.close(() => process.exit(0));
});
