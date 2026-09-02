/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the pre-run stale-orphan reaper (issues #2909 and
 * #3491). Moved from scripts/tests/run_bun_tests.test.ts alongside the
 * implementation's extraction into scripts/lib/bun-test-reaper.ts. The
 * assertions were then updated for #3491 — the `node src/bar.spec.ts`
 * expectation inverted, because that shape is not spawned by this runner —
 * and the review remediation added spaces-in-path argv coverage, the
 * `--prompt-interactive` CLI shape, and the container-topology case. The
 * second remediation round moved the executable identity into a `ps -eo
 * pid=,comm=` capture, so every stub here answers both of the reaper's
 * queries: the executable query (format contains `comm=`) from a comm
 * table and the process query from the args table.
 */

import { describe, it, expect } from 'bun:test';
import { reapStaleBunTestProcesses } from '../lib/bun-test-reaper.js';

describe('reapStaleBunTestProcesses', () => {
  /**
   * Builds the injected spawnSync. The reaper asks two ps queries; this
   * stub dispatches on the requested format, answering the executable
   * query (`pid=,comm=`) from `commOutput` and the process query
   * (`pid=,ppid=,args=`) from `psOutput`.
   */
  const psStub =
    (
      psOutput: string,
      commOutput: string,
    ): ((cmd: readonly string[]) => { stdout: string | null }) =>
    (cmd) => ({
      stdout: cmd.some((arg) => arg.includes('comm=')) ? commOutput : psOutput,
    });

  /** Runs one reap over a ps snapshot, collecting kills and stderr lines. */
  const reapFromPs = (psOutput: string, commOutput: string, ownPid = 99999) => {
    const killed: number[] = [];
    const stderrLines: string[] = [];
    const result = reapStaleBunTestProcesses(
      psStub(psOutput, commOutput),
      (pid) => killed.push(pid),
      ownPid,
      (msg) => stderrLines.push(msg),
    );
    return { result, killed, stderr: stderrLines };
  };

  it('kills orphaned bun test processes with PPID=1 using SIGTERM', () => {
    const killedPids: number[] = [];
    const receivedSignals: string[] = [];
    const psOutput = [
      '  100  1  /usr/local/bun/bin/bun test --max-concurrency 1 --timeout 60000 src/foo.test.ts',
      '  101  1  bun test src/bar.test.ts',
      '  300  500  bun test src/baz.test.ts',
      `  ${process.pid}  ${process.ppid}  bun scripts/run_bun_tests.ts`,
    ].join('\n');
    const commOutput = [
      `  ${process.pid} /opt/homebrew/bin/bun`,
      '  100 /usr/local/bun/bin/bun',
      '  101 bun',
      '  300 bun',
    ].join('\n');

    const result = reapStaleBunTestProcesses(
      psStub(psOutput, commOutput),
      (pid, signal) => {
        killedPids.push(pid);
        receivedSignals.push(signal);
      },
      process.pid,
    );

    expect(result).toBe(2);
    expect(killedPids).toEqual([100, 101]);
    expect(killedPids).not.toContain(300);
    expect(receivedSignals).toEqual(['SIGTERM', 'SIGTERM']);
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

    const outcome = reapFromPs(psOutput, commOutput);
    expect(outcome.result).toBe(0);
    expect(outcome.killed).toEqual([]);
    expect(outcome.stderr).toEqual([]);
  });

  it('reaps orphans whose bun executable path contains spaces', () => {
    // `ps -eo args=` renders argv as a display string without quoting, so
    // an argv[0] that contains spaces arrives as several tokens. The
    // executable is confirmed by comm (which keeps its spaces intact), and
    // the args anchor is the first token with a bun basename, so the token
    // right after it is `test` for every row here.
    const psOutput = [
      '  101  1  /path with spaces/bun test src/foo.test.ts',
      '  102  1  /usr/local/bun/bin/bun test --max-concurrency 1 src/foo.test.ts',
      '  103  1  bun test src/bar.test.ts',
      '  104  1  /usr/local/share/npm-global/lib/node_modules/@vybestack/llxprt-code/node_modules/bun/bin/bun.exe test src/x.test.ts',
    ].join('\n');
    const commOutput = [
      '  101 /path with spaces/bun',
      '  102 /usr/local/bun/bin/bun',
      '  103 bun',
      '  104 /usr/local/share/npm-global/lib/node_modules/@vybestack/llxprt-code/node_modules/bun/bin/bun.exe',
    ].join('\n');

    const outcome = reapFromPs(psOutput, commOutput);
    expect(outcome.result).toBe(4);
    expect(outcome.killed).toEqual([101, 102, 103, 104]);
  });

  it('does not reap a PPID=1 node CLI whose prompt argv puts a non-bun prefix before the word test', () => {
    // Excluded on both sources: the comm is `node`, and no token of the
    // argv has a bun basename. This is the #3491 shape with the word
    // `test` riding in the session prompt rather than in argv[1].
    const outcome = reapFromPs(
      '  200  1  node /usr/local/share/npm-global/bin/llxprt --prompt-interactive please run the test suite',
      '  200 node',
    );
    expect(outcome.result).toBe(0);
    expect(outcome.killed).toEqual([]);
  });

  it('does not reap a PPID=1 CLI whose prompt mentions a path ending in /bun followed by the word test', () => {
    // Verified against the args-only predicate this PR first shipped: the
    // prompt text contains "/tmp/bun test suite", the token after the
    // `/tmp/bun` token is exactly `test`, and the joined prefix ends in a
    // bun basename — so the argument string alone marks this CLI as a
    // reapable orphan. Only the comm (`node`) rejects it, which is why the
    // executable identity must come from ps comm output, never from argv.
    const outcome = reapFromPs(
      '      2       1 node /usr/local/share/npm-global/bin/llxprt --prompt-interactive run /tmp/bun test suite',
      '      2 node',
    );
    expect(outcome.result).toBe(0);
    expect(outcome.killed).toEqual([]);
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
      '    500       1 /usr/local/bin/bun test src/foo.test.ts',
      '    501       1 /opt/other-checkout/node_modules/bun/bin/bun test --max-concurrency 1 src/bar.test.ts',
    ].join('\n');
    const commOutput = [
      '      1 podman-init',
      '      2 node',
      '      9 /usr/local/share/npm-global/lib/node_modules/@vybestack/llxprt-code/node_modules/bun/bin/bun.exe',
      '     73 make',
      '    500 /usr/local/bin/bun',
      '    501 /opt/other-checkout/node_modules/bun/bin/bun',
    ].join('\n');

    const outcome = reapFromPs(psOutput, commOutput);
    expect(outcome.result).toBe(2);
    expect(outcome.killed).toEqual([500, 501]);
    expect(outcome.killed).not.toContain(2);
    expect(outcome.killed).not.toContain(9);
    expect(outcome.killed).not.toContain(73);
  });

  it('does not kill a PPID=1 node process whose argv merely mentions test/spec', () => {
    // This runner only ever spawns `<bun> test [flags...] <file>` (see
    // buildSpawnArgs), so a `node ...` process is never one of its children;
    // matching it via substring heuristics is the #3491 defect that killed
    // the sandboxed CLI. Its comm is `node`, so it is excluded outright.
    const outcome = reapFromPs('  200  1  node src/bar.spec.ts', '  200 node');
    expect(outcome.result).toBe(0);
    expect(outcome.killed).toEqual([]);
  });

  it('does not kill the current process', () => {
    const ownPid = 12345;
    const outcome = reapFromPs(
      `  ${ownPid}  1  bun test src/foo.test.ts`,
      `  ${ownPid} bun`,
      ownPid,
    );
    expect(outcome.killed).not.toContain(ownPid);
  });

  it('does not kill non-test bun/node processes', () => {
    // PID 100 is the strongest case: its comm is genuinely `bun`, so only
    // the argv check can save it — the token after the bun-basename token
    // is `run`, not `test`, because this runner never spawns `bun run`.
    const psOutput = [
      '  100  1  bun run build',
      '  200  1  node server.js',
      '  300  1  bun test src/real.test.ts',
    ].join('\n');
    const commOutput = ['  100 bun', '  200 node', '  300 bun'].join('\n');

    const outcome = reapFromPs(psOutput, commOutput);
    expect(outcome.result).toBe(1);
    expect(outcome.killed).toEqual([300]);
  });

  it('does not reap a process that is missing from the comm table', () => {
    // The pid has no executable entry — it exited between the two ps
    // captures, or comm is unavailable for it. Without a kernel-reported
    // executable there is no evidence the process is bun, so it fails
    // closed even though its argv looks reapable.
    const outcome = reapFromPs('  400  1  bun test src/foo.test.ts', '');
    expect(outcome.result).toBe(0);
    expect(outcome.killed).toEqual([]);
  });

  it('returns 0 when ps fails', () => {
    const result = reapStaleBunTestProcesses(
      () => {
        throw new Error('ps not found');
      },
      () => {},
      99999,
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
      99999,
    );

    // The flag proves the failure came from the args query, not a
    // first-call failure the existing test already covers.
    expect(commQueryAnswered).toBe(true);
    expect(result).toBe(0);
  });

  it('logs a warning when processes are reaped', () => {
    const outcome = reapFromPs(
      '  100  1  bun test src/foo.test.ts',
      '  100 bun',
    );
    expect(outcome.stderr).toHaveLength(1);
    expect(outcome.stderr[0]).toContain('Reaped 1 stale orphaned');
  });
});
