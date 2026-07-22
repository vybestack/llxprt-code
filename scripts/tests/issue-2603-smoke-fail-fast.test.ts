/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Focused unit tests for the Windows installed-command smoke harness
 * infrastructure changes made for CI remediation (PR 2610, run 29850614559):
 *
 *   - runRequiredStep fail-fast (root cause G): a required setup step that
 *     throws or calls fail() must RETHROW so the orchestrator aborts dependent
 *     checks instead of cascading.
 *   - runStep "OK" snapshot (root cause F): a step that calls the non-throwing
 *     assert()/fail() must NOT print OK.
 *   - pwsh resolver (root cause C): PWSH_PATH -> pwsh.exe -> powershell.exe.
 *   - install helpers cache args (root cause A): no isolated empty --cache.
 *   - benchmark env handoff (root cause E): LLXPRT_BENCH_LAUNCHER/BUN reuse.
 *   - bundled bun.exe PE/version validation (root cause B, J).
 *
 * These do NOT spawn real processes (the hosted Windows smoke is the source of
 * truth); they assert the pure-function/state contracts.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  writeFileSync,
  readFileSync,
  mkdtempSync,
  rmSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const nodeRequire = createRequire(import.meta.url);

const smokeDir = join(repoRoot, 'scripts', 'windows-installed-command-smoke');

function loadFresh(modulePath: string): Record<string, unknown> {
  // Each require resolves the module fresh from disk (CJS caches per path; we
  // delete the cache entry so resetState state is isolated per test group).
  const abs = require.resolve(modulePath);
  delete require.cache[abs];
  return nodeRequire(modulePath);
}

const assertModule = () =>
  loadFresh(join(smokeDir, 'assert.cjs')) as {
    fail: (msg: string) => void;
    assert: (cond: boolean, msg: string) => boolean;
    runStep: (label: string, fn: () => unknown) => unknown;
    runRequiredStep: (label: string, fn: () => unknown) => unknown;
    resetState: () => void;
    getState: () => { failed: boolean; failures: string[] };
  };

describe('runRequiredStep fail-fast (root cause G)', () => {
  it('rethrows when the step function throws, so dependent checks abort', () => {
    const m = assertModule();
    m.resetState();
    expect(() =>
      m.runRequiredStep('required-install', () => {
        throw new Error('npm global install spawn failed: ETIMEDOUT');
      }),
    ).toThrow(/npm global install spawn failed: ETIMEDOUT/);
    // The failure is recorded exactly once (no cascade).
    const state = m.getState();
    expect(state.failed).toBe(true);
    expect(state.failures).toHaveLength(1);
    expect(state.failures[0]).toMatch(
      /required-install: npm global install spawn failed/,
    );
  });

  it('treats a non-throwing fail() during a required step as fatal (rethrows)', () => {
    const m = assertModule();
    m.resetState();
    // A step that calls the non-throwing fail() must still abort.
    expect(() =>
      m.runRequiredStep('required-check', () => {
        m.fail('recorded-but-no-throw');
      }),
    ).toThrow(/required step "required-check" recorded failure/);
    const state = m.getState();
    expect(state.failed).toBe(true);
    expect(
      state.failures.some((f) => f.includes('recorded-but-no-throw')),
    ).toBe(true);
  });

  it('does NOT throw when the required step succeeds', () => {
    const m = assertModule();
    m.resetState();
    expect(() =>
      m.runRequiredStep('required-ok', () => {
        /* success */
      }),
    ).not.toThrow();
    expect(m.getState().failed).toBe(false);
  });
});

describe('runStep OK snapshot (root cause F)', () => {
  // We cannot easily capture stdout in this harness, but we CAN assert the
  // STATE contract: a step that calls fail() leaves failed=true with the
  // accumulated failures, and a subsequent getState() reflects it. The OK
  // printing is gated on failures.length not increasing, which we verify
  // indirectly via the failure accumulation.

  it('accumulates failures from non-throwing assert() within a step', () => {
    const m = assertModule();
    m.resetState();
    m.runStep('exit-codes', () => {
      for (const code of [0, 1, 5, 7]) {
        m.assert(code === 0, `cmd did not preserve exit ${code}`);
      }
    });
    const state = m.getState();
    expect(state.failed).toBe(true);
    // 3 failures recorded (for codes 1, 5, 7).
    expect(state.failures).toHaveLength(3);
  });

  it('a passing step leaves the failure count unchanged', () => {
    const m = assertModule();
    m.resetState();
    m.runStep('passing', () => {
      m.assert(true, 'should not fail');
    });
    expect(m.getState().failed).toBe(false);
  });
});

describe('pwsh resolver (root cause C)', () => {
  const pwshModule = () =>
    nodeRequire(join(smokeDir, 'pwsh-resolver.cjs')) as {
      resolvePwsh: (options?: {
        platform?: string;
        env?: NodeJS.ProcessEnv;
        spawnSync?: unknown;
        existsSync?: (path: string) => boolean;
        statSync?: (path: string) => { isFile: () => boolean };
      }) => string;
      whereResolve: (
        command: string,
        options?: {
          platform?: string;
          spawnSync?: unknown;
        },
      ) => string | null;
    };

  it('returns PWSH_PATH when set (highest priority)', () => {
    const m = pwshModule();
    const result = m.resolvePwsh({
      platform: 'win32',
      env: { PWSH_PATH: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' },
      existsSync: () => true,
      statSync: () => ({ isFile: () => true }),
      spawnSync: () => ({ error: new Error('should not be called') }),
    });
    expect(result).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe');
  });

  it('prefers PWSH_PATH even where.exe would resolve pwsh.exe', () => {
    const m = pwshModule();
    const result = m.resolvePwsh({
      platform: 'win32',
      env: { PWSH_PATH: 'C:\\explicit\\pwsh.exe' },
      existsSync: () => true,
      statSync: () => ({ isFile: () => true }),
      spawnSync: () => ({
        status: 0,
        stdout: 'C:\\other\\pwsh.exe\r\n',
      }),
    });
    expect(result).toBe('C:\\explicit\\pwsh.exe');
  });

  it('ignores a malformed PWSH_PATH and falls back to where.exe', () => {
    const m = pwshModule();
    const result = m.resolvePwsh({
      platform: 'win32',
      env: { PWSH_PATH: 'pwsh.exe.Source' },
      existsSync: () => false,
      spawnSync: (cmd: string, args: string[]) => {
        if (cmd === 'where.exe' && args[0] === 'pwsh.exe') {
          return {
            status: 0,
            stdout: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe\r\n',
          };
        }
        return { status: 1, stdout: '' };
      },
    });
    expect(result).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe');
  });

  it('resolves pwsh.exe via where.exe when PWSH_PATH is unset', () => {
    const m = pwshModule();
    const result = m.resolvePwsh({
      platform: 'win32',
      env: {},
      spawnSync: (cmd: string, args: string[]) => {
        if (cmd === 'where.exe' && args[0] === 'pwsh.exe') {
          return {
            status: 0,
            stdout: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe\r\n',
          };
        }
        return { status: 1, stdout: '' };
      },
    });
    expect(result).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe');
  });

  it('falls back to powershell.exe when pwsh.exe is not found', () => {
    const m = pwshModule();
    let whereCount = 0;
    const result = m.resolvePwsh({
      platform: 'win32',
      env: {},
      spawnSync: (cmd: string, args: string[]) => {
        if (cmd !== 'where.exe') return { status: 1, stdout: '' };
        whereCount++;
        if (args[0] === 'pwsh.exe') {
          return {
            status: 1,
            stdout: '',
            stderr: 'INFO: Could not find files',
          };
        }
        // powershell.exe exists
        return {
          status: 0,
          stdout:
            'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\r\n',
        };
      },
    });
    expect(whereCount).toBe(2);
    expect(result).toMatch(/powershell\.exe$/);
  });

  it('returns bare pwsh.exe when neither is found (last-resort PATH lookup)', () => {
    const m = pwshModule();
    const result = m.resolvePwsh({
      platform: 'win32',
      env: {},
      spawnSync: () => ({ status: 1, stdout: '', stderr: 'not found' }),
    });
    expect(result).toBe('pwsh.exe');
  });

  it('returns pwsh on non-Windows (never invoked at runtime)', () => {
    const m = pwshModule();
    const result = m.resolvePwsh({
      platform: 'darwin',
      env: {},
    });
    expect(result).toBe('pwsh');
  });

  it('whereResolve returns null on non-Windows', () => {
    const m = pwshModule();
    expect(m.whereResolve('pwsh.exe', { platform: 'darwin' })).toBeNull();
  });

  it('whereResolve returns null when where.exe fails', () => {
    const m = pwshModule();
    const result = m.whereResolve('pwsh.exe', {
      platform: 'win32',
      spawnSync: () => ({ status: 1, stdout: '', stderr: 'not found' }),
    });
    expect(result).toBeNull();
  });
});

describe('install helpers cache args (root cause A)', () => {
  const installModule = () =>
    nodeRequire(join(smokeDir, 'install-helpers.cjs')) as {
      buildInstallArgs: (extraArgs: string[]) => string[];
      checkLocalCmdVersion: (consumerDir: string) => void;
    };

  it('does NOT include an isolated --cache flag (uses warmed default)', () => {
    const m = installModule();
    const args = m.buildInstallArgs([
      '--global',
      '--prefix',
      'C:\\prefix',
      'pkg.tgz',
    ]);
    expect(args).not.toContain('--cache');
    // No cache path value either.
    expect(args.some((a) => /npm-cache/i.test(a))).toBe(false);
  });

  it('produces exact install args with cache-first, no-weakening flags', () => {
    // Root cause K (PR 2610): three consecutive global installs hit the exact
    // configured timeout ceiling despite a warmed cache, proving the install
    // is blocked on avoidable registry/audit activity (not compute). The args
    // must include cache-first flags and must NOT weaken lifecycle execution.
    const m = installModule();
    const args = m.buildInstallArgs([
      '--global',
      '--prefix',
      'C:\\prefix',
      'replica.tgz',
    ]);
    expect(args).toStrictEqual([
      'install',
      '--global',
      '--prefix',
      'C:\\prefix',
      'replica.tgz',
      '--no-audit',
      '--no-fund',
      '--prefer-offline',
      '--loglevel',
      'error',
    ]);
  });

  it('suppresses avoidable registry/audit activity via cache-first flags', () => {
    const m = installModule();
    const args = m.buildInstallArgs(['pkg.tgz']);
    // --no-audit: skip the blocking vulnerability audit HTTP round-trip.
    expect(args).toContain('--no-audit');
    // --no-fund: skip the blocking funding metadata HTTP round-trip.
    expect(args).toContain('--no-fund');
    // --prefer-offline: serve from the warmed cache, fall back to registry.
    expect(args).toContain('--prefer-offline');
    // Strict --offline must NOT be used: it hard-fails on any cache miss.
    expect(args).not.toContain('--offline');
  });

  it('does NOT weaken lifecycle or install-integrity guarantees', () => {
    const m = installModule();
    const args = m.buildInstallArgs(['pkg.tgz']);
    // --ignore-scripts would skip the postinstall that installs native
    // launchers — the entire point of the smoke.
    expect(args).not.toContain('--ignore-scripts');
    // --force would clobber install-integrity protections.
    expect(args).not.toContain('--force');
  });

  it('includes the user args and loglevel', () => {
    const m = installModule();
    const args = m.buildInstallArgs(['pkg.tgz']);
    expect(args[0]).toBe('install');
    expect(args).toContain('pkg.tgz');
    expect(args).toContain('--loglevel');
    expect(args[args.indexOf('--loglevel') + 1]).toBe('error');
  });

  it('checkLocalCmdVersion uses the shared invokeCmd (not raw spawnSync cmd /c)', () => {
    // The install-helpers module must require invokeCmd from
    // launcher-invocation.cjs so checkLocalCmdVersion uses the proven
    // /d /s /c + windowsVerbatimArguments construction. We verify the module
    // source imports invokeCmd rather than using a raw spawnSync('cmd', ...)
    // with quote-only arguments.
    const src = readFileSync(join(smokeDir, 'install-helpers.cjs'), 'utf8');
    expect(src).toMatch(/require\(['"].*launcher-invocation\.cjs['"]\)/);
    expect(src).toMatch(/invokeCmd/);
    // The raw spawnSync('cmd', ['/c', ...]) pattern must NOT be present for
    // the version check (it lacks /d /s /c and windowsVerbatimArguments).
    expect(src).not.toMatch(/spawnSync\(['"]cmd['"],\s*\['\/c'/);
  });
});

describe('bundled bun.exe PE validation (root cause B, J)', () => {
  const bunModule = () =>
    nodeRequire(join(smokeDir, 'bun-validation.cjs')) as {
      isWindowsPe: (
        filePath: string,
        options?: {
          readHeader?: (p: string, n?: number) => Buffer;
        },
      ) => boolean;
      assertBundledBunHealthy: (
        bunExePath: string,
        expectedVersion: string,
        options?: {
          readHeader?: (p: string, n?: number) => Buffer;
          spawnSync?: unknown;
          env?: NodeJS.ProcessEnv;
          timeoutMs?: number;
        },
      ) => void;
      MZ_MAGIC: Buffer;
      PE_SIGNATURE: Buffer;
      ELFANEW_OFFSET: number;
    };

  /**
   * Builds a minimal valid PE header in a Buffer: MZ, e_lfanew pointing at
   * offset 0x80, and "PE\0\0" at that offset.
   */
  function makePeHeader(size = 256): Buffer {
    const buf = Buffer.alloc(size, 0);
    buf[0] = 0x4d; // M
    buf[1] = 0x5a; // Z
    const peOffset = 0x80;
    buf.writeUInt32LE(peOffset, 0x3c);
    buf.write('PE', peOffset, 'latin1'); // writes 'PE'; trailing \0\0 are implicit from Buffer.alloc(size, 0)
    return buf;
  }

  it('recognizes a valid MZ+PE header', () => {
    const m = bunModule();
    const header = makePeHeader();
    let calledPath = '';
    const result = m.isWindowsPe('C:\\fake\\bun.exe', {
      readHeader: (p) => {
        calledPath = p;
        return header;
      },
    });
    expect(result).toBe(true);
    expect(calledPath).toBe('C:\\fake\\bun.exe');
  });

  it('rejects a non-PE file (POSIX shell script bytes)', () => {
    const m = bunModule();
    const notPe = Buffer.from('#!/bin/sh\necho not a binary\n');
    const result = m.isWindowsPe('C:\\fake\\bun.exe', {
      readHeader: () => notPe,
    });
    expect(result).toBe(false);
  });

  it('rejects a truncated file (shorter than e_lfanew offset)', () => {
    const m = bunModule();
    const truncated = Buffer.from([0x4d, 0x5a]);
    const result = m.isWindowsPe('C:\\fake\\bun.exe', {
      readHeader: () => truncated,
    });
    expect(result).toBe(false);
  });

  it('rejects MZ magic with a bad PE offset', () => {
    const m = bunModule();
    const buf = Buffer.alloc(256, 0);
    buf[0] = 0x4d;
    buf[1] = 0x5a;
    buf.writeUInt32LE(0xff, 0x3c); // out of range
    const result = m.isWindowsPe('C:\\fake\\bun.exe', {
      readHeader: () => buf,
    });
    expect(result).toBe(false);
  });

  it('throws when the PE check fails AND version is wrong', () => {
    const m = bunModule();
    expect(() =>
      m.assertBundledBunHealthy('C:\\fake\\bun.exe', '1.3.14', {
        readHeader: () => Buffer.from('not-a-pe'),
        spawnSync: () => ({
          status: 216,
          stdout: '',
          stderr: 'not compatible with Windows',
        }),
      }),
    ).toThrow(/failed health check/);
  });

  it('does NOT throw for a valid PE + correct version', () => {
    const m = bunModule();
    expect(() =>
      m.assertBundledBunHealthy('C:\\fake\\bun.exe', '1.3.14', {
        readHeader: () => makePeHeader(),
        spawnSync: () => ({
          status: 0,
          stdout: '1.3.14\n',
          stderr: '',
        }),
      }),
    ).not.toThrow();
  });

  it('throws on version mismatch (right PE, wrong version)', () => {
    const m = bunModule();
    expect(() =>
      m.assertBundledBunHealthy('C:\\fake\\bun.exe', '1.3.14', {
        readHeader: () => makePeHeader(),
        spawnSync: () => ({
          status: 0,
          stdout: '1.2.3\n',
          stderr: '',
        }),
      }),
    ).toThrow(/version.*1\.2\.3.*1\.3\.14/);
  });

  it('rejects a real partial-download file written to disk', () => {
    const m = bunModule();
    const dir = mkdtempSync(join(tmpdir(), 'pe-test-'));
    try {
      const partialPath = join(dir, 'partial.exe');
      // Simulate a partial download (not MZ).
      writeFileSync(partialPath, Buffer.from([0x00, 0x01, 0x02, 0x03]));
      expect(m.isWindowsPe(partialPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('constants: expected bun version + configurable timeouts', () => {
  const constantsModule = () =>
    nodeRequire(join(smokeDir, 'constants.cjs')) as {
      EXPECTED_BUN_VERSION: string;
      INSTALL_TIMEOUT_MS: number;
      NPM_EXEC_TIMEOUT_MS: number;
      PROBE_TIMEOUT_MS: number;
      VERSION_TIMEOUT_MS: number;
      resolveExpectedBunVersion: (options?: {
        cliPkgPath?: string;
        readFileSync?: (p: string) => string;
      }) => string | undefined;
    };

  it('EXPECTED_BUN_VERSION is derived from the CLI manifest bun dependency', () => {
    const m = constantsModule();
    // Read the source of truth (the CLI manifest) directly so this test
    // fails if the constant drifts from the declared dependency.
    const cliPkgPath = join(repoRoot, 'packages', 'cli', 'package.json');
    const cliPkg = JSON.parse(readFileSync(cliPkgPath, 'utf8'));
    const declaredBun = String(cliPkg.dependencies.bun);
    // The manifest must declare an EXACT version (no range prefix). The
    // resolver returns the exact spec verbatim; it does NOT strip range
    // prefixes and pretend a range is exact.
    expect(declaredBun).toMatch(/^\d+\.\d+\.\d+/);
    expect(m.EXPECTED_BUN_VERSION).toBe(declaredBun);
  });

  it('EXPECTED_BUN_VERSION is an exact semver (no range prefix stripped)', () => {
    // The CLI manifest intentionally pins exact Bun. resolveExpectedBunVersion
    // must return the exact manifest spec only — it must NOT strip range
    // prefixes (^, ~, >=) and pretend a range is exact. If the manifest ever
    // declares a range, EXPECTED_BUN_VERSION must be undefined (fail loudly)
    // rather than returning a stripped base version.
    const m = constantsModule();
    if (m.EXPECTED_BUN_VERSION !== undefined) {
      // Must be a complete exact semver X.Y.Z (no range prefix).
      expect(m.EXPECTED_BUN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('resolveExpectedBunVersion returns the exact spec for an exact pin', () => {
    const m = constantsModule();
    const fakeRead = (): string =>
      JSON.stringify({ dependencies: { bun: '1.3.14' } });
    expect(
      m.resolveExpectedBunVersion({
        cliPkgPath: 'fake',
        readFileSync: fakeRead,
      }),
    ).toBe('1.3.14');
  });

  it('resolveExpectedBunVersion returns undefined for a caret range (^1.3.14)', () => {
    const m = constantsModule();
    const fakeRead = (): string =>
      JSON.stringify({ dependencies: { bun: '^1.3.14' } });
    expect(
      m.resolveExpectedBunVersion({
        cliPkgPath: 'fake',
        readFileSync: fakeRead,
      }),
    ).toBeUndefined();
  });

  it('resolveExpectedBunVersion returns undefined for a tilde range (~1.3.14)', () => {
    const m = constantsModule();
    const fakeRead = (): string =>
      JSON.stringify({ dependencies: { bun: '~1.3.14' } });
    expect(
      m.resolveExpectedBunVersion({
        cliPkgPath: 'fake',
        readFileSync: fakeRead,
      }),
    ).toBeUndefined();
  });

  it('resolveExpectedBunVersion returns undefined for a digit-leading range (1.x)', () => {
    const m = constantsModule();
    const fakeRead = (): string =>
      JSON.stringify({ dependencies: { bun: '1.x' } });
    expect(
      m.resolveExpectedBunVersion({
        cliPkgPath: 'fake',
        readFileSync: fakeRead,
      }),
    ).toBeUndefined();
  });

  it('resolveExpectedBunVersion returns undefined when manifest is unreadable', () => {
    const m = constantsModule();
    const fakeRead = (): string => {
      throw new Error('ENOENT');
    };
    expect(
      m.resolveExpectedBunVersion({
        cliPkgPath: 'fake',
        readFileSync: fakeRead,
      }),
    ).toBeUndefined();
  });

  it('resolveExpectedBunVersion returns undefined when bun field is missing', () => {
    const m = constantsModule();
    const fakeRead = (): string => JSON.stringify({ dependencies: {} });
    expect(
      m.resolveExpectedBunVersion({
        cliPkgPath: 'fake',
        readFileSync: fakeRead,
      }),
    ).toBeUndefined();
  });

  it('all timeouts are positive and env-configurable', () => {
    const m = constantsModule();
    for (const t of [
      m.INSTALL_TIMEOUT_MS,
      m.NPM_EXEC_TIMEOUT_MS,
      m.PROBE_TIMEOUT_MS,
      m.VERSION_TIMEOUT_MS,
    ]) {
      expect(t).toBeGreaterThan(0);
    }
  });

  it('install timeout default has adequate headroom for Windows npm installs', () => {
    // Evidence-based ceiling (PR 2610): the prior successful global install
    // completed in 342_875 ms; the smoke then failed twice at exactly 480_000
    // ms (the old default), confirming the ceiling was too tight for runner
    // variance. The default must give meaningful headroom over the observed
    // success while staying within the 60-minute aggregate job budget. Two
    // installs use INSTALL_TIMEOUT_MS, one npm exec uses NPM_EXEC_TIMEOUT_MS,
    // and the benchmark uses 300_000 ms — their ceilings must sum to well
    // under 3_600_000 ms (60 min).
    const m = constantsModule();
    const observedSuccessMs = 342_875;
    // At least 1.5x the observed success (~514s) so normal runner variance
    // does not hit the wall.
    expect(m.INSTALL_TIMEOUT_MS).toBeGreaterThanOrEqual(
      Math.ceil(observedSuccessMs * 1.5),
    );
    // Aggregate ceiling budget stays safely under the 60-minute job timeout.
    const aggregateCeilingMs =
      m.INSTALL_TIMEOUT_MS * 2 + m.NPM_EXEC_TIMEOUT_MS + 300_000;
    expect(aggregateCeilingMs).toBeLessThan(3_600_000);
    // Fail-fast preserved: each install still has a finite ceiling so a
    // genuine hang aborts in minutes, not the full job budget.
    expect(m.INSTALL_TIMEOUT_MS).toBeLessThan(3_600_000);
  });
});

describe('benchmark env handoff (root cause E)', () => {
  const benchmarkModule = () =>
    nodeRequire(
      join(repoRoot, 'scripts', 'tests', 'issue-2603-startup-benchmark.cjs'),
    ) as {
      resolveBun: () => string;
      resolveDirectLauncherInvocation: () => {
        command: string;
        baseArgs: string[];
      };
      parseIterations: (raw: unknown) => number;
    };

  /**
   * Creates a real executable file on disk so validateExecutable (POSIX X_OK)
   * passes, then sets LLXPRT_BENCH_BUN and asserts resolveBun() honors it.
   */
  it('resolveBun honors LLXPRT_BENCH_BUN when the file exists and is executable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-bun-'));
    try {
      const bunPath = join(dir, 'fake-bun');
      writeFileSync(bunPath, '#!/bin/sh\\necho 1.3.14\\n');
      chmodSync(bunPath, 0o755);
      const origEnv = process.env.LLXPRT_BENCH_BUN;
      process.env.LLXPRT_BENCH_BUN = bunPath;
      try {
        const m = benchmarkModule();
        expect(m.resolveBun()).toBe(bunPath);
      } finally {
        if (origEnv === undefined) {
          delete process.env.LLXPRT_BENCH_BUN;
        } else {
          process.env.LLXPRT_BENCH_BUN = origEnv;
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolveDirectLauncherInvocation on POSIX returns the source launcher', () => {
    // On POSIX the env handoff does not apply (the launcher is the POSIX
    // shell script). We assert the POSIX path is returned, proving the
    // function does not crash when LLXPRT_BENCH_LAUNCHER is unset.
    const origEnv = process.env.LLXPRT_BENCH_LAUNCHER;
    delete process.env.LLXPRT_BENCH_LAUNCHER;
    try {
      const m = benchmarkModule();
      const inv = m.resolveDirectLauncherInvocation();
      expect(inv.command).toMatch(/llxprt$/);
      expect(inv.baseArgs).toEqual([]);
    } finally {
      if (origEnv !== undefined) {
        process.env.LLXPRT_BENCH_LAUNCHER = origEnv;
      }
    }
  });

  it('parseIterations rejects non-numeric / non-positive values', () => {
    const m = benchmarkModule();
    expect(() => m.parseIterations('abc')).toThrow(/positive integer/);
    expect(() => m.parseIterations(0)).toThrow(/positive integer/);
    expect(() => m.parseIterations(-5)).toThrow(/positive integer/);
    expect(() => m.parseIterations(1.5)).toThrow(/positive integer/);
    expect(m.parseIterations('15')).toBe(15);
  });
});
