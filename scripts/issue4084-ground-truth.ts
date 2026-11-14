/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ground truth for the issue #4084 code mode scenarios A and B, computed
 * from git and the TypeScript parser only (no llxprt), so the tmux runs can
 * be scored against it. Both are pinned to the commit the scenarios name
 * (`SCENARIO_BASE`), because the code mode branch itself changes the files.
 *
 * A: every `@plan` marker in the TypeScript files (`.ts`, `.tsx`) changed by
 *    `git diff --name-only <base>~10..<base>`, read as they are at the base
 *    commit, counted per plan ID (the token after `@plan:` or `@plan `), per
 *    package (`packages/<name>`), and per commit that last touched the marker
 *    line according to `git blame <base> -- <file>`.
 * B: the longest functions under a directory by line count (first line of the
 *    declaration through its closing line), reported both for every
 *    TypeScript file and with test files left out, because the prompt does
 *    not say which a model should count. The B prompt reads the working tree,
 *    so the report also says whether the ranking at `--ref` (default HEAD)
 *    gives the same files, names and lengths as the base commit.
 *
 * Usage: bun scripts/issue4084-ground-truth.ts [--ref HEAD] [--repo .]
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import ts from 'typescript';

/** The commit scenarios A and B are pinned to. */
export const SCENARIO_BASE = 'e3c1782b96';

export interface PlanMarker {
  readonly file: string;
  readonly line: number;
  readonly planId: string;
  readonly commit: string;
}

export interface PlanMarkers {
  readonly ref: string;
  readonly files: readonly string[];
  readonly total: number;
  readonly byPlanId: Readonly<Record<string, number>>;
  readonly byPackage: Readonly<Record<string, number>>;
  readonly byCommit: Readonly<Record<string, number>>;
  readonly markers: readonly PlanMarker[];
}

export interface FunctionLength {
  readonly file: string;
  readonly name: string;
  readonly startLine: number;
  readonly lines: number;
}

/** `@plan` followed by `:` or spaces and the plan ID; `@planning` is not one. */
const PLAN_MARKER = /@plan(?:[:\s]+([^\s'"`,;()[\]]+))?(?![\w-])/g;
const TYPESCRIPT_FILE = /\.tsx?$/;
const PORCELAIN_HEADER = /^([0-9a-f]{40}) \d+ \d+/;

function git(repo: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

function existsAt(repo: string, ref: string, file: string): boolean {
  return git(repo, ['ls-tree', '--name-only', ref, '--', file]).trim() === file;
}

/** The commit that last touched each line of `file` at `ref`, from one blame. */
function lineCommits(repo: string, ref: string, file: string): string[] {
  const commits: string[] = [];
  let current = '';
  for (const line of git(repo, [
    'blame',
    '--line-porcelain',
    ref,
    '--',
    file,
  ]).split('\n')) {
    const header = PORCELAIN_HEADER.exec(line);
    if (header) current = header[1];
    else if (line.startsWith('\t')) commits.push(current);
  }
  return commits;
}

/** `packages/<name>` for package files, otherwise the top directory. */
export function packageOf(file: string): string {
  const parts = file.split('/');
  if (parts[0] === 'packages' && parts.length > 2)
    return parts.slice(0, 2).join('/');
  return parts.length > 1 ? parts[0] : '.';
}

/** A sentence-ending period after an ID is not part of it. */
function withoutTrailingDots(id: string): string {
  let end = id.length;
  while (end > 0 && id[end - 1] === '.') end -= 1;
  return id.slice(0, end);
}

/** Plan IDs of the markers on one line, in order; a bare `@plan` is `(none)`. */
export function planIdsOn(text: string): string[] {
  return [...text.matchAll(PLAN_MARKER)].map((match) =>
    withoutTrailingDots(match[1] ?? '(none)'),
  );
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function sortedCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts).sort(
      ([leftKey, left], [rightKey, right]) =>
        right - left || leftKey.localeCompare(rightKey),
    ),
  );
}

function markersIn(repo: string, ref: string, file: string): PlanMarker[] {
  const lines = git(repo, ['show', `${ref}:${file}`]).split('\n');
  const found = lines.flatMap((text, index) =>
    planIdsOn(text).map((planId) => ({ index, planId })),
  );
  if (found.length === 0) return [];
  const commits = lineCommits(repo, ref, file);
  return found.map(({ index, planId }) => ({
    file,
    line: index + 1,
    planId,
    commit: commits[index],
  }));
}

export function computePlanMarkers(
  repo: string,
  ref: string,
  commits = 10,
): PlanMarkers {
  const files = git(repo, ['diff', '--name-only', `${ref}~${commits}..${ref}`])
    .split('\n')
    .filter((file) => TYPESCRIPT_FILE.test(file) && existsAt(repo, ref, file))
    .sort();
  const markers = files.flatMap((file) => markersIn(repo, ref, file));
  const byPlanId: Record<string, number> = {};
  const byPackage: Record<string, number> = {};
  const byCommit: Record<string, number> = {};
  for (const marker of markers) {
    increment(byPlanId, marker.planId);
    increment(byPackage, packageOf(marker.file));
    increment(byCommit, marker.commit);
  }
  return {
    ref,
    files,
    total: markers.length,
    byPlanId: sortedCounts(byPlanId),
    byPackage: sortedCounts(byPackage),
    byCommit: sortedCounts(byCommit),
    markers,
  };
}

/** Function kinds that carry their own name. */
const SELF_NAMED = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.FunctionExpression,
]);

const FUNCTION_KINDS = new Set<ts.SyntaxKind>([
  ...SELF_NAMED,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.ArrowFunction,
]);

function ownName(node: ts.Node): string | undefined {
  if (!SELF_NAMED.has(node.kind)) return undefined;
  return (node as ts.FunctionLikeDeclarationBase).name?.getText();
}

/** The name a function gets from what holds it (`const f = () => ...`). */
function holderName(node: ts.Node): string | undefined {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent))
    return ts.isIdentifier(parent.name) ? parent.name.text : undefined;
  if (ts.isPropertyDeclaration(parent)) return parent.name.getText();
  return undefined;
}

function functionName(node: ts.Node): string {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  return ownName(node) ?? holderName(node) ?? '<anonymous>';
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return FUNCTION_KINDS.has(node.kind);
}

/** Every function with a body in `source`, with its line span. */
export function functionLengths(
  file: string,
  source: string,
): FunctionLength[] {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: FunctionLength[] = [];
  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node) && node.body !== undefined) {
      const start = parsed.getLineAndCharacterOfPosition(
        node.getStart(parsed),
      ).line;
      const end = parsed.getLineAndCharacterOfPosition(node.getEnd()).line;
      found.push({
        file,
        name: functionName(node),
        startLine: start + 1,
        lines: end - start + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(file) || file.includes('/__tests__/');
}

export function computeLongestFunctions(
  repo: string,
  directory: string,
  options: { ref?: string; limit?: number; includeTests: boolean },
): FunctionLength[] {
  const ref = options.ref ?? 'HEAD';
  const files = git(repo, [
    'ls-tree',
    '-r',
    '--name-only',
    ref,
    '--',
    directory,
  ])
    .split('\n')
    .filter((file) => TYPESCRIPT_FILE.test(file))
    .filter((file) => options.includeTests || !isTestFile(file));
  return files
    .flatMap((file) =>
      functionLengths(file, git(repo, ['show', `${ref}:${file}`])),
    )
    .sort(
      (left, right) =>
        right.lines - left.lines ||
        left.file.localeCompare(right.file) ||
        left.startLine - right.startLine,
    )
    .slice(0, options.limit ?? 10);
}

/**
 * The top `limit` functions plus every function tied with the last of them,
 * so a ranking that picks a different member of a tie can be scored.
 */
export function longestWithTies(
  repo: string,
  directory: string,
  options: { ref: string; limit: number; includeTests: boolean },
): { top: FunctionLength[]; tiedAtCutoff: FunctionLength[] } {
  const ranked = computeLongestFunctions(repo, directory, {
    ...options,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const top = ranked.slice(0, options.limit);
  const cutoff = top[top.length - 1]?.lines;
  return {
    top,
    tiedAtCutoff: ranked.filter((entry) => entry.lines === cutoff),
  };
}

function rankingKey(entries: readonly FunctionLength[]): string {
  return JSON.stringify(
    entries.map(({ file, name, lines }) => [file, name, lines]),
  );
}

function argument(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index < 0 ? undefined : argv[index + 1];
}

function main(argv: readonly string[]): void {
  const repo = path.resolve(argument(argv, '--repo') ?? '.');
  const ref = git(repo, [
    'rev-parse',
    argument(argv, '--ref') ?? 'HEAD',
  ]).trim();
  const base = git(repo, ['rev-parse', SCENARIO_BASE]).trim();
  const directory = 'packages/agents/src/core';
  const longest = (at: string, includeTests: boolean) =>
    longestWithTies(repo, directory, { ref: at, limit: 10, includeTests });
  const atBase = {
    all: longest(base, true),
    excludingTests: longest(base, false),
  };
  const atRef = {
    all: longest(ref, true),
    excludingTests: longest(ref, false),
  };
  const report = {
    base,
    ref,
    a: computePlanMarkers(repo, base),
    b: {
      directory,
      ...atBase,
      sameRankingAtRef:
        rankingKey(atBase.all.tiedAtCutoff) ===
          rankingKey(atRef.all.tiedAtCutoff) &&
        rankingKey(atBase.all.top) === rankingKey(atRef.all.top) &&
        rankingKey(atBase.excludingTests.top) ===
          rankingKey(atRef.excludingTests.top) &&
        rankingKey(atBase.excludingTests.tiedAtCutoff) ===
          rankingKey(atRef.excludingTests.tiedAtCutoff),
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.main) main(process.argv.slice(2));
