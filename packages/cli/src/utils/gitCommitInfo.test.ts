/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  __resetGitCommitInfoCacheForTests,
  getGitCommitInfo,
  GIT_COMMIT_INFO_PATH_ENV,
} from './gitCommitInfo.js';

describe('gitCommitInfo', () => {
  const envVar = GIT_COMMIT_INFO_PATH_ENV;
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

  it('returns "N/A" without throwing when process.cwd is unusable', () => {
    // AboutBox resolves the commit at module load, so importing it under a
    // partial `node:process` mock (one lacking cwd()) must not crash the whole
    // module graph. With no override set, candidatePaths() calls process.cwd();
    // if that throws, the loader must still degrade to 'N/A'. Regression guard
    // for the AppContainer.mount collection failure ("default.cwd is not a
    // function").
    delete process.env[envVar];
    __resetGitCommitInfoCacheForTests();
    const cwdSpy = vi.spyOn(process, 'cwd').mockImplementation(() => {
      throw new TypeError('cwd is not a function');
    });
    try {
      expect(getGitCommitInfo()).toBe('N/A');
    } finally {
      cwdSpy.mockRestore();
    }
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

  it('returns "N/A" when commit field is whitespace only', () => {
    writeFileSync(infoPath, JSON.stringify({ commit: '   ' }), 'utf-8');

    const info = getGitCommitInfo();
    expect(info).toBe('N/A');
  });

  it('trims surrounding whitespace from a valid commit hash', () => {
    writeFileSync(infoPath, JSON.stringify({ commit: '  abc1234  ' }), 'utf-8');

    const info = getGitCommitInfo();
    expect(info).toBe('abc1234');
  });

  it('caches the result and does not re-read on subsequent calls', () => {
    writeFileSync(infoPath, JSON.stringify({ commit: 'abc1234' }), 'utf-8');
    expect(getGitCommitInfo()).toBe('abc1234');

    writeFileSync(infoPath, JSON.stringify({ commit: 'changed999' }), 'utf-8');

    expect(getGitCommitInfo()).toBe('abc1234');

    __resetGitCommitInfoCacheForTests();
    expect(getGitCommitInfo()).toBe('changed999');
  });

  it('does not cache a miss: re-reads once the artifact appears', () => {
    // A load before the artifact exists (fresh checkout / incremental build)
    // must not lock in 'N/A' for the process lifetime. Only successful reads
    // are cached, so a later call self-heals without a manual cache reset.
    expect(getGitCommitInfo()).toBe('N/A');

    writeFileSync(infoPath, JSON.stringify({ commit: 'appeared1' }), 'utf-8');
    expect(getGitCommitInfo()).toBe('appeared1');
  });

  it('treats a whitespace-only override as unset (ignores it)', () => {
    // Baseline: with no override, the loader consults its default candidates.
    // Whatever it resolves (the real generated hash or 'N/A') is the exact
    // behaviour a whitespace-only override must reproduce.
    delete process.env[envVar];
    __resetGitCommitInfoCacheForTests();
    const unsetResult = getGitCommitInfo();

    // Prove the override path is otherwise live: a valid artifact there is
    // honored, so it is a genuine sentinel distinct from the default result.
    writeFileSync(
      infoPath,
      JSON.stringify({ commit: 'override-only' }),
      'utf-8',
    );
    process.env[envVar] = infoPath;
    __resetGitCommitInfoCacheForTests();
    expect(getGitCommitInfo()).toBe('override-only');

    // A whitespace-only override must be treated as unset: the loader ignores
    // infoPath entirely and falls through to the default candidates, yielding
    // exactly the unset baseline (positive assertion) and never the override
    // sentinel (guards against a "trimmed but still used" regression).
    process.env[envVar] = '   ';
    __resetGitCommitInfoCacheForTests();
    const whitespaceResult = getGitCommitInfo();
    expect(whitespaceResult).toBe(unsetResult);
    expect(whitespaceResult).not.toBe('override-only');
  });
});
