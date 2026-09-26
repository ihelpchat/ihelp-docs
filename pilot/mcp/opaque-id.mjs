import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const key = process.env.LOG_ID_KEY || randomBytes(32);
const guideEpoch = randomUUID();

export function opaqueId(type, raw) {
  return `${type}-${createHmac('sha256', key).update(raw).digest('hex').slice(0, 16)}`;
}

export function guideStateToken(guideId, version, stepId) {
  return createHmac('sha256', key).update(JSON.stringify(['guide-state', guideEpoch, guideId, version, stepId])).digest('hex');
}

export function validGuideStateToken(token, guideId, version, stepId) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/u.test(token)) return false;
  return timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(guideStateToken(guideId, version, stepId), 'hex'));
}
