import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const key = process.env.LOG_ID_KEY || randomBytes(32);
const guideEpoch = randomUUID();

export function opaqueId(type, raw) {
  return `${type}-${createHmac('sha256', key).update(raw).digest('hex').slice(0, 16)}`;
}

function guidePathMac(guide, path) {
  return createHmac('sha256', key).update(JSON.stringify(['guide-state', guideEpoch, guide.guideId, guide.version, path])).digest();
}

export function guideStateToken(guide, path) {
  const indices = path.map((id) => guide.steps.findIndex((step) => step.stepId === id));
  if (indices.some((index) => index < 0) || indices.length > 40) throw new Error('caminho de guia inválido');
  return `${Buffer.from(indices).toString('base64url')}.${guidePathMac(guide, path).toString('base64url')}`;
}

export function guideStatePath(token, guide, stepId) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{2,54}\.[A-Za-z0-9_-]{43}$/u.test(token)) return null;
  const [encoded, signature] = token.split('.');
  const indices = [...Buffer.from(encoded, 'base64url')];
  if (!indices.length || indices.length > 40 || indices.some((index) => index >= guide.steps.length)) return null;
  const path = indices.map((index) => guide.steps[index].stepId);
  if (path.at(-1) !== stepId || path[0] !== guide.initialStepId || new Set(path).size !== path.length) return null;
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== 32 || !timingSafeEqual(supplied, guidePathMac(guide, path))) return null;
  return path;
}
