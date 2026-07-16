/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getReleaseVersion } from '../get-release-version.ts';
import { execSync, spawnSync as realSpawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// execSync is mocked for getReleaseVersion internals; subprocess tests guard that spawnSync stays real.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const mod = await importOriginal();
  const readFileSyncMock = vi.fn();
  return {
    ...mod,
    readFileSync: readFileSyncMock,
    default: {
      ...mod.default,
      readFileSync: readFileSyncMock,
    },
  };
});

describe('getReleaseVersion', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.IS_NIGHTLY;
    delete process.env.IS_PREVIEW;
    delete process.env.MANUAL_VERSION;
    vi.useFakeTimers();
    vi.mocked(fs.default.readFileSync).mockReturnValue(
      JSON.stringify({ version: '0.1.0' }),
    );
    vi.mocked(execSync).mockReturnValue('abcdef');
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  it('should calculate nightly version when IS_NIGHTLY is true', () => {
    process.env.IS_NIGHTLY = 'true';
    const knownDate = new Date('2025-07-20T10:00:00.000Z');
    vi.setSystemTime(knownDate);
    const { releaseTag, releaseVersion, npmTag } = getReleaseVersion();
    expect(releaseTag).toBe('v0.1.0-nightly.250720.abcdef');
    expect(releaseVersion).toBe('0.1.0-nightly.250720.abcdef');
    expect(npmTag).toBe('nightly');
  });

  it('should use MANUAL_VERSION as nightly base when IS_NIGHTLY and MANUAL_VERSION are set', () => {
    process.env.IS_NIGHTLY = 'true';
    process.env.MANUAL_VERSION = '0.11.0';
    const knownDate = new Date('2025-07-20T10:00:00.000Z');
    vi.setSystemTime(knownDate);
    const { releaseTag, releaseVersion, npmTag } = getReleaseVersion();
    expect(releaseTag).toBe('v0.11.0-nightly.250720.abcdef');
    expect(releaseVersion).toBe('0.11.0-nightly.250720.abcdef');
    expect(npmTag).toBe('nightly');
  });

  it('should support v-prefixed MANUAL_VERSION as nightly base', () => {
    process.env.IS_NIGHTLY = 'true';
    process.env.MANUAL_VERSION = 'v0.11.0';
    const knownDate = new Date('2025-07-20T10:00:00.000Z');
    vi.setSystemTime(knownDate);
    const { releaseTag, releaseVersion, npmTag } = getReleaseVersion();
    expect(releaseTag).toBe('v0.11.0-nightly.250720.abcdef');
    expect(releaseVersion).toBe('0.11.0-nightly.250720.abcdef');
    expect(npmTag).toBe('nightly');
  });

  it('should fall back to package.json when MANUAL_VERSION is absent for nightly', () => {
    process.env.IS_NIGHTLY = 'true';
    delete process.env.MANUAL_VERSION;
    const knownDate = new Date('2025-07-20T10:00:00.000Z');
    vi.setSystemTime(knownDate);
    const { releaseTag, releaseVersion, npmTag } = getReleaseVersion();
    expect(releaseTag).toBe('v0.1.0-nightly.250720.abcdef');
    expect(releaseVersion).toBe('0.1.0-nightly.250720.abcdef');
    expect(npmTag).toBe('nightly');
  });

  it('should fall back to package.json when MANUAL_VERSION is empty for nightly', () => {
    process.env.IS_NIGHTLY = 'true';
    process.env.MANUAL_VERSION = '';
    const knownDate = new Date('2025-07-20T10:00:00.000Z');
    vi.setSystemTime(knownDate);
    const { releaseTag, releaseVersion, npmTag } = getReleaseVersion();
    expect(releaseTag).toBe('v0.1.0-nightly.250720.abcdef');
    expect(releaseVersion).toBe('0.1.0-nightly.250720.abcdef');
    expect(npmTag).toBe('nightly');
  });

  it('should throw for prerelease MANUAL_VERSION base under nightly', () => {
    process.env.IS_NIGHTLY = 'true';
    process.env.MANUAL_VERSION = 'v0.11.0-beta.1';
    expect(() => getReleaseVersion()).toThrow(
      'Error: Nightly manual version must be a stable numeric semver',
    );
  });

  it('should throw for build-metadata MANUAL_VERSION base under nightly', () => {
    process.env.IS_NIGHTLY = 'true';
    process.env.MANUAL_VERSION = '0.11.0+build1';
    expect(() => getReleaseVersion()).toThrow(
      'Error: Nightly manual version must be a stable numeric semver',
    );
  });

  it('should throw for malformed MANUAL_VERSION base under nightly', () => {
    process.env.IS_NIGHTLY = 'true';
    process.env.MANUAL_VERSION = '0.11';
    expect(() => getReleaseVersion()).toThrow(
      'Error: Nightly manual version must be a stable numeric semver',
    );
  });

  it('should reject leading-zero major component in nightly base (01.2.3)', () => {
    process.env.IS_NIGHTLY = 'true';
    process.env.MANUAL_VERSION = '01.2.3';
    expect(() => getReleaseVersion()).toThrow(
      'Error: Nightly manual version must be a stable numeric semver',
    );
  });

  it('should reject leading-zero minor component in nightly base (1.02.3)', () => {
    process.env.IS_NIGHTLY = 'true';
    process.env.MANUAL_VERSION = '1.02.3';
    expect(() => getReleaseVersion()).toThrow(
      'Error: Nightly manual version must be a stable numeric semver',
    );
  });

  it('should reject leading-zero patch component in nightly base (1.2.03)', () => {
    process.env.IS_NIGHTLY = 'true';
    process.env.MANUAL_VERSION = '1.2.03';
    expect(() => getReleaseVersion()).toThrow(
      'Error: Nightly manual version must be a stable numeric semver',
    );
  });

  it('should reject v-prefixed leading-zero nightly base (v01.2.3)', () => {
    process.env.IS_NIGHTLY = 'true';
    process.env.MANUAL_VERSION = 'v01.2.3';
    expect(() => getReleaseVersion()).toThrow(
      'Error: Nightly manual version must be a stable numeric semver',
    );
  });

  it('should accept zero-valued components in nightly base (0.0.0, 0.10.0)', () => {
    process.env.IS_NIGHTLY = 'true';
    process.env.MANUAL_VERSION = '0.0.0';
    vi.setSystemTime(new Date('2025-07-20T10:00:00.000Z'));
    expect(getReleaseVersion().releaseTag).toBe('v0.0.0-nightly.250720.abcdef');

    process.env.MANUAL_VERSION = '0.10.0';
    expect(getReleaseVersion().releaseTag).toBe(
      'v0.10.0-nightly.250720.abcdef',
    );
  });

  it('should use manual version when provided', () => {
    process.env.MANUAL_VERSION = '1.2.3';
    const { releaseTag, releaseVersion, npmTag } = getReleaseVersion();
    expect(releaseTag).toBe('v1.2.3');
    expect(releaseVersion).toBe('1.2.3');
    expect(npmTag).toBe('latest');
  });

  it('should prepend v to manual version if missing', () => {
    process.env.MANUAL_VERSION = '1.2.3';
    const { releaseTag } = getReleaseVersion();
    expect(releaseTag).toBe('v1.2.3');
  });

  it('should handle pre-release versions correctly', () => {
    process.env.MANUAL_VERSION = 'v1.2.3-beta.1';
    const { releaseTag, releaseVersion, npmTag } = getReleaseVersion();
    expect(releaseTag).toBe('v1.2.3-beta.1');
    expect(releaseVersion).toBe('1.2.3-beta.1');
    expect(npmTag).toBe('beta');
  });

  it('should throw an error for invalid version format', () => {
    process.env.MANUAL_VERSION = '1.2';
    expect(() => getReleaseVersion()).toThrow(
      'Error: Version must be in the format vX.Y.Z or vX.Y.Z-prerelease',
    );
  });

  it('should auto-increment version if no version is provided for non-nightly release', () => {
    const result = getReleaseVersion();
    expect(result.releaseTag).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(result.npmTag).toBe('latest');
  });

  it('should throw an error for versions with build metadata', () => {
    process.env.MANUAL_VERSION = 'v1.2.3+build456';
    expect(() => getReleaseVersion()).toThrow(
      'Error: Versions with build metadata (+) are not supported for releases.',
    );
  });
});

describe('get-release-version script CLI contract', () => {
  // Resolve the script relative to this test file so the test is robust to the
  // process working directory (vitest may be invoked from the repo root or a
  // workspace).
  const scriptPath = path.resolve(
    import.meta.dirname,
    '../get-release-version.ts',
  );

  /**
   * Asserts the CLI contract that stdout contains exactly one JSON object while
   * diagnostics stay on stderr for release workflow parsing.
   */
  function expectCleanJsonStdout(result) {
    expect(result.status, `stderr was: ${result.stderr}`).toBe(0);
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  }

  const RUNTIME = process.env.BUN_EXECUTABLE ?? 'bun';

  function runScript(env = {}) {
    if (typeof realSpawnSync !== 'function') {
      throw new Error('realSpawnSync was not preserved by the mock factory');
    }
    const repoRoot = path.resolve(import.meta.dirname, '..', '..');
    const baseEnv = { ...process.env };
    delete baseEnv.IS_NIGHTLY;
    delete baseEnv.IS_PREVIEW;
    delete baseEnv.MANUAL_VERSION;
    const result = realSpawnSync(RUNTIME, [scriptPath], {
      encoding: 'utf8',
      cwd: repoRoot,
      env: { ...baseEnv, ...env },
      timeout: 15_000,
    });
    if (result.error) {
      throw new Error(`Failed to spawn script: ${result.error.message}`);
    }
    if (result.signal) {
      const hint =
        result.signal === 'SIGTERM'
          ? '(possible timeout, limit is 15s)'
          : '(subprocess crash)';
      throw new Error(
        `Script subprocess was killed by ${result.signal} ${hint}`,
      );
    }
    return result;
  }

  /**
   * Detects whether bun is on PATH. The subprocess contract tests are skipped
   * (not failed) when bun is absent so the suite stays green on minimal
   * toolchains while still asserting the contract wherever bun is installed.
   */
  // Availability is cached per test and reset by the local beforeEach hook.
  /** @type {boolean | undefined} */
  let cachedBunAvailable;

  function bunAvailable() {
    if (cachedBunAvailable !== undefined) {
      return cachedBunAvailable;
    }
    const check = realSpawnSync(RUNTIME, ['--version'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    cachedBunAvailable = check.error === undefined && check.status === 0;
    return cachedBunAvailable;
  }
  /** @type {boolean | undefined} */
  let cachedGitAvailable;

  beforeEach(() => {
    cachedBunAvailable = undefined;
    cachedGitAvailable = undefined;
  });
  function gitAvailable() {
    if (cachedGitAvailable !== undefined) {
      return cachedGitAvailable;
    }
    const check = realSpawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      timeout: 15_000,
      cwd: path.resolve(import.meta.dirname, '..', '..'),
    });
    cachedGitAvailable = check.error === undefined && check.status === 0;
    return cachedGitAvailable;
  }

  function skipWhenBunUnavailable(ctx) {
    if (bunAvailable()) {
      return false;
    }
    if (process.env.CI === 'true') {
      throw new Error(
        'bun is required for get-release-version CLI contract tests in CI.',
      );
    }
    ctx.skip();
    return true;
  }

  it('writes only JSON to stdout (release.yml parses it with jq)', (ctx) => {
    if (skipWhenBunUnavailable(ctx)) {
      return;
    }
    const result = runScript();
    expectCleanJsonStdout(result);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('releaseTag');
    expect(parsed).toHaveProperty('releaseVersion');
    expect(parsed).toHaveProperty('npmTag');
    expect(parsed.releaseTag).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(parsed.npmTag).toBe('latest');
  });

  it('keeps nightly diagnostic text off stdout', (ctx) => {
    if (skipWhenBunUnavailable(ctx)) {
      return;
    }
    if (!gitAvailable()) {
      if (process.env.CI === 'true') {
        throw new Error(
          'git is required for nightly get-release-version CLI contract tests in CI.',
        );
      }
      ctx.skip();
      return;
    }
    const result = runScript({
      IS_NIGHTLY: 'true',
      IS_PREVIEW: '',
      MANUAL_VERSION: '',
    });
    expectCleanJsonStdout(result);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.npmTag).toBe('nightly');
    // getNightlyTagName uses YYMMDD, so the nightly date component is six digits.
    expect(parsed.releaseTag).toMatch(
      /^v\d+\.\d+\.\d+-nightly\.\d{6}\.[0-9a-f]+$/,
    );
  });

  it('uses MANUAL_VERSION as nightly base for manual nightly dispatch', (ctx) => {
    if (skipWhenBunUnavailable(ctx)) {
      return;
    }
    if (!gitAvailable()) {
      if (process.env.CI === 'true') {
        throw new Error(
          'git is required for nightly get-release-version CLI contract tests in CI.',
        );
      }
      ctx.skip();
      return;
    }
    const result = runScript({
      IS_NIGHTLY: 'true',
      IS_PREVIEW: '',
      MANUAL_VERSION: '0.11.0',
    });
    expectCleanJsonStdout(result);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.npmTag).toBe('nightly');
    expect(parsed.releaseTag).toMatch(/^v0\.11\.0-nightly\.\d{6}\.[0-9a-f]+$/);
    expect(parsed.releaseVersion).toMatch(
      /^0\.11\.0-nightly\.\d{6}\.[0-9a-f]+$/,
    );
  });

  it('supports v-prefixed MANUAL_VERSION for manual nightly dispatch', (ctx) => {
    if (skipWhenBunUnavailable(ctx)) {
      return;
    }
    if (!gitAvailable()) {
      if (process.env.CI === 'true') {
        throw new Error(
          'git is required for nightly get-release-version CLI contract tests in CI.',
        );
      }
      ctx.skip();
      return;
    }
    const result = runScript({
      IS_NIGHTLY: 'true',
      IS_PREVIEW: '',
      MANUAL_VERSION: 'v0.11.0',
    });
    expectCleanJsonStdout(result);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.npmTag).toBe('nightly');
    expect(parsed.releaseTag).toMatch(/^v0\.11\.0-nightly\.\d{6}\.[0-9a-f]+$/);
  });

  it('rejects malformed MANUAL_VERSION base under nightly dispatch', (ctx) => {
    if (skipWhenBunUnavailable(ctx)) {
      return;
    }
    const result = runScript({
      IS_NIGHTLY: 'true',
      IS_PREVIEW: '',
      MANUAL_VERSION: '0.11',
    });
    expect(result.status).not.toBeNull();
    expect(result.status, `stderr: ${result.stderr}`).toBeGreaterThan(0);
    expect(result.stderr).toMatch(
      /Error: Nightly manual version must be a stable numeric semver/,
    );
    const trimmed = result.stdout.trim();
    if (trimmed.startsWith('{')) {
      throw new Error(`Unexpected JSON on stdout for error case: ${trimmed}`);
    }
  });

  it('rejects prerelease MANUAL_VERSION base under nightly dispatch', (ctx) => {
    if (skipWhenBunUnavailable(ctx)) {
      return;
    }
    const result = runScript({
      IS_NIGHTLY: 'true',
      IS_PREVIEW: '',
      MANUAL_VERSION: 'v0.11.0-beta.1',
    });
    expect(result.status).not.toBeNull();
    expect(result.status, `stderr: ${result.stderr}`).toBeGreaterThan(0);
    expect(result.stderr).toMatch(
      /Error: Nightly manual version must be a stable numeric semver/,
    );
    const trimmed = result.stdout.trim();
    if (trimmed.startsWith('{')) {
      throw new Error(`Unexpected JSON on stdout for error case: ${trimmed}`);
    }
  });

  it('rejects build-metadata MANUAL_VERSION base under nightly dispatch', (ctx) => {
    if (skipWhenBunUnavailable(ctx)) {
      return;
    }
    const result = runScript({
      IS_NIGHTLY: 'true',
      IS_PREVIEW: '',
      MANUAL_VERSION: '0.11.0+build1',
    });
    expect(result.status).not.toBeNull();
    expect(result.status, `stderr: ${result.stderr}`).toBeGreaterThan(0);
    expect(result.stderr).toMatch(
      /Error: Nightly manual version must be a stable numeric semver/,
    );
    const trimmed = result.stdout.trim();
    if (trimmed.startsWith('{')) {
      throw new Error(`Unexpected JSON on stdout for error case: ${trimmed}`);
    }
  });

  it('rejects leading-zero major in MANUAL_VERSION nightly base before tag creation', (ctx) => {
    if (skipWhenBunUnavailable(ctx)) {
      return;
    }
    const result = runScript({
      IS_NIGHTLY: 'true',
      IS_PREVIEW: '',
      MANUAL_VERSION: '01.2.3',
    });
    expect(result.status).not.toBeNull();
    expect(result.status, `stderr: ${result.stderr}`).toBeGreaterThan(0);
    expect(result.stderr).toMatch(
      /Error: Nightly manual version must be a stable numeric semver/,
    );
    const trimmed = result.stdout.trim();
    if (trimmed.startsWith('{')) {
      throw new Error(`Unexpected JSON on stdout for error case: ${trimmed}`);
    }
  });

  it('rejects leading-zero minor in MANUAL_VERSION nightly base before tag creation', (ctx) => {
    if (skipWhenBunUnavailable(ctx)) {
      return;
    }
    const result = runScript({
      IS_NIGHTLY: 'true',
      IS_PREVIEW: '',
      MANUAL_VERSION: '1.02.3',
    });
    expect(result.status).not.toBeNull();
    expect(result.status, `stderr: ${result.stderr}`).toBeGreaterThan(0);
    expect(result.stderr).toMatch(
      /Error: Nightly manual version must be a stable numeric semver/,
    );
    const trimmed = result.stdout.trim();
    if (trimmed.startsWith('{')) {
      throw new Error(`Unexpected JSON on stdout for error case: ${trimmed}`);
    }
  });

  it('rejects leading-zero patch in MANUAL_VERSION nightly base before tag creation', (ctx) => {
    if (skipWhenBunUnavailable(ctx)) {
      return;
    }
    const result = runScript({
      IS_NIGHTLY: 'true',
      IS_PREVIEW: '',
      MANUAL_VERSION: '1.2.03',
    });
    expect(result.status).not.toBeNull();
    expect(result.status, `stderr: ${result.stderr}`).toBeGreaterThan(0);
    expect(result.stderr).toMatch(
      /Error: Nightly manual version must be a stable numeric semver/,
    );
    const trimmed = result.stdout.trim();
    if (trimmed.startsWith('{')) {
      throw new Error(`Unexpected JSON on stdout for error case: ${trimmed}`);
    }
  });

  it('keeps manual-version diagnostic text off stdout', (ctx) => {
    if (skipWhenBunUnavailable(ctx)) {
      return;
    }
    const result = runScript({
      IS_NIGHTLY: '',
      IS_PREVIEW: '',
      MANUAL_VERSION: '1.2.3',
    });
    expectCleanJsonStdout(result);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.npmTag).toBe('latest');
    expect(parsed.releaseTag).toBe('v1.2.3');
    expect(parsed.releaseVersion).toBe('1.2.3');
  });
  it('keeps prefixed manual-version diagnostic text off stdout', (ctx) => {
    if (skipWhenBunUnavailable(ctx)) {
      return;
    }
    const result = runScript({
      IS_NIGHTLY: '',
      IS_PREVIEW: '',
      MANUAL_VERSION: 'v1.2.3',
    });
    expectCleanJsonStdout(result);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.releaseTag).toBe('v1.2.3');
    expect(parsed.releaseVersion).toBe('1.2.3');
    expect(parsed.npmTag).toBe('latest');
  });

  it('keeps preview/beta diagnostic text off stdout', (ctx) => {
    if (skipWhenBunUnavailable(ctx)) {
      return;
    }
    const result = runScript({
      IS_NIGHTLY: '',
      IS_PREVIEW: 'true',
      MANUAL_VERSION: '',
    });
    expectCleanJsonStdout(result);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.releaseTag).toMatch(/^v\d+\.\d+\.\d+-beta\.\d+$/);
    expect(parsed.npmTag).toBe('beta');
  });

  it('exits non-zero and writes error to stderr for invalid version', (ctx) => {
    if (skipWhenBunUnavailable(ctx)) {
      return;
    }
    const result = runScript({
      IS_NIGHTLY: '',
      IS_PREVIEW: '',
      MANUAL_VERSION: '1.2',
    });
    expect(result.status).not.toBeNull();
    expect(result.status, `stderr: ${result.stderr}`).toBeGreaterThan(0);
    expect(result.stderr).toMatch(
      /Error: Version must be in the format vX\.Y\.Z or vX\.Y\.Z-prerelease/,
    );
    const trimmed = result.stdout.trim();
    if (trimmed.startsWith('{')) {
      throw new Error(`Unexpected JSON on stdout for error case: ${trimmed}`);
    }
  });

  it('exits non-zero and writes error to stderr for build metadata', (ctx) => {
    if (skipWhenBunUnavailable(ctx)) {
      return;
    }
    const result = runScript({
      IS_NIGHTLY: '',
      IS_PREVIEW: '',
      MANUAL_VERSION: '1.2.3+build',
    });
    expect(result.status).not.toBeNull();
    expect(result.status, result.stderr).toBeGreaterThan(0);
    expect(result.stderr).toMatch(/build metadata \(\+\) are not supported/);
    const trimmed = result.stdout.trim();
    if (trimmed.startsWith('{')) {
      throw new Error(`Unexpected JSON on stdout for error case: ${trimmed}`);
    }
  });
});
