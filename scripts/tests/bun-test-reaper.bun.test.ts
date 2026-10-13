/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the pre-run stale-orphan reaper (issues #2909, #3491
 * and #3514). Moved from scripts/tests/run_bun_tests.test.ts alongside the
 * implementation's extraction into scripts/lib/bun-test-reaper.ts. The
 * assertions were then updated for #3491 — the `node src/bar.spec.ts`
 * expectation inverted, because that shape is not spawned by this runner —
 * and the review remediation added spaces-in-path argv coverage, the
 * `--prompt-interactive` CLI shape, and the container-topology case. The
 * second remediation round moved the executable identity into a `ps -eo
 * pid=,comm=` capture, so every fake here answers both of the reaper's
 * queries: the executable query (format contains `comm=`) from a comm
 * table and the process query from the args table.
 *
 * For #3514 the reaper only acts on orphans carrying this checkout's owner
 * token as their final argv element, and counts a process only once signal 0
 * reports it gone. The fake process table below models `ps`, `kill`, and
 * sleep as infrastructure: its `ps` output and liveness answers derive from
 * simulated process state and a simulated clock, so the tests assert which
 * processes end up alive and what the reaper reports, not which calls were
 * made.
 */

import { describe, it, expect } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  reapStaleBunTestProcesses,
  killTimedOutChild,
} from '../lib/bun-test-reaper.js';

const OWNER = 'llxprt-bun-runner-owner-0123456789abcdef';
const OTHER_OWNER = 'llxprt-bun-runner-owner-fedcba9876543210';
const OWN_PID = 99999;

interface SimulatedProcess {
  readonly pid: number;
  readonly ppid: number;
  /** Kernel-reported executable; `undefined` means missing from the comm table. */
  readonly comm: string | undefined;
  readonly args: string;
  /** Milliseconds after SIGTERM until the process exits; `undefined` ignores SIGTERM. */
  readonly termExitsAfterMs?: number;
  /** Whether SIGKILL ends the process. Defaults to true. */
  readonly diesOnKill?: boolean;
  /** errno code thrown when SIGTERM is sent. */
  readonly termErrorCode?: string;
  /** errno code thrown when SIGKILL is sent. */
  readonly killErrorCode?: string;
  /** errno code thrown by signal 0 while the process exists. */
  readonly probeErrorCode?: string;
}

/** How and when a modeled process ended, on the simulated clock. */
interface ProcessExit {
  readonly by: 'SIGTERM' | 'SIGKILL';
  readonly atMs: number;
}

function errnoError(code: string): Error {
  return Object.assign(new Error(`kill ${code}`), { code });
}

/** Simulated process table with a simulated clock advanced only by sleep. */
class ProcessTable {
  elapsedMs = 0;
  sleepCalls = 0;
  private readonly processes = new Map<number, SimulatedProcess>();
  private readonly exitAtMs = new Map<number, number>();
  private readonly exits = new Map<number, ProcessExit>();

  constructor(
    initial: readonly SimulatedProcess[],
    private readonly onSleep?: (table: ProcessTable) => void,
  ) {
    for (const process of initial) this.processes.set(process.pid, process);
  }

  alive(pid: number): boolean {
    this.settle();
    return this.processes.has(pid) && !this.exits.has(pid);
  }

  /** How the process ended, or `undefined` while it runs or if it never existed. */
  exitOf(pid: number): ProcessExit | undefined {
    this.settle();
    return this.exits.get(pid);
  }

  /** Replaces whatever runs under `pid`, as when a pid is reused. */
  replace(replacement: SimulatedProcess): void {
    this.processes.set(replacement.pid, replacement);
    this.exitAtMs.delete(replacement.pid);
    this.exits.delete(replacement.pid);
  }

  readonly spawnSync = (cmd: readonly string[]): { stdout: string | null } => {
    this.settle();
    const live = [...this.processes.values()].filter(
      (process) => !this.exits.has(process.pid),
    );
    if (cmd.some((arg) => arg.includes('comm='))) {
      return {
        stdout: live
          .filter((process) => process.comm !== undefined)
          .map((process) => `  ${process.pid} ${process.comm}`)
          .join('\n'),
      };
    }
    return {
      stdout: live
        .map((process) => `  ${process.pid}  ${process.ppid}  ${process.args}`)
        .join('\n'),
    };
  };

  readonly kill = (pid: number, signal: string | number): void => {
    this.settle();
    const process = this.processes.get(pid);
    if (process === undefined || this.exits.has(pid)) {
      throw errnoError('ESRCH');
    }
    if (signal === 0) {
      if (process.probeErrorCode !== undefined) {
        throw errnoError(process.probeErrorCode);
      }
      return;
    }
    if (signal === 'SIGTERM' && process.termErrorCode !== undefined) {
      throw errnoError(process.termErrorCode);
    }
    if (signal === 'SIGKILL' && process.killErrorCode !== undefined) {
      throw errnoError(process.killErrorCode);
    }
    if (
      signal === 'SIGTERM' &&
      process.termExitsAfterMs !== undefined &&
      !this.exitAtMs.has(pid)
    ) {
      this.exitAtMs.set(pid, this.elapsedMs + process.termExitsAfterMs);
    }
    if (signal === 'SIGKILL' && process.diesOnKill !== false) {
      this.exits.set(pid, { by: 'SIGKILL', atMs: this.elapsedMs });
    }
    this.settle();
  };

  readonly sleep = (ms: number): void => {
    this.elapsedMs += ms;
    this.sleepCalls++;
    this.settle();
    this.onSleep?.(this);
  };

  private settle(): void {
    for (const [pid, exitAt] of this.exitAtMs) {
      if (exitAt <= this.elapsedMs && !this.exits.has(pid)) {
        this.exits.set(pid, { by: 'SIGTERM', atMs: exitAt });
      }
    }
  }
}

/** An orphan exactly as this checkout's runner spawns it. */
function ownedOrphan(
  pid: number,
  overrides: Partial<SimulatedProcess> = {},
): SimulatedProcess {
  return {
    pid,
    ppid: 1,
    comm: '/usr/local/bin/bun',
    args: `/usr/local/bin/bun test --max-concurrency 1 --timeout 60000 /repo/src/f${pid}.test.ts ${OWNER}`,
    termExitsAfterMs: 0,
    ...overrides,
  };
}

/** Runs one reap of `table` and returns its count and stderr lines. */
function reap(
  table: ProcessTable,
  options: { readonly ownPid?: number; readonly owner?: string } = {},
): { readonly count: number; readonly stderr: readonly string[] } {
  const stderr: string[] = [];
  const count = reapStaleBunTestProcesses(
    table.spawnSync,
    table.kill,
    options.ownPid ?? OWN_PID,
    options.owner ?? OWNER,
    table.sleep,
    (line) => stderr.push(line),
  );
  return { count, stderr };
}

/**
 * Builds a process table from verbatim `ps -eo pid=,ppid=,args=` and
 * `ps -eo pid=,comm=` captures. Every process exits on SIGTERM.
 */
function tableFromCaptures(
  psOutput: string,
  commOutput: string,
): { readonly table: ProcessTable; readonly pids: readonly number[] } {
  const comms = new Map<number, string>();
  for (const line of commOutput.split('\n')) {
    const parts = line.trim().split(/\s+/);
    const pid = parseInt(parts[0] ?? '', 10);
    if (Number.isFinite(pid)) comms.set(pid, parts.slice(1).join(' '));
  }
  const processes: SimulatedProcess[] = [];
  for (const line of psOutput.split('\n')) {
    const parts = line.trim().split(/\s+/);
    const pid = parseInt(parts[0] ?? '', 10);
    const ppid = parseInt(parts[1] ?? '', 10);
    if (Number.isFinite(pid) && Number.isFinite(ppid)) {
      processes.push({
        pid,
        ppid,
        comm: comms.get(pid),
        args: parts.slice(2).join(' '),
        termExitsAfterMs: 0,
      });
    }
  }
  return {
    table: new ProcessTable(processes),
    pids: processes.map((p) => p.pid),
  };
}

describe('reapStaleBunTestProcesses', () => {
  /** Reaps a capture pair and reports which of its processes are gone. */
  const reapFromCaptures = (
    psOutput: string,
    commOutput: string,
    ownPid = OWN_PID,
  ): {
    readonly count: number;
    readonly stderr: readonly string[];
    readonly reaped: readonly number[];
  } => {
    const { table, pids } = tableFromCaptures(psOutput, commOutput);
    const outcome = reap(table, { ownPid });
    return {
      ...outcome,
      reaped: pids.filter((pid) => !table.alive(pid)),
    };
  };

  it("reaps this checkout's orphaned bun test processes with PPID=1 and leaves non-orphans alone", () => {
    const psOutput = [
      `  100  1  /usr/local/bun/bin/bun test --max-concurrency 1 --timeout 60000 src/foo.test.ts ${OWNER}`,
      `  101  1  bun test src/bar.test.ts ${OWNER}`,
      `  300  500  bun test src/baz.test.ts ${OWNER}`,
      `  ${process.pid}  ${process.ppid}  bun scripts/run_bun_tests.ts`,
    ].join('\n');
    const commOutput = [
      `  ${process.pid} /opt/homebrew/bin/bun`,
      '  100 /usr/local/bun/bin/bun',
      '  101 bun',
      '  300 bun',
    ].join('\n');

    const outcome = reapFromCaptures(psOutput, commOutput, process.pid);

    expect(outcome.count).toBe(2);
    expect(outcome.reaped).toEqual([100, 101]);
  });

  it('reaps nothing from the sandbox container ps capture (#3491)', () => {
    // `ps -eo pid=,ppid=,args=` capture from inside
    // ghcr.io/vybestack/llxprt-code/sandbox:0.11.0-nightly.260831.393a0080f,
    // taken with `--prompt` to obtain the argv and PPID shape and rendered
    // here with `--prompt-interactive` — the invocation the reported silent
    // status-0 exit requires (interactive, so the status-0 SIGTERM handler
    // is installed, and prompt-bearing argv, so the old predicate matched).
    // PID 2 is the sandboxed CLI itself: PPID 1 under `podman --init`, argv
    // starting with `node`, and the word `test` in the session prompt.
    // Reaping it killed the CLI mid-task with a silent status-0 exit. (Under
    // a non-interactive `--prompt` run the same reap still kills the
    // session, just with status 143 instead of 0.) The comm table carries
    // the Linux base command names: `podman-init`, `node` for the shim, and
    // `bun.exe` for the bundled runtime — only the last is a bun basename,
    // and its argv puts `llxprt.js`, not `test`, right after the binary.
    const psOutput = [
      '      1       0 /run/podman-init -- bash --noprofile --norc -c exec llxprt --prompt-interactive "please run the test suite"',
      '      2       1 node /usr/local/share/npm-global/bin/llxprt --provider openai --key xx --prompt-interactive please run the test suite',
      '      9       2 /usr/local/share/npm-global/lib/node_modules/@vybestack/llxprt-code/node_modules/bun/bin/bun.exe /usr/local/share/npm-global/lib/node_modules/@vybestack/llxprt-code/bundle/llxprt.js -- --prompt-interactive please run the test suite',
    ].join('\n');
    const commOutput = [
      '      1 podman-init',
      '      2 node',
      '      9 bun.exe',
    ].join('\n');

    const outcome = reapFromCaptures(psOutput, commOutput);
    expect(outcome.count).toBe(0);
    expect(outcome.reaped).toEqual([]);
    expect(outcome.stderr).toEqual([]);
  });

  it('reaps orphans whose bun executable path contains spaces', () => {
    // `ps -eo args=` renders argv as a display string without quoting, so
    // an argv[0] that contains spaces arrives as several tokens. The
    // executable is confirmed by comm (which keeps its spaces intact), and
    // the args anchor is the first token with a bun basename, so the token
    // right after it is `test` for every row here.
    const psOutput = [
      `  101  1  /path with spaces/bun test src/foo.test.ts ${OWNER}`,
      `  102  1  /usr/local/bun/bin/bun test --max-concurrency 1 src/foo.test.ts ${OWNER}`,
      `  103  1  bun test src/bar.test.ts ${OWNER}`,
      `  104  1  /usr/local/share/npm-global/lib/node_modules/@vybestack/llxprt-code/node_modules/bun/bin/bun.exe test src/x.test.ts ${OWNER}`,
    ].join('\n');
    const commOutput = [
      '  101 /path with spaces/bun',
      '  102 /usr/local/bun/bin/bun',
      '  103 bun',
      '  104 /usr/local/share/npm-global/lib/node_modules/@vybestack/llxprt-code/node_modules/bun/bin/bun.exe',
    ].join('\n');

    const outcome = reapFromCaptures(psOutput, commOutput);
    expect(outcome.count).toBe(4);
    expect(outcome.reaped).toEqual([101, 102, 103, 104]);
  });

  it('does not reap a PPID=1 node CLI whose prompt argv puts a non-bun prefix before the word test', () => {
    // Excluded on both sources: the comm is `node`, and no token of the
    // argv has a bun basename. This is the #3491 shape with the word
    // `test` riding in the session prompt rather than in argv[1].
    const outcome = reapFromCaptures(
      `  200  1  node /usr/local/share/npm-global/bin/llxprt --prompt-interactive please run the test suite ${OWNER}`,
      '  200 node',
    );
    expect(outcome.count).toBe(0);
    expect(outcome.reaped).toEqual([]);
  });

  it('does not reap a PPID=1 CLI whose prompt mentions a path ending in /bun followed by the word test', () => {
    // Verified against the args-only predicate this PR first shipped: the
    // prompt text contains "/tmp/bun test suite", the token after the
    // `/tmp/bun` token is exactly `test`, and the joined prefix ends in a
    // bun basename — so the argument string alone marks this CLI as a
    // reapable orphan. Only the comm (`node`) rejects it, which is why the
    // executable identity must come from ps comm output, never from argv.
    const outcome = reapFromCaptures(
      `      2       1 node /usr/local/share/npm-global/bin/llxprt --prompt-interactive run /tmp/bun test suite ${OWNER}`,
      '      2 node',
    );
    expect(outcome.count).toBe(0);
    expect(outcome.reaped).toEqual([]);
  });

  it('reaps orphaned bun test children but not the CLI shim or its managed job in the sandbox topology (#3491)', () => {
    // Fabricated `ps` tables of the container mid-run: the CLI shim at
    // PPID 1 under `podman --init` (interactive, prompt-bearing argv), a
    // managed background job it launched, and genuine orphaned `bun test`
    // children at PPID 1 from a previously killed runner. The reaper runs
    // while the managed job is live and must not touch the session it is
    // running under. Comm rows use macOS full-path style for the bun
    // rows to exercise that shape alongside the Linux base names.
    const psOutput = [
      '      1       0 /run/podman-init -- bash --noprofile --norc -c exec llxprt --prompt-interactive "please run the test suite"',
      '      2       1 node /usr/local/share/npm-global/bin/llxprt --provider openai --key xx --prompt-interactive please run the test suite',
      '      9       2 /usr/local/share/npm-global/lib/node_modules/@vybestack/llxprt-code/node_modules/bun/bin/bun.exe /usr/local/share/npm-global/lib/node_modules/@vybestack/llxprt-code/bundle/llxprt.js -- --prompt-interactive please run the test suite',
      '     73       2 make build',
      `    500       1 /usr/local/bin/bun test src/foo.test.ts ${OWNER}`,
      `    501       1 /opt/other-checkout/node_modules/bun/bin/bun test --max-concurrency 1 src/bar.test.ts ${OWNER}`,
    ].join('\n');
    const commOutput = [
      '      1 podman-init',
      '      2 node',
      '      9 /usr/local/share/npm-global/lib/node_modules/@vybestack/llxprt-code/node_modules/bun/bin/bun.exe',
      '     73 make',
      '    500 /usr/local/bin/bun',
      '    501 /opt/other-checkout/node_modules/bun/bin/bun',
    ].join('\n');

    const outcome = reapFromCaptures(psOutput, commOutput);
    expect(outcome.count).toBe(2);
    expect(outcome.reaped).toEqual([500, 501]);
  });

  it('does not kill a PPID=1 node process whose argv merely mentions test/spec', () => {
    // This runner only ever spawns `<bun> test [flags...] <file>` (see
    // buildSpawnArgs), so a `node ...` process is never one of its children;
    // matching it via substring heuristics is the #3491 defect that killed
    // the sandboxed CLI. Its comm is `node`, so it is excluded outright.
    const outcome = reapFromCaptures(
      `  200  1  node src/bar.spec.ts ${OWNER}`,
      '  200 node',
    );
    expect(outcome.count).toBe(0);
    expect(outcome.reaped).toEqual([]);
  });

  it('does not kill the current process', () => {
    const table = new ProcessTable([ownedOrphan(12345)]);
    const outcome = reap(table, { ownPid: 12345 });
    expect(outcome.count).toBe(0);
    expect(table.alive(12345)).toBe(true);
  });

  it('does not kill non-test bun/node processes', () => {
    // PID 100 is the strongest case: its comm is genuinely `bun`, so only
    // the argv check can save it — the token after the bun-basename token
    // is `run`, not `test`, because this runner never spawns `bun run`.
    const psOutput = [
      `  100  1  bun run build ${OWNER}`,
      `  200  1  node server.js ${OWNER}`,
      `  300  1  bun test src/real.test.ts ${OWNER}`,
    ].join('\n');
    const commOutput = ['  100 bun', '  200 node', '  300 bun'].join('\n');

    const outcome = reapFromCaptures(psOutput, commOutput);
    expect(outcome.count).toBe(1);
    expect(outcome.reaped).toEqual([300]);
  });

  it('does not reap a process that is missing from the comm table', () => {
    // The pid has no executable entry — it exited between the two ps
    // captures, or comm is unavailable for it. Without a kernel-reported
    // executable there is no evidence the process is bun, so it fails
    // closed even though its argv looks reapable.
    const outcome = reapFromCaptures(
      `  400  1  bun test src/foo.test.ts ${OWNER}`,
      '',
    );
    expect(outcome.count).toBe(0);
    expect(outcome.reaped).toEqual([]);
  });

  it('returns 0 when ps fails', () => {
    const result = reapStaleBunTestProcesses(
      () => {
        throw new Error('ps not found');
      },
      () => {},
      OWN_PID,
      OWNER,
      () => {},
    );

    expect(result).toBe(0);
  });

  it('returns 0 when the second ps call fails after the first succeeded', () => {
    let commQueryAnswered = false;
    const result = reapStaleBunTestProcesses(
      (cmd) => {
        if (cmd.some((arg) => arg.includes('comm='))) {
          commQueryAnswered = true;
          return { stdout: '  100 bun' };
        }
        throw new Error('ps not found');
      },
      () => {},
      OWN_PID,
      OWNER,
      () => {},
    );

    // The flag proves the failure came from the args query, not a
    // first-call failure the existing test already covers.
    expect(commQueryAnswered).toBe(true);
    expect(result).toBe(0);
  });

  it('logs the confirmed count when processes are reaped', () => {
    const table = new ProcessTable([ownedOrphan(100)]);
    const outcome = reap(table);
    expect(outcome.stderr).toEqual([
      '[run_bun_tests] Reaped 1 stale orphaned test process(es) (PPID=1) before run.',
    ]);
  });
});

describe('reaper checkout ownership (#3514)', () => {
  it('does not reap a same-checkout manual bun test that carries no owner token', () => {
    const manual = ownedOrphan(100, {
      args: '/usr/local/bin/bun test src/foo.test.ts',
    });
    const table = new ProcessTable([manual]);

    const outcome = reap(table);

    expect(outcome.count).toBe(0);
    expect(outcome.stderr).toEqual([]);
    expect(table.alive(100)).toBe(true);
  });

  it("does not reap another checkout's orphan that has the same flags but a different owner token", () => {
    const foreign = ownedOrphan(100, {
      args: `/usr/local/bin/bun test --max-concurrency 1 --timeout 60000 /repo/src/f100.test.ts ${OTHER_OWNER}`,
    });
    const table = new ProcessTable([foreign, ownedOrphan(101)]);

    const outcome = reap(table);

    expect(outcome.count).toBe(1);
    expect(table.alive(100)).toBe(true);
    expect(table.alive(101)).toBe(false);
  });

  it('requires the owner token to be the final argv token', () => {
    const trailing = ownedOrphan(100, {
      args: `/usr/local/bin/bun test /repo/src/f100.test.ts ${OWNER} extra`,
    });
    const table = new ProcessTable([trailing]);

    expect(reap(table).count).toBe(0);
    expect(table.alive(100)).toBe(true);
  });

  it('requires the owner token to match exactly rather than by prefix', () => {
    const longer = ownedOrphan(100, {
      args: `/usr/local/bin/bun test /repo/src/f100.test.ts ${OWNER}0`,
    });
    const table = new ProcessTable([longer]);

    expect(reap(table).count).toBe(0);
    expect(table.alive(100)).toBe(true);
  });

  it('does not reap a marked process that is not an orphan', () => {
    const child = ownedOrphan(100, { ppid: 500 });
    const table = new ProcessTable([child]);

    expect(reap(table).count).toBe(0);
    expect(table.alive(100)).toBe(true);
  });

  it('does not reap a marked process whose executable is not bun', () => {
    const cli = ownedOrphan(100, {
      comm: 'node',
      args: `node /usr/local/bin/llxprt --prompt run the test suite ${OWNER}`,
    });
    const table = new ProcessTable([cli]);

    expect(reap(table).count).toBe(0);
    expect(table.alive(100)).toBe(true);
  });
});

describe('reaper confirmation of exits (#3514)', () => {
  it('counts and logs an owned orphan whose delayed exit falls within the TERM grace, waiting for it rather than escalating', () => {
    const liveness: Array<{ readonly atMs: number; readonly alive: boolean }> =
      [];
    const table = new ProcessTable(
      [ownedOrphan(100, { termExitsAfterMs: 200 })],
      (current) => {
        liveness.push({
          atMs: current.elapsedMs,
          alive: current.alive(100),
        });
      },
    );

    const outcome = reap(table);

    expect(outcome.count).toBe(1);
    expect(outcome.stderr).toEqual([
      '[run_bun_tests] Reaped 1 stale orphaned test process(es) (PPID=1) before run.',
    ]);
    expect(table.alive(100)).toBe(false);
    expect(table.exitOf(100)).toEqual({ by: 'SIGTERM', atMs: 200 });
    expect(liveness).toEqual([
      { atMs: 50, alive: true },
      { atMs: 100, alive: true },
      { atMs: 150, alive: true },
      { atMs: 200, alive: false },
    ]);
  });

  it('escalates to SIGKILL only after the TERM grace and counts the orphan once it is gone', () => {
    const table = new ProcessTable([
      ownedOrphan(100, { termExitsAfterMs: undefined }),
    ]);

    const outcome = reap(table);

    expect(outcome.count).toBe(1);
    expect(outcome.stderr).toHaveLength(1);
    expect(table.alive(100)).toBe(false);
    const exit = table.exitOf(100);
    expect(exit?.by).toBe('SIGKILL');
    expect(exit?.atMs).toBeGreaterThanOrEqual(2000);
  });

  it('does not count or log an orphan that survives both SIGTERM and SIGKILL, and stops waiting within the bound', () => {
    const table = new ProcessTable([
      ownedOrphan(100, { termExitsAfterMs: undefined, diesOnKill: false }),
    ]);

    const outcome = reap(table);

    expect(outcome.count).toBe(0);
    expect(outcome.stderr).toEqual([]);
    expect(table.alive(100)).toBe(true);
    expect(table.elapsedMs).toBeLessThanOrEqual(3000);
  });

  it.each(['EPERM', 'EACCES'])(
    'does not count an orphan whose SIGTERM fails with %s, and does not wait for it',
    (code) => {
      const table = new ProcessTable([
        ownedOrphan(100, { termErrorCode: code }),
      ]);

      const outcome = reap(table);

      expect(outcome.count).toBe(0);
      expect(outcome.stderr).toEqual([]);
      expect(table.alive(100)).toBe(true);
      expect(table.sleepCalls).toBe(0);
    },
  );

  it('does not count an orphan that ignores SIGTERM and whose SIGKILL fails with EPERM', () => {
    const table = new ProcessTable([
      ownedOrphan(100, {
        termExitsAfterMs: undefined,
        killErrorCode: 'EPERM',
      }),
      ownedOrphan(101, { termExitsAfterMs: undefined }),
    ]);

    const outcome = reap(table);

    expect(outcome.count).toBe(1);
    expect(table.alive(100)).toBe(true);
    expect(table.alive(101)).toBe(false);
  });

  it.each(['EPERM', 'EIO'])(
    'never counts an orphan that signal 0 cannot confirm gone (%s)',
    (code) => {
      const table = new ProcessTable([
        ownedOrphan(100, {
          termExitsAfterMs: undefined,
          diesOnKill: false,
          probeErrorCode: code,
        }),
      ]);

      const outcome = reap(table);

      expect(outcome.count).toBe(0);
      expect(outcome.stderr).toEqual([]);
      expect(table.elapsedMs).toBeLessThanOrEqual(3000);
    },
  );

  it('counts only the orphans confirmed gone when outcomes are mixed', () => {
    const table = new ProcessTable([
      ownedOrphan(100, { termExitsAfterMs: 0 }),
      ownedOrphan(101, { termExitsAfterMs: undefined }),
      ownedOrphan(102, { termExitsAfterMs: undefined, diesOnKill: false }),
      ownedOrphan(103, { termErrorCode: 'EPERM' }),
      ownedOrphan(104, { termExitsAfterMs: 500 }),
    ]);

    const outcome = reap(table);

    expect(outcome.count).toBe(3);
    expect(outcome.stderr).toEqual([
      '[run_bun_tests] Reaped 3 stale orphaned test process(es) (PPID=1) before run.',
    ]);
    expect([100, 101, 102, 103, 104].map((pid) => table.alive(pid))).toEqual([
      false,
      false,
      true,
      true,
      false,
    ]);
    expect(table.elapsedMs).toBeLessThanOrEqual(3000);
  });

  it('does not SIGKILL or count a survivor whose ownership changed during the TERM grace', () => {
    const table = new ProcessTable(
      [ownedOrphan(100, { termExitsAfterMs: undefined })],
      (current) => {
        if (current.elapsedMs >= 1000) {
          current.replace({
            pid: 100,
            ppid: 1,
            comm: '/usr/local/bin/bun',
            args: `/usr/local/bin/bun test /other/src/f.test.ts ${OTHER_OWNER}`,
          });
        }
      },
    );

    const outcome = reap(table);

    expect(outcome.count).toBe(0);
    expect(outcome.stderr).toEqual([]);
    expect(table.exitOf(100)).toBeUndefined();
    expect(table.alive(100)).toBe(true);
  });

  it('SIGKILLs a survivor that is still owned after the TERM grace, leaving a pid-reusing process alone', () => {
    const table = new ProcessTable(
      [
        ownedOrphan(100, { termExitsAfterMs: undefined }),
        ownedOrphan(101, { termExitsAfterMs: undefined }),
      ],
      (current) => {
        if (current.elapsedMs >= 1000) {
          current.replace({
            pid: 101,
            ppid: 1,
            comm: 'node',
            args: 'node server.js',
          });
        }
      },
    );

    const outcome = reap(table);

    expect(outcome.count).toBe(1);
    expect(table.alive(100)).toBe(false);
    expect(table.alive(101)).toBe(true);
    expect(table.exitOf(101)).toBeUndefined();
  });

  it('does not sleep when there is nothing to reap', () => {
    const table = new ProcessTable([
      ownedOrphan(100, { args: '/usr/local/bin/bun test src/manual.test.ts' }),
    ]);

    reap(table);

    expect(table.sleepCalls).toBe(0);
  });

  it('does not sleep when every orphan is already gone at the first confirmation', () => {
    const table = new ProcessTable([
      ownedOrphan(100, { termExitsAfterMs: 0 }),
      ownedOrphan(101, { termExitsAfterMs: 0 }),
    ]);

    const outcome = reap(table);

    expect(outcome.count).toBe(2);
    expect(table.sleepCalls).toBe(0);
  });
});

describe.skipIf(process.platform === 'win32')(
  'reaping real orphaned bun test processes (#3514)',
  () => {
    const HANG_TEST = `import { it } from 'bun:test';
it('hang', async () => { await new Promise((r) => setTimeout(r, 60000)); }, 90000);
`;
    const SPAWN_ORPHANS = `
import { spawn } from 'node:child_process';
const { bun, cwd, file, tokens } = JSON.parse(process.env.ORPHAN_SPEC);
const pids = tokens.map((token) =>
  spawn(bun, ['test', file, token], { cwd, stdio: 'ignore', detached: true }),
);
for (const child of pids) child.unref();
console.log(JSON.stringify(pids.map((child) => child.pid)));
setInterval(() => {}, 1000);
`;

    /** Signal 0 raising ESRCH is the only evidence a process is gone. */
    const isAlive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ESRCH'
        ) {
          return false;
        }
        throw error;
      }
    };

    const isPidPair = (value: unknown): value is readonly [number, number] =>
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((pid) => Number.isInteger(pid) && pid > 0);

    const parentPidOf = (pid: number): number => {
      const result = Bun.spawnSync({
        cmd: ['ps', '-o', 'ppid=', '-p', String(pid)],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      return parseInt(new TextDecoder().decode(result.stdout).trim(), 10);
    };

    const waitFor = async (condition: () => boolean): Promise<boolean> => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (condition()) return true;
        await Bun.sleep(50);
      }
      return condition();
    };

    it("reaps the owned orphan of a killed parent and leaves another checkout's orphan running", async () => {
      const dir = mkdtempSync(join(tmpdir(), 'bun-reaper-real-'));
      const file = join(dir, 'hang.test.ts');
      writeFileSync(file, HANG_TEST);
      const owner = `llxprt-bun-runner-owner-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
      const foreign = `llxprt-bun-runner-owner-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
      const parent = spawn(process.execPath, ['-e', SPAWN_ORPHANS], {
        env: {
          ...process.env,
          ORPHAN_SPEC: JSON.stringify({
            bun: process.execPath,
            cwd: dir,
            file,
            tokens: [owner, foreign],
          }),
        },
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      let pids: readonly number[] = [];
      try {
        const spawned = await new Promise<readonly [number, number]>(
          (resolve, reject) => {
            let output = '';
            parent.stdout.on('data', (chunk: Buffer) => {
              output += chunk.toString();
              if (!output.includes('\n')) return;
              const parsed: unknown = JSON.parse(output.trim());
              if (isPidPair(parsed)) {
                resolve(parsed);
              } else {
                reject(new Error(`unexpected child pids: ${output.trim()}`));
              }
            });
            parent.once('error', reject);
            parent.once('close', () =>
              reject(new Error('parent exited early')),
            );
          },
        );
        pids = spawned;
        const [ownedPid, foreignPid] = spawned;

        // Both children started and are still children of the spawning parent.
        expect(parentPidOf(ownedPid)).toBe(parent.pid);
        expect(parentPidOf(foreignPid)).toBe(parent.pid);

        parent.kill('SIGKILL');
        const orphaned = await waitFor(
          () =>
            parentPidOf(ownedPid) !== parent.pid &&
            parentPidOf(foreignPid) !== parent.pid,
        );
        expect(orphaned).toBe(true);
        expect([isAlive(ownedPid), isAlive(foreignPid)]).toEqual([true, true]);

        const reparentedTo = parentPidOf(ownedPid);
        if (reparentedTo !== 1) {
          // A subreaper (for example a container init or a systemd user
          // manager) adopted the children instead of PID 1, so the PPID=1
          // scenario cannot arise here. This is the only permitted skip.
          console.warn(
            `Skipping reap assertions: orphans were adopted by subreaper pid ${reparentedTo}, not PID 1`,
          );
          expect(reparentedTo).toBeGreaterThan(1);
          expect(reparentedTo).not.toBe(parent.pid);
          return;
        }
        expect(parentPidOf(foreignPid)).toBe(1);

        const count = reapStaleBunTestProcesses(
          (cmd) => {
            // A narrow COLUMNS makes ps truncate piped output to that width
            // unless the reaper asks for unlimited width; the owner token is
            // the final args token, so truncation would hide this checkout's
            // own orphan.
            const result = Bun.spawnSync({
              cmd: [...cmd],
              env: { ...process.env, COLUMNS: '40' },
              stdout: 'pipe',
              stderr: 'pipe',
            });
            return { stdout: new TextDecoder().decode(result.stdout) };
          },
          (pid, signal) => process.kill(pid, signal),
          process.pid,
          owner,
          (ms) => Bun.sleepSync(ms),
        );

        expect(count).toBe(1);
        expect({
          owned: isAlive(ownedPid),
          foreign: isAlive(foreignPid),
        }).toEqual({ owned: false, foreign: true });
      } finally {
        for (const pid of pids) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Already gone.
          }
        }
        parent.kill('SIGKILL');
        rmSync(dir, { recursive: true, force: true });
      }
    });
  },
);

describe('finite timeout kills', () => {
  it('finite CLI kill preserves direct-child fallback when no pid exists', () => {
    const signals: string[] = [];
    killTimedOutChild({
      runner: 'cli',
      child: {
        kill: (signal) => {
          signals.push(signal);
          return true;
        },
      },
    });
    expect(signals).toEqual(['SIGKILL']);
  });
});
