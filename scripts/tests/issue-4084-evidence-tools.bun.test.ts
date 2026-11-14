/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4084: the scenario scorers committed with the code mode evidence run
 * from where they are committed, from any working directory, with no
 * checkout-specific paths. Scenario A is scored against the committed answer
 * and ground truth; scenario B against a small repository built here, since
 * the B ranking is computed with git at a commit a shallow clone lacks.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { computeLongestFunctions } from '../issue4084-ground-truth.ts';

const ROOT = path.resolve(import.meta.dir, '../..');
const EVIDENCE = path.join(ROOT, 'project-plans/issue4084/evidence');
const TOOLS = path.join(EVIDENCE, 'tools');
const CORE = 'packages/agents/src/core';

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'issue4084-evidence-tools-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Runs a committed evidence tool with bun from an unrelated directory. */
function runTool(tool: string, args: readonly string[]): unknown {
  const run = spawnSync(process.execPath, [path.join(TOOLS, tool), ...args], {
    cwd: scratch,
    encoding: 'utf8',
  });
  expect({ status: run.status, stderr: run.stderr }).toStrictEqual({
    status: 0,
    stderr: '',
  });
  return JSON.parse(run.stdout) as unknown;
}

/** A repository whose core directory holds twelve functions of known size. */
function buildScenarioBRepo(): string {
  const repo = path.join(scratch, 'repo');
  const file = path.join(repo, CORE, 'sizes.ts');
  mkdirSync(path.dirname(file), { recursive: true });
  const functions = Array.from({ length: 12 }, (_, index) => {
    const body = Array.from(
      { length: index + 2 },
      (_, line) => `  const v${line} = ${line};`,
    );
    return [`export function size${index + 1}() {`, ...body, '}'].join('\n');
  });
  writeFileSync(file, `${functions.join('\n')}\n`);
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    ['-c', 'user.name=Ada', '-c', 'user.email=ada@example.com', 'commit', '-q', '-m', 'sizes'],
  ])
    execFileSync('git', ['-C', repo, ...args]);
  return repo;
}

describe('issue4084 evidence tools', () => {
  it('scores the committed scenario A answer from the committed scorer and ground truth', () => {
    const score = runTool('score-a.ts', [
      path.join(EVIDENCE, 'a-plans-off/final-answer.md'),
      path.join(EVIDENCE, 'ground-truth.json'),
    ]);

    expect(score).toStrictEqual(
      JSON.parse(
        readFileSync(path.join(EVIDENCE, 'a-plans-off/score-a.json'), 'utf8'),
      ),
    );
  });

  it('scores a scenario B answer with the committed scorer against a given repository', () => {
    const repo = buildScenarioBRepo();
    const ranked = computeLongestFunctions(repo, CORE, {
      ref: 'HEAD',
      includeTests: false,
      limit: 10,
    });
    const answer = path.join(scratch, 'answer.md');
    writeFileSync(
      answer,
      ranked
        .map((fn) => `- \`${fn.file}\` ${fn.name}: ${fn.lines} lines`)
        .join('\n'),
    );

    const score = runTool('score-b.ts', [answer, '--repo', repo, '--ref', 'HEAD']) as {
      excludingTests: {
        rowsFound: number;
        inTop10: number;
        inTop10ExactLength: number;
      };
    };

    expect(score.excludingTests).toMatchObject({
      rowsFound: 10,
      inTop10: 10,
      inTop10ExactLength: 10,
    });
  });

  it('holds no path of the checkout it was written in', () => {
    const tools = readdirSync(TOOLS).filter((name) => /\.(ts|sh)$/.test(name));
    expect(tools.length).toBeGreaterThan(0);
    const checkoutPaths = tools.filter((name) =>
      readFileSync(path.join(TOOLS, name), 'utf8').includes('/Volumes/'),
    );
    expect(checkoutPaths).toStrictEqual([]);
  });
});
