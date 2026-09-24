import assert from 'node:assert/strict';
import { containsSensitiveData, redactSensitiveData } from './sensitive-data.mjs';

const cases = [
  ['email', 'contato@example.com'],
  ['CPF formatado', '123.456.789-09'],
  ['CPF somente dígitos', '12345678909'],
  ['telefone formatado', '(11) 98765-4321'],
  ['telefone dez dígitos', '1130422307'],
  ['telefone onze dígitos no path', 'contato11987654321X'],
  ['Bearer', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456'],
  ['apiKey', 'apiKey="abcdefghijklmnop123456"'],
  ['password', 'password="abcdefghijklmnop123456"'],
  ['secret', 'secret="abcdefghijklmnop123456"'],
  ['token', 'token="abcdefghijklmnop123456"'],
  ['OpenAI sk-', 'sk-abcdefghijklmnop1234567890'],
  ['OpenAI sk-proj-', 'sk-proj-abcdefghijklmnop1234567890'],
  ['GitHub ghp_', 'ghp_abcdefghijklmnop1234567890'],
  ['GitHub github_pat_', 'github_pat_abcdefghijklmnop1234567890'],
  ['Google key', 'AIzaabcdefghijklmnopqrstuvwxyz1234567890'],
];

for (const [name, value] of cases) {
  assert.equal(containsSensitiveData(value), true, `${name} precisa ser detectado`);
  assert.equal(redactSensitiveData(value).includes(value), false, `${name} precisa ser redigido`);
}
for (const value of ['docs/contatos/antigo', 'Abra a opção A', 'ID de teste 12']) {
  assert.equal(containsSensitiveData(value), false, `${value} não deve ser redigido`);
  assert.equal(redactSensitiveData(value), value);
}

console.log('Dados sensíveis foram detectados e redigidos.');
