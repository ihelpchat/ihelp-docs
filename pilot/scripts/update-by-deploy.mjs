import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { atualizarPorDeploy } from '../mcp/update-by-deploy.mjs';

const [beforeFile, afterFile, proofFile] = process.argv.slice(2);
if (!beforeFile || !afterFile) throw new Error('Uso: update-by-deploy.mjs BEFORE AFTER [PROOF]');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const [before, after, prova] = await Promise.all([json(beforeFile), json(afterFile), proofFile ? json(proofFile) : undefined]);
const result = await atualizarPorDeploy(resolve(import.meta.dirname, '..'), { before, after, prova, requestedBy: 'service:deploy' });
console.log(JSON.stringify(result, null, 2));
if (result.pending.length) process.exitCode = 1;
