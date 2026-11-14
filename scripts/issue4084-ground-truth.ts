/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ground truth for the issue #4084 code mode scenarios A and B, computed
 * from a git commit with git and the TypeScript parser only (no llxprt), so
 * the tmux runs can be scored against it.
 *
 * A: to-do and fix-me markers in the TypeScript files (`.ts`, `.tsx`) changed by
 *    `git diff --name-only <ref>~10..<ref>`, attributed to authors with
 *    `git blame`, counted per author.
 * B: the longest functions under a directory by line count (first line of the
 *    declaration through its closing line), reported both for every
 *    TypeScript file and with test files left out, because the prompt does
 *    not say which a model should count.
 *
 * Usage: bun scripts/issue4084-ground-truth.ts [--ref HEAD] [--repo .]
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import ts from 'typescript';

export interface TodoAuthors {
  readonly ref: string;
  readonly files: readonly string[];
  readonly total: number;
  readonly byAuthor: Readonly<Record<string, number>>;
}

export interface FunctionLength {
  readonly file: string;
  readonly name: string;
  readonly startLine: number;
  readonly lines: number;
}

const TODO_PATTERN = /\b(?:TODO|FIXME)\b/;
const TYPESCRIPT_FILE = /\.tsx?$/;

function git(repo: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

function existsAt(repo: string, ref: string, file: string): boolean {
  return git(repo, ['ls-tree', '--name-only', ref, '--', file]).trim() === file;
}

/** Authors of each line of `file` at `ref`, from one porcelain blame. */
function lineAuthors(repo: string, ref: string, file: string): string[] {
  const authors: string[] = [];
  let current = '';
  for (const line of git(repo, [
    'blame',
    '--line-porcelain',
    ref,
    '--',
    file,
  ]).split('\n')) {
    if (line.startsWith('author ')) current = line.slice('author '.length);
    else if (line.startsWith('\t')) authors.push(current);
  }
  return authors;
}

export function computeTodoAuthors(
  repo: string,
  ref = 'HEAD',
  commits = 10,
): TodoAuthors {
  const files = git(repo, ['diff', '--name-only', `${ref}~${commits}..${ref}`])
    .split('\n')
    .filter((file) => TYPESCRIPT_FILE.test(file) && existsAt(repo, ref, file))
    .sort();
  const byAuthor: Record<string, number> = {};
  let total = 0;
  for (const file of files) {
    const lines = git(repo, ['show', `${ref}:${file}`]).split('\n');
    const authors = lineAuthors(repo, ref, file);
    lines.forEach((text, index) => {
      if (!TODO_PATTERN.test(text)) return;
      const author = authors[index];
      byAuthor[author] = (byAuthor[author] ?? 0) + 1;
      total += 1;
    });
  }
  return { ref, files, total, byAuthor };
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

function argument(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index < 0 ? undefined : argv[index + 1];
}

function main(argv: readonly string[]): void {
  const repo = path.resolve(argument(argv, '--repo') ?? '.');
  const ref = argument(argv, '--ref') ?? 'HEAD';
  const commit = git(repo, ['rev-parse', ref]).trim();
  const directory = 'packages/agents/src/core';
  const report = {
    commit,
    a: computeTodoAuthors(repo, commit),
    b: {
      directory,
      all: computeLongestFunctions(repo, directory, {
        ref: commit,
        includeTests: true,
      }),
      excludingTests: computeLongestFunctions(repo, directory, {
        ref: commit,
        includeTests: false,
      }),
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.main) main(process.argv.slice(2));
