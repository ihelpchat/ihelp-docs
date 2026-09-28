import ts from 'typescript';
import { posix } from 'node:path';
import { containsSensitiveData } from './sensitive-data.mjs';
import { sanitizeCodeForModel } from './code-hygiene.mjs';

export const FRONT_ROUTER = 'src/components/core/components/Router/utils/pagesData.tsx';
const MAX_FILES = 72;
const MAX_CHARS = 1_000_000;
const VISIBLE = new Set(['label', 'labelText', 'title', 'placeholder', 'aria-label', 'tooltip']);
const ACTION = /^(?:button|a|IconButton|MenuItem|MenuButton|Button|ButtonWithIcon|ButtonIconAction)$/iu;
// Wrappers observed in the read-only front (ITooltip and MiniTooltip are content/types, not wrappers).
const TOOLTIP_WRAPPERS = new Set(['CustomTooltip', 'Tooltip', 'WrapperTooltip']);
const FIELD = /^(?:input|select|textarea|Input\w*|Select\w*|MultiSelectSystem|Controller)$/u;
// Only upload components with an explicit byte-sized maxSize contract.
const UPLOAD_MAX_SIZE = new Set(['Dropzone', 'ReactDropzone', 'FileUpload', 'Upload', 'UploadFile']);
// Call shapes confirmed in the read-only front: addNotification({title, description});
// the remaining entries cover the standard feedback APIs accepted by the screen contract.
const FEEDBACK_CALLS = [
  [/^(?:toast|notification|message)(?:\.[A-Za-z]+)?$/u, 'argument'],
  [/^(?:enqueueSnackbar|alert|confirm|window\.confirm|show\w*Toast|notify\w*)$/u, 'argument'],
  [/^addNotification$/u, 'object'],
];
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
function tooltipLabel(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!ts.isJsxElement(parent) || !TOOLTIP_WRAPPERS.has(jsxName(parent.openingElement))) continue;
    const wrapper = parent.openingElement;
    for (const name of ['title', 'content', 'label']) {
      const value = attrValue(wrapper, name);
      if (validActionLabel(value)) return validActionLabel(value);
      const expression = attr(wrapper, name)?.initializer?.expression;
      if (expression && ts.isConditionalExpression(expression)) {
        const fallback = validActionLabel(literal(expression.whenFalse)) ?? validActionLabel(literal(expression.whenTrue));
        if (fallback) return fallback;
      }
    }
  }
  return null;
}
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
function schemaFields(schema, file, path) {
  const zod = schema && ts.isCallExpression(schema) && /^z\.(?:object|objectOf)$/u.test(schema.expression.getText(file));
  if (schema && ts.isCallExpression(schema) && /^(?:yup|z)\.(?:object|objectOf)$/u.test(schema.expression.getText(file)))
    schema = schema.arguments[0];
  if (!schema || !ts.isObjectLiteralExpression(schema)) return new Map();
  const rules = new Map();
  for (const property of schema.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const field = property.name.getText(file).replace(/^['"]|['"]$/gu, '');
    if (!/^[\w.]{1,80}$/u.test(field)) continue;
    const rule = { required: 'unknown', source: `${path}:${lineOf(file, property)}` };
    let expression = property.initializer;
    let presenceSeen = false;
    while (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
      const method = expression.expression.name.text;
      if (!presenceSeen && ['optional', 'nullable', 'notRequired', 'nullish'].includes(method)) {
        rule.required = false;
        presenceSeen = true;
      }
      if (!presenceSeen && (['required', 'nonNullable', 'defined'].includes(method)
        || (method === 'min' && numeric(expression.arguments[0]) === 1))) {
        rule.required = true;
        rule.message = literal(expression.arguments[method === 'min' ? 1 : 0]) ?? rule.message;
        presenceSeen = true;
      }
      if (['min', 'max', 'email', 'matches'].includes(method))
        rule[method] = method === 'email' ? true : numeric(expression.arguments[0]) ?? literal(expression.arguments[0]) ?? true;
      expression = expression.expression.expression;
    }
    if (zod && !presenceSeen) rule.required = true;
    rules.set(field, rule);
  }
  return rules;
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
    if (ts.isArrowFunction(child) || ts.isFunctionExpression(child) || ts.isFunctionDeclaration(child)
      || ts.isMethodDeclaration(child)) return;
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
  const linkedImports = new Map();
  const columnImports = new Map();
  for (const statement of file.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
    const names = [];
    if (statement.importClause?.name) names.push({ local: statement.importClause.name.text, exported: null });
    for (const item of statement.importClause?.namedBindings?.elements ?? [])
      names.push({ local: item.name.text, exported: item.propertyName?.text ?? item.name.text });
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
  let forms = [];
  let controllerFields = new Map();
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
    for (const [specifier, names] of imports) for (const binding of names)
      if (binding.local === name) usedImports.add(`${specifier}\0${binding.local}`);
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
  function renderedMapChildren(node) {
    const scan = (child) => {
      if (!child) return;
      if (ts.isArrowFunction(child) || ts.isFunctionExpression(child)) return;
      if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)
        && child.expression.name.text === 'map') {
        for (const argument of child.arguments) {
          if (!ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument)) continue;
          for (const tree of returnedTrees(argument)) if (jsxValue(tree)) visit(tree);
        }
      }
      ts.forEachChild(child, scan);
    };
    scan(node);
  }
  function handlerNameOf(expression) {
    if (ts.isIdentifier(expression)) return expression.text;
    if (!ts.isArrowFunction(expression)) return null;
    let body = expression.body;
    if (ts.isBlock(body)) {
      if (body.statements.length !== 1 || !ts.isExpressionStatement(body.statements[0])) return '(inline)';
      body = body.statements[0].expression;
    }
    while (ts.isParenthesizedExpression(body)) body = body.expression;
    if (ts.isCallExpression(body) && ts.isIdentifier(body.expression)) {
      const name = body.expression.text;
      const declaration = found.get(name);
      if (declaration && (ts.isFunctionDeclaration(declaration)
        || (ts.isVariableDeclaration(declaration) && (ts.isArrowFunction(declaration.initializer)
          || ts.isFunctionExpression(declaration.initializer)
          || (ts.isCallExpression(declaration.initializer)
            && declaration.initializer.expression.getText(file) === 'useCallback'))))) return name;
    }
    return '(inline)';
  }
  function rulesFor(node) {
    const component = ts.isVariableDeclaration(node) ? node.initializer : node;
    const body = component?.body;
    if (!body) return [];
    const formList = [];
    controllerFields = new Map();
    const controllers = [];
    const schemaOf = (call) => {
      const options = call.arguments[0];
      if (!options || !ts.isObjectLiteralExpression(options)) return null;
      const property = options.properties.find((item) => ts.isPropertyAssignment(item)
        && ['resolver', 'validationSchema'].includes(item.name.getText(file)));
      if (!property) return null;
      let value = property.initializer;
      if (ts.isCallExpression(value) && /^(?:yupResolver|zodResolver)$/u.test(value.expression.getText(file))) value = value.arguments[0];
      return ts.isIdentifier(value) ? value.text : null;
    };
    const inspect = (child) => {
      if (child !== body && (ts.isArrowFunction(child) || ts.isFunctionExpression(child)
        || ts.isFunctionDeclaration(child))) return;
      if (ts.isCallExpression(child) && /^(?:useForm|useFormik)$/u.test(child.expression.getText(file))) {
        const schema = schemaOf(child);
        if (schema) {
          const form = { schema, registers: new Set(), controls: new Set() };
          const declaration = child.parent;
          if (ts.isVariableDeclaration(declaration)) {
            if (ts.isIdentifier(declaration.name)) {
              form.registers.add(`${declaration.name.text}.register`);
              form.controls.add(`${declaration.name.text}.control`);
            } else if (ts.isObjectBindingPattern(declaration.name)) for (const element of declaration.name.elements) {
              const property = element.propertyName?.getText(file) ?? element.name.getText(file);
              if (property === 'register') form.registers.add(element.name.getText(file));
              if (property === 'control') form.controls.add(element.name.getText(file));
            }
          }
          formList.push(form);
        }
      }
      if (ts.isCallExpression(child) && child.expression.getText(file) === 'useController'
        && ts.isVariableDeclaration(child.parent)) controllers.push(child.parent);
      ts.forEachChild(child, inspect);
    };
    inspect(body);
    for (const declaration of controllers) {
      const options = declaration.initializer.arguments[0];
      if (!options || !ts.isObjectLiteralExpression(options)) continue;
      const property = (key) => options.properties.find((item) => ts.isPropertyAssignment(item)
        && item.name.getText(file) === key)?.initializer;
      const field = literal(property('name'));
      const control = property('control')?.getText(file);
      const matches = formList.filter((form) => form.controls.has(control));
      if (!field || matches.length !== 1) continue;
      if (ts.isIdentifier(declaration.name)) controllerFields.set(`${declaration.name.text}.field`, { name: field, schema: matches[0].schema });
      if (ts.isObjectBindingPattern(declaration.name)) for (const element of declaration.name.elements)
        if ((element.propertyName?.getText(file) ?? element.name.getText(file)) === 'field')
          controllerFields.set(element.name.getText(file), { name: field, schema: matches[0].schema });
    }
    return formList;
  }
  function schemaRule(name, field) {
    const declaration = found.get(name);
    const schema = declaration && ts.isVariableDeclaration(declaration) ? declaration.initializer : null;
    if (!schema) return null;
    return schemaFields(schema, file, filePath).get(field) ?? null;
  }
  function boundSchema(node, registerCall, controlled) {
    if (controlled) return controlled.schema;
    if (registerCall) {
      const name = registerCall.expression.getText(file);
      const matches = forms.filter((form) => form.registers.has(name));
      return matches.length === 1 ? matches[0].schema : null;
    }
    const control = attr(node, 'control')?.initializer?.expression;
    if (control) {
      const name = control.getText(file);
      const matches = forms.filter((form) => form.controls.has(name));
      return matches.length === 1 ? matches[0].schema : null;
    }
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (!ts.isJsxElement(parent) || jsxName(parent.openingElement) !== 'Formik') continue;
      const expression = attr(parent.openingElement, 'validationSchema')?.initializer?.expression;
      return expression && ts.isIdentifier(expression) ? expression.text : null;
    }
    if (forms.length !== 1) return null;
    for (let parent = node.parent; parent; parent = parent.parent)
      if (ts.isJsxElement(parent) && jsxName(parent.openingElement) === 'form') return forms[0].schema;
    return null;
  }
  function visit(node) {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)
      || ts.isMethodDeclaration(node)) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) render(jsxName(node).split('.')[0]);
    if (ts.isJsxExpression(node)) {
      renderExpression(node.expression);
      if (!ts.isJsxAttribute(node.parent)) renderedMapChildren(node.expression);
    }
    if (ts.isJsxExpression(node) && node.expression && ts.isIdentifier(node.expression)) {
      const local = found.get(node.expression.text);
      if (local && ts.isVariableDeclaration(local) && jsxValue(local.initializer)) render(node.expression.text);
    }
    if (ts.isJsxAttribute(node) && renderProps.has(node.name.text) && ts.isJsxExpression(node.initializer)
      && node.initializer.expression && ts.isIdentifier(node.initializer.expression)) render(node.initializer.expression.text);
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
      const children = ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent.children : [];
      const body = validActionLabel(jsxBody(children, file));
      const actionLabel = validActionLabel(attrValue(node, 'aria-label'))
        ?? validActionLabel(attrValue(node, 'title')) ?? body
        ?? validActionLabel(attrValue(node, 'labelText')) ?? validActionLabel(attrValue(node, 'label'))
        ?? tooltipLabel(node);
      if (actionLabel || attrValue(node, 'type') === 'file') for (const property of node.attributes.properties) {
        if (!ts.isJsxAttribute(property) || !/^on[A-Z]/u.test(property.name.text)
          || !ts.isJsxExpression(property.initializer)) continue;
        walkHandler(property.initializer.expression, actionLabel ?? tag, 0, new Set());
      }
      if (ACTION.test(tag) || attrValue(node, 'role') === 'button' || handler) {
        const ariaLabel = validActionLabel(attrValue(node, 'aria-label'));
        const title = validActionLabel(attrValue(node, 'title'));
        const text = ariaLabel ?? title ?? body ?? validActionLabel(attrValue(node, 'labelText'))
          ?? validActionLabel(attrValue(node, 'label')) ?? tooltipLabel(node);
        const expression = handler && ts.isJsxExpression(handler) ? handler.expression : null;
        const handlerName = expression ? handlerNameOf(expression) : null;
        if (text && handlerName) emit(node, 'action', { text, handler: handlerName,
          ...(body ? { body } : {}), ...(ariaLabel ? { ariaLabel } : {}), ...(title ? { title } : {}) });
      }
      const accept = attrValue(node, 'accept');
      if (accept) emit(attr(node, 'accept'), 'upload', { accept });
      const maxSize = UPLOAD_MAX_SIZE.has(tag) ? numeric(attr(node, 'maxSize')?.initializer?.expression) : null;
      if (Number.isSafeInteger(maxSize) && maxSize > 0)
        addFact(facts, filePath, file, attr(node, 'maxSize'), 'uploadLimit',
          { maxBytes: maxSize, owner: tag, subject: subjectOf(owner, title, filePath) });
      const register = attr(node, 'register')?.initializer?.expression
        ?? node.attributes.properties.find((item) => ts.isJsxSpreadAttribute(item)
          && ts.isCallExpression(item.expression))?.expression;
      const controlled = node.attributes.properties.filter(ts.isJsxSpreadAttribute)
        .map((item) => controllerFields.get(item.expression.getText(file))).find(Boolean);
      const fieldName = attrValue(node, 'name') ?? (register && ts.isCallExpression(register) ? literal(register.arguments[0]) : null)
        ?? controlled?.name;
      if (FIELD.test(tag) && fieldName) {
        const requiredAttr = attr(node, 'required');
        const explicitFalse = requiredAttr?.initializer && ts.isJsxExpression(requiredAttr.initializer)
          && requiredAttr.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword;
        const schema = boundSchema(node, register && ts.isCallExpression(register) ? register : null, controlled);
        const rule = schema ? schemaRule(schema, fieldName) : null;
        const controllerRules = tag === 'Controller' ? attr(node, 'rules')?.initializer?.expression : null;
        const controllerRequired = controllerRules && ts.isObjectLiteralExpression(controllerRules)
          ? controllerRules.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText(file) === 'required') : null;
        const explicitTrue = requiredAttr && (!requiredAttr.initializer
          || (ts.isJsxExpression(requiredAttr.initializer)
            && requiredAttr.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword));
        const required = explicitFalse ? false : explicitTrue ? true
          : controllerRequired ? (controllerRequired.initializer.kind === ts.SyntaxKind.FalseKeyword ? false : true)
          : rule?.required ?? 'unknown';
        const values = { name: fieldName,
          ...(attrValue(node, 'label') ? { text: attrValue(node, 'label') } : {}), required,
          ...(controllerRequired && literal(controllerRequired.initializer) ? { message: literal(controllerRequired.initializer) } : {}),
          ...(rule?.message ? { message: rule.message } : {}),
          ...Object.fromEntries(['min', 'max', 'email', 'matches'].filter((key) => rule?.[key] !== undefined).map((key) => [key, rule[key]])),
          ...(rule ? { validationSource: rule.source } : {}),
          ...(!schema && required === 'unknown' ? { note: 'vínculo não provado' } : {}),
          type: attrValue(node, 'type') ?? 'text' };
        const previous = facts.length;
        emit(node, 'field', values);
        if (schema && !found.has(schema) && facts.length > previous) {
          if (!linkedImports.has(schema)) linkedImports.set(schema, new Set());
          linkedImports.get(schema).add(facts.at(-1));
        }
      }
    }
    if (ts.isCallExpression(node) && clean.slice(node.expression.getStart(file), node.expression.getEnd()).trim()) {
      const call = node.expression.getText(file);
      if (/^(?:translate|t)$/u.test(call) && literal(node.arguments[0]))
        translationKeys.set(literal(node.arguments[0]), { owner, ...(title ? { ownerTitle: title } : {}), subject: subjectOf(owner, title, filePath) });
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
  function walkHandler(expression, action, depth, seenHandlers, outerLocals = new Map()) {
    if (!expression) return;
    if (ts.isIdentifier(expression)) {
      const declaration = outerLocals.get(expression.text) ?? found.get(expression.text);
      if (!declaration || seenHandlers.has(declaration)) return;
      seenHandlers.add(declaration);
      const value = ts.isVariableDeclaration(declaration) ? declaration.initializer : declaration;
      const callback = value && ts.isCallExpression(value) && value.expression.getText(file) === 'useCallback'
        ? value.arguments[0] : value;
      const body = (ts.isFunctionDeclaration(callback) || ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
        ? callback.body : null;
      if (body) walkHandler(body, action, depth, seenHandlers, outerLocals);
      return;
    }
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression) || ts.isFunctionDeclaration(expression))
      expression = expression.body;
    if (!expression) return;
    const locals = new Map(outerLocals);
    const register = (node) => {
      if (ts.isFunctionDeclaration(node)) {
        if (node.name) locals.set(node.name.text, node);
        return;
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        locals.set(node.name.text, node);
        return;
      }
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return;
      ts.forEachChild(node, register);
    };
    register(expression);
    const scan = (node) => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return;
      if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return;
      if (ts.isVariableDeclaration(node) && node.initializer
        && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) return;
      if (ts.isIfStatement(node) && ts.isBinaryExpression(node.expression)
        && /^(?:\w+\.)?(?:file|files(?:\[\w+\])?)\.size$/u.test(node.expression.left.getText(file))
        && [ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(node.expression.operatorToken.kind)) {
        const maxBytes = numeric(node.expression.right);
        const hasReturn = (child) => (ts.isArrowFunction(child) || ts.isFunctionExpression(child)
          || ts.isFunctionDeclaration(child)) ? false : child.kind === ts.SyntaxKind.ReturnStatement
          || ts.forEachChild(child, hasReturn) === true;
        const hasFeedback = (child) => (ts.isArrowFunction(child) || ts.isFunctionExpression(child)
          || ts.isFunctionDeclaration(child)) ? false : ts.isCallExpression(child)
          && FEEDBACK_CALLS.some(([pattern]) => pattern.test(child.expression.getText(file)))
          || ts.forEachChild(child, hasFeedback) === true;
        if (Number.isSafeInteger(maxBytes) && maxBytes > 0
          && (hasReturn(node.thenStatement) || hasFeedback(node.thenStatement))) {
          let message;
          const findMessage = (child) => {
            if (message || ts.isArrowFunction(child) || ts.isFunctionExpression(child)) return;
            if (ts.isCallExpression(child) && FEEDBACK_CALLS.some(([pattern]) => pattern.test(child.expression.getText(file))))
              message = literal(child.arguments[0]);
            ts.forEachChild(child, findMessage);
          };
          findMessage(node.thenStatement);
          addFact(facts, filePath, file, node.expression, 'uploadLimit',
            { maxBytes, ...(message ? { message } : {}), owner: action, subject: subjectOf(owner, title, filePath) });
        }
      }
      if (ts.isCallExpression(node)) {
        const call = node.expression.getText(file);
        const feedback = FEEDBACK_CALLS.find(([pattern]) => pattern.test(call));
        if (feedback) {
          if (feedback[1] === 'object' && ts.isObjectLiteralExpression(node.arguments[0])) {
            for (const prop of node.arguments[0].properties) if (ts.isPropertyAssignment(prop)
              && ['title', 'description', 'message'].includes(prop.name.getText(file))) {
              const value = literal(prop.initializer);
              if (value) addFact(facts, filePath, file, prop, 'message',
                { text: value, owner: action, action, subject: subjectOf(owner, title, filePath) });
            }
          } else {
            const value = literal(node.arguments[0]);
            if (value) addFact(facts, filePath, file, node, 'message',
              { text: value, owner: action, action, subject: subjectOf(owner, title, filePath) });
          }
        }
        if (/^(?:navigate|history\.push)$/u.test(call)) {
          const route = literal(node.arguments[0]);
          if (route) addFact(facts, filePath, file, node, 'destination',
            { route, owner: action, action, subject: subjectOf(owner, title, filePath) });
        }
        if (call === 'handleSubmit' && depth === 0)
          for (const argument of node.arguments) if (ts.isIdentifier(argument))
            walkHandler(argument, action, depth, seenHandlers, locals);
        if (depth < 2 && ts.isIdentifier(node.expression) && !feedback)
          walkHandler(node.expression, action, depth + 1, seenHandlers, locals);
        const promiseCallback = ts.isPropertyAccessExpression(node.expression)
          && ['then', 'catch', 'finally'].includes(node.expression.name.text);
        const timerCallback = call === 'setTimeout';
        for (const argument of node.arguments) {
          if (promiseCallback || timerCallback) {
            if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument) || ts.isIdentifier(argument))
              walkHandler(argument, action, depth, seenHandlers, locals);
          }
          if (/^(?:useMutation|useQuery|mutate|mutateAsync)$/u.test(call) && ts.isObjectLiteralExpression(argument))
            for (const property of argument.properties) if (ts.isPropertyAssignment(property)
              && ['onSuccess', 'onError', 'onSettled'].includes(property.name.getText(file)))
              walkHandler(property.initializer, action, depth, seenHandlers, locals);
        }
        scan(node.expression);
        for (const argument of node.arguments) if (!ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument)) scan(argument);
        return;
      }
      ts.forEachChild(node, scan);
    };
    scan(expression);
  }
  while (reachable.length) {
    const [node, name] = reachable.shift();
    if (visited.has(node)) continue;
    visited.add(node);
    owner = name;
    const inspectColumns = (child) => {
      if (ts.isIdentifier(child) && child.text === 'SYSTEM_COLUMNS') columnImports.set(child.text, owner);
      ts.forEachChild(child, inspectColumns);
    };
    inspectColumns(node);
    const trees = returnedTrees(node);
    forms = rulesFor(node);
    title = trees.map((tree) => ownerTitle(tree, file)).find(Boolean) ?? null;
    for (const tree of trees) visit(tree);
  }
  return { file, imports, usedImports, clean, translationKeys, linkedImports, columnImports };
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
    if (seen.has(`${path}\0${used ?? ''}`) || !allowed.has(path)) continue;
    seen.add(`${path}\0${used ?? ''}`);
    const source = await readSource(path);
    total += source.length;
    if (total > MAX_CHARS) { pending.push('limite de caracteres dos fatos da tela'); break; }
    const localFacts = [];
    const parsed = collect(path, source, localFacts, used);
    for (const [key, meta] of parsed.translationKeys) translationKeys.set(key, meta);
    if (!files.includes(path)) { files.push(path); code.push({ path, excerpt: source }); }
    for (const [name, linkedFacts] of parsed.linkedImports) {
      const binding = [...parsed.imports].find(([, names]) => names.some((item) => item.local === name));
      const target = binding && resolveImport(path, binding[0], allowed);
      if (!target || files.length >= MAX_FILES) continue;
      const imported = await readSource(target);
      total += imported.length;
      if (total > MAX_CHARS) { pending.push('limite de caracteres dos fatos da tela'); break; }
      const importFile = ts.createSourceFile(target, imported, ts.ScriptTarget.Latest, true,
        target.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const exported = binding[1].find((item) => item.local === name)?.exported ?? name;
      const declaration = importFile.statements.filter(ts.isVariableStatement)
        .flatMap((statement) => statement.declarationList.declarations)
        .find((item) => ts.isIdentifier(item.name) && item.name.text === exported);
      const rules = schemaFields(declaration?.initializer, importFile, target);
      for (const fact of linkedFacts) if (rules.has(fact.name)) {
        const rule = rules.get(fact.name);
        if (fact.required === 'unknown') fact.required = rule.required;
        if (rule.message) fact.message = rule.message;
        fact.validationSource = rule.source;
        for (const key of ['min', 'max', 'email', 'matches']) if (rule[key] !== undefined) fact[key] = rule[key];
      }
      if (!files.includes(target)) { files.push(target); code.push({ path: target, excerpt: imported }); }
    }
    for (const [name, formOwner] of parsed.columnImports) {
      const binding = [...parsed.imports].find(([, names]) => names.some((item) => item.local === name));
      const target = binding && resolveImport(path, binding[0], allowed);
      if (!target || files.length >= MAX_FILES) continue;
      const imported = await readSource(target);
      total += imported.length;
      if (total > MAX_CHARS) { pending.push('limite de caracteres dos fatos da tela'); break; }
      const importFile = ts.createSourceFile(target, imported, ts.ScriptTarget.Latest, true,
        target.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const declaration = importFile.statements.filter(ts.isVariableStatement)
        .flatMap((statement) => statement.declarationList.declarations)
        .find((item) => ts.isIdentifier(item.name) && item.name.text === 'SYSTEM_COLUMNS');
      if (declaration?.initializer && ts.isArrayLiteralExpression(declaration.initializer))
        for (const element of declaration.initializer.elements) {
          if (!ts.isObjectLiteralExpression(element)) continue;
          const prop = (key) => element.properties.find((item) => ts.isPropertyAssignment(item)
            && item.name.getText(importFile) === key)?.initializer;
          const label = literal(prop('label'));
          const key = literal(prop('key'));
          const required = prop('required');
          if (label && key && required && [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(required.kind))
            addFact(localFacts, target, importFile, element, 'column', { name: key, text: label,
              required: required.kind === ts.SyntaxKind.TrueKeyword, owner: formOwner,
              subject: subjectOf(formOwner, null, path) });
        }
      if (!files.includes(target)) { files.push(target); code.push({ path: target, excerpt: imported }); }
    }
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
      const routeImport = [...parsed.imports].find(([, names]) => names.some((name) => name.local === component));
      const next = routeImport && resolveImport(path, routeImport[0], allowed);
      if (next) queue.push([next, 1, routeImport[1].find((name) => name.local === component).exported ?? component]);
      continue;
    }
    facts.push(...localFacts);
    if (depth >= 3) continue;
    for (const [specifier, names] of parsed.imports) {
      const target = resolveImport(path, specifier, allowed);
      if (target) for (const binding of names) if (parsed.usedImports.has(`${specifier}\0${binding.local}`))
        queue.push([target, depth + 1, binding.exported ?? binding.local]);
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
