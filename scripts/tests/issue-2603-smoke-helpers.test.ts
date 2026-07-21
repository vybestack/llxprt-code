/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Focused unit tests for the pure validation/quoting helpers used by the
 * Windows installed-command smoke harness. These do NOT spawn real processes
 * (the hosted Windows smoke is the source of truth for end-to-end behavior);
 * they assert the pure-function contracts of validateSpawnResult, cmdQuote,
 * pwshQuote, and assertValidPid.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const nodeRequire = createRequire(import.meta.url);

const launcherInvocation = nodeRequire(
  join(
    repoRoot,
    'scripts',
    'windows-installed-command-smoke',
    'launcher-invocation.cjs',
  ),
) as {
  validateSpawnResult: <T>(label: string, r: T) => T;
  cmdQuote: (s: string) => string;
  pwshQuote: (s: string) => string;
};

const processHelpers = nodeRequire(
  join(
    repoRoot,
    'scripts',
    'windows-installed-command-smoke',
    'process-helpers.cjs',
  ),
) as {
  assertValidPid: (pid: unknown) => void;
  MAX_LEVELS: number;
};

describe('validateSpawnResult', () => {
  it('returns the result unchanged when there is no error and no signal', () => {
    const r = { status: 0, signal: null, error: undefined, stdout: '' };
    expect(launcherInvocation.validateSpawnResult('lbl', r)).toBe(r);
  });

  it('returns the result when status is nonzero (child exit, not spawn failure)', () => {
    const r = { status: 42, signal: null, error: undefined, stdout: '' };
    expect(launcherInvocation.validateSpawnResult('lbl', r)).toBe(r);
  });

  it('throws when r.error is set (spawn failure)', () => {
    const r = {
      status: null,
      signal: null,
      error: new Error('ENOENT'),
      stdout: '',
    };
    expect(() =>
      launcherInvocation.validateSpawnResult('invokeCmd', r),
    ).toThrow(/invokeCmd: spawn failed: ENOENT/);
  });

  it('throws when r.signal is set (terminated by signal)', () => {
    const r = {
      status: null,
      signal: 'SIGTERM',
      error: undefined,
      stdout: '',
    };
    expect(() =>
      launcherInvocation.validateSpawnResult('invokePwsh', r),
    ).toThrow(/invokePwsh: terminated by signal SIGTERM/);
  });

  it('does NOT throw for a legitimate nonzero status', () => {
    const r = { status: 1, signal: null, error: undefined, stdout: '' };
    expect(() =>
      launcherInvocation.validateSpawnResult('lbl', r),
    ).not.toThrow();
  });
});

describe('cmdQuote', () => {
  it('wraps a plain argument in double quotes', () => {
    expect(launcherInvocation.cmdQuote('hello')).toBe('"hello"');
  });

  it('doubles internal double quotes', () => {
    expect(launcherInvocation.cmdQuote('a"b')).toBe('"a""b"');
  });

  it('doubles percent signs so a literal % survives the batch parser', () => {
    expect(launcherInvocation.cmdQuote('100%done')).toBe('"100%%done"');
  });

  it('doubles every percent in a sequence', () => {
    expect(launcherInvocation.cmdQuote('%%')).toBe('"%%%%"');
  });

  it('preserves spaces and other metacharacters within quotes', () => {
    expect(launcherInvocation.cmdQuote('a b&c|d')).toBe('"a b&c|d"');
  });

  it('handles an empty string', () => {
    expect(launcherInvocation.cmdQuote('')).toBe('""');
  });
});

describe('pwshQuote', () => {
  it('returns simple tokens unquoted', () => {
    expect(launcherInvocation.pwshQuote('abc123')).toBe('abc123');
  });

  it('single-quotes and doubles internal single quotes', () => {
    expect(launcherInvocation.pwshQuote("a'b")).toBe("'a''b'");
  });
});

describe('assertValidPid', () => {
  it('accepts a positive integer', () => {
    expect(() => processHelpers.assertValidPid(1234)).not.toThrow();
  });

  it('throws on a non-number', () => {
    expect(() => processHelpers.assertValidPid('1234')).toThrow(/Invalid PID/);
  });

  it('throws on a non-integer number', () => {
    expect(() => processHelpers.assertValidPid(1.5)).toThrow(/Invalid PID/);
  });

  it('throws on zero', () => {
    expect(() => processHelpers.assertValidPid(0)).toThrow(/Invalid PID/);
  });

  it('throws on a negative number', () => {
    expect(() => processHelpers.assertValidPid(-1)).toThrow(/Invalid PID/);
  });

  it('throws on null/undefined', () => {
    expect(() => processHelpers.assertValidPid(null)).toThrow(/Invalid PID/);
    expect(() => processHelpers.assertValidPid(undefined)).toThrow(
      /Invalid PID/,
    );
  });

  it('throws on NaN', () => {
    expect(() => processHelpers.assertValidPid(NaN)).toThrow(/Invalid PID/);
  });
});

describe('MAX_LEVELS', () => {
  it('is a positive safety bound for BFS traversal depth', () => {
    expect(typeof processHelpers.MAX_LEVELS).toBe('number');
    expect(processHelpers.MAX_LEVELS).toBeGreaterThan(0);
  });
});
