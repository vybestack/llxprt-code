/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fetchGitStatus } from './useGitBranchInfo.js';

let repositoryPath: string;
let originalIndex: string;
let originalIndexMtime: number;

function getGitStatus(cwd: string): Promise<boolean> {
  return new Promise((resolve) => fetchGitStatus(cwd, resolve));
}

function expectIndexUnchanged(): void {
  const indexPath = path.join(repositoryPath, '.git', 'index');
  expect(readFileSync(indexPath).toString('base64')).toStrictEqual(
    originalIndex,
  );
  expect(statSync(indexPath).mtimeMs).toStrictEqual(originalIndexMtime);
}

describe('fetchGitStatus', () => {
  beforeEach(() => {
    repositoryPath = mkdtempSync(path.join(tmpdir(), 'use-git-branch-info-'));
    execFileSync('git', ['init', '-q'], { cwd: repositoryPath });
    execFileSync('git', ['config', 'user.name', 'Test User'], {
      cwd: repositoryPath,
    });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repositoryPath,
    });
    writeFileSync(
      path.join(repositoryPath, 'tracked.txt'),
      'tracked content\n',
    );
    execFileSync('git', ['add', 'tracked.txt'], { cwd: repositoryPath });
    execFileSync('git', ['commit', '-q', '-m', 'initial'], {
      cwd: repositoryPath,
    });
    const indexPath = path.join(repositoryPath, '.git', 'index');
    originalIndex = readFileSync(indexPath).toString('base64');
    originalIndexMtime = statSync(indexPath).mtimeMs;
  });

  afterEach(() => {
    rmSync(repositoryPath, { recursive: true, force: true });
  });

  it('keeps the index untouched while returning correct clean and dirty status', async () => {
    const trackedPath = path.join(repositoryPath, 'tracked.txt');
    const future = new Date(Date.now() + 60_000);
    utimesSync(trackedPath, future, future);

    expect(await getGitStatus(repositoryPath)).toStrictEqual(false);
    expectIndexUnchanged();

    writeFileSync(path.join(repositoryPath, 'untracked.txt'), 'untracked\n');

    expect(await getGitStatus(repositoryPath)).toStrictEqual(true);
    expectIndexUnchanged();
  });
});
