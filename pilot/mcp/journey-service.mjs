import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { containsSensitiveData } from './sensitive-data.mjs';
import { captureFailureCategory, captureFailureLog } from './capture-diagnostics.mjs';
import { areaPlans, areaFixtureValue, nextAreaAction } from './journey-plans/index.mjs';

export const JOURNEY_POLICY_VERSION = 'm578-3';
const sha = /^[a-f0-9]{40}$/u;
const taskId = /^(?:contatos|robos|crm|campanhas|agendamentos|tarefas)\.[a-z_]+$/u;
const modules = new Set(['contatos', 'robos', 'crm', 'campanhas', 'agendamentos', 'tarefas']);
const areaModules = new Set(['crm', 'campanhas', 'agendamentos', 'tarefas']);
const forbidden = /\b(?:enviar|disparar|campanha|publicar|ativar|conectar|desconectar|excluir|deletar|remover|pagar|pagamento|cobrança|convidar|convite|senha|permiss(?:ã|a)o|integra(?:ç|c)(?:ã|a)o|webhook|agendar|agendamento)\b/iu;
const taskPlans = {
  'contatos.editar': 'Na ficha, abra a aba Informações; clique no campo editável Nome ou no lápis Editar; preencha editedName; confirme em Salvar ou Enter. Mais não edita.',
  'contatos.definir_responsavel': 'Na ficha, abra Informações; no campo Responsável clique no lápis Editar; escolha departamento e usuário nas fichas de opção opaca; clique no ícone Salvar. Mais não edita.',
};
const normalized = (value) => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const deny = (reason) => ({ allowed: false, reason });
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Ofcom drama range 020 7946 0000..0999. Never dial it.
export function fixtureValue(kind, n = 1, marker = '') {
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new Error('índice fictício inválido');
  if (marker && !/^[a-f0-9]{8}$/u.test(marker)) throw new Error('marcador fictício inválido');
  const suffix = String(n).padStart(2, '0');
  const tag = marker ? ` · ${marker}` : '';
  if (kind === 'contactName') return `Contato Exemplo ${suffix}${tag}`;
  if (kind === 'editedName') return `Contato Exemplo ${suffix} Editado${tag}`;
  if (kind === 'robotName') return `Robô Exemplo ${suffix}${tag}`;
  if (kind === 'tagName') return `Tag Exemplo ${suffix}${tag}`;
  if (kind === 'menuQuestion') return 'Qual opção deseja escolher?';
  if (kind === 'menuOption') return `Opção Exemplo ${suffix}`;
  if (kind === 'departmentName') return `Departamento Exemplo ${suffix}`;
  if (kind === 'userName') return `Atendente Exemplo ${suffix}`;
  if (kind === 'email') return `contato${suffix}@example.com`;
  if (kind === 'phone') {
    const offset = marker ? Number.parseInt(marker, 16) % 1000 : 0;
    return `+44 20 7946 0${String((offset + n - 1) % 1000).padStart(3, '0')}`;
  }
  throw new Error('tipo fictício inválido');
}
const generatedValues = () => new Set(['contactName', 'editedName', 'robotName', 'tagName', 'menuQuestion',
  'menuOption', 'departmentName', 'userName', 'email', 'phone']
  .flatMap((kind) => Array.from({ length: 99 }, (_, index) => fixtureValue(kind, index + 1))));
const fixtureValues = generatedValues();
const fictionalPhone = /^\+44 20 7946 0\d{3}$/u;
const fictionalAreaValue = /^(?:Card|Campanha|Nota|Tarefa|Etapa|Atendente) Exemplo \d{2}(?: Editada)?(?: · [a-f0-9]{8})?$/u;
class SanitizationError extends Error {}

export function journeyFailureCategory(error) {
  const message = String(error?.message ?? '');
  if (/sanitiza|máscara|mascara|sensitive/iu.test(message)) return 'sanitização';
  if (error?.code === 'QA_SESSION_ACTIVE' || /login|logado|credencia|sessão|senha|password/iu.test(message)) return 'login';
  if (/host|destino|URL|homologação deve/iu.test(message)) return 'host';
  if (/modelo|model|openai|api.key/iu.test(message)) return 'modelo';
  if (/timeout|tempo|timed out/iu.test(message)) return 'tempo';
  if (/preparo|fixture|fictício|fatos da tela|SHA do front/iu.test(message)) return 'dado de preparo';
  return 'trava';
}
export function journeyFailureLog(error, env = process.env) {
  const category = journeyFailureCategory(error);
  const detail = captureFailureLog(error, env).replace(/^capturar_telas: [^:]*: /u, '');
  return `gravar_jornada: ${category}: ${containsSensitiveData(detail, { detectOpaque: true }) ? '[detalhe removido]' : detail}`;
}
export function journeyCoverage(records) {
  const environmentBlocked = records.filter((record) => record.status === 'bloqueada' && record.reason?.startsWith('ambiente: '))
    .map((record) => ({ task: record.task, reason: record.reason }));
  const eligible = records.filter((record) => !['contatos.agendar_mensagem', 'robos.publicar_ativar'].includes(record.task)
    && (!/^(?:crm|campanhas|agendamentos|tarefas)\./u.test(record.task) || areaPlans[record.task])
    && (!areaPlans[record.task] || !['dado de preparo', 'sem dado de preparo'].includes(record.reason))
    && !environmentBlocked.some((blocked) => blocked.task === record.task));
  const completed = eligible.filter((record) => record.status === 'concluída').length;
  return { completed, eligible: eligible.length, percent: eligible.length ? Math.round(completed * 100 / eligible.length) : 0,
    ...(environmentBlocked.length ? { environmentBlocked } : {}) };
}

export function policyDecision(action, generated = fixtureValues, taskId = '') {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return deny('ação inválida');
  if (!['click', 'fill', 'select', 'press', 'finish', 'upload_csv'].includes(action.type)) return deny('tipo inválido');
  if (action.type === 'finish') return { allowed: true };
  if (action.type === 'upload_csv') return action.role == null && action.name == null && action.value == null
    ? { allowed: true } : deny('upload inválido');
  if (action.type === 'press') return deny('ação proibida');
  if (!['button', 'link', 'menuitem', 'textbox', 'combobox', 'option', 'checkbox', 'tab'].includes(action.role)
    || typeof action.name !== 'string' || !action.name.trim() || action.name.length > 100) return deny('alvo inválido');
  const name = normalized(action.name);
  if (forbidden.test(name) && !(action.type === 'click' && action.role === 'button'
    && name === 'enviar mensagem' && taskId === 'robos.montar_menu')) return deny('ação proibida');
  if (action.type === 'fill' && (action.role !== 'textbox'
    && !(taskId === 'contatos.marcar_tags' && action.role === 'combobox') || !generated.has(action.value)))
    return deny('valor fora do gerador');
  if (action.type === 'select' && (action.role !== 'combobox' || !generated.has(action.value)
    && !(taskId === 'contatos.importar' && ['Nome', 'Contato', 'Email'].includes(action.value)))) return deny('valor fora do gerador');
  if (action.type === 'click' && !['button', 'link', 'menuitem', 'checkbox', 'tab', 'combobox', 'option'].includes(action.role)) return deny('clique inválido');
  if (taskId === 'contatos.exportar' && /limpar filtros/iu.test(action.name)) return deny('ação proibida');
  if (action.role === 'option' && !/^opção [1-9]\d{0,2}$/u.test(action.name)) return deny('opção inválida');
  return { allowed: true };
}
export function selectedRobotChannel(actions) {
  let selected = null;
  let opened = false;
  for (const action of actions) {
    if (action.type !== 'click') continue;
    if (action.name === 'Canais') opened = true;
    else if (opened && action.role === 'option') selected = selected === action.name ? null : action.name;
  }
  return selected;
}

function safeString(value) {
  if (typeof value !== 'string' || value.length > 180 || /[\r\n<>]/u.test(value)
    || !fixtureValues.has(value) && !fictionalAreaValue.test(value) && !fictionalPhone.test(value)
      && !/^(?:Contato|Robô|Tag) Exemplo \d{2}(?: Editado)? · [a-f0-9]{8}$/iu.test(value)
      && containsSensitiveData(value, { detectOpaque: true })) throw new Error('sanitização falhou');
  return value;
}
const commonLabels = new Set(['Adicionar Contato', 'Importar Contatos', 'Exportar Contatos', 'Criar novo Robô',
  'Listar Contatos', 'Proprietário do Contato', 'Menu de opções', 'Encaminhar atendimento']);
const personLike = /\b[\p{Lu}][\p{Ll}]{2,}\s+[\p{Lu}][\p{Ll}]{2,}\b/u;
function screenString(value, allowedLabels) {
  if (typeof value !== 'string' || value.length > 180 || /[\r\n<>]/u.test(value)) throw new Error('sanitização falhou');
  return !fixtureValues.has(value) && !fictionalAreaValue.test(value) && !fictionalPhone.test(value)
    && !/^(?:Contato|Robô|Tag) Exemplo \d{2}(?: Editado)? · [a-f0-9]{8}$/iu.test(value)
    && !/^Selecionar Contato Exemplo \d{2}(?: Editado)? · [a-f0-9]{8}$/iu.test(value)
    && (containsSensitiveData(value, { detectOpaque: true })
      || personLike.test(value) && !allowedLabels.has(value) && !commonLabels.has(value))
    ? '[conteúdo oculto]' : value;
}
function sanitizeScreen(raw, allowedLabels) {
  if (!raw || typeof raw !== 'object' || !Buffer.isBuffer(raw.screenshot)) throw new Error('sanitização falhou');
  const clean = (value) => screenString(value, allowedLabels);
  const path = clean(raw.path);
  if (!/^\/[a-z0-9/_-]*$/iu.test(path)) throw new Error('sanitização falhou');
  const controls = (raw.controls ?? []).slice(0, 40).map((item) => ({
    role: clean(item.role), name: clean(item.name), enabled: Boolean(item.enabled),
    checked: item.checked == null ? null : Boolean(item.checked),
  }));
  const fields = (raw.fields ?? []).slice(0, 20).map((item) => ({
    role: clean(item.role), name: clean(item.name), required: Boolean(item.required),
    filled: Boolean(item.filled),
    value: item.value == null ? null : clean(item.value),
  }));
  const messages = (raw.messages ?? []).slice(0, 10).map(clean);
  const state = {};
  for (const [key, value] of Object.entries(raw.state ?? {}).slice(0, 15)) state[clean(key)] = clean(value);
  return { title: clean(raw.title), path, controls, fields, messages, state,
    screenshot: raw.screenshot };
}
function safeJourney(record) {
  const copy = structuredClone(record);
  const identity = copy.identity;
  delete copy.identity;
  if (identity && (!Array.isArray(identity.refs) || !Array.isArray(identity.ids)
    || identity.refs.some((ref) => typeof ref !== 'string' || !/^[a-z0-9-]{1,80}$/iu.test(ref))
    || identity.ids.some((id) => !Number.isSafeInteger(id) || id <= 0))) throw new Error('sanitização falhou');
  if (copy.created?.robotRef != null && (!identity || copy.created.robotRef !== identity.refs[0]
    || !Number.isSafeInteger(copy.created.robotId) || !identity.ids.includes(copy.created.robotId)))
    throw new Error('sanitização falhou');
  if (copy.createdRef != null && (typeof copy.createdRef !== 'string' || !/^[a-z0-9-]{1,80}$/iu.test(copy.createdRef)))
    throw new Error('sanitização falhou');
  if (copy.accountProof != null && !/^[a-f0-9]{64}$/u.test(copy.accountProof)) throw new Error('sanitização falhou');
  if (copy.configuredIdentityHash != null && !/^[a-f0-9]{64}$/u.test(copy.configuredIdentityHash)) throw new Error('sanitização falhou');
  const check = (value) => {
    if (typeof value === 'string' && !sha.test(value) && !/^[a-f0-9]{64}$/u.test(value)
      && !fixtureValues.has(value) && !fictionalAreaValue.test(value) && !fictionalPhone.test(value)
      && !/^(?:Contato|Robô|Tag) Exemplo \d{2}(?: Editado)? · [a-f0-9]{8}$/iu.test(value)
      && value !== copy.created?.robotRef && value !== copy.createdRef
      && containsSensitiveData(value, { detectOpaque: true })) throw new Error('sanitização falhou');
    if (Array.isArray(value)) value.forEach(check);
    else if (value && typeof value === 'object') Object.values(value).forEach(check);
  };
  check(copy);
  if (identity) copy.identity = identity;
  return copy;
}
function orderTasks(tasks) {
  const priority = { 'contatos.cadastrar': 0, 'robos.criar': 0, 'crm.criar_card': 0, 'tarefas.criar': 0 };
  return [...tasks].sort((a, b) => (priority[a.id] ?? 1) - (priority[b.id] ?? 1));
}
function prerequisites(id, prepared) {
  if (id.startsWith('contatos.') && !['contatos.cadastrar', 'contatos.importar'].includes(id) && !prepared.contact) return false;
  if (id.startsWith('robos.') && id !== 'robos.criar' && !prepared.robot) return false;
  return true;
}
function actionEvidence(id, actions, fixtureFor = fixtureValue) {
  if (areaPlans[id]) return nextAreaAction(id, { controls: [], fields: [] }, actions, fixtureFor)?.type === 'finish';
  const fills = actions.filter((action) => action.type === 'fill').map((action) => action.value);
  const clickedSave = actions.some((action) => action.type === 'click' && /^(?:salvar|criar(?: novo)? robô|criar|cadastrar)$/iu.test(action.name));
  if (id === 'contatos.cadastrar') return fills.includes(fixtureFor('contactName'))
    && fills.includes(fixtureFor('phone')) && clickedSave;
  if (id === 'contatos.editar') return fills.includes(fixtureFor('editedName')) && clickedSave;
  if (id === 'robos.criar') return fills.includes(fixtureFor('robotName')) && clickedSave;
  if (id === 'contatos.buscar') return fills.includes(fixtureFor('contactName'));
  if (id === 'contatos.definir_responsavel') return actions.some((action) => action.type === 'select'
    || action.type === 'click' && action.role === 'option') && clickedSave;
  if (id === 'contatos.marcar_tags') return actions.some((action) => action.type === 'click' && action.role === 'option')
    || fills.includes(fixtureFor('tagName'))
      && actions.some((action) => action.type === 'click' && /criar|adicionar|salvar/iu.test(action.name));
  if (id === 'contatos.importar') return actions.some((action) => action.type === 'upload_csv')
    && actions.some((action) => action.type === 'click' && /^importar$/iu.test(action.name));
  if (id === 'contatos.exportar') return actions.some((action) => action.type === 'click' && /exportar contatos/iu.test(action.name));
  if (id === 'robos.montar_menu') return actions.some((action) => action.type === 'click' && /bloco|menu|opções/iu.test(action.name))
    && fills.includes(fixtureFor('menuQuestion')) && fills.includes(fixtureFor('menuOption', 1))
    && fills.includes(fixtureFor('menuOption', 2)) && clickedSave;
  if (id === 'robos.encaminhar') return actions.some((action) => action.type === 'click' && /encaminhar|transferir/iu.test(action.name))
    && actions.some((action) => action.type === 'select' && [fixtureFor('departmentName'), fixtureFor('userName')].includes(action.value)
      || action.type === 'click' && action.role === 'option')
    && clickedSave;
  if (id === 'robos.salvar') return clickedSave;
  if (id === 'robos.buscar') return actions.some((action) => action.type === 'fill' && action.value === fixtureFor('robotName'))
    || actions.some((action) => action.type === 'click' && action.name === fixtureFor('robotName'));
  if (id === 'robos.editar') return fills.includes(fixtureFor('robotName', 2))
    && actions.some((action) => action.type === 'click' && action.name === 'Voltar para lista');
  return actions.length > 0;
}
const plannedClick = (screen, pattern, role = null) => {
  const target = screen.controls.find((item) => item.enabled && (!role || item.role === role) && pattern.test(item.name));
  return target ? { type: 'click', role: target.role, name: target.name, value: null } : null;
};
const plannedClickLast = (screen, pattern) => {
  const target = screen.controls.filter((item) => item.enabled && item.role === 'button' && pattern.test(item.name)).at(-1);
  return target ? { type: 'click', role: target.role, name: target.name, value: null } : null;
};
const plannedFill = (screen, pattern, value, roles = ['textbox']) => {
  const field = screen.fields.find((item) => roles.includes(item.role) && pattern.test(item.name));
  return field && field.value !== value ? { type: 'fill', role: field.role, name: field.name, value } : null;
};
const finished = () => ({ type: 'finish', role: null, name: null, value: null });
export function plannedJourneyAction(id, screen, actions, fixtureFor = fixtureValue) {
  const done = (pattern) => actions.some((action) => action.type === 'click' && pattern.test(action.name));
  const filled = (value) => actions.some((action) => action.type === 'fill' && action.value === value);
  if (id === 'contatos.cadastrar') {
    if (!done(/^Adicionar Contato$/iu)) return plannedClick(screen, /^Adicionar Contato$/iu);
    if (!filled(fixtureFor('contactName'))) return plannedFill(screen, /^Nome$/iu, fixtureFor('contactName'));
    if (!filled(fixtureFor('phone'))) return plannedFill(screen, /^Telefone$/iu, fixtureFor('phone'));
    return !done(/^Salvar$/iu) ? plannedClick(screen, /^Salvar$/iu) : finished();
  }
  if (id === 'contatos.editar') {
    if (!done(/^Editar Nome$/iu)) return plannedClick(screen, /^Editar Nome$/iu);
    if (!filled(fixtureFor('editedName'))) return plannedFill(screen, /^Nome$/iu, fixtureFor('editedName'));
    return !done(/^Salvar(?: \(|$)/iu) ? plannedClick(screen, /^Salvar(?: \(|$)/iu) : finished();
  }
  if (id === 'contatos.definir_responsavel') {
    if (!done(/^Informações$/iu)) return plannedClick(screen, /^Informações$/iu, 'tab');
    if (!done(/^Editar Proprietário do Contato$/iu)) return plannedClick(screen, /^Editar Proprietário do Contato$/iu, 'button');
    const selected = actions.filter((action) => action.type === 'click' && action.role === 'option').length;
    const opened = actions.filter((action) => action.type === 'click' && action.role === 'combobox').length;
    if (selected === 0 && opened === 0) return plannedClick(screen, /^campo \d+ do formulário \(seleção\)$/iu, 'combobox');
    if (selected === 0 || selected === 1 && opened >= 2) return plannedClick(screen, /^opção 1$/iu, 'option');
    if (selected === 1) {
      const comboboxes = screen.controls.filter((item) => item.role === 'combobox' && item.enabled);
      const target = comboboxes.at(-1);
      return target ? { type: 'click', role: 'combobox', name: target.name, value: null } : null;
    }
    return !done(/^Salvar(?: \(|$)/iu) ? plannedClick(screen, /^Salvar(?: \(|$)/iu, 'button') : finished();
  }
  if (id === 'contatos.marcar_tags') {
    if (!done(/^Tags$/iu)) return plannedClick(screen, /^Tags$/iu, 'tab');
    if (!filled(fixtureFor('tagName'))) return plannedFill(screen,
      /^(?:Adicionar tag|Buscar ou criar tag|campo \d+ do formulário \((?:texto|seleção)\))/iu,
      fixtureFor('tagName'), ['textbox', 'combobox']);
    if (!done(/^opção [1-9]\d*$/iu)) {
      const options = screen.controls.filter((item) => item.role === 'option' && item.enabled);
      const target = options.at(-1);
      return target ? { type: 'click', role: 'option', name: target.name, value: null } : null;
    }
    return finished();
  }
  if (id === 'contatos.importar') {
    if (!done(/^Mais opções$/iu)) return plannedClick(screen, /^Mais opções$/iu, 'button');
    if (!done(/^Importar Contatos$/iu)) return plannedClick(screen, /^Importar Contatos$/iu);
    if (!actions.some((action) => action.type === 'upload_csv')) return { type: 'upload_csv', role: null, name: null, value: null };
    return null;
  }
  if (id === 'robos.criar') {
    if (!done(/^Criar novo robô$/iu)) return plannedClick(screen, /^Criar novo robô$/iu);
    if (!filled(fixtureFor('robotName'))) return plannedFill(screen, /^Título do Robô$/iu, fixtureFor('robotName'));
    if (!done(/^Canais$/iu)) return plannedClick(screen, /^Canais$/iu, 'button');
    if (!done(/^Canais$/iu) || !actions.some((action) => action.type === 'click' && action.role === 'combobox'
      && action.name === 'Canais')) return plannedClick(screen, /^Canais$/iu, 'combobox');
    if (!done(/^opção [1-9]\d*$/iu)) return plannedClick(screen, /^opção 1$/iu, 'option');
    return !done(/^Adicionar robô$/iu) ? plannedClick(screen, /^Adicionar robô$/iu) : finished();
  }
  if (id === 'robos.montar_menu') {
    const addCount = actions.filter((action) => action.type === 'click' && /^Adicionar bloco(?: \(|$)/iu.test(action.name)).length;
    const messageCount = actions.filter((action) => action.type === 'click' && action.name === 'Mensagem simples').length;
    if (!done(/^Fluxo de Robô$/iu)) return plannedClick(screen, /^Fluxo de Robô$/iu, 'link');
    if (addCount === 0) return plannedClick(screen, /^Adicionar bloco$/iu);
    if (!done(/^Menu de opções$/iu)) return plannedClick(screen, /^Menu de opções$/iu);
    if (!filled(fixtureFor('menuQuestion'))) return plannedFill(screen, /^Mensagem de onboarding$/iu, fixtureFor('menuQuestion'));
    if (!actions.some((action) => action.type === 'fill' && action.name === 'Mensagem'))
      return plannedFill(screen, /^Mensagem$/iu, fixtureFor('menuQuestion'));
    if (actions.filter((action) => action.type === 'click' && /^Adicionar opção \+$/iu.test(action.name)).length < 1)
      return plannedClick(screen, /^Adicionar opção \+$/iu);
    if (!filled(fixtureFor('menuOption', 1))) return plannedFill(screen, /^Adicione uma opção(?: \(cabeçalho(?: \d+)?\))?$/iu, fixtureFor('menuOption', 1));
    if (actions.filter((action) => action.type === 'click' && /^Adicionar opção \+$/iu.test(action.name)).length < 2)
      return plannedClick(screen, /^Adicionar opção \+$/iu);
    if (!filled(fixtureFor('menuOption', 2))) {
      const field = screen.fields.find((item) => item.role === 'textbox'
        && /^Adicione uma opção(?: \(cabeçalho(?: \d+)?\))?$/iu.test(item.name)
        && item.value !== fixtureFor('menuOption', 1));
      return field ? { type: 'fill', role: 'textbox', name: field.name, value: fixtureFor('menuOption', 2) } : null;
    }
    if (addCount < 2)
      return plannedClick(screen, /^Adicionar bloco$/iu);
    if (addCount < 3) return plannedClick(screen, /^Adicionar bloco(?: \(cabeçalho(?: \d+)?\))?$/iu);
    if (messageCount < 1) return plannedClick(screen, /^Mensagem simples$/iu);
    if (!filled(fixtureFor('menuOption', 1)) || !actions.some((action) => action.type === 'fill'
      && action.name === 'Título da mensagem' && action.value === fixtureFor('menuOption', 1)))
      return plannedFill(screen, /^Título da mensagem$/iu, fixtureFor('menuOption', 1));
    if (!actions.some((action) => action.type === 'fill' && action.name === 'campo 2 do formulário (texto)'
      && action.value === fixtureFor('menuOption', 1)))
      return plannedFill(screen, /^campo 2 do formulário \(texto\)$/iu, fixtureFor('menuOption', 1));
    if (!actions.some((action) => action.type === 'click' && action.name === 'Enviar mensagem'))
      return plannedClick(screen, /^Enviar mensagem$/iu, 'button');
    if (addCount < 4) return plannedClickLast(screen, /^Adicionar bloco(?: \(cabeçalho(?: \d+)?\))?$/iu);
    if (addCount < 5) return plannedClick(screen, /^Adicionar bloco(?: \(cabeçalho(?: \d+)?\))?$/iu);
    if (messageCount < 2) return plannedClick(screen, /^Mensagem simples$/iu);
    if (!actions.some((action) => action.type === 'fill' && action.name === 'Título da mensagem'
      && action.value === fixtureFor('menuOption', 2)))
      return plannedFill(screen, /^Título da mensagem$/iu, fixtureFor('menuOption', 2));
    if (!actions.some((action) => action.type === 'fill' && action.name === 'campo 2 do formulário (texto)'
      && action.value === fixtureFor('menuOption', 2)))
      return plannedFill(screen, /^campo 2 do formulário \(texto\)$/iu, fixtureFor('menuOption', 2));
    if (actions.filter((action) => action.type === 'click' && action.name === 'Enviar mensagem').length < 2)
      return plannedClick(screen, /^Enviar mensagem$/iu, 'button');
    if (addCount < 6) return plannedClickLast(screen, /^Adicionar bloco(?: \(cabeçalho(?: \d+)?\))?$/iu);
    return !done(/^Salvar$/iu) ? plannedClick(screen, /^Salvar$/iu) : finished();
  }
  if (id === 'robos.encaminhar') {
    if (!done(/^Fluxo de Robô$/iu)) return plannedClick(screen, /^Fluxo de Robô$/iu, 'link');
    if (!done(/^Adicionar bloco(?: \(|$)/iu))
      return plannedClick(screen, /^Adicionar bloco(?: \(cabeçalho(?: \d+)?\))?$/iu);
    if (!done(/^Ação$/iu)) return plannedClick(screen, /^Ação$/iu);
    if (!done(/^Encaminhar atendimento$/iu)) return plannedClick(screen, /^Encaminhar atendimento$/iu);
    if (!done(/^opção [1-9]\d*$/iu)) return plannedClick(screen, /^opção 1$/iu, 'option');
    if (actions.filter((action) => action.type === 'click' && /^Adicionar bloco(?: \(|$)/iu.test(action.name)).length < 2)
      return plannedClick(screen, /^Adicionar bloco(?: \(cabeçalho(?: \d+)?\))?$/iu);
    return !done(/^Salvar$/iu) ? plannedClick(screen, /^Salvar$/iu) : finished();
  }
  if (id === 'robos.salvar') {
    if (!done(/^Fluxo de Robô$/iu)) return plannedClick(screen, /^Fluxo de Robô$/iu, 'link');
    return !done(/^Salvar$/iu) ? plannedClick(screen, /^Salvar$/iu) : finished();
  }
  if (id === 'robos.buscar') return !filled(fixtureFor('robotName'))
    ? plannedFill(screen, /^Buscar robô$/iu, fixtureFor('robotName')) : finished();
  if (id === 'robos.editar') {
    if (!done(/^Fluxo de Robô$/iu)) return plannedClick(screen, /^Fluxo de Robô$/iu, 'link');
    if (!done(/^Editar título do Robô$/iu)) return plannedClick(screen, /^Editar título do Robô$/iu);
    if (!filled(fixtureFor('robotName', 2))) return plannedFill(screen, /^Digite o título do robô$/iu, fixtureFor('robotName', 2));
    return !done(/^Voltar para lista$/iu) ? plannedClick(screen, /^Voltar para lista$/iu) : finished();
  }
  return null;
}
const fileFor = (root, module, id, key) => join(root, module, `${id}.${key}.json`);
async function loadCache(root, module, id, key, cacheOnly = false) {
  try {
    const data = JSON.parse(await readFile(fileFor(root, module, id, key), 'utf8'));
    if (data.cacheKey !== key || data.task !== id) throw new Error('cache incompatível');
    if (cacheOnly && !(data.status === 'concluída' && data.verification?.confirmed === true
      || data.status === 'bloqueada' && /política|proibida|upload fora da tarefa|tipo inválido|ação inválida|alvo inválido|valor fora do gerador|clique inválido|opção inválida/u.test(data.reason ?? '')))
      return null;
    for (const { screenshotId } of data.screens ?? []) {
      if (!/^[a-f0-9]{64}$/u.test(screenshotId)
        || createHash('sha256').update(await readFile(join(root, module, `${screenshotId}.png`))).digest('hex') !== screenshotId)
        throw new Error('print do cache inválido');
    }
    return safeJourney(data);
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function saveJourney(root, module, record, images) {
  // Validate the full record before creating even a directory or screenshot.
  const safeRecord = safeJourney(record);
  const dir = join(root, module);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const [id, bytes] of images) await writeFile(join(dir, `${id}.png`), bytes, { flag: 'wx', mode: 0o600 }).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const name = fileFor(root, module, record.task, record.cacheKey);
  await writeFile(name, JSON.stringify(safeRecord, null, 2), { mode: 0o600 });
  if (record.configuredIdentityHash) await writeFile(join(dir,
    `${record.task}.${digest(record.configuredIdentityHash)}.latest`), record.cacheKey, { mode: 0o600 });
}

const proofCache = new WeakMap();
export function clearJourneyProofCache(probeAccount) { proofCache.delete(probeAccount); }
async function cachedAccountProof(accountHash, probeAccount) {
  let entries = proofCache.get(probeAccount);
  if (!entries) { entries = new Map(); proofCache.set(probeAccount, entries); }
  let entry = entries.get(accountHash);
  if (!entry || entry.expiresAt <= Date.now()) {
    entry = { expiresAt: Date.now() + 30_000, promise: Promise.resolve().then(probeAccount)
      .then((live) => ({ live, reason: live ? null : 'homologação indisponível' }))
      .catch((error) => ({ live: null, reason: journeyFailureCategory(error) })) };
    entries.set(accountHash, entry);
    entry.promise.then(({ live }) => { entry.expiresAt = Date.now() + (live ? 600_000 : 30_000); });
  }
  return entry.promise;
}

export function journeyReadFailureCategory(error) {
  if (error?.code === 'ENOENT' || error?.message === 'registro ausente') return 'registro ausente';
  if (error?.message === 'prova de conta indisponível') return 'prova de conta indisponível';
  if (/sanitização|cache inválido|cache incompatível|print do cache inválido/u.test(error?.message ?? '')) return 'sanitização';
  return 'leitura falhou';
}

export async function readJourney({ root = resolve(process.env.MCP_STATE_DIR ?? '/data', 'journeys'), module, task, accountHash, probeAccount }) {
  if (!modules.has(module) || !taskId.test(task) || !task.startsWith(`${module}.`)) throw new Error('tarefa inválida');
  if (!accountHash || typeof accountHash !== 'string') throw new Error('identidade configurada indisponível');
  const key = await readFile(join(root, module, `${task}.${digest(accountHash)}.latest`), 'utf8');
  if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error('cache inválido');
  const record = await loadCache(root, module, task, key);
  if (!record) throw new Error('registro ausente');
  if (record?.configuredIdentityHash !== accountHash) throw new Error('identidade configurada divergente');
  if (record.target === 'producao' && !record.accountProof) throw new Error('prova de conta indisponível');
  if (!record.accountProof) return { ...record, identityVerified: false, accountless: true };
  let proof = { live: null, reason: 'prova indisponível' };
  if (probeAccount) {
    if (record.target === 'producao') {
      try { proof = { live: await probeAccount(), reason: 'prova indisponível' }; }
      catch { /* A leitura de produção recusa sem expor o erro de login. */ }
    } else proof = await cachedAccountProof(accountHash, probeAccount);
  }
  const { live, reason } = proof;
  if (!live) {
    if (record.target === 'producao') throw new Error('prova de conta indisponível');
    return { ...record, identityVerified: false, identityReason: reason };
  }
  if (!/^[a-z0-9-]{1,80}$/iu.test(live.userId ?? '') || !/^[a-z0-9-]{1,80}$/iu.test(live.companyId ?? '')) {
    if (record.target === 'producao') throw new Error('prova de conta indisponível');
    return { ...record, identityVerified: false, identityReason: 'identidade inválida' };
  }
  if (record.accountProof !== digest([live.userId, live.companyId])) throw new Error('jornada de outra conta');
  return { ...record, identityVerified: true };
}

export async function runJourneys({ module, tasks, root = resolve(process.env.MCP_STATE_DIR ?? '/data', 'journeys'), marker = '',
  frontSha, backSha = 'unavailable', profile, browser, model, sanitize = async (value) => value,
  connectivityAttestation,
  allowedScreenLabels = new Set(),
  maxActionsPerTask = 30, maxActionsPerModule = 300, maxMs = 900_000, maxCostUsd = 5,
  cacheConfig = {}, cacheBypass = false, markerChanged = () => {}, accountIdentity, probeAccount,
  deterministicPlans = false }) {
  const invalid = [
    ['module', !modules.has(module)],
    ['tasks', !Array.isArray(tasks) || tasks.some((item) => !taskId.test(item.id) || item.modulo !== module)],
    ['frontSha', !sha.test(frontSha)],
    ['backSha', !(sha.test(backSha) || backSha === 'unavailable')],
    ['profile', !profile], ['browser', !browser], ['model', !model],
    ['marker', Boolean(marker && !/^[a-f0-9]{8}$/u.test(marker))],
  ].find(([, failed]) => failed)?.[0];
  if (invalid) throw new Error(`${invalid} ausente`);
  const account = accountIdentity ? await accountIdentity() : null;
  if (accountIdentity && (!account || !(typeof account.credentialHash === 'string' && account.credentialHash
    || typeof account.userId === 'string' && account.userId && typeof account.companyId === 'string' && account.companyId)))
    throw new Error('identidade configurada indisponível');
  const accountHash = account ? account.credentialHash ?? digest([account.userId, account.companyId]) : null;
  let currentMarker = marker;
  let areaFixtureContext = {};
  const fixtureFor = (kind, n = 1) => areaModules.has(module)
    ? areaFixtureContext[kind] ?? areaFixtureValue(kind, { marker: currentMarker, ...areaFixtureContext })
    : fixtureValue(kind, n, currentMarker);
  const generatedFor = () => areaModules.has(module) ? new Set([...Object.values(areaFixtureContext),
    ...['cardName', 'campaignName', 'noteText', 'taskName', 'editedTaskName']
      .map((kind) => areaFixtureValue(kind, { marker: currentMarker }))])
    : currentMarker ? new Set([currentMarker, ...['contactName', 'editedName', 'robotName', 'tagName',
    'menuQuestion', 'menuOption', 'departmentName', 'userName', 'email', 'phone']
    .flatMap((kind) => areaModules.has(module) ? [] : Array.from({ length: 99 }, (_, index) => fixtureFor(kind, index + 1))),
    ]) : fixtureValues;
  const results = [];
  const prepared = {};
  let moduleActions = 0;
  let costUsd = 0;
  const started = Date.now();
  try {
  for (const task of orderTasks(tasks)) {
    const dependency = ['contatos.cadastrar', 'robos.criar'].includes(task.id) ? null
      : { marker: currentMarker, contact: prepared.contact, robot: prepared.robot,
        robotRef: prepared.robotRef, robotId: prepared.robotId, identity: prepared.identity };
    const key = digest({ task, frontSha, backSha, profile, accountHash, policy: JOURNEY_POLICY_VERSION, dependency,
      config: { maxActionsPerTask, maxActionsPerModule, maxMs, maxCostUsd, connectivityAttestation, ...cacheConfig } });
    let cached = cacheBypass || areaModules.has(module) ? null : await loadCache(root, module, task.id, key, true);
    if (cached && accountHash && cached.configuredIdentityHash !== accountHash) cached = null;
    if (cached && probeAccount) {
      const live = await probeAccount();
      if (live) {
        const proof = digest([live.userId, live.companyId]);
        if (cached.accountProof !== proof) cached = null;
        else cached.identityVerified = true;
      } else if (cacheConfig.qaTarget === 'producao') cached = null;
      else cached.identityVerified = false;
      if (cached) await writeFile(fileFor(root, module, task.id, key), JSON.stringify(cached, null, 2), { mode: 0o600 });
    }
    if (cached) {
      results.push(cached); Object.assign(prepared, cached.created ?? {});
      if (cached.created && Object.keys(cached.created).length) {
        currentMarker = cached.marker;
        markerChanged(currentMarker);
        prepared.identity = cached.identity;
        prepared.accountProof = cached.accountProof;
      }
      continue;
    }
    const record = { task: task.id, module, target: cacheConfig.qaTarget ?? 'homolog',
      ...(connectivityAttestation ? { connectivityAttestation } : {}),
      objective: task.tarefa, prerequisites: task.preRequisitos,
      profile, versions: { frontSha, backSha, note: backSha === 'unavailable' ? 'SHA do back indisponível; recapturar quando disponível' : null },
      fixtures: [prepared.contact, prepared.robot].filter((value) => typeof value === 'string'), marker: currentMarker,
      actions: [], screens: [], before: null, after: null,
      expected: task.resultadoEsperadoObservavel, observed: null, verification: null, created: {},
      status: 'inconclusiva', reason: null, limits: { maxActionsPerTask, maxActionsPerModule, maxMs, maxCostUsd },
      blocked: null, thirdPartyDenied: {},
      ...(accountHash ? { configuredIdentityHash: accountHash } : {}),
      usage: { actions: 0, costUsd: 0, elapsedMs: 0 }, cacheKey: key, policyVersion: JOURNEY_POLICY_VERSION };
    const images = [];
    if (task.id === 'robos.publicar_ativar' || task.id === 'contatos.agendar_mensagem'
      || areaModules.has(module) && !areaPlans[task.id]) {
      record.status = 'bloqueada'; record.reason = 'ação proibida pela política';
    } else if (!prerequisites(task.id, prepared)) {
      record.reason = 'sem dado de preparo';
    } else {
      let opened = false;
      let fallbackActions = 0;
      try {
        const openedFixtures = await browser.open(task, prepared); opened = true;
        areaFixtureContext = openedFixtures?.areaFixtureContext ?? {};
        if (openedFixtures?.account) {
          const { userId, companyId } = openedFixtures.account;
          if (!/^[a-z0-9-]{1,80}$/iu.test(userId ?? '') || !/^[a-z0-9-]{1,80}$/iu.test(companyId ?? ''))
            throw new Error('identidade autenticada indisponível');
          record.accountProof = digest([userId, companyId]);
          record.identityVerified = true;
          if (prepared.accountProof && prepared.accountProof !== record.accountProof) {
            const stale = new Error('conta de cache mudou'); stale.code = 'STALE_JOURNEY_REFERENCE'; throw stale;
          }
        }
        if (Array.isArray(openedFixtures?.fixtures)) record.fixtures.push(...openedFixtures.fixtures);
        if (openedFixtures?.environmentBlocked) {
          record.status = 'bloqueada';
          record.reason = `ambiente: importação anterior em andamento${openedFixtures.environmentBlocked.date
            ? ` (${openedFixtures.environmentBlocked.date})` : ''}`;
        }
        const complete = async (screen) => {
          if (!actionEvidence(task.id, record.actions, fixtureFor)) {
            record.reason = 'ações necessárias não observadas'; return;
          }
          const checked = await browser.verify(task, prepared, record.actions);
          record.verification = { confirmed: Boolean(checked.confirmed), observed: safeString(checked.observed ?? ''),
            ...(Number.isSafeInteger(checked.refsCount) ? { refsCount: checked.refsCount } : {}),
            ...(typeof checked.createdRefInRefs === 'boolean' ? { createdRefInRefs: checked.createdRefInRefs } : {}),
            ...(Number.isSafeInteger(checked.foundCount) ? { foundCount: checked.foundCount } : {}) };
          if (checked.importCapture) record.importCapture = checked.importCapture;
          if (checked.persistedCapture) record.persistedCapture = checked.persistedCapture;
          if (checked.importResultMessage) record.importResultMessage = screenString(checked.importResultMessage, allowedScreenLabels);
          record.observed = record.verification.observed;
          record.after = screen.state;
          record.status = checked.confirmed ? 'concluída' : 'inconclusiva';
          record.reason = checked.confirmed ? null : 'resultado não conferido';
          if (checked.confirmed && checked.created) {
            if (Object.entries(checked.created).some(([key, value]) =>
              key === 'robotRef' ? value !== checked.identity?.refs?.[0]
                : key === 'robotId' ? !checked.identity?.ids?.includes(value) : !generatedFor().has(value)))
              throw new SanitizationError('dado de preparo inválido');
            record.created = checked.created;
            if (checked.identity) record.identity = checked.identity;
          }
        };
        let feedback = null;
        for (let index = 0; index < maxActionsPerTask && record.status !== 'bloqueada'; index++) {
          if (moduleActions >= maxActionsPerModule || Date.now() - started > maxMs || costUsd >= maxCostUsd) {
            record.reason = 'limite da execução atingido';
            if (feedback) record.status = 'falhou';
            break;
          }
          let raw;
          try { raw = await browser.observe(); }
          catch (error) {
            record.observeError = { stage: ['dom', 'máscara', 'screenshot', 'navegação'].includes(error?.stage)
              ? error.stage : 'dom', category: captureFailureCategory(error) };
            const safe = new SanitizationError(`observação: ${record.observeError.category}`);
            safe.observeError = record.observeError;
            throw safe;
          }
          let sanitized;
          try { sanitized = sanitizeScreen(await sanitize(raw), allowedScreenLabels); }
          catch { throw new SanitizationError('sanitização falhou'); }
          const screenshotId = createHash('sha256').update(sanitized.screenshot).digest('hex');
          const screen = { title: sanitized.title, path: sanitized.path, controls: sanitized.controls,
            fields: sanitized.fields, messages: sanitized.messages, state: sanitized.state, screenshotId,
            controlsOffered: sanitized.controls };
          if (record.before == null) record.before = sanitized.state;
          if (record.screens.length) screen.controlsOffered = sanitized.controls.filter((control) =>
            !record.screens.at(-1).controls.some((old) => old.role === control.role && old.name === control.name));
          record.screens.push(screen);
          images.push([screenshotId, sanitized.screenshot]);
          const validation = screen.messages.find((message) => /^(?:Informe o telefone com DDD|Já existe um contato com este número de telefone|O telefone é obrigatório|Precisa ter pelo menos um canal)$/iu.test(message));
          if (task.id === 'contatos.importar' && screen.controls.some((control) => /importar contatos/iu.test(control.name) && !control.enabled)) {
            record.importInProgress = true;
            if (!await browser.waitImportReady?.(30_000)) {
              record.status = 'bloqueada';
              const pending = await browser.pendingImport?.();
              record.reason = `ambiente: importação anterior em andamento${pending?.date ? ` (${pending.date})` : ''}`;
              break;
            }
            continue;
          }
          const plan = task.id === 'contatos.cadastrar' ? { Nome: 'contactName', Telefone: 'phone' }
            : task.id === 'robos.criar' ? { 'Título do Robô': 'robotName' } : {};
          const channelSelected = selectedRobotChannel(record.actions);
          const missingPlanned = Object.entries(plan).find(([name, kind]) => {
            const field = screen.fields.find((item) => item.name === name);
            const expected = fixtureFor(kind);
            if (!field) return true;
            return kind === 'phone' ? !field.value || field.value.replace(/\D/gu, '') !== expected.replace(/\D/gu, '')
              : field.value !== expected;
          }) ?? (task.id === 'robos.criar' && !channelSelected ? ['Canais', 'ficha'] : null);
          if (validation && !(missingPlanned && /telefone|canal/iu.test(validation))) {
            record.status = 'falhou';
            record.reason = `validação do formulário: ${validation}`;
            record.observed = validation;
            break;
          }
          if (validation && missingPlanned) feedback = `${missingPlanned[0]} ainda sem o valor do gerador (${missingPlanned[1]})`;
          const specialized = task.id === 'contatos.exportar' && typeof browser.exportAction === 'function'
            || task.id === 'contatos.buscar' && typeof browser.searchAction === 'function';
          let decision = task.id === 'contatos.exportar' && browser.exportAction
            ? await browser.exportAction(screen, prepared, record.actions)
            : task.id === 'contatos.buscar' && browser.searchAction
              ? await browser.searchAction(screen, prepared, record.actions)
              : areaModules.has(module) ? nextAreaAction(task.id, screen, record.actions, fixtureFor)
                : deterministicPlans ? plannedJourneyAction(task.id, screen, record.actions, fixtureFor) : null;
          if (areaModules.has(module) && !decision) { record.reason = 'plano sem alvo'; break; }
          if (!decision && !specialized) {
            if (deterministicPlans && fallbackActions >= 5) {
              record.reason = 'plano sem alvo após 5 ações de fallback'; break;
            }
            decision = await model.decide({ task: { id: task.id, objective: task.tarefa, expected: record.expected,
              verification: task.verificacaoM571, plan: taskPlans[task.id] ?? null }, screen, actions: record.actions, feedback });
            fallbackActions++;
          }
          if (!decision) { record.reason = 'seleção fictícia não comprovada'; break; }
          feedback = null;
          const charge = Number(decision.costUsd ?? 0);
          if (!Number.isFinite(charge) || charge < 0) { record.reason = 'custo inválido'; break; }
          costUsd += charge;
          if (costUsd > maxCostUsd) {
            record.reason = 'limite de custo atingido';
            if (feedback) record.status = 'falhou';
            break;
          }
          const action = { type: decision.type, role: decision.role, name: decision.name, value: decision.value };
          if (action.type === 'upload_csv' && task.id !== 'contatos.importar') {
            record.status = 'bloqueada'; record.reason = 'upload fora da tarefa'; break;
          }
          const policy = policyDecision(action, generatedFor(), task.id);
          if (!policy.allowed) { record.status = 'bloqueada'; record.reason = policy.reason; break; }
          if (action.type === 'click' && /^(?:Salvar|Adicionar robô)$/iu.test(action.name) && missingPlanned) {
            feedback = `${missingPlanned[0]} ainda sem o valor do gerador (${missingPlanned[1]})`;
            continue;
          }
          if (task.id === 'robos.criar' && action.type === 'click' && action.role === 'option'
            && channelSelected === action.name) {
            feedback = 'Canais já tem uma ficha selecionada';
            continue;
          }
          if (action.type === 'finish') {
            if (missingPlanned) { feedback = `${missingPlanned[0]} ainda sem o valor do gerador (${missingPlanned[1]})`; continue; }
            const missingRequired = screen.fields.find((field) => field.required && !field.filled);
            if (missingRequired) {
              const generatorKind = task.id === 'contatos.cadastrar' ? { Nome: 'contactName', Telefone: 'phone' }
                : task.id === 'robos.criar' ? { 'Título do Robô': 'robotName' } : {};
              if (generatorKind[missingRequired.name]) {
                feedback = `obrigatório vazio: ${missingRequired.name}; use o valor do gerador`;
                continue;
              }
              record.status = 'falhou'; record.reason = 'valor do gerador ausente para campo obrigatório';
              break;
            }
            await complete(sanitized);
            break;
          }
          if (action.type !== 'upload_csv' && !['contatos.exportar', 'contatos.buscar'].includes(task.id)
            && !sanitized.controls.some((control) => control.role === action.role && control.name === action.name && control.enabled)
            && !sanitized.fields.some((field) => field.role === action.role && field.name === action.name)) {
            record.reason = 'alvo ausente da tela'; break;
          }
          if (action.type === 'fill' && (screen.fields.some((field) => field.role === action.role && field.name === action.name && field.value === action.value)
            || record.actions.some((previous) => previous.type === 'fill' && previous.role === action.role
              && previous.name === action.name && previous.value === action.value))) {
            record.status = 'falhou'; record.reason = 'preenchimento repetido'; break;
          }
          try { await browser.act(action); }
          catch (error) {
            if (error?.code === 'JOURNEY_TARGET_CHANGED') {
              feedback = 'alvo mudou; observe de novo'; continue;
            }
            if (error?.actionCategory) record.actionError = { categoria: error.actionCategory, alvo: action.name,
              ...(error.controlProbe ? { controlProbe: error.controlProbe } : {}),
              ...(error.coveredBy ? { coveredBy: error.coveredBy } : {}) };
            throw error;
          }
          record.actions.push(action);
          moduleActions++;
          record.usage.actions++;
          if (task.id === 'contatos.definir_responsavel' && action.type === 'click' && action.name === 'Salvar'
            || task.id === 'contatos.marcar_tags' && action.type === 'click' && action.role === 'option') {
            await complete(sanitized);
            break;
          }
          if (['contatos.cadastrar', 'robos.criar'].includes(task.id)
            && action.type === 'click' && /^(?:Salvar|Adicionar robô)$/iu.test(action.name)) {
            const outcome = await browser.awaitCreation?.(20_000);
            if (outcome) {
              record.creationCapture = outcome.capture;
              if (outcome.capture?.refFound && typeof outcome.ref === 'string') record.createdRef = outcome.ref;
              if (outcome.saveOutcome) record.saveOutcome = outcome.saveOutcome;
              if (outcome.messages) record.saveMessages = outcome.messages.map((message) => screenString(message, allowedScreenLabels));
              if (outcome.ref && outcome.capture?.refFound && outcome.capture?.status >= 200
                && outcome.capture.status < 300) { await complete(sanitized); break; }
              if (outcome.capture?.postSeen && outcome.capture.status >= 400) {
                record.status = 'falhou'; record.reason = record.saveOutcome ?? `erro ${outcome.capture.status}`; break;
              }
              if (outcome.capture?.postSeen) {
                record.reason = outcome.saveOutcome ?? 'POST sem referência conferível'; break;
              }
              feedback = outcome.saveOutcome;
            }
          }
        }
        if (!record.reason && record.status === 'inconclusiva') {
          record.reason = 'limite de ações por tarefa';
          if (feedback) record.status = 'falhou';
        }
      } catch (error) {
        if (error?.code === 'STALE_JOURNEY_REFERENCE') throw error;
        record.status = error?.code === 'QA_SESSION_ACTIVE' || /escrita bloqueada pela política/iu.test(String(error?.message ?? ''))
          ? 'bloqueada' : 'inconclusiva';
        record.reason = error?.code === 'QA_SESSION_ACTIVE' ? 'ambiente: sessão ativa'
          : record.status === 'bloqueada' ? 'escrita bloqueada pela política' : journeyFailureCategory(error);
        if (task.id === 'contatos.exportar') record.failureDetail = journeyFailureLog(error);
        if (record.status === 'bloqueada' && error.blocked) record.blocked = error.blocked;
        if (error instanceof SanitizationError) {
          record.screens = []; record.before = null; record.after = null; images.length = 0;
        }
        console.error(record.observeError
          ? `gravar_jornada: observe ${record.observeError.stage}: ${record.observeError.category}`
          : record.actionError ? `gravar_jornada: ação: ${record.actionError.categoria}` : journeyFailureLog(error));
      } finally {
        const diagnostics = browser.diagnostics?.() ?? {};
        record.thirdPartyDenied = diagnostics.thirdPartyDenied ?? {};
        if (diagnostics.searchProbe) record.searchProbe = diagnostics.searchProbe;
        if (diagnostics.apiError && ['contatos.buscar', 'contatos.exportar', 'contatos.definir_responsavel', 'contatos.importar'].includes(task.id)) {
          record.apiError = diagnostics.apiError;
          record.status = 'bloqueada';
          record.reason = `ambiente: API da homologação respondeu ${diagnostics.apiError.status}`;
        }
        if (diagnostics.ownerProbe) record.ownerProbe = diagnostics.ownerProbe;
        if (diagnostics.menuProbe) record.menuProbe = diagnostics.menuProbe;
        if (diagnostics.botWriteProbe?.length) record.botWriteProbe = diagnostics.botWriteProbe;
        if (diagnostics.tagProbe) record.tagProbe = diagnostics.tagProbe;
        if (['contatos.cadastrar', 'robos.criar'].includes(task.id)) record.creationCapture ??=
          diagnostics.creationCapture ?? { postSeen: false, status: null, jsonParsed: false, topKeys: [], refFound: false };
        await browser.close().catch(() => {});
      }
    }
    record.usage.costUsd = costUsd;
    record.usage.elapsedMs = Date.now() - started;
    // The caller cannot bypass this final privacy gate with an injected sanitizer.
    safeJourney(record);
    await saveJourney(root, module, record, images);
    Object.assign(prepared, record.created);
    if (record.identity) prepared.identity = record.identity;
    if (record.accountProof) prepared.accountProof = record.accountProof;
    results.push(record);
  }
  } catch (error) {
    if (error && typeof error === 'object') error.results = results;
    throw error;
  }
  return results;
}
