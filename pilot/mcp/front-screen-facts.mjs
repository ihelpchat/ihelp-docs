import ts from 'typescript';
import { posix } from 'node:path';
import { containsSensitiveData } from './sensitive-data.mjs';
import { sanitizeCodeForModel } from './code-hygiene.mjs';

export const FRONT_ROUTER = 'src/components/core/components/Router/utils/pagesData.tsx';
const MAX_FILES = 72;
const MAX_CHARS = 1_000_000;
const VISIBLE = new Set(['label', 'labelText', 'title', 'placeholder', 'aria-label', 'tooltip']);
const ACTION = /^(?:button|MenuItem|MenuButton|Button|ButtonWithIcon|ButtonIconAction)$/iu;
const FIELD = /^(?:input|select|textarea|Input\w*|Select\w*|Controller)$/u;
const normalized = (value) => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// One TS/TSX lexer. Offsets and newlines stay fixed; values always come from the original AST.
export function neutralizeTypescript(source) {
  const file = ts.createSourceFile('screen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const chars = source.split('');
  const mask = (start, end) => {
    for (let i = start; i < end; i++) if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
  };
  const visit = (node) => {
    ts.forEachLeadingCommentRange(source, node.pos, mask);
    ts.forEachTrailingCommentRange(source, node.end, mask);
    if ([ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
      ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail].includes(node.kind))
      mask(node.getStart(file), node.getEnd());
    ts.forEachChild(node, visit);
  };
  visit(file);
  return chars.join('');
}

function literal(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) return literal(node.expression);
  return null;
}
function attr(node, name) {
  return node.attributes?.properties?.find((item) => ts.isJsxAttribute(item) && item.name.text === name);
}
function attrValue(node, name) { return literal(attr(node, name)?.initializer); }
function jsxName(node) { return node.tagName?.getText() ?? ''; }
function safeText(value) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!text || text.length > 200 || !/[\p{L}\p{N}]/u.test(text)
    || containsSensitiveData(text, { detectOpaque: true })
    || sanitizeCodeForModel(JSON.stringify(text)).literalsOmitted) return null;
  return text;
}
function lineOf(file, node) { return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1; }
function numeric(node) {
  if (!node) return null;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
    const left = numeric(node.left), right = numeric(node.right);
    return Number.isFinite(left * right) ? left * right : null;
  }
  return null;
}
function addFact(facts, filePath, file, node, kind, values) {
  const text = values.text === undefined ? undefined : safeText(values.text);
  if (values.text !== undefined && !text) return;
  const fact = { kind, ...(text ? { text } : {}), ...values,
    ...(text ? { text } : {}), source: `${filePath}:${lineOf(file, node)}` };
  if (Object.values(fact).some((value) => typeof value === 'string' && containsSensitiveData(value, { detectOpaque: true }))) return;
  facts.push(fact);
}
function collect(filePath, source, facts) {
  const clean = neutralizeTypescript(source);
  const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = new Map();
  const translationKeys = new Set();
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && /\bimport\b/u.test(clean.slice(node.getStart(file), node.moduleSpecifier.getStart(file)))) {
      const names = [];
      if (node.importClause?.name) names.push(node.importClause.name.text);
      for (const item of node.importClause?.namedBindings?.elements ?? []) names.push(item.name.text);
      imports.set(node.moduleSpecifier.text, names);
    }
    if (ts.isJsxText(node)) {
      const value = safeText(node.getText(file));
      if (value) addFact(facts, filePath, file, node, 'text', { text: value });
    }
    if (ts.isJsxExpression(node) && node.expression && ts.isConditionalExpression(node.expression)) {
      for (const branch of [node.expression.whenTrue, node.expression.whenFalse]) {
        const value = literal(branch);
        if (value) addFact(facts, filePath, file, branch, 'state', { text: value });
      }
    }
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = jsxName(node);
      for (const name of VISIBLE) {
        const value = attrValue(node, name);
        if (value) addFact(facts, filePath, file, attr(node, name), 'text', { text: value, property: name });
      }
      const handler = attr(node, 'onClick')?.initializer;
      if (ACTION.test(tag) || /^button$/iu.test(tag)) {
        const label = attrValue(node, 'labelText') ?? attrValue(node, 'label') ?? attrValue(node, 'aria-label');
        const children = ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent.children : [];
        const body = children.flatMap((child) => {
          if (ts.isJsxText(child)) return [child.getText(file)];
          if (ts.isJsxExpression(child) && child.expression && ts.isConditionalExpression(child.expression))
            return [literal(child.expression.whenFalse), literal(child.expression.whenTrue)];
          return [];
        }).find((value) => safeText(value));
        const text = body ?? label;
        const expression = handler && ts.isJsxExpression(handler) ? handler.expression : null;
        const handlerName = expression && ts.isIdentifier(expression) ? expression.text
          : expression && ts.isArrowFunction(expression) ? expression.body.getText(file).match(/\b([A-Za-z]\w*)\s*\(/u)?.[1] : null;
        if (text && handlerName) addFact(facts, filePath, file, node, 'action', { text, handler: handlerName });
      }
      const accept = attrValue(node, 'accept');
      if (accept) addFact(facts, filePath, file, attr(node, 'accept'), 'upload', { accept });
      const fieldName = attrValue(node, 'name');
      if (FIELD.test(tag) && fieldName) {
        const required = Boolean(attr(node, 'required')) || /\brequired\s*:/u.test(node.getText(file));
        addFact(facts, filePath, file, node, 'field', { name: fieldName,
          ...(attrValue(node, 'label') ? { text: attrValue(node, 'label') } : {}), required,
          type: attrValue(node, 'type') ?? 'text' });
      }
    }
    if (ts.isCallExpression(node) && clean.slice(node.expression.getStart(file), node.expression.getEnd()).trim()) {
      const call = node.expression.getText(file);
      if (/^(?:translate|t)$/u.test(call) && literal(node.arguments[0])) translationKeys.add(literal(node.arguments[0]));
      if (/^(?:toast(?:\.[A-Za-z]+)?|confirm|window\.confirm)$/u.test(call)) {
        const text = literal(node.arguments[0]);
        if (text) addFact(facts, filePath, file, node, 'message', { text });
      }
      if (/^(?:addNotification|notify)$/u.test(call) && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        for (const prop of node.arguments[0].properties) if (ts.isPropertyAssignment(prop)
          && ['title', 'description'].includes(prop.name.getText(file))) {
          const text = literal(prop.initializer);
          if (text) addFact(facts, filePath, file, prop, 'message', { text });
        }
      }
      if (/\.(?:required|min)$/u.test(call) && (call.endsWith('.required') || numeric(node.arguments[0]) === 1)) {
        let parent = node.parent;
        while (parent && !ts.isPropertyAssignment(parent) && !ts.isSourceFile(parent)) parent = parent.parent;
        if (parent && ts.isPropertyAssignment(parent)) {
          const name = parent.name.getText(file).replace(/^['"]|['"]$/gu, '');
          if (/^[A-Za-z][A-Za-z0-9_]{0,50}$/u.test(name))
            addFact(facts, filePath, file, node, 'field', { name, required: true, type: 'schema' });
        }
      }
    }
    if (ts.isBinaryExpression(node) && /(?:file|arquivo)\.size\b/iu.test(node.left.getText(file))
      && [ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(node.operatorToken.kind)) {
      const maxBytes = numeric(node.right);
      if (Number.isSafeInteger(maxBytes) && maxBytes > 0) addFact(facts, filePath, file, node, 'uploadLimit', { maxBytes });
    }
    if (ts.isIfStatement(node)) {
      const names = [...new Set(node.expression.getText(file).match(/\b(?:isAdmin|hasAccess|can[A-Z]\w*|\w*Permission|\w*Profile|\w*Role)\b/gu) ?? [])];
      for (const name of names) addFact(facts, filePath, file, node.expression, 'guard', { name });
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'required') {
      const message = literal(node.initializer);
      if (message) addFact(facts, filePath, file, node, 'validation', { text: message });
    }
    if (ts.isObjectLiteralExpression(node)) {
      const label = node.properties.find((prop) => ts.isPropertyAssignment(prop) && prop.name.getText(file) === 'label');
      const key = node.properties.find((prop) => ts.isPropertyAssignment(prop) && prop.name.getText(file) === 'key');
      const required = node.properties.find((prop) => ts.isPropertyAssignment(prop) && prop.name.getText(file) === 'required');
      if (label && key && ts.isPropertyAssignment(label) && ts.isPropertyAssignment(key)
        && literal(label.initializer) && literal(key.initializer) && required && ts.isPropertyAssignment(required)) {
        addFact(facts, filePath, file, label, 'column', { name: literal(key.initializer), text: literal(label.initializer),
          required: required.initializer.kind === ts.SyntaxKind.TrueKeyword });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { file, imports, clean, translationKeys };
}

function resolveImport(from, specifier, paths) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
  const base = specifier.startsWith('@/') ? `src/${specifier.slice(2)}` : posix.normalize(posix.join(posix.dirname(from), specifier));
  if (!base.startsWith('src/') || base.split('/').includes('..')) return null;
  return [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((path) => paths.has(path)) ?? null;
}

export async function extractScreenFacts({ route, topic, module, paths, readSource, sha }) {
  if (route && !/^\/[A-Za-z0-9/:_-]+$/u.test(route)) return { files: [], facts: [], code: [], pending: [] };
  if (!paths.includes(FRONT_ROUTER)) return { files: [], facts: [], code: [], pending: [] };
  const allowed = new Set(paths.filter((path) => path.startsWith('src/') && /\.tsx?$/u.test(path)));
  const facts = [], files = [], code = [], pending = [];
  let total = 0;
  const queue = [[FRONT_ROUTER, 0, null]];
  const seen = new Set();
  const translationKeys = new Set();
  while (queue.length && files.length < MAX_FILES) {
    const [path, depth, used] = queue.shift();
    if (seen.has(path) || !allowed.has(path)) continue;
    seen.add(path);
    const source = await readSource(path);
    total += source.length;
    if (total > MAX_CHARS) { pending.push('limite de caracteres dos fatos da tela'); break; }
    const localFacts = [];
    const parsed = collect(path, source, localFacts);
    for (const key of parsed.translationKeys) translationKeys.add(key);
    files.push(path);
    code.push({ path, excerpt: source });
    if (depth === 0) {
      const objects = parsed.file.statements.flatMap((statement) => {
        const found = [];
        const walk = (node) => { if (ts.isObjectLiteralExpression(node)) found.push(node); ts.forEachChild(node, walk); };
        walk(statement); return found;
      });
      const wanted = normalized(module || topic);
      const entry = objects.find((node) => {
        const path = node.properties.find((prop) => ts.isPropertyAssignment(prop) && prop.name.getText(parsed.file) === 'path');
        const title = node.properties.find((prop) => ts.isPropertyAssignment(prop) && prop.name.getText(parsed.file) === 'title');
        return route ? literal(path?.initializer) === route : wanted.length >= 4
          && normalized(literal(title?.initializer)).includes(wanted);
      });
      if (!entry) break;
      route = literal(entry.properties.find((prop) => ts.isPropertyAssignment(prop)
        && prop.name.getText(parsed.file) === 'path')?.initializer);
      const title = entry.properties.find((prop) => ts.isPropertyAssignment(prop) && prop.name.getText(parsed.file) === 'title');
      if (title && ts.isPropertyAssignment(title) && literal(title.initializer))
        addFact(facts, path, parsed.file, title, 'route', { text: literal(title.initializer), route });
      const element = entry.properties.find((prop) => ts.isPropertyAssignment(prop) && prop.name.getText(parsed.file) === 'element')?.initializer;
      const component = element?.getText(parsed.file).match(/<([A-Z][A-Za-z0-9]*)\b/u)?.[1];
      const routeImport = [...parsed.imports].find(([, names]) => names.includes(component));
      const next = routeImport && resolveImport(path, routeImport[0], allowed);
      if (next) queue.push([next, 1, component]);
      continue;
    }
    facts.push(...localFacts);
    if (depth >= 3) continue;
    const usage = parsed.clean.split('');
    for (const statement of parsed.file.statements) if (ts.isImportDeclaration(statement)) {
      for (let i = statement.getStart(parsed.file); i < statement.getEnd(); i++) usage[i] = ' ';
    }
    const content = usage.join('');
    for (const [specifier, names] of parsed.imports) {
      if (!names.some((name) => new RegExp(`(?:<\\s*${name}\\b|(?<![\\w.])${name}\\s*\\(|\\b(?:component\\s*=\\s*\\{\\s*|element\\s*:\\s*)${name}\\b)`, 'u').test(content))) continue;
      const target = resolveImport(path, specifier, allowed);
      if (target) queue.push([target, depth + 1, null]);
    }
  }
  if (translationKeys.size && allowed.has('src/translate/pt.ts') && files.length < MAX_FILES) {
    const path = 'src/translate/pt.ts';
    const source = await readSource(path);
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isPropertyAssignment(node) && translationKeys.has(node.name.getText(file).replace(/^['"]|['"]$/gu, ''))) {
        const text = literal(node.initializer);
        if (text) addFact(facts, path, file, node, 'text', { text, property: 'translate' });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    files.push(path);
    code.push({ path, excerpt: source });
  }
  if (queue.length) pending.push(`limite de arquivos dos fatos da tela: ${MAX_FILES}`);
  return { route, sha, files, facts: [...new Map(facts.map((fact) => [JSON.stringify(fact), fact])).values()], code, pending };
}

// The same closed vocabulary drives both question classification and label matching.
const SYNONYMS = [
  ['excluir', 'remover', 'apagar'], ['adicionar', 'cadastrar', 'criar'], ['importar', 'importacao'],
  ['exportar', 'exportacao'], ['editar', 'alterar', 'edicao'], ['buscar', 'pesquisar', 'busca', 'pesquisa'],
  ['agendar', 'agendamento'], ['filtrar', 'filtro', 'filtros'],
  ['carteirizar', 'responsavel', 'proprietario'],
  ['contato', 'contact', 'contacts'],
];
const ACTION_GROUPS = SYNONYMS.slice(0, 8);
function words(value) { return normalized(value).match(/[a-z0-9]+/gu) ?? []; }
function groupsIn(value, groups = SYNONYMS) {
  const tokens = new Set(words(value));
  return groups.filter((group) => group.some((word) => tokens.has(word)));
}
function sameGroup(left, right, groups = SYNONYMS) {
  return groupsIn(left, groups).some((group) => groupsIn(right, groups).includes(group));
}
function visibleNameFact(fact) {
  return ['text', 'field', 'action', 'column'].includes(fact.kind) && Boolean(fact.text);
}
function matchesSubject(subject, value) {
  if (!subject) return true;
  const tokens = new Set(words(value));
  const group = groupsIn(subject).find((entry) => entry.includes(subject));
  return (group ?? [subject]).some((term) => tokens.has(term));
}

export function discardAnsweredScreenQuestions(questions, facts) {
  const kept = [], discarded = [];
  for (const question of questions ?? []) {
    const q = normalized(question);
    const pool = facts ?? [];
    let candidates = [];
    // Only a single, closed question can be answered by one category of screen facts.
    if ((q.match(/\?/gu) ?? []).length <= 1) {
      if (/\bcampos?\b/u.test(q) && /\bobrigatori[oa]s?\b/u.test(q)
        && /\b(?:cadastro|formulario|form|criar|cadastrar)\b/u.test(q)) {
        const subject = q.match(/\b(?:cadastro|formulario)\s+d[eo]s?\s+([a-z]+)/u)?.[1];
        candidates = pool.filter((fact) => fact.kind === 'field' && fact.required === true
          && matchesSubject(subject, `${fact.source} ${fact.text ?? ''}`));
      } else if (/\b(?:formatos?|extensoes?)\b/u.test(q) && /\b(?:arquivos?|importacao|importar|upload)\b/u.test(q)
        && !/\b(?:telefone|tamanho|limite|prazo|colunas|mapeamento|duplicatas|validacao|correcao|como)\b/u.test(q)) {
        candidates = pool.filter((fact) => fact.kind === 'upload' && fact.accept);
      } else if (/\b(?:nome|rotulo|texto)\b/u.test(q) && /\b(?:botao|opcao|menu|acao)\b/u.test(q)) {
        const verbGroups = groupsIn(q, ACTION_GROUPS);
        const verb = verbGroups[0]?.find((word) => words(q).includes(word));
        const subject = verb && q.match(new RegExp(`\\b${verb}\\s+([a-z]+)`, 'u'))?.[1];
        if (verbGroups.length === 1) candidates = pool.filter((fact) => fact.kind === 'action'
          && sameGroup(q, fact.text, ACTION_GROUPS) && matchesSubject(subject, fact.text));
      } else if (/\b(?:nome|rotulo|chamado|interface|campo|conceito|visiveis?)\b/u.test(q)) {
        const quoted = [...question.matchAll(/[“"']([^”"']+)[”"']/gu)].map((match) => match[1]);
        const terms = quoted.length ? quoted : groupsIn(q).map((group) => group[0]);
        if (terms.length) {
          const matched = terms.map((term) => pool.find((fact) => visibleNameFact(fact)
            && (words(fact.text).join(' ').includes(words(term).join(' ')) || sameGroup(term, fact.text))));
          if (matched.every(Boolean)) candidates = matched;
        }
      }
    }
    if (candidates.length) discarded.push({ question, source: candidates[0].source, fact: candidates[0].text ?? candidates[0].accept });
    else kept.push(question);
  }
  return { questions: kept, discarded };
}
