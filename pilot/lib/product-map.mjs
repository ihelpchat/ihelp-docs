import { readdir, readFile } from 'node:fs/promises';
import { join, relative, posix, resolve } from 'node:path';
import { sensitiveKinds } from '../mcp/sensitive-data.mjs';
import ts from 'typescript';
import { readCsharpEndpoints } from './csharp-endpoints.mjs';
import { resolveFrontImport } from '../mcp/front-screen-facts.mjs';

const safe = (value, pattern = /^[\p{L}\p{N} ._:/-]{1,100}$/u) => {
  if (!pattern.test(value) || Object.values(sensitiveKinds(value)).some(Boolean)) return null;
  return value;
};
const ordered = (items) => [...new Map(items.map((item) => [JSON.stringify(item), item])).values()]
  .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'));

async function files(root, extensions) {
  const found = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'bin', 'obj', 'dist', 'build', 'coverage', '__tests__', 'tests'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) found.push(path);
    }
  }
  await visit(root);
  return found.sort();
}

function differences(before, after, kind, key) {
  if (!before) return [];
  const old = new Map(before.map((item) => [key(item), item]));
  const now = new Map(after.map((item) => [key(item), item]));
  return ordered([...new Set([...old.keys(), ...now.keys()])].filter((id) =>
    JSON.stringify(old.get(id)) !== JSON.stringify(now.get(id))).map((id) => `${kind}: ${id}: ${JSON.stringify(old.get(id) ?? null)} -> ${JSON.stringify(now.get(id) ?? null)}`));
}

// Resolve local JSX wrappers through TypeScript symbols, including aliases and styled primitives.
// Only literal values reaching a rendered control become names; arbitrary component props do not.
function wrapperResolver(program) {
  const checker = program.getTypeChecker();
  const declaration = (node) => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const decl = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    if (decl && (ts.isVariableDeclaration(decl) || ts.isPropertyAssignment(decl))) return decl.initializer;
    if (decl && ts.isShorthandPropertyAssignment(decl)) return checker.getShorthandAssignmentValueSymbol(decl)?.valueDeclaration?.initializer;
    return decl;
  };
  const primitive = (tag) => /^(button|input|select|textarea|a|h[1-6])$/u.test(tag)
    ? tag === 'button' ? 'button' : tag === 'a' ? 'link' : /^h/u.test(tag) ? 'heading' : 'field' : null;
  const styledKind = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return null;
    seen.add(node);
    if (ts.isIdentifier(node)) return styledKind(declaration(node), seen);
    if (ts.isTaggedTemplateExpression(node)) return styledKind(node.tag, seen);
    if (ts.isCallExpression(node)) return styledKind(node.expression, seen) ?? (node.arguments[0] && styledKind(node.arguments[0], seen));
    if (ts.isPropertyAccessExpression(node)) return primitive(node.name.text);
    return null;
  };
  const values = (node, env, seen = new Set()) => {
    if (!node || seen.has(node)) return [];
    seen.add(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node)) return values(node.expression,env,seen);
    if (ts.isIdentifier(node)) return env.get(node.text) ?? values(declaration(node),env,seen);
    if (ts.isPropertyAccessExpression(node)) return env.get(node.getText()) ?? [];
    if (ts.isConditionalExpression(node)) return [...values(node.whenTrue,env,new Set(seen)),...values(node.whenFalse,env,new Set(seen))];
    return [];
  };
  const textVariants = (node, env) => {
    if (ts.isJsxText(node)) return [node.text];
    if (ts.isJsxExpression(node)) return node.expression ? values(node.expression,env) : [''];
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.getText()==='aria-hidden'&&values(a.initializer,env).includes('true'))) return [''];
      let result=[''];
      for (const child of node.children) {
        const parts=textVariants(child,env);
        if (!parts.length || result.length*parts.length>32) return [];
        result=result.flatMap(prefix=>parts.map(part=>`${prefix} ${part}`));
      }
      return result;
    }
    return [''];
  };
  const attrsOf = (node, env) => {
    const attrs=new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(a=>[a.name.getText(),values(a.initializer,env)]));
    for (const spread of node.attributes.properties.filter(ts.isJsxSpreadAttribute)) {
      const prefix=spread.expression.getText()+'.';
      for (const [key,value] of env) if (key.startsWith(prefix)) attrs.set(key.slice(prefix.length),value);
    }
    if (ts.isJsxOpeningElement(node)) attrs.set('children',textVariants(node.parent,env));
    return attrs;
  };
  const resolveNode = (node, supplied, depth = 0, seen = new Set()) => {
    if (!node || depth > 8 || seen.has(node)) return [];
    seen = new Set([...seen,node]);
    if (ts.isIdentifier(node)) return resolveNode(declaration(node),supplied,depth+1,seen);
    if (ts.isCallExpression(node)) return node.arguments.flatMap(a=>resolveNode(a,supplied,depth+1,seen));
    if (!ts.isFunctionLike(node) || !node.body) return [];
    const env = new Map();
    const param=node.parameters[0]?.name;
    if (param && ts.isObjectBindingPattern(param)) for (const binding of param.elements) {
      if (binding.dotDotDotToken) { for (const [key,value] of supplied) env.set(`${binding.name.getText()}.${key}`,value); continue; }
      const key=(binding.propertyName ?? binding.name).getText().replace(/^['"]|['"]$/gu,'');
      env.set(binding.name.getText(), supplied.get(key) ?? values(binding.initializer,env));
    }
    else if (param && ts.isIdentifier(param)) for (const [key,val] of supplied) env.set(`${param.text}.${key}`,val);
    const result=[];
    const walk=(child,modal=false) => {
      if (ts.isJsxElement(child)) { walk(child.openingElement,modal); return; }
      if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
        const tag=child.tagName.getText(), attrs=attrsOf(child,env);
        modal ||= /Modal|Dialog|Drawer/iu.test(tag) || !!attrs.get('role')?.includes('dialog');
        const kind=primitive(tag) ?? styledKind(child.tagName);
        if (kind) {
          let names=[];
          for (const key of ['aria-label','label','labelText','tooltipTitle','placeholder','title']) if (attrs.get(key)?.length) { names=attrs.get(key);break; }
          if (!names.length && ts.isJsxOpeningElement(child)) {
            names=textVariants(child.parent,env);
          }
          for (const name of names) if(name.trim()) result.push({kind,name:name.replace(/\s+/gu,' ').trim(),inModal:modal});
        } else result.push(...resolveNode(declaration(child.tagName),attrs,depth+1,seen).map(e=>({...e,inModal:e.inModal||modal})));
        if (ts.isJsxOpeningElement(child)) for (const c of child.parent.children) walk(c,modal);
        return;
      }
      if (ts.isFunctionLike(child)) return;
      ts.forEachChild(child,c=>walk(c,modal));
    };
    walk(node.body,/Modal|Dialog|Drawer/iu.test(node.parent?.name?.getText() ?? node.name?.getText() ?? ''));
    return result;
  };
  return { kind: styledKind, expand(node) {
    const supplied=attrsOf(node,new Map());
    // A wrapper must receive a literal naming prop at this use site. Static descendants
    // are already collected from their own file and must not be counted again.
    if (![...supplied.values()].some(v=>v.length)) return [];
    return resolveNode(declaration(node.tagName),supplied).filter(e=>[...supplied.values()].flat().some(v=>v && e.name.includes(v)));
  }};
}

export async function buildProductMap({ frontRoot, backRoot, guides, actions, baseline, runtime }) {
  const frontFiles = await files(join(frontRoot, 'src'), ['.tsx', '.jsx', '.ts', '.js']);
  const program = ts.createProgram(frontFiles, { allowJs: true, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, baseUrl: frontRoot, paths: { '@/*': ['src/*'] } });
  const wrappers = wrapperResolver(program);
  const routes = [];
  const records = new Map();
  const seeds = [];
  const sections = new Map();
  const markers = [];
  const labels = [];
  const permissions = [];
  const pending = [];
  const informational = [];
  // Configurações (redesign v4): as telas vêm de um registro de seções com `path: \`${CONFIG_V4_PREFIX}/…\``
  // e `legacyPaths` que redirecionam. O prefixo é lido do próprio front; sem ele, o registro é ignorado.
  const registryFile = 'src/features/configurations/registry/sections.ts';
  const registryPrefix = await readFile(join(frontRoot, 'src/features/configurations/registry/prefix.ts'), 'utf8')
    .then((raw) => raw.match(/export const CONFIG_V4_PREFIX = ['"](\/[a-z0-9-]+)['"]/u)?.[1] ?? null).catch(() => null);
  for (const file of frontFiles) {
    const source = await readFile(file, 'utf8');
    const path = relative(frontRoot, file);
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const ast = program.getSourceFile(resolve(file)) ?? ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
    const record = { provided: new Set(), imports: new Map(), exports: new Map(), importedNames: new Map(), rendered: new Set(), modalUses: new Map(), elements: [] };
    records.set(path, record);
    const constants = new Map();
    const ambiguousConstants = new Set();
    const addLabel = (value) => {
      const clean = (part) => part.replace(/\s+/gu, ' ').trim().replace(/[.:]$/u, '').trim();
      const full = safe(value.replace(/\s+/gu, ' ').trim());
      if (full) labels.push({ label: full, file: path });
      for (const part of value.split('→')) {
        const label = safe(clean(part));
        if (label) labels.push({ label, file: path });
      }
    };
    const staticText = (node, seen = new Set()) => {
      if (!node) return [];
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
      if (ts.isParenthesizedExpression(node)) return staticText(node.expression, seen);
      if (ts.isConditionalExpression(node)) return [
        ...staticText(node.whenTrue, seen), ...staticText(node.whenFalse, seen),
      ];
      if (ts.isIdentifier(node) && constants.has(node.text) && !seen.has(node.text)) {
        return staticText(constants.get(node.text), new Set([...seen, node.text]));
      }
      if (ts.isCallExpression(node) && node.arguments.length === 0) {
        const callee = ts.isParenthesizedExpression(node.expression) ? node.expression.expression : node.expression;
        if (ts.isArrowFunction(callee) && ts.isBlock(callee.body)) {
          const values = [];
          const returns = (current) => {
            if (ts.isReturnStatement(current)) values.push(...staticText(current.expression, seen));
            else if (!ts.isFunctionLike(current)) ts.forEachChild(current, returns);
          };
          returns(callee.body);
          return values;
        }
      }
      return [];
    };
    const collectConstants = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
          node.parent && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const)) {
        if (constants.has(node.name.text)) ambiguousConstants.add(node.name.text);
        else constants.set(node.name.text, node.initializer);
      }
      ts.forEachChild(node, collectConstants);
    };
    collectConstants(ast);
    for (const name of ambiguousConstants) constants.delete(name);
    // A label/id pair is proof of a field name even when a local input wrapper forwards id.
    const linkedLabels = new Map();
    const idKey = node => {
      if (!node) return null;
      if (ts.isStringLiteral(node)) return `literal:${node.text}`;
      if (!ts.isIdentifier(node)) return null;
      const declaration = program.getTypeChecker().getSymbolAtLocation(node)?.declarations?.[0];
      return declaration ? `${declaration.getSourceFile().fileName}:${declaration.pos}` : null;
    };
    const labelText = node => {
      if (ts.isJsxText(node)) return node.text;
      if (ts.isJsxExpression(node)) {
        if (!node.expression || [ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword,ts.SyntaxKind.NullKeyword].includes(node.expression.kind)) return '';
        const values=staticText(node.expression);
        return values.length === 1 ? values[0] : null;
      }
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening=ts.isJsxElement(node)?node.openingElement:node;
        if (opening.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='aria-hidden'&&a.initializer&&(ts.isStringLiteral(a.initializer)&&a.initializer.text==='true'||ts.isJsxExpression(a.initializer)&&a.initializer.expression?.kind===ts.SyntaxKind.TrueKeyword))) return '';
        if (!ts.isJsxElement(node)) return null;
        const children=node.children.map(labelText);
        return children.some(text=>text===null)?null:children.join(' ');
      }
      return null;
    };
    const collectLabels = node => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast)==='label') {
        const attribute=node.openingElement.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='htmlFor');
        const key=idKey(attribute?.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : attribute?.initializer);
        const name=labelText(node)?.replace(/\s+/gu,' ').trim();
        if (key && name) linkedLabels.set(key,[...(linkedLabels.get(key)??[]),name]);
      }
      ts.forEachChild(node,collectLabels);
    };
    collectLabels(ast);
    const screenText = (node) => {
      const element = node.parent;
      return ts.isJsxElement(element) && /^(button|Button|Title|Label|strong|StyledGreenSpan)$/u.test(element.openingElement.tagName.getText(ast));
    };
    const prop = (node, name) => node.properties?.find((item) => ts.isPropertyAssignment(item) && item.name.getText(ast).replace(/^['"]|['"]$/gu, '') === name)?.initializer;
    const routeText = (node) => {
      if (node && ts.isIdentifier(node) && node.text === 'CONFIG_V4_PREFIX') return registryPrefix;
      if (node && ts.isTemplateExpression(node) && node.head.text === '' && node.templateSpans.length === 1 && node.templateSpans[0].expression.getText(ast) === 'CONFIG_V4_PREFIX' && registryPrefix)
        return registryPrefix + node.templateSpans[0].literal.text;
      return staticText(node)[0];
    };
    const tags = (node) => {
      const found = [];
      const walk = (child) => {
        if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) found.push(child.tagName.getText(ast));
        ts.forEachChild(child, walk);
      };
      if (node) walk(node);
      return found;
    };
    const visit = (node) => {
      if (node.modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)) {
        if (node.modifiers.some((item) => item.kind === ts.SyntaxKind.DefaultKeyword)) record.provided.add('default');
        if (node.name && ts.isIdentifier(node.name)) record.provided.add(node.name.text);
        if (ts.isVariableStatement(node)) for (const item of node.declarationList.declarations)
          if (ts.isIdentifier(item.name)) record.provided.add(item.name.text);
      }
      if (ts.isExportAssignment(node) && !node.isExportEquals) record.provided.add('default');
      if (ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause))
        for (const item of node.exportClause.elements) record.provided.add(item.name.text);
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        if (clause?.name) { record.imports.set(clause.name.text, node.moduleSpecifier.text); record.importedNames.set(clause.name.text, 'default'); }
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
          for (const item of clause.namedBindings.elements) { record.imports.set(item.name.text, node.moduleSpecifier.text); record.importedNames.set(item.name.text, item.propertyName?.text ?? item.name.text); }
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const findLazy = (child) => {
          if (ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(child.arguments[0]))
            { record.imports.set(node.name.text, child.arguments[0].text); record.importedNames.set(node.name.text, 'default'); }
          ts.forEachChild(child, findLazy);
        };
        findLazy(node.initializer);
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const item of node.exportClause.elements) if (!item.isTypeOnly)
            record.exports.set(item.name.text, { specifier: node.moduleSpecifier.text, name: item.propertyName?.text ?? item.name.text });
        } else if (!node.exportClause) record.exports.set(`*:${node.pos}`, { specifier: node.moduleSpecifier.text, name: '*' });
      }
      if (ts.isObjectLiteralExpression(node)) {
        const route = routeText(prop(node, 'path'));
        const title = staticText(prop(node, 'title'))[0];
        let routeOwner = path === 'src/features/configurations/routes.tsx';
        for (let parent = node.parent; parent; parent = parent.parent)
          if (ts.isVariableDeclaration(parent) && /^(?:pagesData|[A-Za-z0-9_]*[Rr]outes)$/u.test(parent.name.getText(ast))) routeOwner = true;
        if (routeOwner && route?.startsWith('/') && safe(route, /^\/[A-Za-z0-9_/:.-]{1,120}$/u) && title && safe(title)) {
          routes.push({ path: route, label: title });
          for (const component of tags(prop(node, 'element'))) seeds.push({ path, component, route });
        }
        if (path === registryFile && route && prop(node, 'id')) {
          const id = staticText(prop(node, 'id'))[0];
          const legacy = prop(node, 'legacyPaths');
          sections.set(id, [route, ...(legacy && ts.isArrayLiteralExpression(legacy) ? legacy.elements.flatMap((item) => staticText(item)) : [])]);
        }
      }
      if (path === 'src/features/configurations/registry/elements.tsx' && ts.isPropertyAssignment(node)) {
        const id = node.name.getText(ast).replace(/^['"]|['"]$/gu, '');
        for (const component of tags(node.initializer)) seeds.push({ path, component, section: id });
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(ast);
        record.rendered.add(tag);
        let inModal = false;
        for (let parent = node; parent; parent = parent.parent) {
          const name = parent.name?.getText(ast) ?? (ts.isJsxElement(parent) ? parent.openingElement.tagName.getText(ast) : '');
          if (/Modal|Dialog|Drawer|Sidebar/iu.test(name)) inModal = true;
          if (ts.isJsxElement(parent) && parent.openingElement.attributes.properties.some(a => ts.isJsxAttribute(a) && a.name.getText(ast) === 'role' && a.initializer && ts.isStringLiteral(a.initializer) && a.initializer.text === 'dialog')) inModal = true;
        }
        // A component used both inside and outside a dialog has no proven global modal scope.
        record.modalUses.set(tag, record.modalUses.has(tag) ? record.modalUses.get(tag) && inModal : inModal);
        const visibility = [];
        for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
          if (ts.isConditionalExpression(parent) && (child === parent.whenTrue || child === parent.whenFalse)) visibility.push({ key: `${path}:${parent.getStart(ast)}`, branch: child === parent.whenTrue });
        }
        const attrs = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map((item) => [item.name.getText(ast), item.initializer && ts.isJsxExpression(item.initializer) ? item.initializer.expression : item.initializer]));
        const role = staticText(attrs.get('role'))[0];
        // Keep established library-name heuristics as compatibility fallback; local
        // wrappers below must prove their rendered primitive through compiler symbols.
        const kind = ['button', 'field', 'link', 'tab', 'menuitem', 'heading'].includes(role) ? role
          : /^(?:button|Button|ButtonIconAction|ButtonWithIcon|IconButton|MenuButton)$/u.test(tag) ? 'button'
          : /^(?:a|Link|NavLink)$/u.test(tag) ? 'link'
          : /^(?:input|select|textarea|Input\w*|Select\w*|Textarea\w*|TextArea\w*|LegacySelect\w*|MultiSelectSystem)$/u.test(tag) && !/(?:Container|Wrapper|Group|Label|Node|Option|Content|Icon|Provider|Context|Props)$/u.test(tag) ? 'field'
          : /^(?:Tab|TabItem)$/u.test(tag) ? 'tab'
          : tag === 'MenuItem' ? 'menuitem'
          : /^(?:h[1-6]|Title|DialogTitle)$/u.test(tag) ? 'heading' : wrappers.kind(node.tagName);
        if (!kind) for (const inferred of wrappers.expand(node)) {
          const name = safe(inferred.name, /^[\p{L}\p{N}\p{P}\p{S} ]{1,160}$/u);
          if (name) labels.push({ label: name, file: path });
          if (name) record.elements.push({ ...inferred, name, inModal: inModal || inferred.inModal, source: `${path}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}`, column: ast.getLineAndCharacterOfPosition(node.getStart(ast)).character + 1, component: tag, ...(visibility.length ? { visibility } : {}) });
        }
        if (kind) {
          let names = [];
          for (const key of ['aria-label', 'label', 'labelText', 'tooltipTitle']) {
            names = staticText(attrs.get(key));
            if (names.length) break;
          }
          if (!names.length && kind === 'field') names = linkedLabels.get(idKey(attrs.get('id'))) ?? [];
          if (!names.length) for (const key of ['placeholder', 'title']) {
            names = staticText(attrs.get(key));
            if (names.length) break;
          }
          if (!names.length && ts.isJsxOpeningElement(node)) {
            const combine = (children) => {
              let variants = [''];
              for (const child of children) {
                const parts = text(child);
                if (!parts.length || variants.length * parts.length > 32) return [];
                variants = variants.flatMap((prefix) => parts.map((part) => `${prefix} ${part}`));
              }
              return variants;
            };
            const text = (child) => ts.isJsxText(child) ? [child.getText(ast)]
              : ts.isJsxExpression(child) ? (child.expression ? staticText(child.expression) : [''])
              : ts.isJsxElement(child) || ts.isJsxFragment(child) ? combine(child.children) : [''];
            names = combine(node.parent.children);
          }
          names = [...new Set(names.map((name) => safe(name.replace(/\s+/gu, ' ').trim(), /^[\p{L}\p{N}\p{P}\p{S} ]{1,160}$/u)).filter(Boolean))];
          record.elements.push(...(names.length ? names : [null]).map((name) => ({ kind, name, source: `${path}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}`, column: ast.getLineAndCharacterOfPosition(node.getStart(ast)).character + 1, inModal, component: tag, ...(visibility.length ? { visibility } : {}) })));
        }
      }
      if (ts.isVariableDeclaration(node) && /^(?:pagesData|[A-Za-z0-9_]*[Rr]outes)$/u.test(node.name.getText(ast)) && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
          for (const entry of node.initializer.elements) {
            if (!ts.isObjectLiteralExpression(entry)) continue;
            const property = (name) => entry.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText(ast) === name);
            const routeNode = property('path') ?? property('route');
            const titleNode = property('title');
            if (!routeNode) continue;
            if (!ts.isStringLiteral(routeNode.initializer)) {
              informational.push(`rota não resolvida: ${path}`);
              continue;
            }
            const route = safe(routeNode.initializer.text, /^\/[A-Za-z0-9_/:.-]{1,120}$/u);
            const label = titleNode && ts.isStringLiteral(titleNode.initializer) ? safe(titleNode.initializer.text) : null;
            if (route && label) routes.push({ path: route, label });
            else informational.push(`rota ou rótulo não verificável: ${path}`);
          }
      }
      if (registryPrefix && path === registryFile && ts.isObjectLiteralExpression(node)) {
        const property = (name) => node.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText(ast) === name);
        const pathNode = property('path')?.initializer;
        const labelNode = property('label')?.initializer;
        if (pathNode && ts.isTemplateExpression(pathNode) && pathNode.head.text === '' && pathNode.templateSpans.length === 1
            && pathNode.templateSpans[0].expression.getText(ast) === 'CONFIG_V4_PREFIX' && labelNode && ts.isStringLiteral(labelNode)) {
          const label = safe(labelNode.text);
          if (label) labels.push({ label, file: path });
          const legacy = property('legacyPaths')?.initializer;
          const paths = [registryPrefix + pathNode.templateSpans[0].literal.text,
            ...(legacy && ts.isArrayLiteralExpression(legacy) ? legacy.elements.filter(ts.isStringLiteral).map((item) => item.text) : [])];
          for (const candidate of paths) {
            const route = safe(candidate, /^\/[A-Za-z0-9_/:.-]{1,120}$/u);
            if (route && label) routes.push({ path: route, label });
          }
        }
      }
      if (ts.isJsxAttribute(node) && /^(data-tour-id|data-help-id)$/u.test(node.name.text)) {
        const kind = node.name.text === 'data-tour-id' ? 'tour' : 'help';
        if (node.initializer && ts.isStringLiteral(node.initializer)) {
          const id = safe(node.initializer.text, /^[A-Za-z0-9_-]{1,80}$/u);
          if (id) markers.push({ kind, id });
          else informational.push(`expressão ou marcador não verificável: ${path}`);
        } else informational.push(`marcador dinâmico: ${path}`);
      }
      if (ts.isJsxText(node) && screenText(node)) addLabel(node.getText(ast));
      if (ts.isJsxExpression(node) && screenText(node)) {
        for (const value of staticText(node.expression)) addLabel(value);
      }
      if (ts.isJsxAttribute(node) && /^(labelText|label|title|placeholder|aria-label|tooltipTitle)$/u.test(node.name.text)) {
        const value = node.initializer && ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
        for (const label of staticText(value)) addLabel(label);
      }
      if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'name' &&
          ts.isObjectLiteralExpression(node.parent) && ts.isArrayLiteralExpression(node.parent.parent) &&
          ((ts.isPropertyAssignment(node.parent.parent.parent) && node.parent.parent.parent.name.getText(ast) === 'tabs') ||
           (ts.isVariableDeclaration(node.parent.parent.parent) && node.parent.parent.parent.name.getText(ast) === 'tabs'))) {
        for (const label of staticText(node.initializer)) addLabel(label);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  for (const file of await files(backRoot, ['.cs'])) {
    const source = await readFile(file, 'utf8');
    for (const endpoint of readCsharpEndpoints(source, relative(backRoot, file))) {
      const fields = [endpoint.controller, endpoint.method, endpoint.verb, endpoint.route, endpoint.policy];
      if (fields.every((value) => safe(value, /^[A-Za-z0-9_.:\/[\]-]{1,120}$/u))) permissions.push(endpoint);
      else informational.push(`permissão não resolvida: ${relative(backRoot, file)}`);
    }
  }
  // Follow only rendered imports, not every dependency (services/hooks do not own UI).
  // Like front-screen-facts, seed routes from pagesData and resolve local/@ imports.
  const sourcePaths = new Set(records.keys());
  const resolveImport = (from, specifier) => {
    const existing = resolveFrontImport(from, specifier ?? '', sourcePaths);
    if (existing) return existing;
    if (!specifier?.startsWith('.') && !specifier?.startsWith('@/')) return null;
    const base = specifier.startsWith('@/') ? `src/${specifier.slice(2)}` : posix.normalize(posix.join(posix.dirname(from), specifier));
    return [base, ...['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts'].map((suffix) => base + suffix)].find((candidate) => records.has(candidate));
  };
  const componentFile = (from, local, seen = new Set()) => {
    const record = records.get(from);
    const path = resolveImport(from, record?.imports.get(local));
    if (!path) return null;
    const follow = (path, name) => {
      const key = `${path}:${name}`;
      if (seen.has(key)) return null;
      seen.add(key);
      const target = records.get(path);
      const exported = target.exports.get(name);
      if (exported) {
        const next = resolveImport(path, exported.specifier);
        return next ? follow(next, exported.name) : null;
      }
      if (target.provided.has(name) && (target.elements.length || target.rendered.size)) return path;
      for (const [key, item] of target.exports) if (key.startsWith('*:')) {
        const next = resolveImport(path, item.specifier);
        const found = next && follow(next, name);
        if (found) return found;
      }
      return null;
    };
    return follow(path, record.importedNames.get(local) ?? 'default');
  };
  const assigned = new Map();
  for (const seed of seeds) for (const route of seed.section ? sections.get(seed.section) ?? [] : [seed.route]) {
    if (!safe(route ?? '', /^\/[A-Za-z0-9_/:.-]{1,120}$/u)) continue;
    const start = componentFile(seed.path, seed.component);
    const queue = start ? [[start, /Modal|Dialog|Drawer|Sidebar/iu.test(seed.component)]] : [];
    const seen = new Set();
    while (queue.length) {
      const [path, modal] = queue.shift();
      if (seen.has(`${path}:${modal}`)) continue;
      seen.add(`${path}:${modal}`);
      if (!assigned.has(path)) assigned.set(path, new Map());
      assigned.get(path).set(route, assigned.get(path).has(route) ? modal && assigned.get(path).get(route) : modal);
      const record = records.get(path);
      for (const name of record.imports.keys()) if (record.rendered.has(name)) {
        const target = componentFile(path, name);
        if (target) queue.push([target, modal || record.modalUses.get(name) || /Modal|Dialog|Drawer|Sidebar/iu.test(name)]);
      }
    }
  }
  const elements = [];
  for (const [path, record] of records) for (const element of record.elements) {
    const assignments = assigned.get(path);
    if (!assignments?.size) elements.push({ ...element, route: null, shared: true });
    else for (const [route, modal] of assignments) elements.push({ ...element, route, inModal: modal || element.inModal });
  }
  const groups = new Map();
  const groupKey = e => JSON.stringify([e.route,e.kind,e.name,!!e.inModal]);
  for (const element of elements) if (element.route && element.name) {
    const key=groupKey(element);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(element);
  }
  const canCoexist = (a,b) => !(a.visibility ?? []).some(left=>(b.visibility ?? []).some(right=>left.key===right.key&&left.branch!==right.branch));
  for (const element of elements) element.duplicates = element.route && element.name ? groups.get(groupKey(element)).filter(other=>canCoexist(element,other)).length : 0;
  // Runtime evidence adds unique observed targets; it never overrides a static ambiguity.
  if (runtime) {
    const routeSet = new Set(routes.map(({path})=>path));
    const staticKeys = new Set(elements.map(groupKey));
    const candidates = new Map();
    for (const element of runtime.runtimeOnly ?? []) {
      if (!routeSet.has(element.route) || !['button','field','link','tab','menuitem','heading'].includes(element.kind) || !safe(element.name ?? '', /^[\p{L}\p{N}\p{P}\p{S} ]{1,160}$/u) || staticKeys.has(groupKey(element))) continue;
      const previous = candidates.get(groupKey(element));
      candidates.set(groupKey(element), { ...element, duplicates: Math.max(element.duplicates ?? 0, previous?.duplicates ?? 0) });
    }
    for (const element of candidates.values()) if (element.duplicates === 1) {
      elements.push({ ...element, inModal: !!element.inModal, runtimeOnly: true, source: `runtime:${runtime.sourceSha}`, component: 'runtime' });
      labels.push({ label: element.name, file: `runtime:${runtime.sourceSha}` });
    }
  }
  const manifest = {
    schemaVersion: 2, elements: ordered(elements),
    routes: ordered(routes), markers: ordered(markers), labels: ordered(labels), permissions: ordered(permissions),
  };
  const markerIds = new Set(manifest.markers.map(({ id }) => id));
  const routeIds = new Set(manifest.routes.map(({ path }) => path));
  const oldPermissions = new Map((baseline?.permissions ?? []).map((item) => [`${item.controller}.${item.method}:${item.verb}:${item.route}`, item]));
  const newPermissions = new Map(manifest.permissions.map((item) => [`${item.controller}.${item.method}:${item.verb}:${item.route}`, item]));
  for (const { guide } of guides) {
    for (const step of guide.steps) {
      const action = actions[step.actionId];
      if (!action) continue;
      if (action.target && !markerIds.has(action.target)) pending.push(`${guide.guideId}: marcador ausente ${action.target}`);
      if (action.route && !routeIds.has(action.route)) pending.push(`${guide.guideId}: rota ausente ${action.route}`);
      const area = action.route?.split('/').at(-1)?.toLowerCase();
      for (const [key, old] of oldPermissions) {
        if (!area || !old.controller.toLowerCase().includes(area)) continue;
        const now = newPermissions.get(key);
        if (old.policy !== 'anonymous' && (!now || now.policy === 'anonymous' || (old.policy !== 'authenticated' && now.policy !== old.policy))) {
          pending.push(`${guide.guideId}: autorização perdida ${key}`);
        }
      }
    }
  }
  const changes = [
    ...differences(baseline?.routes, manifest.routes, 'route', (item) => item.path),
    ...differences(baseline?.markers, manifest.markers, 'marker', (item) => `${item.kind}:${item.id}`),
    ...differences(baseline?.labels, manifest.labels, 'label', (item) => item.label),
    ...differences(baseline?.permissions, manifest.permissions, 'permission', (item) => `${item.controller}.${item.method}:${item.verb}:${item.route}`),
  ];
  return { manifest, changes: ordered(changes), pending: ordered(pending), informational: ordered(informational) };
}
