/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Proves the bulk fast-import commit builds the same Git tree as the
 * `git add -A && git commit` fixture helper it replaces for large fixtures.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  gitCheck,
  gitCommitAll,
  gitCommitAllBulk,
  gitInit,
} from './ast-read-git-fixtures.js';

const tempDirs: string[] = [];

function createRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ast-read-git-bulk-'));
  tempDirs.push(dir);
  gitInit(dir);
  return dir;
}

function writeFixtureFile(dir: string, path: string, data: string | Buffer) {
  const absolute = join(dir, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, data);
}

/** Identical worktree content in every repository handed in. */
function populate(dir: string): void {
  writeFixtureFile(dir, '.gitignore', 'ignored_tree/\n*.log\n');
  writeFixtureFile(dir, 'src/main.rs', 'fn main() {}\n');
  writeFixtureFile(dir, 'src/nested/deep/lib.rs', 'pub fn lib() {}\n');
  writeFixtureFile(dir, 'crlf.txt', 'one\r\ntwo\r\n');
  writeFixtureFile(dir, 'empty.txt', '');
  writeFixtureFile(dir, 'binary.bin', Buffer.from([0, 255, 13, 10, 128, 0]));
  writeFixtureFile(dir, 'name with space.txt', 'spaced\n');
  writeFixtureFile(dir, 'ünïcode.txt', 'unicode\n');
  writeFixtureFile(dir, 'no-final-newline.txt', 'tail');
  writeFixtureFile(dir, 'ignored_tree/skip.rs', 'ignored\n');
  writeFixtureFile(dir, 'debug.log', 'ignored\n');
  writeFixtureFile(dir, 'run.sh', '#!/bin/sh\n');
  if (process.platform !== 'win32') {
    chmodSync(join(dir, 'run.sh'), 0o755);
  }
}

function treeOf(dir: string): string {
  return gitCheck(dir, ['rev-parse', 'HEAD^{tree}']).trim();
}

function trackedListing(dir: string): string {
  return gitCheck(dir, ['ls-tree', '-r', '--full-tree', 'HEAD']);
}

describe('gitCommitAllBulk', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('commits the same tree as gitCommitAll for a fresh fixture', () => {
    const reference = createRepo();
    const bulk = createRepo();
    populate(reference);
    populate(bulk);

    gitCommitAll(reference, 'fixture');
    const sha = gitCommitAllBulk(bulk, 'fixture');

    expect(sha).toBe(gitCheck(bulk, ['rev-parse', 'HEAD']).trim());
    expect(treeOf(bulk)).toBe(treeOf(reference));
    expect(trackedListing(bulk)).toBe(trackedListing(reference));
    expect(trackedListing(bulk)).not.toContain('ignored_tree');
    expect(trackedListing(bulk)).not.toContain('debug.log');
    expect(trackedListing(bulk)).toContain('.gitignore');
  });

  it('leaves a clean, stat-fresh index and the same commit metadata', () => {
    const reference = createRepo();
    const bulk = createRepo();
    populate(reference);
    populate(bulk);

    gitCommitAll(reference, 'fixture message');
    gitCommitAllBulk(bulk, 'fixture message');

    expect(gitCheck(bulk, ['status', '--porcelain', '-z'])).toBe('');
    expect(gitCheck(bulk, ['diff', '--name-only', '-z'])).toBe('');
    expect(gitCheck(bulk, ['diff', '--cached', '--name-only', '-z'])).toBe('');
    expect(gitCheck(bulk, ['ls-files', '-s'])).toBe(
      gitCheck(reference, ['ls-files', '-s']),
    );
    expect(
      gitCheck(bulk, ['log', '-1', '--format=%an <%ae>|%cn <%ce>|%B']),
    ).toBe(
      gitCheck(reference, ['log', '-1', '--format=%an <%ae>|%cn <%ce>|%B']),
    );
    expect(gitCheck(bulk, ['rev-list', '--count', 'HEAD']).trim()).toBe('1');
  });

  it('commits modifications, additions, and deletions on top of a parent', () => {
    const reference = createRepo();
    const bulk = createRepo();
    for (const dir of [reference, bulk]) {
      populate(dir);
      gitCommitAll(dir, 'seed');
      writeFixtureFile(dir, 'src/main.rs', 'fn main() { changed(); }\n');
      writeFixtureFile(dir, 'added.rs', 'pub fn added() {}\n');
      unlinkSync(join(dir, 'crlf.txt'));
    }
    const parent = gitCheck(bulk, ['rev-parse', 'HEAD']).trim();

    gitCommitAll(reference, 'second');
    gitCommitAllBulk(bulk, 'second');

    expect(treeOf(bulk)).toBe(treeOf(reference));
    expect(gitCheck(bulk, ['rev-parse', 'HEAD^']).trim()).toBe(parent);
    expect(trackedListing(bulk)).not.toContain('crlf.txt');
    expect(gitCheck(bulk, ['status', '--porcelain', '-z'])).toBe('');
  });
});
