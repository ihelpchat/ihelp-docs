import { assistantRouterModel, assistantRouterEffort, mcpCredentialsFromEnv } from './env-compat.mjs';

const credentials = mcpCredentialsFromEnv();
if (!credentials.length) throw new Error('Configure DOCS_MCP_CREDENTIALS ou DOCS_MCP_API_KEY antes de iniciar o MCP');
assistantRouterModel();
assistantRouterEffort();

const { httpServer } = await import(`./http-runtime.mjs${new URL(import.meta.url).search}`);
export { httpServer };
