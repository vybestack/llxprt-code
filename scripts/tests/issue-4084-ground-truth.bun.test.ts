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
  computePlanMarkers,
  functionLengths,
  longestWithTies,
  planIdsOn,
} from '../issue4084-ground-truth.ts';

let repo: string;
const hashes: Record<string, string> = {};

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

function head(): string {
  return execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
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
  // Outside the last ten commits: its marker counts only because the file
  // changes inside the window, and blame names this older commit.
  commit('packages/old/old.ts', '// @plan:PLAN-OLD.P01\n', 'Old');
  hashes.old = head();
  for (let i = 0; i < 9; i++) commit(`pad${i}.md`, `pad ${i}\n`, 'Ada');
  commit(
    'packages/alpha/a.ts',
    '/** @plan:PLAN-A.P01 */\nconst x = 1; // @plan PLAN-B.P02.\n// @planning is not a marker\n',
    'Ada',
  );
  hashes.alpha = head();
  commit('packages/beta/b.tsx', 'export const B = 1;\n', 'Ada');
  commit(
    'packages/beta/b.tsx',
    'export const B = 1;\n// @plan:PLAN-A.P01 @plan:PLAN-A.P02\n',
    'Bob',
  );
  hashes.beta = head();
  commit('notes.md', '@plan:PLAN-A.P01 not typescript\n', 'Bob');
  commit('gone.ts', '// @plan:PLAN-GONE.P01\n', 'Bob');
  git(['rm', '-q', 'gone.ts'], 'Bob');
  git(['commit', '-q', '-m', 'remove gone.ts'], 'Bob');
  commit('scripts/tool.ts', "it('x @plan:PLAN-B.P02', () => {});\n", 'Bob');
  hashes.tool = head();
  commit('packages/old/old.ts', '// @plan:PLAN-OLD.P01\nconst y = 2;\n', 'Bob');
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
  it('counts @plan markers per plan ID, package and blamed commit in TypeScript files changed in the last ten commits', () => {
    const result = computePlanMarkers(repo, 'HEAD', 10);

    expect(result.files).toStrictEqual([
      'core/long.test.ts',
      'core/long.ts',
      'packages/alpha/a.ts',
      'packages/beta/b.tsx',
      'packages/old/old.ts',
      'scripts/tool.ts',
    ]);
    expect(result.byPlanId).toStrictEqual({
      'PLAN-A.P01': 2,
      'PLAN-B.P02': 2,
      'PLAN-A.P02': 1,
      'PLAN-OLD.P01': 1,
    });
    expect(result.byPackage).toStrictEqual({
      'packages/alpha': 2,
      'packages/beta': 2,
      'packages/old': 1,
      scripts: 1,
    });
    expect(result.byCommit).toStrictEqual({
      [hashes.alpha]: 2,
      [hashes.beta]: 2,
      [hashes.old]: 1,
      [hashes.tool]: 1,
    });
    expect(result.total).toBe(6);
  });

  it('reads plan IDs after a colon or spaces and ignores words that only start with @plan', () => {
    expect(planIdsOn('// @plan:PLAN-X.P01 @requirement:REQ-1')).toStrictEqual([
      'PLAN-X.P01',
    ]);
    expect(
      planIdsOn(" * @plan PLAN-Y.P07/P11, see '@plan:ISSUE-3'"),
    ).toStrictEqual(['PLAN-Y.P07/P11', 'ISSUE-3']);
    expect(planIdsOn('@planning @plans @plan-x')).toStrictEqual([]);
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

  it('leaves anonymous callbacks out when asked for named functions only', () => {
    const named = computeLongestFunctions(repo, 'core', {
      includeTests: true,
      namedOnly: true,
      limit: 2,
    });

    expect(
      named.map(({ file, name, lines }) => [file, name, lines]),
    ).toStrictEqual([
      ['core/long.ts', 'method', 5],
      ['core/long.ts', 'shortOne', 3],
    ]);
  });

  it('lists every function tied with the last of the top entries', () => {
    const { top, tiedAtCutoff } = longestWithTies(repo, 'core', {
      ref: 'HEAD',
      includeTests: false,
      limit: 2,
    });

    expect(top.map(({ name }) => name)).toStrictEqual(['method', 'shortOne']);
    expect(tiedAtCutoff.map(({ name }) => name)).toStrictEqual([
      'shortOne',
      'arrow',
    ]);
  });
});
