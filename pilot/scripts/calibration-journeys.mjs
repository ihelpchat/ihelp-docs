import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import tasks from '../architecture/faq-regua/tarefas-ouro.json' with { type: 'json' };
import { fixtureValue } from '../mcp/journey-service.mjs';

const moduleIds = { Contatos: 'contatos', Robôs: 'robos' };
const statuses = ['concluída', 'bloqueada', 'inconclusiva', 'falhou'];
const knownReasons = new Set(['ação proibida pela política', 'sem dado de preparo',
  'ações necessárias não observadas', 'resultado não conferido', 'limite da execução atingido',
  'plano sem alvo após 5 ações de fallback', 'seleção fictícia não comprovada', 'custo inválido',
  'limite de custo atingido', 'upload fora da tarefa', 'valor do gerador ausente para campo obrigatório',
  'alvo ausente da tela', 'preenchimento repetido', 'POST sem referência conferível',
  'limite de ações por tarefa', 'ambiente: sessão ativa']);
const actionTypes = new Set(['click', 'fill', 'select', 'upload_csv', 'press']);
const actionRoles = new Set(['button', 'link', 'menuitem', 'checkbox', 'tab', 'combobox',
  'option', 'textbox']);

function generatedValues(marker) {
  const result = new Set(['Nome', 'Contato', 'Email']);
  for (const kind of ['contactName', 'editedName', 'robotName', 'tagName', 'menuQuestion',
    'menuOption', 'departmentName', 'userName', 'email', 'phone']) {
    for (let n = 1; n <= 99; n++) result.add(fixtureValue(kind, n, marker));
  }
  return result;
}

function authorizedReason(reason) {
  if (reason == null) return null;
  if (knownReasons.has(reason)) return reason;
  if (/^ambiente: importação anterior em andamento(?: \(\d{4}-\d{2}-\d{2}\))?$/u.test(reason))
    return 'ambiente: importação anterior em andamento';
  if (/^ambiente: API da homologação respondeu [45]\d{2}$/u.test(reason)) return reason;
  if (/^validação do formulário:/u.test(reason)) return 'validação do formulário';
  return 'motivo não categorizado';
}

function project(record, knownLabels) {
  const generated = generatedValues(/^[a-f0-9]{8}$/u.test(record.marker) ? record.marker : '');
  const actions = Array.isArray(record.actions) ? record.actions : [];
  const screens = Array.isArray(record.screens) ? record.screens : [];
  return { tarefa: record.task, status: record.status,
    evidenciaDeFuncionamento: record.status === 'concluída' && record.verification?.confirmed === true,
    motivo: authorizedReason(record.reason),
    acoes: actions.map(({ type, role, name, value }) => ({
      tipo: actionTypes.has(type) ? type : 'outro',
      papel: actionRoles.has(role) ? role : null,
      nome: knownLabels.has(name) || generated.has(name) ? name : '[nome não confirmado]',
      ...(generated.has(value) ? { valor: value } : {}),
    })),
    verificacao: { confirmada: record.verification?.confirmed === true },
    mensagens: [...new Set(screens.flatMap(({ messages }) => Array.isArray(messages) ? messages : [])
      .filter((message) => knownLabels.has(message)))],
  };
}

export async function loadCalibrationJourneys(moduleName, dir, { knownLabels = new Set() } = {}) {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
  if (!dir) return { jornadas: [], aviso: 'JOURNEYS_DIR ausente', contagens: counts };
  const moduleId = moduleIds[moduleName];
  if (!moduleId) return { jornadas: [], aviso: null, contagens: counts };
  const journeys = [];
  for (const task of tasks.tarefas.filter((item) => item.modulo === moduleId)) {
    let raw;
    try { raw = await readFile(join(dir, `ler-${task.id}.json`), 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const rpc = JSON.parse(raw);
    if (rpc.result?.isError || rpc.result?.content?.length !== 1 || rpc.result.content[0]?.type !== 'text')
      throw new Error(`resposta de jornada inválida: ${task.id}`);
    const record = JSON.parse(rpc.result.content[0].text);
    if (record.module !== moduleId || record.task !== task.id || !statuses.includes(record.status))
      throw new Error(`jornada incompatível: ${task.id}`);
    journeys.push(project(record, knownLabels));
    counts[record.status]++;
  }
  return { jornadas: journeys, aviso: null, contagens: counts };
}
