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

/**
 * Require a smoke-harness module by relative path, reducing repetition of the
 * verbose join(repoRoot, 'scripts', ...) pattern.
 */
function requireSmoke(moduleRelpath: string): Record<string, unknown> {
  return nodeRequire(join(repoRoot, ...moduleRelpath.split('/')));
}

const launcherInvocation = requireSmoke(
  'scripts/windows-installed-command-smoke/launcher-invocation.cjs',
) as {
  probeArg: (request: Record<string, unknown>) => string;
  validateSpawnResult: <T>(label: string, r: T) => T;
  cmdQuote: (s: string) => string;
  pwshQuote: (s: string) => string;
};

const processHelpers = requireSmoke(
  'scripts/windows-installed-command-smoke/process-helpers.cjs',
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

  it('preserves a single caret (^) without doubling it', () => {
    // The caret (^) is a cmd.exe escape metacharacter, but inside the quoted
    // /c argument doubling it (^^) can turn one literal caret into two. The
    // hosted Windows hostile-argv test passed at commit b6bdf4e1a with caret
    // preserved, so cmdQuote must NOT double carets.
    expect(launcherInvocation.cmdQuote('a^b')).toBe('"a^b"');
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

  it('wraps strings with spaces in single quotes', () => {
    expect(launcherInvocation.pwshQuote('hello world')).toBe("'hello world'");
  });

  it('wraps strings with PowerShell metacharacters in single quotes', () => {
    expect(launcherInvocation.pwshQuote('a;b')).toBe("'a;b'");
    expect(launcherInvocation.pwshQuote('a|b')).toBe("'a|b'");
    expect(launcherInvocation.pwshQuote('a&b')).toBe("'a&b'");
    expect(launcherInvocation.pwshQuote('$var')).toBe("'$var'");
  });

  it('handles combined spaces, metacharacters, and single quotes', () => {
    expect(launcherInvocation.pwshQuote("it's a $test; done")).toBe(
      "'it''s a $test; done'",
    );
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
  it('is the expected safety bound for BFS traversal depth', () => {
    expect(typeof processHelpers.MAX_LEVELS).toBe('number');
    expect(processHelpers.MAX_LEVELS).toBe(200);
  });
});

/**
 * Probe request/payload contract tests for the nativeExit mode. The probe
 * request is base64url-encoded JSON; these verify the construction keeps the
 * exit status exact so the hosted Windows behavioral check can rely on it.
 * Source pattern alone is not sufficient — the round-trip must preserve the
 * full uint32 value.
 */
describe('probeArg nativeExit payload contract', () => {
  function decodeProbeArg(arg: string): Record<string, unknown> {
    expect(arg.startsWith('LLXPRT_PROBE_B64=')).toBe(true);
    const json = Buffer.from(
      arg.slice('LLXPRT_PROBE_B64='.length),
      'base64url',
    ).toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  }

  it('keeps nativeExit 9009 exact through the base64url round-trip', () => {
    const arg = launcherInvocation.probeArg({ nativeExit: 9009 });
    const decoded = decodeProbeArg(arg);
    expect(decoded.nativeExit).toBe(9009);
    // Sanity: 9009 must NOT be truncated modulo 256 (which would be 49).
    expect(decoded.nativeExit).not.toBe(9009 % 256);
  });

  it('keeps nativeExit 0 exact (valid uint32)', () => {
    const arg = launcherInvocation.probeArg({ nativeExit: 0 });
    const decoded = decodeProbeArg(arg);
    expect(decoded.nativeExit).toBe(0);
  });

  it('keeps the max uint32 value exact', () => {
    const arg = launcherInvocation.probeArg({ nativeExit: 0xffffffff });
    const decoded = decodeProbeArg(arg);
    expect(decoded.nativeExit).toBe(0xffffffff);
  });

  it('does not add nativeExit when only exit is requested', () => {
    const arg = launcherInvocation.probeArg({ exit: 42 });
    const decoded = decodeProbeArg(arg);
    expect(decoded.exit).toBe(42);
    expect(decoded.nativeExit).toBeUndefined();
  });

  it('keeps exit (ordinary process.exit path) exact for in-range codes', () => {
    const arg = launcherInvocation.probeArg({ exit: 193 });
    const decoded = decodeProbeArg(arg);
    expect(decoded.exit).toBe(193);
  });

  describe('parseProbeOutput sentinel extraction', () => {
    const launcherInvocationWithParse = nodeRequire(
      join(
        repoRoot,
        'scripts',
        'windows-installed-command-smoke',
        'launcher-invocation.cjs',
      ),
    ) as {
      parseProbeOutput: (stdout: string) => Record<string, unknown>;
      PROBE_SENTINEL: string;
    };

    it('extracts JSON from a dedicated sentinel line', () => {
      const payload = { argv: ['test'], exit: 0 };
      const stdout = `some log line\n${launcherInvocationWithParse.PROBE_SENTINEL}${JSON.stringify(payload)}\nmore output\n`;
      const result = launcherInvocationWithParse.parseProbeOutput(stdout);
      expect(result).toEqual(payload);
    });

    it('falls back to brace-matching when no sentinel is present', () => {
      const payload = { argv: ['test'], exit: 0 };
      const stdout = `log line\n${JSON.stringify(payload)}\n`;
      const result = launcherInvocationWithParse.parseProbeOutput(stdout);
      expect(result).toEqual(payload);
    });

    it('throws when stdout has no JSON object', () => {
      expect(() =>
        launcherInvocationWithParse.parseProbeOutput('no json here'),
      ).toThrow(/no JSON object/);
    });

    it('throws with context when sentinel line has invalid JSON', () => {
      const stdout = `${launcherInvocationWithParse.PROBE_SENTINEL}{invalid}\n`;
      expect(() =>
        launcherInvocationWithParse.parseProbeOutput(stdout),
      ).toThrow(/sentinel line/);
    });
  });

  describe('buildInstallArgs input guard', () => {
    const installHelpersModule = () =>
      requireSmoke(
        'scripts/windows-installed-command-smoke/install-helpers.cjs',
      ) as {
        buildInstallArgs: (extraArgs: string[]) => string[];
      };

    it('throws TypeError when extraArgs is undefined', () => {
      const m = installHelpersModule();
      expect(() =>
        m.buildInstallArgs(undefined as unknown as string[]),
      ).toThrow(/must be an array/);
    });

    it('throws TypeError when extraArgs is a string', () => {
      const m = installHelpersModule();
      expect(() =>
        m.buildInstallArgs('not-an-array' as unknown as string[]),
      ).toThrow(/must be an array/);
    });

    it('accepts an empty array', () => {
      const m = installHelpersModule();
      const args = m.buildInstallArgs([]);
      expect(args).toStrictEqual([
        'install',
        '--no-audit',
        '--no-fund',
        '--prefer-offline',
        '--loglevel',
        'error',
      ]);
    });

    it('emits cache-first flags that suppress avoidable registry activity', () => {
      // Root cause K (PR 2610, three exact-ceiling global-install timeouts):
      // npm's defaults (audit=true, fund=true, prefer-offline=false) cause
      // every smoke install to make blocking registry/audit HTTP round-trips
      // even when the warmed cache holds a copy. The prior successful head
      // completed in 342_875 ms; three consecutive runs then hit the exact
      // configured ceiling, proving the install is blocked on avoidable
      // network activity, not compute. These flags make installs
      // deterministic and cache-first while preserving registry fallback.
      const m = installHelpersModule();
      const args = m.buildInstallArgs(['pkg.tgz']);
      expect(args).toContain('--no-audit');
      expect(args).toContain('--no-fund');
      expect(args).toContain('--prefer-offline');
    });

    it('does NOT emit strict --offline (registry fallback preserved)', () => {
      // --offline would hard-fail on any cache miss (e.g. metadata stall or a
      // cold entry), making installs brittle. --prefer-offline prefers cached
      // copies but transparently falls back to the registry when needed.
      const m = installHelpersModule();
      const args = m.buildInstallArgs(['pkg.tgz']);
      expect(args).not.toContain('--offline');
    });

    it('does NOT weaken lifecycle/script execution', () => {
      // --ignore-scripts would skip the postinstall that installs native
      // launchers, defeating the entire smoke. --force would clobber
      // install-integrity guarantees. Neither must ever appear.
      const m = installHelpersModule();
      const args = m.buildInstallArgs(['pkg.tgz']);
      expect(args).not.toContain('--ignore-scripts');
      expect(args).not.toContain('--force');
    });
  });
});
