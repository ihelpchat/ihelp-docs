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
  ['AWS secret access key', 'AWS_SECRET_ACCESS_KEY="alphaBetaGammaDeltaEpsilon"'],
  ['JWT secret key', 'JWT_SECRET_KEY="bravoCharlieDeltaEchoFoxtrot"'],
  ['private key', 'private_key="charlieDeltaEchoFoxtrotGolf"'],
  ['DB pass', 'DB_PASS="deltaEchoFoxtrotGolfHotel"'],
  ['credentials', 'credentials="echoFoxtrotGolfHotelIndia"'],
  ['AWS strong key', 'AWS_SECRET_ACCESS_KEY="administradores"'],
  ['JWT strong key', 'JWT_SECRET_KEY="administradores"'],
  ['private strong key', 'private_key="administradores"'],
  ['DB strong pass', 'DB_PASS="administradores"'],
  ['privateKey camel', 'privateKey="administradores"'],
  ['awsSecretAccessKey camel', 'awsSecretAccessKey="administradores"'],
  ['jwtSecretKey camel', 'jwtSecretKey="administradores"'],
  ['dbPass camel', 'dbPass="administradores"'],
  ['secretKey camel', 'secretKey="administradores"'],
  ['private key mixed case', 'PrIvAtE_KeY="administradores"'],
  ['GitHub token uppercase value', 'GITHUB_TOKEN=ABCDEFGHIJKLMNOPQRSTUVWX'],
  ['passwd alias', 'passwd="Sup3rS3cret!"'],
  ['senha admin alias', 'senha_admin="Adm!n2024#x"'],
  ['secret key base hex', 'SECRET_KEY_BASE=abcdef0123456789abcdef0123456789'],
  ['PWD uppercase', 'PWD="Sup3rS3cret!"'],
  ['mixed camel alias', 'AdminPassWd="Sup3rS3cret!"'],
  ['DB password numbered', 'DB_PASSWORD2="Sup3rS3cret!"'],
  ['API key numbered', 'API_KEY2="Adm!n2024#x"'],
  ['token numbered', 'TOKEN2="Sup3rS3cret!"'],
  ['MySQL pwd numbered', 'MYSQL_PWD1="Adm!n2024#x"'],
];

for (const [name, value] of cases) {
  assert.equal(containsSensitiveData(value), true, `${name} precisa ser detectado`);
  assert.equal(redactSensitiveData(value).includes(value), false, `${name} precisa ser redigido`);
  if (name.endsWith('numbered')) assert.doesNotMatch(redactSensitiveData(value), /Sup3rS3cret!|Adm!n2024#x/u, `${name} não pode deixar o valor literal`);
  if (/OPENAI_API_KEY|GITHUB_TOKEN|access_token|client_secret|prefixo|GitHub gh[osru]_|Google AIza alfabética|AWS|JWT|private|DB|credentials|camel|mixed case|uppercase value/.test(name)) assert.equal(sensitiveKinds(value).credential, true, `${name} deve ser credencial independentemente de telefone`);
}
for (const value of ['docs/contatos/antigo', 'Abra a opção A', 'ID de teste 12', 'token de acesso', 'senha do usuário', 'apiKey inválida', 'token=$IHELP_TOKEN', 'token=${TOKEN}', 'tokenizer="abcdefghijklmno"', 'password_hint="abcdefghijklmno"', 'admin_password_hint="Sup3rS3cret!"', 'secret_name="Sup3rS3cret!"', 'access_token_count=25', 'version2="Sup3rS3cret!"', 'step2="Sup3rS3cret!"', 'token_count2="Sup3rS3cret!"', 'password_hint2="Sup3rS3cret!"', 'private_key_description2="Sup3rS3cret!"', 'dono do token: administradores veem todos os funis', 'token: administradores', 'secret: usuários', 'password: administradores', 'credentials: administradores', 'private_key_description="texto explicativo"', 'monkey="alphaBetaGammaDeltaEpsilon"']) {
  assert.equal(containsSensitiveData(value), false, `${value} não deve ser redigido`);
  assert.equal(redactSensitiveData(value), value);
}

console.log('Dados sensíveis foram detectados e redigidos.');
