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
function jsxBody(children, file) {
  return children.map((child) => {
    if (ts.isJsxText(child)) return child.getText(file);
    if (ts.isJsxExpression(child)) return '…';
    if (ts.isJsxElement(child)) return jsxBody(child.children, file);
    return '';
  }).join('').replace(/\s+/gu, ' ').trim();
}
function validActionLabel(value) {
  const text = safeText(value);
  return text && !/[('"“‘]\s*$/u.test(text) ? text : null;
}
function safeText(value) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!text || text.length > 200 || !/[\p{L}\p{N}]/u.test(text)
    || containsSensitiveData(text, { detectOpaque: true })
    || sanitizeCodeForModel(JSON.stringify(text.replaceAll('…', '1'))).literalsOmitted) return null;
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
function declarations(file) {
  const found = new Map();
  let defaultExport = null;
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      if (statement.name) found.set(statement.name.text, statement);
      if (statement.modifiers?.some((item) => item.kind === ts.SyntaxKind.DefaultKeyword)) defaultExport = statement;
    } else if (ts.isVariableStatement(statement)) {
      for (const item of statement.declarationList.declarations) if (ts.isIdentifier(item.name)) found.set(item.name.text, item);
    } else if (ts.isExportAssignment(statement)) {
      defaultExport = ts.isIdentifier(statement.expression) ? statement.expression.text : statement.expression;
    }
  }
  return { found, defaultExport };
}
function splitName(value) { return String(value ?? '').replace(/([a-z])([A-Z])/gu, '$1 $2').replace(/[\\/_-]/gu, ' '); }
function subjectOf(owner, title, path) {
  const own = words(splitName(owner));
  const location = words(splitName(path));
  const visible = words(title);
  const action = [...own, ...location, ...visible].find((word) => ['importar', 'importacao', 'cadastro', 'cadastrar', 'criar'].some((term) => sameGroup(word, term))) ?? '';
  const nouns = ['contato', 'empresa', 'usuario', 'departamento', 'atendimento', 'campanha'];
  const noun = nouns.find((term) => own.some((word) => sameGroup(word, term)))
    ?? nouns.find((term) => visible.some((word) => sameGroup(word, term)))
    ?? nouns.find((term) => location.some((word) => sameGroup(word, term))) ?? '';
  return [action && (sameGroup(action, 'importacao') ? 'importacao' : 'cadastro'), noun].filter(Boolean).join(' ');
}
function ownerTitle(node, file) {
  let title = null;
  const scan = (child) => {
    if (title) return;
    if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
      title = attrValue(child, 'title') ?? null;
    }
    if (ts.isJsxElement(child) && /^(?:h[1-6]|DialogTitle|ModalTitle)$/u.test(jsxName(child.openingElement)))
      title = safeText(jsxBody(child.children, file)) ?? title;
    ts.forEachChild(child, scan);
  };
  scan(node);
  return title;
}
function collect(filePath, source, facts, entryName) {
  const clean = neutralizeTypescript(source);
  const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = new Map();
  const translationKeys = new Map();
  const usedImports = new Set();
  for (const statement of file.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
    const names = [];
    if (statement.importClause?.name) names.push(statement.importClause.name.text);
    for (const item of statement.importClause?.namedBindings?.elements ?? []) names.push(item.name.text);
    imports.set(statement.moduleSpecifier.text, names);
  }
  const { found, defaultExport } = declarations(file);
  const aliases = new Map();
  function registerLocals(body) {
    const scan = (node) => {
      if (ts.isFunctionDeclaration(node)) {
        if (node.name) found.set(node.name.text, node);
        return;
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        found.set(node.name.text, node);
        if (node.initializer && ts.isIdentifier(node.initializer)) aliases.set(node.name.text, node.initializer.text);
        return;
      }
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return;
      ts.forEachChild(node, scan);
    };
    scan(body);
  }
  registerLocals(file);
  const root = entryName && (found.get(entryName) ?? (typeof defaultExport === 'string' ? found.get(defaultExport) : defaultExport));
  const visited = new Set();
  let owner = null, title = null;
  const reachable = [];
  const emit = (node, kind, values) => addFact(facts, filePath, file, node, kind,
    { ...values, owner, ...(title ? { ownerTitle: title } : {}), subject: subjectOf(owner, title, filePath) });
  if (root) reachable.push([root, ts.isFunctionDeclaration(root) ? root.name?.text ?? entryName :
    ts.isVariableDeclaration(root) ? root.name.getText(file) : entryName]);
  const renderProps = new Set(['component', 'element', 'render', 'Component', 'as']);
  function render(name) {
    const seen = new Set();
    while (aliases.has(name) && !seen.has(name)) {
      seen.add(name);
      name = aliases.get(name);
    }
    for (const [specifier, names] of imports) if (names.includes(name)) usedImports.add(specifier);
    if (found.has(name)) reachable.push([found.get(name), name]);
  }
  function jsxValue(node) {
    if (!node) return false;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
    if (ts.isParenthesizedExpression(node)) return jsxValue(node.expression);
    if (ts.isConditionalExpression(node)) return jsxValue(node.whenTrue) || jsxValue(node.whenFalse);
    if (ts.isBinaryExpression(node)) return jsxValue(node.right);
    return false;
  }
  function returnedTrees(node) {
    const value = ts.isVariableDeclaration(node) ? node.initializer : node;
    const body = (ts.isFunctionDeclaration(value) || ts.isFunctionExpression(value) || ts.isArrowFunction(value))
      ? value.body : value;
    if (!body) return [];
    if (!ts.isBlock(body)) return [body];
    registerLocals(body);
    const trees = [];
    const scan = (child) => {
      if (ts.isFunctionDeclaration(child) || ts.isFunctionExpression(child) || ts.isArrowFunction(child)) return;
      if (ts.isReturnStatement(child)) {
        if (child.expression) trees.push(child.expression);
        return;
      }
      ts.forEachChild(child, scan);
    };
    scan(body);
    return trees;
  }
  function renderExpression(node) {
    if (!node) return;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) render(node.expression.text);
    if (ts.isPropertyAssignment(node) && renderProps.has(node.name.getText(file))
      && ts.isIdentifier(node.initializer)) render(node.initializer.text);
    ts.forEachChild(node, renderExpression);
  }
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) render(jsxName(node).split('.')[0]);
    if (ts.isJsxExpression(node)) renderExpression(node.expression);
    if (ts.isJsxExpression(node) && ts.isIdentifier(node.expression)) {
      const local = found.get(node.expression.text);
      if (local && ts.isVariableDeclaration(local) && jsxValue(local.initializer)) render(node.expression.text);
    }
    if (ts.isJsxAttribute(node) && renderProps.has(node.name.text) && ts.isJsxExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)) render(node.initializer.expression.text);
    if (ts.isJsxText(node)) {
      const value = safeText(node.getText(file));
      if (value) emit(node, 'text', { text: value });
    }
    if (ts.isJsxExpression(node) && node.expression && ts.isConditionalExpression(node.expression)) {
      for (const branch of [node.expression.whenTrue, node.expression.whenFalse]) {
        const value = literal(branch);
        if (value) emit(branch, 'state', { text: value });
      }
    }
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = jsxName(node);
      for (const name of VISIBLE) {
        const value = attrValue(node, name);
        if (value) emit(attr(node, name), 'text', { text: value, property: name });
      }
      const handler = attr(node, 'onClick')?.initializer;
      if (ACTION.test(tag) || /^button$/iu.test(tag)) {
        const children = ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent.children : [];
        const body = validActionLabel(jsxBody(children, file));
        const ariaLabel = validActionLabel(attrValue(node, 'aria-label'));
        const title = validActionLabel(attrValue(node, 'title'));
        const text = ariaLabel ?? body ?? validActionLabel(attrValue(node, 'labelText'))
          ?? validActionLabel(attrValue(node, 'label')) ?? title;
        const expression = handler && ts.isJsxExpression(handler) ? handler.expression : null;
        const handlerName = expression && ts.isIdentifier(expression) ? expression.text
          : expression && ts.isArrowFunction(expression) ? expression.body.getText(file).match(/\b([A-Za-z]\w*)\s*\(/u)?.[1] : null;
        if (text && handlerName) emit(node, 'action', { text, handler: handlerName,
          ...(body ? { body } : {}), ...(ariaLabel ? { ariaLabel } : {}), ...(title ? { title } : {}) });
      }
      const accept = attrValue(node, 'accept');
      if (accept) emit(attr(node, 'accept'), 'upload', { accept });
      const fieldName = attrValue(node, 'name');
      if (FIELD.test(tag) && fieldName) {
        const required = Boolean(attr(node, 'required')) || /\brequired\s*:/u.test(node.getText(file));
        emit(node, 'field', { name: fieldName,
          ...(attrValue(node, 'label') ? { text: attrValue(node, 'label') } : {}), required,
          type: attrValue(node, 'type') ?? 'text' });
      }
    }
    if (ts.isCallExpression(node) && clean.slice(node.expression.getStart(file), node.expression.getEnd()).trim()) {
      const call = node.expression.getText(file);
      if (/^(?:translate|t)$/u.test(call) && literal(node.arguments[0]))
        translationKeys.set(literal(node.arguments[0]), { owner, ...(title ? { ownerTitle: title } : {}), subject: subjectOf(owner, title, filePath) });
      if (/^(?:toast(?:\.[A-Za-z]+)?|confirm|window\.confirm)$/u.test(call)) {
        const text = literal(node.arguments[0]);
        if (text) emit(node, 'message', { text });
      }
      if (/^(?:addNotification|notify)$/u.test(call) && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        for (const prop of node.arguments[0].properties) if (ts.isPropertyAssignment(prop)
          && ['title', 'description'].includes(prop.name.getText(file))) {
          const text = literal(prop.initializer);
          if (text) emit(prop, 'message', { text });
        }
      }
      if (/\.(?:required|min)$/u.test(call) && (call.endsWith('.required') || numeric(node.arguments[0]) === 1)) {
        let parent = node.parent;
        while (parent && !ts.isPropertyAssignment(parent) && !ts.isSourceFile(parent)) parent = parent.parent;
        if (parent && ts.isPropertyAssignment(parent)) {
          const name = parent.name.getText(file).replace(/^['"]|['"]$/gu, '');
          if (/^[A-Za-z][A-Za-z0-9_]{0,50}$/u.test(name))
            emit(node, 'field', { name, required: true, type: 'schema' });
        }
      }
    }
    if (ts.isBinaryExpression(node) && /(?:file|arquivo)\.size\b/iu.test(node.left.getText(file))
      && [ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(node.operatorToken.kind)) {
      const maxBytes = numeric(node.right);
      if (Number.isSafeInteger(maxBytes) && maxBytes > 0) emit(node, 'uploadLimit', { maxBytes });
    }
    if (ts.isIfStatement(node)) {
      const names = [...new Set(node.expression.getText(file).match(/\b(?:isAdmin|hasAccess|can[A-Z]\w*|\w*Permission|\w*Profile|\w*Role)\b/gu) ?? [])];
      for (const name of names) emit(node.expression, 'guard', { name });
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'required') {
      const message = literal(node.initializer);
      if (message) emit(node, 'validation', { text: message });
    }
    if (ts.isObjectLiteralExpression(node)) {
      const label = node.properties.find((prop) => ts.isPropertyAssignment(prop) && prop.name.getText(file) === 'label');
      const key = node.properties.find((prop) => ts.isPropertyAssignment(prop) && prop.name.getText(file) === 'key');
      const required = node.properties.find((prop) => ts.isPropertyAssignment(prop) && prop.name.getText(file) === 'required');
      if (label && key && ts.isPropertyAssignment(label) && ts.isPropertyAssignment(key)
        && literal(label.initializer) && literal(key.initializer) && required && ts.isPropertyAssignment(required)) {
        emit(label, 'column', { name: literal(key.initializer), text: literal(label.initializer),
          required: required.initializer.kind === ts.SyntaxKind.TrueKeyword });
      }
    }
    ts.forEachChild(node, visit);
  }
  while (reachable.length) {
    const [node, name] = reachable.shift();
    if (visited.has(node)) continue;
    visited.add(node);
    owner = name;
    const trees = returnedTrees(node);
    title = trees.map((tree) => ownerTitle(tree, file)).find(Boolean) ?? null;
    for (const tree of trees) visit(tree);
  }
  return { file, imports, usedImports, clean, translationKeys };
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
  const translationKeys = new Map();
  while (queue.length && files.length < MAX_FILES) {
    const [path, depth, used] = queue.shift();
    if (seen.has(path) || !allowed.has(path)) continue;
    seen.add(path);
    const source = await readSource(path);
    total += source.length;
    if (total > MAX_CHARS) { pending.push('limite de caracteres dos fatos da tela'); break; }
    const localFacts = [];
    const parsed = collect(path, source, localFacts, used);
    for (const [key, meta] of parsed.translationKeys) translationKeys.set(key, meta);
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
      const element = entry.properties.find((prop) => ts.isPropertyAssignment(prop) && prop.name.getText(parsed.file) === 'element')?.initializer;
      const component = element?.getText(parsed.file).match(/<([A-Z][A-Za-z0-9]*)\b/u)?.[1];
      if (title && ts.isPropertyAssignment(title) && literal(title.initializer))
        addFact(facts, path, parsed.file, title, 'route', { text: literal(title.initializer), route,
          owner: component, subject: subjectOf(component, literal(title.initializer), path) });
      const routeImport = [...parsed.imports].find(([, names]) => names.includes(component));
      const next = routeImport && resolveImport(path, routeImport[0], allowed);
      if (next) queue.push([next, 1, component]);
      continue;
    }
    facts.push(...localFacts);
    if (depth >= 3) continue;
    for (const [specifier, names] of parsed.imports) {
      if (!names.length || !parsed.usedImports.has(specifier)) continue;
      const target = resolveImport(path, specifier, allowed);
      if (target) queue.push([target, depth + 1, names[0]]);
    }
  }
  if (translationKeys.size && allowed.has('src/translate/pt.ts') && files.length < MAX_FILES) {
    const path = 'src/translate/pt.ts';
    const source = await readSource(path);
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node) => {
      const meta = ts.isPropertyAssignment(node)
        ? translationKeys.get(node.name.getText(file).replace(/^['"]|['"]$/gu, '')) : null;
      if (meta) {
        const text = literal(node.initializer);
        if (text) addFact(facts, path, file, node, 'text', { text, property: 'translate', ...meta });
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

// Closed vocabulary used to assign a subject to screen facts.
const SYNONYMS = [
  ['excluir', 'remover', 'apagar'], ['adicionar', 'cadastrar', 'criar', 'create'], ['importar', 'importacao', 'import'],
  ['exportar', 'exportacao'], ['editar', 'alterar', 'edicao'], ['buscar', 'pesquisar', 'busca', 'pesquisa'],
  ['agendar', 'agendamento'], ['filtrar', 'filtro', 'filtros'],
  ['carteirizar', 'responsavel', 'proprietario'],
  ['contato', 'contact', 'contacts'],
  ['empresa', 'company', 'companies'], ['usuario', 'user'], ['departamento', 'department'],
  ['atendimento', 'attendance'], ['campanha', 'campaign'],
];
function canonicalWord(value) {
  const word = String(value ?? '').toLowerCase();
  const singular = word.endsWith('ões') || word.endsWith('ães') ? `${word.slice(0, -3)}ão`
    : word.endsWith('ais') ? `${word.slice(0, -3)}al`
    : word.endsWith('éis') || word.endsWith('eis') ? `${word.slice(0, -3)}el`
    : /(?:res|zes|ses)$/u.test(word) ? word.slice(0, -2)
    : word.endsWith('s') ? word.slice(0, -1) : word;
  return normalized(singular);
}
function words(value) { return (String(value ?? '').toLowerCase().match(/[\p{L}0-9]+/gu) ?? []).map(canonicalWord); }
function groupsIn(value, groups = SYNONYMS) {
  const tokens = new Set(words(value));
  return groups.filter((group) => group.some((word) => words(word).some((token) => tokens.has(token))));
}
function sameGroup(left, right, groups = SYNONYMS) {
  return groupsIn(left, groups).some((group) => groupsIn(right, groups).includes(group));
}
