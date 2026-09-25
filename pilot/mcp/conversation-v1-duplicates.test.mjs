import assert from 'node:assert/strict';
import { parseGuide } from '../architecture/conversation-v1.mjs';

const guide = {
  schemaVersion: 1, guideId: 'reconectar-canal-qr', version: 1, mode: 'real', initialStepId: 'inicio',
  steps: [{ stepId: 'inicio', text: 'Abra Canais.' }, { stepId: 'fim', text: 'Confira a conexão.' }],
};
assert.deepEqual(parseGuide(guide), guide);
assert.throws(() => parseGuide({ ...guide, steps: [guide.steps[0], { ...guide.steps[1], stepId: 'inicio' }] }), 'stepId duplicado isolado precisa falhar');
console.log('stepId duplicado isolado: rejeitado.');
