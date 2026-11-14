/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4084: the scenario A/B ground truth is computed from a commit with
 * git and the TypeScript parser. These tests build a small repository whose
 * answers are known and check both computations against it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  computeLongestFunctions,
  computeTodoAuthors,
  functionLengths,
} from '../issue4084-ground-truth.ts';

let repo: string;

function git(args: readonly string[], author = 'Ada'): void {
  execFileSync('git', ['-C', repo, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: author,
      GIT_AUTHOR_EMAIL: `${author.toLowerCase()}@example.com`,
      GIT_COMMITTER_NAME: author,
      GIT_COMMITTER_EMAIL: `${author.toLowerCase()}@example.com`,
    },
  });
}

function commit(file: string, content: string, author: string): void {
  const target = path.join(repo, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  git(['add', file], author);
  git(['commit', '-q', '-m', `edit ${file}`], author);
}

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'issue4084-ground-truth-'));
  git(['init', '-q']);
  // Outside the last ten commits: its marker must not count.
  commit('old.ts', '// TODO old\n', 'Old');
  for (let i = 0; i < 9; i++) commit(`pad${i}.md`, `pad ${i}\n`, 'Ada');
  commit('a.ts', '// TODO one\nconst x = 1; // FIXME two\n', 'Ada');
  commit('b.tsx', 'export const B = 1;\n', 'Ada');
  commit('b.tsx', 'export const B = 1;\n// TODO from bob\n', 'Bob');
  commit('notes.md', 'TODO not typescript\n', 'Bob');
  commit('gone.ts', '// TODO deleted\n', 'Bob');
  git(['rm', '-q', 'gone.ts'], 'Bob');
  git(['commit', '-q', '-m', 'remove gone.ts'], 'Bob');
  commit(
    'core/long.ts',
    [
      'export function shortOne() {',
      '  return 1;',
      '}',
      'export class Box {',
      '  method() {',
      '    const a = 1;',
      '    const b = 2;',
      '    return a + b;',
      '  }',
      '}',
      'export const arrow = () => {',
      '  return 3;',
      '};',
      '',
    ].join('\n'),
    'Ada',
  );
  commit(
    'core/long.test.ts',
    ['it("x", () => {', '  a();', '  b();', '  c();', '  d();', '});', ''].join(
      '\n',
    ),
    'Ada',
  );
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('issue4084 ground truth', () => {
  it('counts TODO/FIXME lines per blamed author in TypeScript files changed in the last ten commits', () => {
    const result = computeTodoAuthors(repo, 'HEAD', 10);

    expect(result.files).toStrictEqual([
      'a.ts',
      'b.tsx',
      'core/long.test.ts',
      'core/long.ts',
    ]);
    expect(result.byAuthor).toStrictEqual({ Ada: 2, Bob: 1 });
    expect(result.total).toBe(3);
  });

  it('measures function spans from the declaration line to the closing line', () => {
    const spans = functionLengths(
      'x.ts',
      'function f() {\n  return 1;\n}\nconst g = function named() {\n};\n',
    );

    expect(spans).toStrictEqual([
      { file: 'x.ts', name: 'f', startLine: 1, lines: 3 },
      { file: 'x.ts', name: 'named', startLine: 4, lines: 2 },
    ]);
  });

  it('ranks the longest functions under a directory, with and without test files', () => {
    const withTests = computeLongestFunctions(repo, 'core', {
      includeTests: true,
      limit: 2,
    });
    const withoutTests = computeLongestFunctions(repo, 'core', {
      includeTests: false,
      limit: 3,
    });

    expect(
      withTests.map(({ file, name, lines }) => [file, name, lines]),
    ).toStrictEqual([
      ['core/long.test.ts', '<anonymous>', 6],
      ['core/long.ts', 'method', 5],
    ]);
    expect(
      withoutTests.map(({ file, name, lines }) => [file, name, lines]),
    ).toStrictEqual([
      ['core/long.ts', 'method', 5],
      ['core/long.ts', 'shortOne', 3],
      ['core/long.ts', 'arrow', 3],
    ]);
  });
});
