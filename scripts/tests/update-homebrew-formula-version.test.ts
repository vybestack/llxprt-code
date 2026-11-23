/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

describe('update-homebrew-formula version argument', () => {
  let work: string;
  let tarball: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'llxprt-homebrew-version-'));
    tarball = join(work, 'prepared.tgz');
    writeFileSync(tarball, 'prepared release package bytes');
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  function runDry(version: string): SpawnSyncReturns<string> {
    return spawnSync(
      'bun',
      ['scripts/update-homebrew-formula.ts', version, tarball],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, DRY_RUN: 'true' },
      },
    );
  }

  it('accepts a plain release version', () => {
    const result = runDry('1.2.3');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('llxprt-code-1.2.3.tgz');
  });

  it('skips pre-release versions without publishing', () => {
    const result = runDry('1.2.3-rc.1');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Skipping Homebrew update');
    expect(result.stdout).not.toContain('SHA256:');
  });

  it.each([
    ['trailing shell command', '1.2.3; touch injected'],
    ['command substitution', '1.2.3$(touch injected)'],
    ['quote breaking out of the commit message', '1.2.3" && touch injected #'],
    ['embedded newline', '1.2.3\nclass Evil < Formula'],
    ['trailing whitespace', '1.2.3 '],
    ['pre-release with shell syntax', '1.2.3-rc;touch injected'],
  ])('rejects a version with %s', (_label, version) => {
    const result = runDry(version);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invalid version format');
    expect(existsSync(join(ROOT, 'injected'))).toBe(false);
    expect(result.stdout).not.toContain('SHA256:');
  });
});
