/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Structural shape matchers and variable-provenance resolution for the
 * agents-neutral-gate checkF family (PLAN-20260707-AGENTNEUTRAL.P31).
 *
 * Extracted from agents-neutral-gate-checks.ts to keep that module under
 * the 800-line limit. These helpers trace variable references back to their
 * initializers and type annotations to determine whether a value has the
 * Google Content shape (role/parts), enabling precise provenance-constrained
 * detection (Finding #5).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

import ts from 'typescript';

// ─── Property-key helpers ───────────────────────────────────────────────────

/**
 * Extract the property-name text from a property-assignment's name node,
 * supporting both Identifier and StringLiteral forms (Finding #2).
 * Also handles ShorthandPropertyAssignment (`{ parts }`) so indirect
 * shorthand detection does not miss the Gemini envelope pattern.
 * Also resolves const-computed keys (`{ [ck]: ... }` where
 * `const ck = 'candidates'`) so the Google-shaped envelope cannot evade
 * detection by using computed property names.
 */
export function propKeyName(prop: ts.ObjectLiteralElementLike): string | null {
  if (ts.isShorthandPropertyAssignment(prop)) return prop.name.text;
  if (!ts.isPropertyAssignment(prop)) return null;
  return propertyNameText(prop.name);
}

/**
 * Whether a candidate element's `content` property holds an object with
 * a `role` or `parts` key (Gemini Content shape). Returns false when
 * content is a plain string, number, array, or an object without
 * role/parts (neutral domain false-positive guard — Finding #2).
 *
 * Also handles ShorthandPropertyAssignment (`{ role }`, `{ parts }`) so
 * that the shorthand envelope form `{ role, parts }` is detected.
 */
export function contentHasRoleOrParts(
  contentInit: ts.Expression | undefined,
): boolean {
  if (contentInit === undefined || !ts.isObjectLiteralExpression(contentInit)) {
    return false;
  }
  return contentInit.properties.some((p) => {
    const keyName = propKeyName(p);
    return keyName === 'role' || keyName === 'parts';
  });
}

/**
 * Safely extracts the text of a property name node, supporting:
 * - Identifier names (Finding #2)
 * - StringLiteral (quoted) keys (Finding #2)
 * - ComputedPropertyName where the expression is a const identifier
 *   initialized to a string literal (`const ck = 'candidates'; { [ck]: ... }`)
 *   — resolves the const to its literal value so the Google-shaped envelope
 *   cannot evade detection via computed property names.
 *
 * Returns null for dynamic/non-const-literal computed names and numeric literals.
 */
export function propertyNameText(name: ts.Node): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    return resolveComputedKeyText(name);
  }
  return null;
}

/**
 * Resolve a ComputedPropertyName's expression to a string literal value.
 * Handles direct string literals (`['candidates']`) and const identifier
 * references (`const ck = 'candidates'; [ck]`) by walking the AST scope.
 */
function resolveComputedKeyText(node: ts.ComputedPropertyName): string | null {
  const expr = node.expression;
  // Direct string literal: `['key']`
  if (ts.isStringLiteral(expr)) return expr.text;
  // Const identifier: `const k = 'key'; [k]`
  if (ts.isIdentifier(expr)) {
    const resolved = resolveInitializer(
      node.getSourceFile() as ts.SourceFile,
      expr.text,
      node,
    );
    if (resolved !== null && ts.isStringLiteral(resolved)) {
      return resolved.text;
    }
  }
  return null;
}

// ─── Role/parts envelope detection ──────────────────────────────────────────

/** Whether a property assignment's initializer is `'user'` or `'model'`. */
function isRoleValue(init: ts.Expression): boolean {
  return (
    ts.isStringLiteral(init) && (init.text === 'user' || init.text === 'model')
  );
}

/** Whether a property assignment is `role: 'user'|'model'`. */
function isRoleProp(
  prop: ts.ObjectLiteralElementLike,
  keyName: string,
): prop is ts.PropertyAssignment {
  if (keyName !== 'role' || !ts.isPropertyAssignment(prop)) return false;
  return isRoleValue(prop.initializer);
}

/** Whether a shorthand `{ role }` resolves to a `'user'`/`'model'` variable. */
function isShorthandRoleProp(
  sf: ts.SourceFile,
  prop: ts.ObjectLiteralElementLike,
  keyName: string,
): boolean {
  if (keyName !== 'role' || !ts.isShorthandPropertyAssignment(prop)) {
    return false;
  }
  const resolved = resolveInitializer(sf, prop.name.text, prop);
  return resolved !== null && isRoleValue(resolved);
}

/** Find the role/parts envelope in an object literal's properties.
 *
 *  Detects both `PropertyAssignment` (`role: 'model'`) and
 *  `ShorthandPropertyAssignment` (`{ role }` where `const role = 'model'`).
 */
export function findRolePartsEnvelope(
  sf: ts.SourceFile,
  props: ts.NodeArray<ts.ObjectLiteralElementLike>,
): ts.ObjectLiteralElementLike | null {
  let roleNode: ts.ObjectLiteralElementLike | null = null;
  let hasParts = false;
  for (const prop of props) {
    const keyName = propKeyName(prop);
    if (keyName === null) continue;
    if (isRoleProp(prop, keyName) || isShorthandRoleProp(sf, prop, keyName)) {
      roleNode = prop;
    }
    if (keyName === 'parts') hasParts = true;
  }
  return roleNode !== null && hasParts ? roleNode : null;
}

// ─── Variable provenance resolver (Finding #5) ─────────────────────────────

/** Get the SourceFile that contains a given AST node. */
function sfForNode(node: ts.Node): ts.SourceFile {
  return node.getSourceFile();
}

/**
 * Resolve a variable name to its initializer expression by searching
 * enclosing scopes for `const`/`let`/`var` declarations. Returns the
 * initializer expression, or null if the variable cannot be found or has
 * no initializer.
 *
 * Used to trace shorthand/indirect envelope constructions back to the
 * object literal that gives the value its shape.
 */
function resolveInitializer(
  sf: ts.SourceFile,
  name: string,
  fromNode: ts.Node,
): ts.Expression | null {
  let scope: ts.Node | undefined = fromNode.parent;
  while (scope !== undefined) {
    // Search all descendants within this scope for variable declarations.
    // Children may be nested inside SyntaxList nodes (Block → SyntaxList →
    // VariableStatement), so we walk all children recursively.
    const found = findVarInSubtree(sf, scope, name, fromNode);
    if (found !== null) return found;
    scope = scope.parent;
  }
  return null;
}

/** Recursively search a scope subtree for a variable declaration matching
 *  `name` that appears BEFORE `fromNode` (lexical ordering within the
 *  same block). Does not descend into nested function bodies. */
function findVarInSubtree(
  sf: ts.SourceFile,
  node: ts.Node,
  name: string,
  fromNode: ts.Node,
): ts.Expression | null {
  const directHit = findVarInStatement(node, name, fromNode);
  if (directHit !== null) return directHit;
  // Don't descend into nested functions/arrows (different scope)
  if (isFunctionWithParams(node)) return null;
  for (const child of node.getChildren(sf)) {
    const found = findVarInSubtree(sf, child, name, fromNode);
    if (found !== null) return found;
  }
  return null;
}

/** Check a single node (if VariableStatement) for a matching declaration. */
function findVarInStatement(
  node: ts.Node,
  name: string,
  fromNode: ts.Node,
): ts.Expression | null {
  if (!ts.isVariableStatement(node)) return null;
  for (const decl of node.declarationList.declarations) {
    if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
    if (decl.initializer === undefined) return null;
    if (decl.getEnd() <= fromNode.getStart()) {
      return decl.initializer;
    }
  }
  return null;
}

// ─── Google Content shape detection ─────────────────────────────────────────

interface RoleCheckResult {
  readonly hasRoleProp: boolean;
  readonly hasRoleValue: boolean;
}

/** Check a `role` property for value or shorthand resolution. */
function checkRoleProp(
  expr: ts.ObjectLiteralExpression,
  prop: ts.ObjectLiteralElementLike,
): RoleCheckResult {
  const result: RoleCheckResult = { hasRoleProp: true, hasRoleValue: false };
  // Check for role: 'user'|'model'
  if (ts.isPropertyAssignment(prop) && isRoleValue(prop.initializer)) {
    return { hasRoleProp: true, hasRoleValue: true };
  }
  // Check for shorthand { role } where const role = 'model'
  if (ts.isShorthandPropertyAssignment(prop)) {
    const sf = expr.getSourceFile();
    if (sf !== undefined) {
      const resolved = resolveInitializer(sf, 'role', prop);
      if (resolved !== null && isRoleValue(resolved)) {
        return { hasRoleProp: true, hasRoleValue: true };
      }
    }
  }
  return result;
}

/** Part-shaped property keys that identify a Google Part object. */
const PART_OBJECT_KEYS: ReadonlySet<string> = new Set([
  'text',
  'inlineData',
  'functionResponse',
  'functionCall',
]);

/** Whether a `parts` property's value is an array of Part-shaped objects. */
function hasPartObjects(prop: ts.ObjectLiteralElementLike): boolean {
  if (!ts.isPropertyAssignment(prop)) return false;
  if (!ts.isArrayLiteralExpression(prop.initializer)) return false;
  if (prop.initializer.elements.length === 0) return false;
  const first = prop.initializer.elements[0];
  if (!ts.isObjectLiteralExpression(first)) return false;
  return first.properties.some((p) => {
    const k = propKeyName(p);
    return k !== null && PART_OBJECT_KEYS.has(k);
  });
}

/** Whether an object literal has both a role property and a parts property. */
function hasRoleAndParts(hasRole: boolean, hasParts: boolean): boolean {
  return hasRole && hasParts;
}

/** Whether an expression is an object literal with the Google Content shape.
 *
 *  The Content shape requires `role` with value `'user'`/`'model'` (as a
 *  PropertyAssignment or a shorthand resolving to such) AND/OR `parts`, OR
 *  is a candidates envelope. Bare `{ parts: [...] }` without role is NOT
 *  sufficient — unrelated domain objects may have a `parts` property.
 *  However, `{ parts: [{ text: ... }] }` (Part objects) IS Google-shaped.
 */
export function isGoogleShapedObject(expr: ts.Expression): boolean {
  if (!ts.isObjectLiteralExpression(expr)) return false;
  let hasRoleValue = false;
  let hasRoleProp = false;
  let hasParts = false;
  let hasPartsObjects = false;
  for (const prop of expr.properties) {
    const keyName = propKeyName(prop);
    if (keyName === 'role') {
      const roleResult = checkRoleProp(expr, prop);
      hasRoleProp = roleResult.hasRoleProp || hasRoleProp;
      hasRoleValue = roleResult.hasRoleValue || hasRoleValue;
    }
    if (keyName === 'parts') {
      hasParts = true;
      if (hasPartObjects(prop)) {
        hasPartsObjects = true;
      }
    }
  }
  // Google Content shape: role:'user'|'model' + parts, or Part-shaped parts
  return (
    hasPartsObjects ||
    hasRoleAndParts(hasRoleValue, hasParts) ||
    hasRoleAndParts(hasRoleProp, hasParts)
  );
}

/**
 * Whether a node is a `candidates: [{ content: {role?,parts?} }]` property
 * assignment. Inspects ALL candidate elements and requires content to be an
 * object with `role` or `parts` (Finding #2). Supports string-literal keys.
 *
 * Also resolves content assigned via a variable reference or shorthand
 * property back to its initializer (indirect shorthand envelope — Finding #5).
 * Also resolves candidate elements that are variable references to their
 * initializer (indirect `candidates: [candidateVar]` — Finding #5).
 */
export function isCandidatesContentAssignment(node: ts.Node): boolean {
  if (!ts.isPropertyAssignment(node)) return false;
  const name = propKeyName(node);
  if (name !== 'candidates') return false;
  if (!ts.isArrayLiteralExpression(node.initializer)) return false;
  if (node.initializer.elements.length === 0) return false;
  const sf = sfForNode(node);
  return node.initializer.elements.some((el) =>
    isGoogleShapedCandidateElement(sf, el),
  );
}

/** Whether a single candidate array element has the Google Content shape,
 *  resolving variable references and shorthand properties. */
function isGoogleShapedCandidateElement(
  sf: ts.SourceFile,
  el: ts.Expression,
): boolean {
  // Resolve identifier element: `candidates: [candidateVar]`
  let candidateObj = el;
  if (ts.isIdentifier(el)) {
    const resolved = resolveInitializer(sf, el.text, el);
    if (resolved === null || !ts.isObjectLiteralExpression(resolved)) {
      return false;
    }
    candidateObj = resolved;
  }
  if (!ts.isObjectLiteralExpression(candidateObj)) return false;
  const contentProp = candidateObj.properties.find(
    (p) => propKeyName(p) === 'content',
  );
  if (contentProp === undefined) return false;
  // Shorthand: `{ content }` — resolve the variable's initializer
  if (ts.isShorthandPropertyAssignment(contentProp)) {
    const resolved = resolveInitializer(sf, contentProp.name.text, contentProp);
    return resolved !== null && isGoogleShapedObject(resolved);
  }
  if (!ts.isPropertyAssignment(contentProp)) return false;
  // Direct variable reference: `{ content: contentVar }`
  if (ts.isIdentifier(contentProp.initializer)) {
    const resolved = resolveInitializer(
      sf,
      contentProp.initializer.text,
      contentProp,
    );
    return resolved !== null && isGoogleShapedObject(resolved);
  }
  return contentHasRoleOrParts(contentProp.initializer);
}

// ─── Provenance-constrained .parts access (Finding #5) ─────────────────────

/**
 * Whether a base expression for a `.parts` access has Google-shaped
 * provenance. Traces variable references back to their initializer and
 * checks for the Content shape (role/parts object literal) or a
 * candidates envelope. Also checks function-parameter type annotations
 * that declare both `role` and `parts` members (Google Content shape).
 *
 * This constrains F5 to values with proven Google-shaped provenance,
 * avoiding false positives on unrelated domain objects like
 * `const domain = { parts: ['wheel'] }; domain.parts.length`.
 */
export function hasGoogleShapedProvenance(
  sf: ts.SourceFile,
  base: ts.Expression,
): boolean {
  // Identifier: trace to variable initializer or parameter type annotation
  if (ts.isIdentifier(base)) {
    return hasIdentifierGoogleProvenance(sf, base);
  }
  // Property access: `x.content` — if x resolves to a candidates envelope
  if (
    ts.isPropertyAccessExpression(base) &&
    ts.isIdentifier(base.name) &&
    base.name.text === 'content'
  ) {
    return hasContentAccessProvenance(sf, base);
  }
  // Object literal inline: `{ role: 'model', parts: [] }.parts`
  if (ts.isObjectLiteralExpression(base)) {
    return isGoogleShapedObject(base);
  }
  return false;
}

/** Check provenance for an identifier base: variable initializer or param type. */
function hasIdentifierGoogleProvenance(
  sf: ts.SourceFile,
  base: ts.Identifier,
): boolean {
  const init = resolveInitializer(sf, base.text, base);
  if (
    init !== null &&
    (isGoogleShapedObject(init) || isCandidatesEnvelopeValue(init))
  ) {
    return true;
  }
  return hasGoogleShapedParamType(sf, base);
}

/** Check provenance for `x.content` property access. */
function hasContentAccessProvenance(
  sf: ts.SourceFile,
  base: ts.PropertyAccessExpression,
): boolean {
  const varName = ts.isIdentifier(base.expression) ? base.expression.text : '';
  const objInit = resolveInitializer(sf, varName, base);
  return objInit !== null && isCandidatesEnvelopeValue(objInit);
}

/** Whether an expression is an object literal that is a candidates envelope
 *  ({ candidates: [{ content: ... }] }). */
function isCandidatesEnvelopeValue(expr: ts.Expression): boolean {
  if (!ts.isObjectLiteralExpression(expr)) return false;
  return expr.properties.some(
    (p) =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      propKeyName(p) === 'candidates',
  );
}

/** Whether an identifier refers to a function parameter whose type annotation
 *  declares a Google Content shape (has a `parts` member — the Gemini
 *  Content discriminator; neutral IContent uses `blocks`). */
function hasGoogleShapedParamType(
  sf: ts.SourceFile,
  id: ts.Identifier,
): boolean {
  const param = findParameterByName(sf, id.text, id);
  if (param === null || param.type === undefined) return false;
  return isGoogleShapedTypeNode(param.type);
}

/** Function-like node kinds that can have parameters. */
function isFunctionWithParams(node: ts.Node): node is ts.SignatureDeclaration {
  const checks: ReadonlyArray<(n: ts.Node) => boolean> = [
    ts.isFunctionDeclaration,
    ts.isFunctionExpression,
    ts.isArrowFunction,
    ts.isMethodDeclaration,
    ts.isConstructorDeclaration,
  ];
  return checks.some((check) => check(node));
}

/** Find a function parameter matching `name` in an enclosing function scope
 *  of `fromNode`. Returns the parameter node, or null. */
function findParameterByName(
  sf: ts.SourceFile,
  name: string,
  fromNode: ts.Node,
): ts.ParameterDeclaration | null {
  let scope: ts.Node | undefined = fromNode.parent;
  while (scope !== undefined) {
    if (isFunctionWithParams(scope)) {
      const param = scope.parameters.find(
        (p) => ts.isIdentifier(p.name) && p.name.text === name,
      );
      if (param !== undefined) return param;
    }
    scope = scope.parent;
  }
  return null;
}

/** Extract the text name from a type-literal property signature's name node. */
function propertySignatureName(member: ts.TypeElement): string | null {
  if (!ts.isPropertySignature(member) || member.name === undefined) return null;
  return propertyNameText(member.name);
}

/** Whether a type annotation node declares a Google Content shape:
 *  has a `parts` member (the Gemini Content discriminator) or both
 *  `role` and `parts`. A type literal with `parts` is considered
 *  Content-shaped because the `parts` property name is the Gemini wire
 *  discriminator (neutral IContent uses `blocks`). */
function isGoogleShapedTypeNode(typeNode: ts.TypeNode): boolean {
  if (!ts.isTypeLiteralNode(typeNode)) return false;
  return typeNode.members.some(
    (member) => propertySignatureName(member) === 'parts',
  );
}

/**
 * Resolve a variable name to its initializer expression. Searches
 * enclosing scopes for const/let/var declarations before `fromNode`.
 * Exported for checkF7 candidates-typed-envelope detection.
 */
export function resolveVarInitializerFromNode(
  sf: ts.SourceFile,
  id: ts.Identifier,
): ts.Expression | null {
  let scope: ts.Node | undefined = id.parent;
  while (scope !== undefined) {
    const found = searchScopeForInitializer(sf, scope, id.text, id);
    if (found !== null) return found;
    scope = scope.parent;
  }
  return null;
}

function searchScopeForInitializer(
  sf: ts.SourceFile,
  node: ts.Node,
  name: string,
  fromNode: ts.Node,
): ts.Expression | null {
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.name.text === name &&
        decl.initializer !== undefined &&
        decl.getEnd() <= fromNode.getStart()
      ) {
        return decl.initializer;
      }
    }
  }
  for (const child of node.getChildren(sf)) {
    const found = searchScopeForInitializer(sf, child, name, fromNode);
    if (found !== null) return found;
  }
  return null;
}

// ─── F7 candidates-typed-envelope provenance ────────────────────────────────

/**
 * Whether a type annotation node has a `candidates` member.
 * Exported for checkF7 candidates-typed-envelope detection.
 */
export function typeHasCandidatesMember(typeNode: ts.TypeNode): boolean {
  if (!ts.isTypeLiteralNode(typeNode)) return false;
  return typeNode.members.some((member) => {
    if (!ts.isPropertySignature(member) || member.name === undefined) {
      return false;
    }
    const name = propertyNameText(member.name);
    return name === 'candidates';
  });
}

/**
 * Whether a call expression has a return-type annotation bearing a
 * `candidates` member. This provides provenance: the developer explicitly
 * declared the call returns a response-shaped envelope.
 *
 * Exported for checkF7 candidates-typed-envelope detection.
 */
export function callHasCandidatesReturnType(call: ts.CallExpression): boolean {
  const parent = call.parent;
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === call &&
    parent.type !== undefined &&
    typeHasCandidatesMember(parent.type)
  ) {
    return true;
  }
  const fn = resolveCalledFunction(call);
  if (
    fn !== null &&
    fn.type !== undefined &&
    typeHasCandidatesMember(fn.type)
  ) {
    return true;
  }
  return false;
}

/**
 * Resolve a call expression's callee to its function declaration within the
 * same source file. Returns null when the callee cannot be resolved.
 */
function resolveCalledFunction(
  call: ts.CallExpression,
): ts.FunctionDeclaration | null {
  const callee = call.expression;
  if (!ts.isIdentifier(callee)) return null;
  const calleeName = callee.text;
  const sf = call.getSourceFile();
  let result: ts.FunctionDeclaration | null = null;
  function visit(node: ts.Node): void {
    if (result !== null) return;
    if (
      ts.isFunctionDeclaration(node) &&
      node.name !== undefined &&
      node.name.text === calleeName
    ) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return result;
}

/**
 * Whether an identifier used as a `.candidates` base has candidates-bearing
 * provenance: either a variable declaration with a candidates type annotation,
 * or assigned from a call whose return type bears `candidates`.
 *
 * Exported for checkF7 candidates-typed-envelope detection.
 */
export function identifierHasCandidatesProvenance(
  sf: ts.SourceFile,
  id: ts.Identifier,
): boolean {
  const decl = findVariableDeclaration(sf, id);
  if (decl === null) return false;
  if (decl.type !== undefined && typeHasCandidatesMember(decl.type)) {
    return true;
  }
  if (
    decl.initializer !== undefined &&
    ts.isCallExpression(decl.initializer) &&
    callHasCandidatesReturnType(decl.initializer)
  ) {
    return true;
  }
  return false;
}

/** Find the VariableDeclaration node matching `name` in the source file. */
function findVariableDeclaration(
  sf: ts.SourceFile,
  id: ts.Identifier,
): ts.VariableDeclaration | null {
  let result: ts.VariableDeclaration | null = null;
  function visit(node: ts.Node): void {
    if (result !== null) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === id.text
    ) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return result;
}
