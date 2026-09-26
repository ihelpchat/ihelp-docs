import { createHash, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export const requestIdentity = new AsyncLocalStorage();
const actorCalls = new Map();
const actorPattern = /^(?:user|service):[a-z0-9][a-z0-9_-]{2,63}$/;
const writerTools = new Set(['docs_submit_article', 'docs_submit_package', 'docs_update_article', 'docs_delete_article']);
const privateTools = new Set(['docs_product_context', 'docs_plan_content', 'docs_generate_package']);

export function loadCredentials(serialized) {
  if (!serialized) return [];
  const entries = JSON.parse(serialized);
  if (!Array.isArray(entries) || !entries.length) throw new Error('DOCS_MCP_CREDENTIALS inválido');
  const actors = new Set();
  const keys = new Set();
  return entries.map(({ actor, role, key }) => {
    if (!actorPattern.test(actor) || !['reader', 'writer'].includes(role) || typeof key !== 'string' || key.length < 24 || actors.has(actor) || keys.has(key)) {
      throw new Error('DOCS_MCP_CREDENTIALS inválido');
    }
    actors.add(actor);
    keys.add(key);
    return { actor, role, digest: createHash('sha256').update(key).digest() };
  });
}

export function authenticate(credentials, authorization) {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null;
  const digest = createHash('sha256').update(authorization.slice(7)).digest();
  return credentials.find((entry) => timingSafeEqual(entry.digest, digest)) ?? null;
}

export function authorizeTool(identity, name, args, { now = Date.now(), limit = 30 } = {}) {
  if (!identity) throw new Error('unauthorized');
  if (args.requestedBy !== undefined && args.requestedBy !== identity.actor) throw new Error('requestedBy forged');
  if (identity.role === 'reader' && writerTools.has(name)) throw new Error('forbidden: reader cannot write');
  if (identity.role === 'writer' && privateTools.has(name)) throw new Error('forbidden: writer cannot read private code');
  const recent = (actorCalls.get(identity.actor) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= limit) throw new Error('rate limit per actor');
  recent.push(now);
  actorCalls.set(identity.actor, recent);
  return identity.actor;
}
