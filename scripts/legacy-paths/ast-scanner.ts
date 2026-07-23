/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AST-based legacy-path dataflow scanner (Finding #5).
 *
 * The regex scanner (check-legacy-paths.ts) catches single-line home-anchored
 * patterns but cannot detect:
 *
 * 1. **Arbitrary local aliases**: `const myDir = '.llxprt'; path.join(homedir(), myDir)`
 *    where the literal `.llxprt` is assigned to a variable on one line and
 *    joined with `homedir()` on another.
 * 2. **Multiline path.join**: `path.join(\n  os.homedir(),\n  '.llxprt',\n)`
 *    where `homedir()` and `.llxprt` are on separate lines.
 * 3. **The exact telemetry prior shape**: `const SETTINGS_DIR = join(homedir(), '.llxprt')`
 *    that was the original finding-1 pattern.
 *
 * This module uses the TypeScript compiler API (available in the repo) to
 * perform a dataflow-aware scan of `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`
 * files. It tracks string-literal assignments to local variables and detects
 * when any `.llxprt`-bearing string (or a variable aliased to one) is joined
 * with a `homedir()`/`os.homedir()` call.
 *
 * Allowlist semantics are identical to the regex scanner: entries from
 * `legacy-path-allowlist.json` narrow suppressions to `path` + optional
 * `pattern`. The AST scanner reuses the same allowlist.
 */

import * as ts from 'typescript';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { CompiledAllowlist } from './config.js';

/**
 * Matches strings that contain `.llxprt` as a path segment (e.g. `.llxprt`,
 * `.llxprt/settings.json`). Used to detect alias assignments.
 */
const DOT_LLPRT_PATTERN = /\.llxprt(?=[/"'`)}\s$]|$)/;

/**
 * An AST-detected legacy-path violation.
 */
export interface AstMatch {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
  readonly patternId: string;
  readonly patternDescription: string;
}

/**
 * Maps a file path to the TypeScript {@link ts.ScriptKind} for parsing. Files
 * that don't match a known extension fall back to {@link ts.ScriptKind.Unknown}.
 */
const SCRIPT_KIND_BY_EXTENSION: ReadonlyMap<string, ts.ScriptKind> = new Map([
  ['.tsx', ts.ScriptKind.TSX],
  ['.ts', ts.ScriptKind.TS],
  ['.jsx', ts.ScriptKind.JSX],
  ['.js', ts.ScriptKind.JS],
  ['.mjs', ts.ScriptKind.JS],
  ['.cjs', ts.ScriptKind.JS],
]);

function scriptKindForFile(filePath: string): ts.ScriptKind {
  for (const [ext, kind] of SCRIPT_KIND_BY_EXTENSION) {
    if (filePath.endsWith(ext)) {
      return kind;
    }
  }
  return ts.ScriptKind.Unknown;
}

/**
 * Scans a TypeScript/JavaScript file for dataflow-aware legacy-path
 * constructions: `.llxprt` joined with `homedir()` via local aliases or
 * multiline path.join.
 *
 * Returns a list of matches. The `rootDir` is used to compute repo-relative
 * paths for allowlist matching.
 */
export function scanFileAst(
  filePath: string,
  rootDir: string,
  allowlist: CompiledAllowlist,
): { matches: AstMatch[]; suppressed: AstMatch[] } {
  const relPath = relative(rootDir, filePath).replace(/\\/g, '/');
  const content = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    relPath,
    content,
    ts.ScriptTarget.Latest,
    true, // setParentNodes
    scriptKindForFile(filePath),
  );

  // Phase 1: Collect local variable/const identifiers that are assigned a
  // string literal containing `.llxprt`.
  const aliasMap = new Map<string, string>(); // identifier → original string value
  collectAliases(sourceFile, aliasMap);

  // Phase 2: Walk the AST and detect path.join/concat calls that combine
  // homedir() with a `.llxprt`-bearing string or alias.
  const allMatches: AstMatch[] = [];
  scanNode(sourceFile, aliasMap, allMatches);

  // Phase 3: Apply allowlist suppressions.
  const matches: AstMatch[] = [];
  const suppressed: SuppressedAstMatch[] = [];
  for (const match of allMatches) {
    const { suppressed: isSup, reason } = checkSuppression(match, allowlist);
    if (isSup) {
      suppressed.push({ ...match, reason });
    } else {
      matches.push(match);
    }
  }
  return { matches, suppressed };
}

/**
 * An AST-detected match suppressed by the allowlist, with the suppression
 * reason preserved for auditability.
 */
export interface SuppressedAstMatch extends AstMatch {
  readonly reason: string;
}

/**
 * Returns true when a node is a variable declaration with an identifier name
 * and a string-literal or identifier initializer — the only declarations that
 * can participate in alias chains.
 */
function isAliasableDeclaration(node: ts.Node): node is ts.VariableDeclaration {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) {
    return false;
  }
  if (node.initializer === undefined) {
    return false;
  }
  return (
    ts.isStringLiteral(node.initializer) || ts.isIdentifier(node.initializer)
  );
}

/**
 * Phase 1: Collect local variable/const identifiers assigned a string literal
 * containing `.llxprt`, plus identifier-to-identifier aliases.
 *
 * Two-pass order-independent collection: first pass collects all direct
 * `.llxprt` string-literal aliases; second pass resolves identifier-to-
 * identifier aliases against the now-complete direct set. This ensures
 * `const A = B;` before `const B = '.llxprt';` is resolved correctly regardless
 * of source order.
 */
function collectAliases(
  sourceFile: ts.SourceFile,
  aliasMap: Map<string, string>,
): void {
  const declarations: ts.VariableDeclaration[] = [];
  function visit(node: ts.Node): void {
    if (isAliasableDeclaration(node)) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  // First pass: collect all direct .llxprt string-literal aliases.
  for (const decl of declarations) {
    if (
      ts.isIdentifier(decl.name) &&
      ts.isStringLiteral(decl.initializer!) &&
      DOT_LLPRT_PATTERN.test(decl.initializer.text)
    ) {
      aliasMap.set(decl.name.text, decl.initializer.text);
    }
  }

  // Second pass: resolve identifier-to-identifier aliases to a fixed point so
  // order-independent chains are fully resolved.
  let changed = true;
  while (changed) {
    changed = resolveAliasPass(declarations, aliasMap);
  }
}

/**
 * Single pass over declarations that resolves identifier-to-identifier
 * aliases. Returns true when at least one new alias was registered.
 */
function resolveAliasPass(
  declarations: readonly ts.VariableDeclaration[],
  aliasMap: Map<string, string>,
): boolean {
  let changed = false;
  for (const decl of declarations) {
    if (!ts.isIdentifier(decl.name) || !ts.isIdentifier(decl.initializer!)) {
      continue;
    }
    const source = aliasMap.get(decl.initializer.text);
    if (source !== undefined && !aliasMap.has(decl.name.text)) {
      aliasMap.set(decl.name.text, source);
      changed = true;
    }
  }
  return changed;
}

/**
 * Phase 2: Walk the AST and detect path.join/concat/template expressions that
 * combine homedir() with a `.llxprt`-bearing string or alias.
 */
function scanNode(
  sourceFile: ts.SourceFile,
  aliasMap: Map<string, string>,
  matches: AstMatch[],
): void {
  function visit(node: ts.Node): void {
    // Detect CallExpression: path.join(homedir(), '.llxprt')
    // or path.join(os.homedir(), alias)
    // or any function call where one arg is homedir() and another is
    // .llxprt-bearing.
    if (ts.isCallExpression(node)) {
      checkCallExpression(node, sourceFile, aliasMap, matches);
    }
    // Detect template literal: `${homedir()}/.llxprt` or
    // `${os.homedir()}/.llxprt`
    if (ts.isTemplateExpression(node)) {
      checkTemplateExpression(node, sourceFile, matches);
    }
    // Detect binary + concatenation: homedir() + '/.llxprt'
    if (ts.isBinaryExpression(node)) {
      checkBinaryExpression(node, sourceFile, aliasMap, matches);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

/**
 * Returns true when a node is a `homedir()` or `os.homedir()` call.
 */
function isHomedirCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const expr = node.expression;
  // homedir()
  if (ts.isIdentifier(expr) && expr.text === 'homedir') return true;
  // os.homedir()
  if (
    ts.isPropertyAccessExpression(expr) &&
    expr.name.text === 'homedir' &&
    ts.isIdentifier(expr.expression)
  ) {
    return true;
  }
  return false;
}

/**
 * Returns true when a node is a string literal or identifier aliasing a
 * `.llxprt`-bearing string.
 */
function isDotLlxprtValue(
  node: ts.Node,
  aliasMap: Map<string, string>,
): boolean {
  if (ts.isStringLiteral(node) && DOT_LLPRT_PATTERN.test(node.text)) {
    return true;
  }
  if (ts.isIdentifier(node)) {
    const aliased = aliasMap.get(node.text);
    if (aliased !== undefined && DOT_LLPRT_PATTERN.test(aliased)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks a CallExpression for homedir() + .llxprt patterns.
 */
function checkCallExpression(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  aliasMap: Map<string, string>,
  matches: AstMatch[],
): void {
  // Check all argument pairs: is any arg homedir() and another .llxprt?
  const args = node.arguments;
  let hasHomedir = false;
  let hasDotLlxprt = false;
  for (const arg of args) {
    if (isHomedirCall(arg)) hasHomedir = true;
    if (isDotLlxprtValue(arg, aliasMap)) hasDotLlxprt = true;
  }
  if (hasHomedir && hasDotLlxprt) {
    const pos = node.getStart(sourceFile);
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
    matches.push({
      file: sourceFile.fileName,
      line: line + 1,
      column: character + 1,
      text: node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 120),
      patternId: 'ast-homedir-dotllxprt-join',
      patternDescription:
        'AST: `homedir()` joined with `.llxprt` (path.join/concat), possibly via alias or multiline',
    });
  }
}

/**
 * Checks a TemplateExpression for `${homedir()}/.llxprt` patterns.
 */
function checkTemplateExpression(
  node: ts.TemplateExpression,
  sourceFile: ts.SourceFile,
  matches: AstMatch[],
): void {
  // Check template spans: ${homedir()} followed by .llxprt
  for (const span of node.templateSpans) {
    if (
      isHomedirCall(span.expression) &&
      DOT_LLPRT_PATTERN.test(span.literal.text)
    ) {
      const pos = node.getStart(sourceFile);
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
      matches.push({
        file: sourceFile.fileName,
        line: line + 1,
        column: character + 1,
        text: node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 120),
        patternId: 'ast-homedir-template-dotllxprt',
        patternDescription: 'AST: template literal `${homedir()}/.llxprt`',
      });
    }
  }
}

/**
 * Checks a BinaryExpression for homedir() + '/.llxprt' concatenation.
 */
function checkBinaryExpression(
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  aliasMap: Map<string, string>,
  matches: AstMatch[],
): void {
  if (node.operatorToken.kind !== ts.SyntaxKind.PlusToken) return;
  const leftHomrightDotLlxprt =
    isHomedirCall(node.left) && isDotLlxprtValue(node.right, aliasMap);
  const rightHomleftDotLlxprt =
    isHomedirCall(node.right) && isDotLlxprtValue(node.left, aliasMap);
  if (leftHomrightDotLlxprt || rightHomleftDotLlxprt) {
    const pos = node.getStart(sourceFile);
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
    matches.push({
      file: sourceFile.fileName,
      line: line + 1,
      column: character + 1,
      text: node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 120),
      patternId: 'ast-homedir-concat-dotllxprt',
      patternDescription:
        'AST: `homedir()` concatenated with `.llxprt` (binary +)',
    });
  }
}

/**
 * Checks whether a specific match is suppressed by the allowlist.
 */
function checkSuppression(
  match: AstMatch,
  allowlist: CompiledAllowlist,
): { suppressed: boolean; reason: string } {
  const entries = allowlist.get(match.file);
  if (entries === undefined) {
    return { suppressed: false, reason: '' };
  }
  for (const entry of entries) {
    if (entry.patterns.length === 0) {
      return { suppressed: true, reason: entry.reason };
    }
    for (const pattern of entry.patterns) {
      if (pattern.test(match.text)) {
        return { suppressed: true, reason: entry.reason };
      }
    }
  }
  return { suppressed: false, reason: '' };
}
