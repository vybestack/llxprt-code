/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AST utilities, file discovery, and allow-list matching for the
 * agents-neutral-gate (PLAN-20260707-AGENTNEUTRAL.P31).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, relative, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { isErrnoException } from './utils/error-guards.ts';
import {
  type Hit,
  type AllowlistEntry,
  type CheckSubkind,
  H_FUNCTION_BODY_PATTERNS,
} from './agents-neutral-gate-config.ts';

// ─── Paths ──────────────────────────────────────────────────────────────────

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SCAN_ROOT = 'packages/agents/src';

export const ALLOWLIST_PATH = join(
  REPO_ROOT,
  'dev-docs/agents-neutral-gate-allowlist.md',
);

// ─── File discovery ─────────────────────────────────────────────────────────

const FILE_EXCLUSION_GLOBS: readonly string[] = [
  '**/*.test.*',
  '**/*.spec.*',
  '**/*-test-helpers*',
  '**/*test-helper*',
];
const DIR_EXCLUSION_GLOBS: readonly string[] = ['**/__tests__/**'];
const PRUNED_DIR_BASE_NAMES = new Set([
  '__tests__',
  'node_modules',
  'dist',
  'build',
  '.turbo',
  'coverage',
]);

function matchGlob(glob: string, relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  const escaped = glob.replace(/[\\^$.|?*+(){}[\]]/g, (ch) => '\\' + ch);
  const body = escaped
    .replace(/\\\*\\\*\//g, '(?:.*/)?')
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*');
  return new RegExp('^' + body + '$').test(normalized);
}

function isExcludedFile(repoRoot: string, filePath: string): boolean {
  const rel = relative(repoRoot, filePath).replace(/\\/g, '/');
  return FILE_EXCLUSION_GLOBS.some((g) => matchGlob(g, rel));
}

function isExcludedDir(
  repoRoot: string,
  dirPath: string,
  isStart: boolean,
): boolean {
  if (isStart) return false;
  const rel = relative(repoRoot, dirPath).replace(/\\/g, '/');
  return DIR_EXCLUSION_GLOBS.some((g) => matchGlob(g, rel));
}

function isPrunableDir(
  repoRoot: string,
  name: string,
  full: string,
  isStart: boolean,
): boolean {
  if (!isStart && PRUNED_DIR_BASE_NAMES.has(name)) return true;
  return isExcludedDir(repoRoot, full, false);
}

/** Walk a directory tree for production .ts/.tsx files. The START directory
 *  is never pruned (so --root scripts/__tests__/fixtures evaluates fixtures). */
function walkDir(repoRoot: string, dir: string): string[] {
  const results: string[] = [];
  function walk(d: string, isStart: boolean): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch (err) {
      if (isErrnoException(err, 'ENOENT') || isErrnoException(err, 'ENOTDIR'))
        return;
      throw err;
    }
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (isPrunableDir(repoRoot, entry.name, full, isStart)) continue;
        walk(full, false);
      } else if (
        !isExcludedFile(repoRoot, full) &&
        entry.isFile() &&
        (extname(entry.name) === '.ts' || extname(entry.name) === '.tsx')
      ) {
        results.push(full);
      }
    }
  }
  walk(resolve(dir), true);
  return results;
}

export function productionFilesUnder(
  repoRoot: string,
  rootRel: string,
): string[] {
  const absRoot = join(repoRoot, rootRel);
  if (!existsSync(absRoot)) return [];
  return walkDir(repoRoot, absRoot);
}

// ─── Allow-list parsing ─────────────────────────────────────────────────────

/** Parse the central allow-list artifact (markdown table rows).
 *  Inline // gate-exempt comments grant NOTHING (OQ-17). */
export function parseAllowlist(path: string): AllowlistEntry[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf-8');
  const entries: AllowlistEntry[] = [];
  for (const line of content.split('\n')) {
    const parsed = parseAllowlistLine(line);
    if (parsed !== null) entries.push(parsed);
  }
  return entries;
}

function parseAllowlistLine(line: string): AllowlistEntry | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || trimmed.includes('---')) return null;
  if (trimmed.includes('File') && trimmed.includes('Subkind')) return null;
  const cells = trimmed
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (cells.length < 4) return null;
  return {
    file: cells[0].replace(/`/g, ''),
    subkind: cells[1].replace(/`/g, ''),
    contextPattern: cells[2].replace(/`/g, ''),
    justification: cells.slice(3).join(' | ').trim(),
  };
}

// ─── Allow-list matching ────────────────────────────────────────────────────

/** AST-context allow-list match: file AND subkind AND context.
 *  For checkH (H-usage-key), the context check is delegated entirely to
 *  hContextMatches (AST-context: enclosing function / schema / type-decl
 *  membership) — the generic contextSnippet includes() does NOT apply.
 *  For all other subkinds, contextSnippet includes(pattern) applies. */
export function matchesAstContext(
  hit: Hit,
  allowlist: readonly AllowlistEntry[],
): boolean {
  return allowlist.some(
    (entry) =>
      fileMatches(hit.file, entry.file) &&
      subkindMatches(hit.subkind, entry.subkind) &&
      (hit.subkind === 'H-usage-key'
        ? hContextMatches(hit, entry)
        : contextMatches(hit.contextSnippet, entry.contextPattern)),
  );
}

/**
 * checkH AST-context guard: for H-usage-key hits, the exemption must
 * additionally match on enclosing-function/schema name or type-declaration
 * membership (Major 4 — AST-context, NOT file-level).
 *
 * - If the pattern names a function/schema (H_FUNCTION_BODY_PATTERNS),
 *   the hit's enclosingFn must match.
 * - If the pattern is a usage key name (e.g. `promptTokenCount`) intended
 *   for a PropertySignature/type-alias declaration in event-types.ts, the
 *   hit MUST be inside a type declaration (hit.inTypeDecl === true) AND
 *   the context snippet must contain the key (Finding #1: runtime
 *   object/property hits must fail even if the snippet contains the key).
 * - A bare file-path exemption (pattern `*`) is REJECTED for H-usage-key.
 */
function hContextMatches(hit: Hit, entry: AllowlistEntry): boolean {
  if (hit.subkind !== 'H-usage-key') return true;
  const pattern = entry.contextPattern;
  // Reject bare file-level exemptions for usage keys (Major 4).
  if (pattern === '' || pattern === '*') return false;
  // Function-body/schema exemptions: enclosing name must match the pattern.
  if (H_FUNCTION_BODY_PATTERNS.has(pattern)) {
    return hit.enclosingFn === pattern;
  }
  // Declared-type-member exemptions (Finding #1): require hit inside a type
  // declaration (PropertySignature) AND snippet contains the key. Runtime
  // object/property hits are rejected even when the snippet includes the key.
  return hit.inTypeDecl === true && hit.contextSnippet.includes(pattern);
}

function fileMatches(hitFile: string, entryFile: string): boolean {
  return hitFile.endsWith(entryFile) || entryFile === '*';
}

function subkindMatches(
  hitSubkind: CheckSubkind,
  entrySubkind: string,
): boolean {
  return entrySubkind === hitSubkind || entrySubkind === '*';
}

function contextMatches(snippet: string, pattern: string): boolean {
  return pattern === '' || pattern === '*' || snippet.includes(pattern);
}

// ─── AST helpers ────────────────────────────────────────────────────────────

export function getLine(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

export function relRepo(filePath: string): string {
  return relative(REPO_ROOT, filePath).replace(/\\/g, '/');
}

export function snippetOf(sf: ts.SourceFile, node: ts.Node): string {
  const start = node.getStart();
  return sf.text
    .slice(start, Math.min(start + 80, node.getEnd()))
    .replace(/\n/g, ' ')
    .trim();
}

export function parseFile(filePath: string): ts.SourceFile | null {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
  return ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Collect all import declarations from a source file. */
export function collectImportDecls(sf: ts.SourceFile): ts.ImportDeclaration[] {
  const decls: ts.ImportDeclaration[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) decls.push(node);
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return decls;
}

/** Collect all imported names (local + property) from an import declaration. */
export function collectImportedNames(node: ts.ImportDeclaration): string[] {
  const names: string[] = [];
  const clause = node.importClause;
  if (clause === undefined) return names;
  if (clause.name !== undefined) names.push('default');
  if (clause.namedBindings === undefined) return names;
  if (ts.isNamedImports(clause.namedBindings)) {
    for (const el of clause.namedBindings.elements) {
      names.push(el.name.text);
      const prop = el.propertyName?.text;
      if (prop !== undefined) names.push(prop);
    }
  } else if (ts.isNamespaceImport(clause.namedBindings)) {
    names.push(clause.namedBindings.name.text);
  }
  return names;
}

/** Extract the callee name from a call-expression's expression node. */
export function calleeName(expr: ts.Expression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return '';
}

/**
 * Walk upward to find the enclosing named function declaration's name.
 * Returns the function name, or null if not inside a named function.
 * For checkH schema definitions (e.g. `const XSchema = z.object({...})`),
 * also returns the enclosing variable name when the initializer is a
 * call expression (zod/schema factory), but NOT for plain data
 * variables (`const usage = {...}`) to avoid premature matching.
 */
export function enclosingFunctionName(node: ts.Node): string | null {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isFunctionDeclaration(current) && current.name !== undefined) {
      return current.name.text;
    }
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    if (ts.isFunctionExpression(current) && current.name !== undefined) {
      return current.name.text;
    }
    if (
      ts.isArrowFunction(current) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }
    // Named schema-const initializer only (e.g. `const XSchema = z.object({...})`)
    const schemaName = schemaConstName(current);
    if (schemaName !== null) return schemaName;
    current = current.parent;
  }
  return null;
}

/** Returns the variable name if `current` is a named schema-const initializer
 *  (a variable declaration initialized by a call expression), else null. */
function schemaConstName(current: ts.Node): string | null {
  if (!ts.isVariableDeclaration(current)) return null;
  if (!ts.isIdentifier(current.name)) return null;
  if (
    current.initializer === undefined ||
    !ts.isCallExpression(current.initializer)
  ) {
    return null;
  }
  return current.name.text;
}
