/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  clearQuotaGuard,
  detectQuotaSignal,
  formatQuotaError,
  getQuotaGuardTrip,
  QUOTA_ERROR_PREFIX,
  SENTINEL_FILENAME,
  tripQuotaGuard,
} from './quota-guard.js';
import { restoreEnv, setEnv } from './env-test-helpers.js';

const ANNOTATION_MARKER = '::error title=E2E quota guard tripped::';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'quota-guard-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Names of any leftover atomic-publication temp files in `dir`. The guard
 * stages the payload as `<SENTINEL_FILENAME>.<pid>.<uuid>.tmp` in the sentinel's
 * own directory before hard-linking it into place, so a correct implementation
 * leaves none of these behind on any path.
 */
function leftoverTempFiles(dir: string): string[] {
  return readdirSync(dir).filter(
    (name) => name.startsWith(SENTINEL_FILENAME) && name.endsWith('.tmp'),
  );
}

function callsIncludeAnnotation(
  calls: ReadonlyArray<readonly unknown[]>,
): boolean {
  return calls.some(
    (call) =>
      typeof call[0] === 'string' && call[0].includes(ANNOTATION_MARKER),
  );
}

/**
 * Return the first `::error ...::` workflow-command line written to the stdout
 * spy, or `null` when none was emitted. Used to assert on the exact escaped
 * payload of the GitHub Actions annotation.
 */
function findAnnotationLine(
  calls: ReadonlyArray<readonly unknown[]>,
): string | null {
  for (const call of calls) {
    if (typeof call[0] === 'string' && call[0].includes(ANNOTATION_MARKER)) {
      return call[0];
    }
  }
  return null;
}

describe('quota-guard', () => {
  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  describe('detectQuotaSignal', () => {
    const positiveCases: readonly string[] = [
      'Process exited with code 1: something (Status: 429)',
      'HTTP 429 Too Many Requests',
      // camelCase and snake_case status-code fields carry no other quota
      // keyword, so they genuinely exercise the extended status(_)?code branch.
      'Provider rejected the request with statusCode: 429',
      'openai.APIStatusError status_code: 429',
      '{"type":"error","error":{"type":"rate_limit_error","message":"Rate limited"}}',
      'Rate limit exceeded. Please wait a moment and retry',
      // Contextual rate-limit forms: an error-context word ("limited",
      // "_error", "exceeded", "reached", "hit") disambiguates a genuine
      // provider wall from prose that merely mentions rate limits.
      'Rate limited',
      'rate_limit_error',
      'Rate limit exceeded',
      'rate limit reached',
      // Classic OpenAI 429 body wording that carries no status/code context.
      'You exceeded your current quota, please check your plan and billing details.',
      'You have reached your daily gemini-2.5-pro quota limit',
      // "quota limit" WITH a trailing exhaustion verb is a genuine wall; the
      // bare-"limit" form (see negative cases) must stay green.
      'quota limit exceeded',
      'quota limit reached',
      'RESOURCE_EXHAUSTED',
      'insufficient_quota',
    ];

    for (const input of positiveCases) {
      it(`detects a quota signal in: ${input.slice(0, 48)}`, () => {
        expect(detectQuotaSignal(input)).not.toBeNull();
      });
    }

    const negativeCases: readonly string[] = [
      'Error: expected 2 to be 3\n    at file.test.ts:10',
      'Expected to find list_directory tool call(s). Found: none.',
      'Processed 429 items successfully',
      // Bare, non-contextual mentions of rate limiting are prose a failing test
      // could legitimately echo — they must NOT trip the guard and mask a real
      // regression.
      'Expected the CLI to explain rate limit behavior',
      'tests for rate limits',
      // "quota" without exhaustion context must stay green.
      'quota check passed',
      // A bare "quota limit" that merely NAMES the limit (config/help text) is
      // not a wall — only "quota limit reached/exceeded/hit" trips the guard.
      'Config: quota limit = 60',
      '',
    ];

    for (const input of negativeCases) {
      it(`ignores non-quota output: ${input.slice(0, 48) || '(empty)'}`, () => {
        expect(detectQuotaSignal(input)).toBeNull();
      });
    }
  });

  describe('formatQuotaError', () => {
    it('produces a stable prefix, reason, newline, then context', () => {
      const formatted = formatQuotaError(
        'matched HTTP 429 status: "429 Too Many Requests"',
        'Process exited with code 1',
      );
      // Uniform prefix that both interactive and non-interactive paths share.
      expect(formatted.startsWith(`${QUOTA_ERROR_PREFIX} `)).toBe(true);
      // Reason comes first for at-a-glance triage.
      expect(formatted).toContain('matched HTTP 429 status');
      expect(formatted).toContain('\nProcess exited with code 1');
    });

    it('separates reason and context with exactly one newline', () => {
      const formatted = formatQuotaError('reason-here', 'context-here');
      const withoutPrefix = formatted.slice(`${QUOTA_ERROR_PREFIX} `.length);
      expect(withoutPrefix).toBe('reason-here\ncontext-here');
    });

    it('preserves multi-line context verbatim', () => {
      const multiLineContext = ['Line one', 'Line two', 'Line three'].join(
        '\n',
      );
      const formatted = formatQuotaError('quota wall', multiLineContext);
      expect(formatted).toContain(multiLineContext);
    });
  });

  describe('quota guard sentinel lifecycle', () => {
    it('round-trips a trip reason through the sentinel file', () => {
      const dir = makeTempDir();
      setEnv('INTEGRATION_TEST_FILE_DIR', dir);
      setEnv('GITHUB_ACTIONS', 'false');

      tripQuotaGuard('quota exhausted for provider X');

      expect(getQuotaGuardTrip()).toStrictEqual({
        reason: 'quota exhausted for provider X',
      });
    });

    it('is idempotent and keeps the first reason', () => {
      const dir = makeTempDir();
      setEnv('INTEGRATION_TEST_FILE_DIR', dir);
      setEnv('GITHUB_ACTIONS', 'false');

      tripQuotaGuard('first');
      tripQuotaGuard('second');

      expect(getQuotaGuardTrip()).toStrictEqual({ reason: 'first' });
    });

    it('keeps a reason written externally by another worker (wx never clobbers)', () => {
      const dir = makeTempDir();
      setEnv('INTEGRATION_TEST_FILE_DIR', dir);
      setEnv('GITHUB_ACTIONS', 'false');

      // Simulate a concurrent worker that already won the race by pre-creating
      // the sentinel out-of-band (not via tripQuotaGuard in this process). The
      // exclusive `wx` create must fail with EEXIST and leave reason A intact.
      const sentinelPath = join(dir, SENTINEL_FILENAME);
      writeFileSync(
        sentinelPath,
        JSON.stringify({
          reason: 'external worker reason A',
          timestamp: new Date().toISOString(),
        }),
      );

      tripQuotaGuard('reason B from this worker');

      expect(getQuotaGuardTrip()).toStrictEqual({
        reason: 'external worker reason A',
      });
    });

    it('leaves no temp file behind after a winning publication', () => {
      const dir = makeTempDir();
      setEnv('INTEGRATION_TEST_FILE_DIR', dir);
      setEnv('GITHUB_ACTIONS', 'false');

      tripQuotaGuard('winner reason');

      // The sentinel is published and the staged temp inode was unlinked in the
      // finally block — only the sentinel itself remains.
      expect(getQuotaGuardTrip()).toStrictEqual({ reason: 'winner reason' });
      expect(leftoverTempFiles(dir)).toStrictEqual([]);
    });

    it('leaves no temp file behind when it loses the publication race (EEXIST)', () => {
      const dir = makeTempDir();
      setEnv('INTEGRATION_TEST_FILE_DIR', dir);
      setEnv('GITHUB_ACTIONS', 'false');

      // Pre-create the sentinel so this worker's hard-link fails with EEXIST.
      // The loser still stages a temp file first; it must clean that temp up in
      // the finally block rather than leaking one temp per losing worker/retry.
      const sentinelPath = join(dir, SENTINEL_FILENAME);
      writeFileSync(
        sentinelPath,
        JSON.stringify({
          reason: 'first winner',
          timestamp: new Date().toISOString(),
        }),
      );

      tripQuotaGuard('losing reason');

      expect(getQuotaGuardTrip()).toStrictEqual({ reason: 'first winner' });
      expect(leftoverTempFiles(dir)).toStrictEqual([]);
    });

    it('does not emit a CI annotation when it loses the exclusive-create race', () => {
      const dir = makeTempDir();
      setEnv('INTEGRATION_TEST_FILE_DIR', dir);
      setEnv('GITHUB_ACTIONS', 'true');
      setEnv('GITHUB_STEP_SUMMARY', undefined);

      // The sentinel already exists (another worker won), so this trip must hit
      // the EEXIST branch and return before emitting an annotation — only the
      // winning writer announces the wall.
      const sentinelPath = join(dir, SENTINEL_FILENAME);
      writeFileSync(
        sentinelPath,
        JSON.stringify({
          reason: 'already tripped',
          timestamp: new Date().toISOString(),
        }),
      );

      const spy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      tripQuotaGuard('late loser reason');

      expect(callsIncludeAnnotation(spy.mock.calls)).toBe(false);
    });

    it('returns null after the guard is cleared', () => {
      const dir = makeTempDir();
      setEnv('INTEGRATION_TEST_FILE_DIR', dir);
      setEnv('GITHUB_ACTIONS', 'false');

      tripQuotaGuard('boom');
      expect(getQuotaGuardTrip()).not.toBeNull();

      clearQuotaGuard();
      expect(getQuotaGuardTrip()).toBeNull();
    });

    it('is inactive when INTEGRATION_TEST_FILE_DIR is unset', () => {
      setEnv('INTEGRATION_TEST_FILE_DIR', undefined);

      expect(() => tripQuotaGuard('ignored')).not.toThrow();
      expect(getQuotaGuardTrip()).toBeNull();
    });

    it('writes nothing and reads null when explicitly disabled', () => {
      const dir = makeTempDir();
      setEnv('INTEGRATION_TEST_FILE_DIR', dir);
      setEnv('LLXPRT_QUOTA_GUARD_DISABLED', 'true');

      tripQuotaGuard('should not persist');

      const sentinelPath = join(dir, SENTINEL_FILENAME);
      expect(existsSync(sentinelPath)).toBe(false);

      writeFileSync(
        sentinelPath,
        JSON.stringify({
          reason: 'manual',
          timestamp: new Date().toISOString(),
        }),
      );
      expect(getQuotaGuardTrip()).toBeNull();
    });

    it('clears a sentinel even while the guard is disabled', () => {
      const dir = makeTempDir();
      setEnv('INTEGRATION_TEST_FILE_DIR', dir);
      setEnv('LLXPRT_QUOTA_GUARD_DISABLED', 'true');

      const sentinelPath = join(dir, SENTINEL_FILENAME);
      writeFileSync(
        sentinelPath,
        JSON.stringify({
          reason: 'manual',
          timestamp: new Date().toISOString(),
        }),
      );
      expect(existsSync(sentinelPath)).toBe(true);

      clearQuotaGuard();
      expect(existsSync(sentinelPath)).toBe(false);
    });

    it('returns null for a malformed sentinel file', () => {
      const dir = makeTempDir();
      setEnv('INTEGRATION_TEST_FILE_DIR', dir);
      setEnv('GITHUB_ACTIONS', 'false');

      const sentinelPath = join(dir, SENTINEL_FILENAME);
      writeFileSync(sentinelPath, 'not-json{{');

      expect(getQuotaGuardTrip()).toBeNull();
    });

    it('returns null when the persisted reason is not a string', () => {
      const dir = makeTempDir();
      setEnv('INTEGRATION_TEST_FILE_DIR', dir);
      setEnv('GITHUB_ACTIONS', 'false');

      const sentinelPath = join(dir, SENTINEL_FILENAME);
      writeFileSync(sentinelPath, JSON.stringify({ reason: 42 }));

      expect(getQuotaGuardTrip()).toBeNull();
    });

    it('returns null when the sentinel JSON is a top-level array carrying a reason index', () => {
      // A top-level JSON array is malformed for our schema even though
      // `typeof [] === 'object'`. Because the array's index 0 holds the string
      // "reason", a record guard that failed to exclude arrays would read
      // `value['reason']` as the array METHOD/undefined and could mis-narrow;
      // more importantly the guard must treat this structurally-wrong payload as
      // malformed → null rather than surfacing a bogus trip. Arrays are excluded
      // explicitly in isRecord, so this stays null.
      const dir = makeTempDir();
      setEnv('INTEGRATION_TEST_FILE_DIR', dir);
      setEnv('GITHUB_ACTIONS', 'false');

      const sentinelPath = join(dir, SENTINEL_FILENAME);
      writeFileSync(sentinelPath, JSON.stringify(['reason', 'still an array']));

      expect(getQuotaGuardTrip()).toBeNull();
    });
  });

  describe('GitHub Actions integration', () => {
    it('emits an error annotation and step summary in CI', () => {
      const dir = makeTempDir();
      const summaryPath = join(dir, 'summary.md');
      setEnv('INTEGRATION_TEST_FILE_DIR', dir);
      setEnv('GITHUB_ACTIONS', 'true');
      setEnv('GITHUB_STEP_SUMMARY', summaryPath);

      const spy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      tripQuotaGuard('provider quota exhausted');

      expect(callsIncludeAnnotation(spy.mock.calls)).toBe(true);

      spy.mockRestore();

      const summary = readFileSync(summaryPath, 'utf8');
      expect(summary).toContain('provider quota exhausted');
    });

    it('escapes newlines and percent signs in the annotation payload', () => {
      const dir = makeTempDir();
      setEnv('INTEGRATION_TEST_FILE_DIR', dir);
      setEnv('GITHUB_ACTIONS', 'true');
      setEnv('GITHUB_STEP_SUMMARY', undefined);

      const spy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      // A reason containing the characters GitHub treats specially in a
      // workflow-command message: percent, carriage return and newline. Raw,
      // the newline would prematurely terminate the `::error::` command and the
      // second line would leak as plain log output.
      const cr = String.fromCharCode(13);
      const lf = String.fromCharCode(10);
      tripQuotaGuard(`boom 50% off${cr}${lf}second line`);

      const annotation = findAnnotationLine(spy.mock.calls);
      spy.mockRestore();

      expect(annotation).not.toBeNull();
      const line = annotation ?? '';
      // The single workflow command must be one physical line: the special
      // characters are percent-encoded, so only the writer's trailing newline
      // remains raw.
      expect(line).toBe(
        `::error title=E2E quota guard tripped::boom 50%25 off%0D%0Asecond line${lf}`,
      );
      expect(line).toContain('%25');
      expect(line).toContain('%0A');
      expect(line).toContain('%0D');
      // The escaped payload itself must not contain a raw CR, nor a raw LF
      // before the writer's trailing newline.
      expect(line.slice(0, -1)).not.toContain(lf);
      expect(line).not.toContain(cr);
    });

    it('does not emit an annotation outside of CI', () => {
      const dir = makeTempDir();
      setEnv('INTEGRATION_TEST_FILE_DIR', dir);
      setEnv('GITHUB_ACTIONS', 'false');

      const spy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      tripQuotaGuard('provider quota exhausted');

      expect(callsIncludeAnnotation(spy.mock.calls)).toBe(false);
    });

    it('stays silent when the sentinel write fails with a non-EEXIST error', () => {
      // Point the guard at a state dir whose PARENT does not exist, so the
      // exclusive `wx` write throws ENOENT rather than EEXIST. No sentinel is
      // created, so there is no cross-process latch to dedupe against. If the
      // guard emitted here, every worker (and every subsequent call) would hit
      // the same failing write and announce its own wall — flooding CI with
      // duplicate annotations. It must therefore stay silent; the quota wall is
      // still surfaced by the failing test itself.
      const dir = makeTempDir();
      const missingStateDir = join(dir, 'missing-parent', 'state');
      setEnv('INTEGRATION_TEST_FILE_DIR', missingStateDir);
      setEnv('GITHUB_ACTIONS', 'true');
      setEnv('GITHUB_STEP_SUMMARY', undefined);

      const spy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      expect(() => tripQuotaGuard('provider quota exhausted')).not.toThrow();

      expect(callsIncludeAnnotation(spy.mock.calls)).toBe(false);
      expect(getQuotaGuardTrip()).toBeNull();
    });
  });
});
