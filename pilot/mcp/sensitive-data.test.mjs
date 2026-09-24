import assert from 'node:assert/strict';
import { containsSensitiveData, redactSensitiveData, sensitiveKinds } from './sensitive-data.mjs';

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
  ['JSON apiKey', '"apiKey" : "P@ss!word#123"'],
  ['JSON password', '"password": "P@ss!word#123"'],
  ['JSON token', '"token" : "abc!def#ghi$123"'],
  ['api_key assignment', 'api_key = abc!def#ghi$123'],
  ['senha simbólica', "senha = 'P@ss!word#123'"],
  ['GitHub gho_', 'gho_abcdefghijklmnop1234567890'],
  ['OPENAI_API_KEY', 'OPENAI_API_KEY="alphaBetaGammaDeltaEpsilon"'],
  ['GITHUB_TOKEN', 'GITHUB_TOKEN = "bravoCharlieDeltaEchoFoxtrot"'],
  ['access_token', "access_token='charlieDeltaEchoFoxtrotGolf'"],
  ['client_secret', 'client_secret = "deltaEchoFoxtrotGolfHotel"'],
  ['prefixo snake', 'tenant_api_key = "echoFoxtrotGolfHotelIndia"'],
  ['prefixo camel', 'vendorApiKey="foxtrotGolfHotelIndiaJuliet"'],
  ['prefixo simples', 'tenanttoken="golfHotelIndiaJulietKilo"'],
  ['GitHub ghs_', 'ghs_abcdefghijklmnopqrstuvwxyza'],
  ['GitHub ghu_', 'ghu_abcdefghijklmnopqrstuvwxyza'],
  ['GitHub ghr_', 'ghr_abcdefghijklmnopqrstuvwxyza'],
  ['Google AIza alfabética', 'AIzaabcdefghijklmnopqrstuvwxyzABCDEFGH'],
  ['bare token forte', 'token="aBcd!Efgh#Ijklmnop"'],
  ['bare secret forte', 'secret=xyZ!abcdEfgh#mnop'],
  ['bare password forte', 'password="aBcD!efGh#ijkl"'],
  ['nome composto forte', 'OPENAI_API_KEY="administradores"'],
];

for (const [name, value] of cases) {
  assert.equal(containsSensitiveData(value), true, `${name} precisa ser detectado`);
  assert.equal(redactSensitiveData(value).includes(value), false, `${name} precisa ser redigido`);
  if (/OPENAI_API_KEY|GITHUB_TOKEN|access_token|client_secret|prefixo|GitHub gh[osru]_|Google AIza alfabética/.test(name)) assert.equal(sensitiveKinds(value).credential, true, `${name} deve ser credencial independentemente de telefone`);
}
for (const value of ['docs/contatos/antigo', 'Abra a opção A', 'ID de teste 12', 'token de acesso', 'senha do usuário', 'apiKey inválida', 'token=$IHELP_TOKEN', 'tokenizer="abcdefghijklmno"', 'password_hint="abcdefghijklmno"', 'access_token_count=25', 'dono do token: administradores veem todos os funis', 'token: administradores', 'secret: usuários', 'password: administradores']) {
  assert.equal(containsSensitiveData(value), false, `${value} não deve ser redigido`);
  assert.equal(redactSensitiveData(value), value);
}

console.log('Dados sensíveis foram detectados e redigidos.');
