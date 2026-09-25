import assert from 'node:assert/strict';
import { resolveCatalogAction } from '../architecture/catalog-action.mjs';
import { parseAssistantReply } from '../architecture/conversation-v1.mjs';
import { isCatalogAction } from './product-actions.mjs';

const input = { id: 'importar-contatos', route: '/contact', label: 'Outro', target: 'alvo-falso' };
const canonical = { id: 'importar-contatos', route: '/contact', label: 'Abrir a tela Contatos', target: 'contacts-more-options' };
assert.deepEqual(resolveCatalogAction(input), canonical);
assert.equal(isCatalogAction(input), true);
assert.deepEqual(parseAssistantReply({ answer: 'Abra Contatos.', steps: [{ text: 'Abra Contatos.', action: input }] }).steps[0].action, canonical);
console.log('target e label de ação com alvo: catálogo prevalece.');
