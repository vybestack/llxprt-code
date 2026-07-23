/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Focused unit tests for the five Windows installed-command CI remediations
 * (PR 2610). These cover the pure/helper contracts:
 *   - cmdInvocationArgs: direct cmd.exe /d /s /c + Windows verbatim quoting
 *   - samePath: exact path normalization via injected realpath (8.3 → long)
 *   - probe payload PID shape (pid + ppid present)
 *   - validateProcessLineage: root reached, Bun expected, Node rejected
 *   - walkProcessLineage: bounded ancestry walk with an injected query seam
 *
 * The core Windows behavior remains a CI behavioral test
 * (windows-installed-command.yml); these do NOT fake it locally.
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
  cmdInvocationArgs: (cmdPath: string, args: string[]) => string[];
  cmdQuote: (s: string) => string;
  spawnCmdLongRunning: unknown;
};

const packageLayout = nodeRequire(
  join(
    repoRoot,
    'scripts',
    'windows-installed-command-smoke',
    'package-layout.cjs',
  ),
) as {
  samePath: (
    a: string,
    b: string,
    options?: { realpathSync?: (p: string) => string },
  ) => boolean;
};

const processHelpers = nodeRequire(
  join(
    repoRoot,
    'scripts',
    'windows-installed-command-smoke',
    'process-helpers.cjs',
  ),
) as {
  validateProcessLineage: (
    chain: Array<{ pid: number; ppid: number; name: string }>,
    rootPid: number,
  ) => { ok: true; chain: Array<{ pid: number; ppid: number; name: string }> };
  walkProcessLineage: (
    probePid: number,
    rootPid: number,
    options?: {
      queryProcessEntry?: (
        pid: number,
      ) => { pid: number; ppid: number; name: string } | null;
    },
  ) => Array<{ pid: number; ppid: number; name: string }>;
  queryProcessEntry: (
    pid: number,
    options?: {
      resolvePwsh?: () => string;
      spawnSync?: unknown;
      timeout?: number;
    },
  ) => { pid: number; ppid: number; name: string } | null;
  MAX_ANCESTRY_HOPS: number;
  assertValidPid: (pid: unknown) => void;
};

describe('cmdInvocationArgs', () => {
  it('produces a direct cmd.exe /d /s /c argv array', () => {
    const argv = launcherInvocation.cmdInvocationArgs('C:\\app\\llxprt.cmd', [
      '--version',
    ]);
    expect(argv[0]).toBe('/d');
    expect(argv[1]).toBe('/s');
    expect(argv[2]).toBe('/c');
  });

  it('wraps the full command in one quoted token as the 4th argv element', () => {
    const argv = launcherInvocation.cmdInvocationArgs('C:\\app\\llxprt.cmd', [
      '--version',
    ]);
    expect(argv.length).toBe(4);
    // The /c argument is a single double-quoted command string built from
    // cmdQuote-wrapped pieces joined by spaces.
    expect(argv[3].startsWith('"')).toBe(true);
    expect(argv[3].endsWith('"')).toBe(true);
  });

  it('keeps a hostile metacharacter argument as a separate quoted piece', () => {
    const hostile = '& echo INJECTED > "C:\\evil.txt"';
    const argv = launcherInvocation.cmdInvocationArgs('C:\\app\\llxprt.cmd', [
      'LLXPRT_PROBE_B64=abc',
      hostile,
    ]);
    const command = argv[3];
    // The command string contains both the probe arg and the hostile arg,
    // each separately cmdQuote-wrapped, joined by a space.
    expect(command).toContain(
      launcherInvocation.cmdQuote('LLXPRT_PROBE_B64=abc'),
    );
    expect(command).toContain(launcherInvocation.cmdQuote(hostile));
  });

  it('doubles internal double quotes in the hostile arg (cmd quoting rule)', () => {
    const hostile = 'a"b';
    const argv = launcherInvocation.cmdInvocationArgs('C:\\app\\llxprt.cmd', [
      hostile,
    ]);
    // cmdQuote('a"b') === '"a""b"', embedded inside the outer /c quotes.
    expect(argv[3]).toContain('"a""b"');
  });

  it('doubles percent signs so a literal % survives the batch parser', () => {
    const argv = launcherInvocation.cmdInvocationArgs('C:\\app\\llxprt.cmd', [
      '100%done',
    ]);
    expect(argv[3]).toContain('100%%done');
  });

  it('does NOT inject an unquoted metacharacter sentinel into the command', () => {
    // The hostile arg must be fully cmdQuote-wrapped so & cannot act as a
    // command separator at the cmd.exe level.
    const argv = launcherInvocation.cmdInvocationArgs('C:\\app\\llxprt.cmd', [
      '& echo INJECTED',
    ]);
    const command = argv[3];
    // The raw & should only ever appear inside quotes within the command.
    // Verify the quoted form is present.
    expect(command).toContain(launcherInvocation.cmdQuote('& echo INJECTED'));
  });

  it('preserves the base64url control payload unmodified', () => {
    const payload = 'LLXPRT_PROBE_B64=eyJleGl0Ijo5MDA5fQ';
    const argv = launcherInvocation.cmdInvocationArgs('C:\\app\\llxprt.cmd', [
      payload,
    ]);
    expect(argv[3]).toContain(payload);
  });
});

describe('samePath', () => {
  it('matches identical paths', () => {
    const identity = (p: string): string => p;
    expect(
      packageLayout.samePath('C:\\app\\bun.exe', 'C:\\app\\bun.exe', {
        realpathSync: identity,
      }),
    ).toBe(true);
  });

  it('matches when only the case differs (Windows is case-insensitive)', () => {
    const identity = (p: string): string => p;
    expect(
      packageLayout.samePath('C:\\App\\Bun.exe', 'c:\\app\\bun.exe', {
        realpathSync: identity,
      }),
    ).toBe(true);
  });

  it('matches when only the separator differs (backslash vs forward slash)', () => {
    const identity = (p: string): string => p;
    expect(
      packageLayout.samePath('C:\\app\\bun.exe', 'C:/app/bun.exe', {
        realpathSync: identity,
      }),
    ).toBe(true);
  });

  it('canonicalizes an 8.3 short path to the long path via injected realpath', () => {
    // Simulate realpath resolving the 8.3 short name to the long name.
    const shortToLong = (p: string): string => {
      if (p.toUpperCase() === 'C:\\PROGRA~2\\APP\\BUN.exe'.toUpperCase()) {
        return 'C:\\Program Files (x86)\\App\\bun.exe';
      }
      return p;
    };
    expect(
      packageLayout.samePath(
        'C:\\PROGRA~2\\APP\\BUN.exe',
        'C:\\Program Files (x86)\\App\\bun.exe',
        { realpathSync: shortToLong },
      ),
    ).toBe(true);
  });

  it('rejects different paths', () => {
    const identity = (p: string): string => p;
    expect(
      packageLayout.samePath('C:\\app\\bun.exe', 'C:\\app\\node.exe', {
        realpathSync: identity,
      }),
    ).toBe(false);
  });

  it('strips trailing slashes before comparing', () => {
    const identity = (p: string): string => p;
    expect(
      packageLayout.samePath('C:\\app\\', 'C:\\app', {
        realpathSync: identity,
      }),
    ).toBe(true);
  });

  it('falls back to the original path when realpath throws ENOENT (missing path)', () => {
    const throwing = (): string => {
      const err: NodeJS.ErrnoException = new Error(
        'ENOENT: no such file or directory',
      );
      err.code = 'ENOENT';
      throw err;
    };
    // Both paths throw ENOENT, so the originals are compared. Different originals → false.
    expect(
      packageLayout.samePath('C:\\missing\\a.exe', 'C:\\missing\\b.exe', {
        realpathSync: throwing,
      }),
    ).toBe(false);
    // Same originals → true even though realpath throws ENOENT.
    expect(
      packageLayout.samePath('C:\\missing\\a.exe', 'C:\\missing\\a.exe', {
        realpathSync: throwing,
      }),
    ).toBe(true);
  });

  it('propagates unexpected realpath errors (not ENOENT)', () => {
    const throwing = (): string => {
      const err: NodeJS.ErrnoException = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      throw err;
    };
    // An EACCES error is NOT silently swallowed; it propagates so the caller
    // sees an unexpected filesystem condition.
    expect(() =>
      packageLayout.samePath('C:\\secure\\a.exe', 'C:\\secure\\b.exe', {
        realpathSync: throwing,
      }),
    ).toThrow(/samePath: realpath failed/);
  });

  it('uses the native realpathSync when no options are provided', () => {
    // This exercises the default branch; the two real paths must resolve via
    // the host's native realpath. Use the repo's own package.json which exists.
    const pkgPath = join(repoRoot, 'package.json');
    expect(packageLayout.samePath(pkgPath, pkgPath)).toBe(true);
  });
});

describe('validateProcessLineage', () => {
  it('accepts a valid chain that reaches root and contains Bun', () => {
    // root is NOT node.exe here — it's the launcher root (the test harness
    // Node process). Use a non-node root name.
    const launcherRoot = { pid: 6000, ppid: 1, name: 'cmd.exe' };
    const chain = [
      { pid: 5000, ppid: 5001, name: 'bun.exe' },
      { pid: 5001, ppid: 6000, name: 'cmd.exe' },
      launcherRoot,
    ];
    const result = processHelpers.validateProcessLineage(chain, 6000);
    expect(result.ok).toBe(true);
    expect(result.chain).toEqual(chain);
  });

  it('throws when the chain does not reach the root', () => {
    const chain = [
      { pid: 5000, ppid: 5001, name: 'bun.exe' },
      { pid: 5001, ppid: 5002, name: 'cmd.exe' },
    ];
    expect(() => processHelpers.validateProcessLineage(chain, 9999)).toThrow(
      /lineage root not reached/,
    );
  });

  it('throws when Bun is missing from the chain', () => {
    const noBun = [
      { pid: 5001, ppid: 5002, name: 'cmd.exe' },
      { pid: 5002, ppid: 1, name: 'cmd.exe' },
    ];
    expect(() => processHelpers.validateProcessLineage(noBun, 5002)).toThrow(
      /lineage missing bundled bun/,
    );
  });

  it('throws when node.exe appears in the bounded chain', () => {
    // The chain includes node.exe as an intermediary (not the root). The
    // launcher must hand off directly to bundled bun.exe, never node.
    const withNode = [
      { pid: 5000, ppid: 5100, name: 'bun.exe' },
      { pid: 5100, ppid: 5002, name: 'node.exe' },
      { pid: 5002, ppid: 1, name: 'cmd.exe' },
    ];
    expect(() => processHelpers.validateProcessLineage(withNode, 5002)).toThrow(
      /lineage contains node.exe/,
    );
  });

  it('rejects node.exe even at the root (root must be the launcher, not Node)', () => {
    // The root is the spawned launcher (cmd.exe/pwsh.exe), never node.exe.
    // The walk stops at root precisely because the Node test harness lives
    // BEYOND root; node.exe inside the bounded chain (root included) is a bug.
    const chain = [
      { pid: 5000, ppid: 5001, name: 'bun.exe' },
      { pid: 5001, ppid: 7000, name: 'cmd.exe' },
      { pid: 7000, ppid: 1, name: 'node.exe' },
    ];
    expect(() => processHelpers.validateProcessLineage(chain, 7000)).toThrow(
      /lineage contains node.exe/,
    );
  });

  it('accepts conhost and pwsh intermediary processes', () => {
    const chain = [
      { pid: 5000, ppid: 5100, name: 'bun.exe' },
      { pid: 5100, ppid: 5200, name: 'pwsh.exe' },
      { pid: 5200, ppid: 5300, name: 'conhost.exe' },
      { pid: 5300, ppid: 1, name: 'pwsh.exe' },
    ];
    expect(() =>
      processHelpers.validateProcessLineage(chain, 5300),
    ).not.toThrow();
  });

  it('throws on an empty chain', () => {
    expect(() => processHelpers.validateProcessLineage([], 100)).toThrow(
      /empty chain/,
    );
  });
});

describe('walkProcessLineage', () => {
  it('walks from probe PID to root using injected single-PID queries', () => {
    // Simulate: probe(5000, bun) → parent(5001, cmd) → root(5002, node harness)
    const table = new Map<number, { pid: number; ppid: number; name: string }>([
      [5000, { pid: 5000, ppid: 5001, name: 'bun.exe' }],
      [5001, { pid: 5001, ppid: 5002, name: 'cmd.exe' }],
      [5002, { pid: 5002, ppid: 1, name: 'pwsh.exe' }],
    ]);
    const query = (pid: number) => table.get(pid) ?? null;
    const chain = processHelpers.walkProcessLineage(5000, 5002, {
      queryProcessEntry: query,
    });
    expect(chain.map((e) => e.pid)).toEqual([5000, 5001, 5002]);
  });

  it('stops exactly at the root and does not walk beyond it', () => {
    // Root's ppid points to pid 1, but the walk must stop at root (5002) and
    // never query pid 1.
    const queried: number[] = [];
    const table = new Map<number, { pid: number; ppid: number; name: string }>([
      [5000, { pid: 5000, ppid: 5001, name: 'bun.exe' }],
      [5001, { pid: 5001, ppid: 5002, name: 'cmd.exe' }],
      [5002, { pid: 5002, ppid: 1, name: 'node.exe' }],
    ]);
    const query = (pid: number) => {
      queried.push(pid);
      return table.get(pid) ?? null;
    };
    const chain = processHelpers.walkProcessLineage(5000, 5002, {
      queryProcessEntry: query,
    });
    // The walk queried 5000, 5001, 5002 but NOT 1 (root's ppid).
    expect(queried).toEqual([5000, 5001, 5002]);
    expect(chain.length).toBe(3);
    expect(chain[chain.length - 1].pid).toBe(5002);
  });

  it('throws when a query returns null before reaching root', () => {
    const query = (pid: number): null => {
      // Simulate the process having exited (CIM returns nothing).
      void pid;
      return null;
    };
    expect(() =>
      processHelpers.walkProcessLineage(5000, 5002, {
        queryProcessEntry: query,
      }),
    ).toThrow(/could not query pid=5000/);
  });

  it('detects a cycle and throws', () => {
    // 5000 → 5001 → 5000 (cycle), root is 9999 (never reached).
    const table = new Map<number, { pid: number; ppid: number; name: string }>([
      [5000, { pid: 5000, ppid: 5001, name: 'bun.exe' }],
      [5001, { pid: 5001, ppid: 5000, name: 'cmd.exe' }],
    ]);
    const query = (pid: number) => table.get(pid) ?? null;
    expect(() =>
      processHelpers.walkProcessLineage(5000, 9999, {
        queryProcessEntry: query,
      }),
    ).toThrow(/cycle detected/);
  });

  it('throws when exceeding MAX_ANCESTRY_HOPS without reaching root', () => {
    // Build an infinite chain where every pid's parent is pid+1, and root is
    // unreachable (very large). The walk must bail after MAX_ANCESTRY_HOPS.
    const query = (pid: number) => ({
      pid,
      ppid: pid + 1,
      name: 'bun.exe',
    });
    const unreachableRoot = 9_999_999;
    expect(() =>
      processHelpers.walkProcessLineage(1, unreachableRoot, {
        queryProcessEntry: query,
      }),
    ).toThrow(/exceeded .* hops/);
  });

  it('rejects an invalid probe PID', () => {
    expect(() =>
      processHelpers.walkProcessLineage(-1, 100, {
        queryProcessEntry: () => null,
      }),
    ).toThrow(/Invalid PID/);
  });

  it('rejects an invalid root PID', () => {
    expect(() =>
      processHelpers.walkProcessLineage(100, 0, {
        queryProcessEntry: () => null,
      }),
    ).toThrow(/Invalid PID/);
  });

  it('handles a single-entry chain where probe PID equals root PID', () => {
    const query = (pid: number) => ({
      pid,
      ppid: 1,
      name: 'bun.exe',
    });
    const chain = processHelpers.walkProcessLineage(5000, 5000, {
      queryProcessEntry: query,
    });
    expect(chain.length).toBe(1);
    expect(chain[0].pid).toBe(5000);
  });
});

describe('MAX_ANCESTRY_HOPS', () => {
  it('is a positive safety bound for ancestry walk depth', () => {
    expect(typeof processHelpers.MAX_ANCESTRY_HOPS).toBe('number');
    expect(processHelpers.MAX_ANCESTRY_HOPS).toBeGreaterThan(0);
  });
});

/**
 * A fake spawnSync that returns a configurable result. Used to exercise the
 * real queryProcessEntry diagnostics (throw vs null) without spawning a real
 * PowerShell process.
 */
type SpawnResult = {
  error?: { message: string };
  signal?: string | null;
  status?: number | null;
  stdout?: string;
  stderr?: string;
};

describe('queryProcessEntry diagnostics (no silent null-collapse)', () => {
  it('returns the parsed entry when CIM reports the process present', () => {
    const fakeSpawn = (): SpawnResult => ({
      status: 0,
      signal: null,
      stdout: '{"pid":5000,"ppid":5001,"name":"bun.exe"}',
      stderr: '',
    });
    const entry = processHelpers.queryProcessEntry(5000, {
      resolvePwsh: () => 'pwsh.exe',
      spawnSync: fakeSpawn,
    });
    expect(entry).toEqual({ pid: 5000, ppid: 5001, name: 'bun.exe' });
  });

  it('returns null ONLY when CIM definitively reports the process absent', () => {
    // status 0 + empty stdout = process is no longer alive (the one
    // legitimate "not found" outcome for the ancestry walk).
    const fakeSpawn = (): SpawnResult => ({
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
    });
    expect(
      processHelpers.queryProcessEntry(5000, {
        resolvePwsh: () => 'pwsh.exe',
        spawnSync: fakeSpawn,
      }),
    ).toBeNull();
  });

  it('throws on spawn error (does not collapse to null)', () => {
    const fakeSpawn = (): SpawnResult => ({
      error: new Error('ENOENT'),
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
    });
    expect(() =>
      processHelpers.queryProcessEntry(5000, {
        resolvePwsh: () => 'pwsh.exe',
        spawnSync: fakeSpawn,
      }),
    ).toThrow(/spawn failed for pid=5000: ENOENT/);
  });

  it('throws on signal termination with stderr context', () => {
    const fakeSpawn = (): SpawnResult => ({
      status: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: 'killed',
    });
    expect(() =>
      processHelpers.queryProcessEntry(5000, {
        resolvePwsh: () => 'pwsh.exe',
        spawnSync: fakeSpawn,
      }),
    ).toThrow(/terminated by signal SIGTERM for pid=5000/);
  });

  it('throws on non-zero PowerShell exit with stdout/stderr context', () => {
    const fakeSpawn = (): SpawnResult => ({
      status: 1,
      signal: null,
      stdout: 'partial',
      stderr: 'pwsh error: bad filter',
    });
    expect(() =>
      processHelpers.queryProcessEntry(5000, {
        resolvePwsh: () => 'pwsh.exe',
        spawnSync: fakeSpawn,
      }),
    ).toThrow(/PowerShell exited 1 for pid=5000/);
  });

  it('throws on unparseable JSON with the raw output', () => {
    const fakeSpawn = (): SpawnResult => ({
      status: 0,
      signal: null,
      stdout: 'this is not json',
      stderr: '',
    });
    expect(() =>
      processHelpers.queryProcessEntry(5000, {
        resolvePwsh: () => 'pwsh.exe',
        spawnSync: fakeSpawn,
      }),
    ).toThrow(/failed to parse JSON for pid=5000/);
  });

  it('throws on non-integer pid/ppid fields', () => {
    const fakeSpawn = (): SpawnResult => ({
      status: 0,
      signal: null,
      stdout: '{"pid":"oops","ppid":5001,"name":"bun.exe"}',
      stderr: '',
    });
    expect(() =>
      processHelpers.queryProcessEntry(5000, {
        resolvePwsh: () => 'pwsh.exe',
        spawnSync: fakeSpawn,
      }),
    ).toThrow(/non-integer pid\/ppid for pid=5000/);
  });
});

describe('spawnCmdLongRunning export', () => {
  it('is exported as a function for long-running CMD process spawn', () => {
    expect(typeof launcherInvocation.spawnCmdLongRunning).toBe('function');
  });
});
