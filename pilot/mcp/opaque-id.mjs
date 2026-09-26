import { createHmac, randomBytes } from 'node:crypto';

const key = process.env.LOG_ID_KEY || randomBytes(32);

export function opaqueId(type, raw) {
  return `${type}-${createHmac('sha256', key).update(raw).digest('hex').slice(0, 16)}`;
}
