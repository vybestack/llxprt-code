/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  __resetGitCommitInfoCacheForTests,
  getGitCommitInfo,
} from './gitCommitInfo.js';

describe('gitCommitInfo', () => {
  const envVar = 'LLXPRT_GIT_COMMIT_INFO_PATH';
  let tempDir: string;
  let infoPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'llxprt-git-commit-test-'));
    infoPath = path.join(tempDir, 'git-commit.json');
    process.env[envVar] = infoPath;
    __resetGitCommitInfoCacheForTests();
  });

  afterEach(() => {
    delete process.env[envVar];
    rmSync(tempDir, { recursive: true, force: true });
    __resetGitCommitInfoCacheForTests();
  });

  it('returns the commit hash when a valid git-commit.json exists', () => {
    writeFileSync(infoPath, JSON.stringify({ commit: 'abc1234' }), 'utf-8');

    const info = getGitCommitInfo();
    expect(info).toBe('abc1234');
  });

  it('treats a non-empty override as the sole candidate (exclusivity)', () => {
    // A valid artifact exists at the override path, so it is honored...
    writeFileSync(infoPath, JSON.stringify({ commit: 'abc1234' }), 'utf-8');
    expect(getGitCommitInfo()).toBe('abc1234');

    // ...but repointing the override at a missing path yields 'N/A' even
    // though the real default-location artifact (packages/cli/src/generated/
    // git-commit.json) exists on this developer machine. This locks in the
    // override-exclusivity contract the #2435 smoke regression depends on:
    // the override, when set, is the ONLY candidate consulted.
    process.env[envVar] = path.join(tempDir, 'does-not-exist.json');
    __resetGitCommitInfoCacheForTests();
    expect(getGitCommitInfo()).toBe('N/A');
  });

  it('returns "N/A" when the artifact is absent (never throws)', () => {
    const info = getGitCommitInfo();
    expect(info).toBe('N/A');
  });

  it('returns "N/A" when the file exists but is malformed JSON', () => {
    writeFileSync(infoPath, '{ not valid json', 'utf-8');

    const info = getGitCommitInfo();
    expect(info).toBe('N/A');
  });

  it('returns "N/A" when JSON is valid but missing the commit field', () => {
    writeFileSync(infoPath, JSON.stringify({ other: 'value' }), 'utf-8');

    const info = getGitCommitInfo();
    expect(info).toBe('N/A');
  });

  it('returns "N/A" when commit field is an empty string', () => {
    writeFileSync(infoPath, JSON.stringify({ commit: '' }), 'utf-8');

    const info = getGitCommitInfo();
    expect(info).toBe('N/A');
  });

  it('caches the result and does not re-read on subsequent calls', () => {
    writeFileSync(infoPath, JSON.stringify({ commit: 'abc1234' }), 'utf-8');
    expect(getGitCommitInfo()).toBe('abc1234');

    writeFileSync(infoPath, JSON.stringify({ commit: 'changed999' }), 'utf-8');

    expect(getGitCommitInfo()).toBe('abc1234');

    __resetGitCommitInfoCacheForTests();
    expect(getGitCommitInfo()).toBe('changed999');
  });

  it('treats a whitespace-only override as unset (ignores it)', () => {
    // With a valid artifact at the override path, the override is honored.
    writeFileSync(
      infoPath,
      JSON.stringify({ commit: 'override-only' }),
      'utf-8',
    );
    process.env[envVar] = infoPath;
    __resetGitCommitInfoCacheForTests();
    expect(getGitCommitInfo()).toBe('override-only');

    // A whitespace-only override must be ignored (treated as unset), so the
    // loader stops reading infoPath and falls through to its default
    // candidates. It must therefore NOT return the override artifact's value.
    // This is deterministic regardless of whether default candidates exist:
    // the default result is either the real generated hash or 'N/A', neither
    // of which equals the sentinel written above.
    process.env[envVar] = '   ';
    __resetGitCommitInfoCacheForTests();
    expect(getGitCommitInfo()).not.toBe('override-only');
  });
});
