/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IPty } from '@lydell/node-pty';
import headless from '@xterm/headless';

import type { PtyExecState } from './shellPtyState.js';
import type {
  ShellExecutionConfig,
  ShellExecutionResult,
} from './shellExecutionTypes.js';
import { createExitGuard } from './shellExitGuard.js';
import {
  createPtyResultPromise,
  ptyAbortAction,
  ptyInactivityAbortAction,
} from './shellPtyLifecycle.js';
import type { ActivePty } from './shellPtyHelpers.js';
import { loadNodePty, type PtyImplementation } from '../utils/getPty.js';
import { getShellConfiguration } from '../utils/shell-utils.js';
import {
  ensureNativeExitCodePropagated,
  ensurePromptvarsDisabled,
} from './shellOutputUtils.js';
import {
  BoundedCombinedCollector,
  createByteBudget,
} from '@vybestack/llxprt-code-tools/acquisition.js';

const { Terminal } = headless;

const isWindows = os.platform() === 'win32';

/**
 * The abort actions take an exhaustive state bag; only a handful of fields
 * are read on the paths under test. The collaborator under observation is the
 * ptyProcess double (an infrastructure boundary, not the unit under test): we
 * assert it is NOT signalled when the pid is non-killable.
 */
interface FakeStateInputs {
  readonly pid: number;
  readonly isWindows: boolean;
  readonly supportsProcessGroupKill: boolean;
}

function makeFakeState(inputs: FakeStateInputs): {
  state: PtyExecState;
  killSignals: string[];
} {
  const killSignals: string[] = [];
  const ptyProcess = {
    pid: inputs.pid,
    kill: (signal?: string | number): void => {
      killSignals.push(signal === undefined ? '<none>' : String(signal));
    },
    onData: () => ({ dispose: () => undefined }),
    onExit: () => ({ dispose: () => undefined }),
  } as unknown as IPty;

  const headlessTerminal = new Terminal({
    allowProposedApi: true,
    cols: 80,
    rows: 30,
    scrollback: 10,
  });

  const inactivityAbortController = new AbortController();

  const state = {
    ptyProcess,
    headlessTerminal,
    activePtyEntry: {
      ptyProcess,
      headlessTerminal,
      supportsProcessGroupKill: inputs.supportsProcessGroupKill,
    },
    isWindows: inputs.isWindows,
    abortSignal: new AbortController().signal,
    onOutputEvent: () => undefined,
    shellExecutionConfig: {} as ShellExecutionConfig,
    ptyInfo: {
      name: 'node-pty',
      module: {},
      supportsBackpressure: true,
    } as NonNullable<PtyImplementation>,
    supportsProcessGroupKill: inputs.supportsProcessGroupKill,
    inactivityAbortController,
    resetInactivityTimer: () => undefined,
    exitedGuard: createExitGuard(),
    output: null,
    rawCollector: new BoundedCombinedCollector({
      budget: createByteBudget(1024),
    }),
    error: null,
    isStreamingRawContent: true,
    sniffedBytes: 0,
    isWriting: false,
    hasStartedOutput: false,
    hasResolved: false,
    abortFinalizeTimeout: null,
    processingChain: Promise.resolve(),
    pendingQueueBytes: 0,
    pendingQueueItems: 0,
    supportsBackpressure: true,
    backpressurePaused: false,
    queueOverflowed: false,
  } as unknown as PtyExecState;

  return { state, killSignals };
}

/**
 * Clear any finalization timer the abort action schedules, so the deferred
 * resolveResult call (which builds a result from terminal state) never fires
 * and the test focuses purely on whether the pid was signalled.
 */
function clearFinalizeTimer(state: PtyExecState): void {
  if (state.abortFinalizeTimeout !== null) {
    clearTimeout(state.abortFinalizeTimeout);
    state.abortFinalizeTimeout = null;
  }
}

/**
 * Release the timer and the headless terminal each fake state holds. The
 * terminal owns internal buffers and listeners, so leaving it undisposed
 * across many cases leaks memory in the test process.
 */
function disposeFakeState(state: PtyExecState): void {
  clearFinalizeTimer(state);
  state.inactivityAbortController.abort();
  state.headlessTerminal.dispose();
}

describe('ptyAbortAction pid validation', () => {
  const createdStates: PtyExecState[] = [];

  afterEach(() => {
    for (const state of createdStates) {
      disposeFakeState(state);
    }
    createdStates.length = 0;
  });

  it('does not signal a NaN pid (=== 0 guard previously let NaN through)', async () => {
    const { state, killSignals } = makeFakeState({
      pid: Number.NaN,
      isWindows: false,
      supportsProcessGroupKill: true,
    });
    createdStates.push(state);

    const noopResolve = (_: ShellExecutionResult): void => undefined;
    await ptyAbortAction(state, noopResolve);
    clearFinalizeTimer(state);

    // Before the fix the `=== 0` check let NaN pass; process.kill(-NaN) threw
    // synchronously and the catch fallback invoked ptyProcess.kill. After the
    // fix the isKillablePid guard short-circuits before any signal attempt.
    expect(killSignals).toStrictEqual([]);
  });

  it('does not signal an Infinity pid', async () => {
    const { state, killSignals } = makeFakeState({
      pid: Number.POSITIVE_INFINITY,
      isWindows: false,
      supportsProcessGroupKill: true,
    });
    createdStates.push(state);

    await ptyAbortAction(state, () => undefined);
    clearFinalizeTimer(state);

    expect(killSignals).toStrictEqual([]);
  });

  it('does not signal a negative pid', async () => {
    const { state, killSignals } = makeFakeState({
      pid: -1,
      isWindows: false,
      supportsProcessGroupKill: true,
    });
    createdStates.push(state);

    await ptyAbortAction(state, () => undefined);
    clearFinalizeTimer(state);

    expect(killSignals).toStrictEqual([]);
  });

  it('does not signal pid 0 (would signal the caller process group)', async () => {
    const { state, killSignals } = makeFakeState({
      pid: 0,
      isWindows: false,
      supportsProcessGroupKill: true,
    });
    createdStates.push(state);

    await ptyAbortAction(state, () => undefined);
    clearFinalizeTimer(state);

    // pid 0 was already covered by the old `=== 0` check, so this is a
    // regression guard rather than a red test: it pins the single most
    // dangerous value, for which process.kill(-0) === process.kill(0)
    // signals every process in llxprt's own process group.
    expect(killSignals).toStrictEqual([]);
  });

  it('still signals a valid positive pid (guard is not over-broad)', async () => {
    // supportsProcessGroupKill is deliberately false: with it true this path
    // runs process.kill(-pid) against a REAL process group, and a made-up pid
    // would signal an unrelated group on a CI runner - the exact hazard this
    // issue is about. With it false the only kill is the fake pty's, so the
    // assertion still proves isKillablePid admits valid pids.
    const { state, killSignals } = makeFakeState({
      pid: 12345,
      isWindows: false,
      supportsProcessGroupKill: false,
    });
    createdStates.push(state);

    await ptyAbortAction(state, () => undefined);
    clearFinalizeTimer(state);

    expect(killSignals).toContain('SIGTERM');
  });
});

describe('ptyInactivityAbortAction pid validation', () => {
  const createdStates: PtyExecState[] = [];

  afterEach(() => {
    for (const state of createdStates) {
      disposeFakeState(state);
    }
    createdStates.length = 0;
  });

  it('does not signal a NaN pid (=== 0 guard previously let NaN through)', async () => {
    const { state, killSignals } = makeFakeState({
      pid: Number.NaN,
      isWindows: false,
      supportsProcessGroupKill: true,
    });
    createdStates.push(state);

    await ptyInactivityAbortAction(state, () => undefined);
    clearFinalizeTimer(state);

    // Before the fix NaN slipped past `=== 0`; process.kill(-NaN) threw, the
    // catch escalated to ptyProcess.kill('SIGKILL'). After the fix no kill is
    // attempted.
    expect(killSignals).toStrictEqual([]);
  });

  it('does not signal pid 0 (would signal the caller process group)', async () => {
    const { state, killSignals } = makeFakeState({
      pid: 0,
      isWindows: false,
      supportsProcessGroupKill: true,
    });
    createdStates.push(state);

    await ptyInactivityAbortAction(state, () => undefined);
    clearFinalizeTimer(state);

    expect(killSignals).toStrictEqual([]);
  });

  it('still signals a valid positive pid (guard is not over-broad)', async () => {
    // supportsProcessGroupKill false for the same reason as the abort path:
    // never aim process.kill(-pid) at a fabricated pid on a real machine.
    const { state, killSignals } = makeFakeState({
      pid: 12345,
      isWindows: false,
      supportsProcessGroupKill: false,
    });
    createdStates.push(state);

    await ptyInactivityAbortAction(state, () => undefined);
    clearFinalizeTimer(state);

    expect(killSignals.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Real forkpty abort behavior (POSIX, issue #3517)
// ---------------------------------------------------------------------------

/** Signal-0 existence check. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll until `markerPath` exists and contains non-whitespace. */
async function waitForMarker(
  markerPath: string,
  timeoutMs = 8000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const content = fs.readFileSync(markerPath, 'utf8').trim();
      if (content !== '') return content;
    } catch {
      // Not written yet.
    }
    if (Date.now() > deadline) {
      throw new Error(`Marker ${markerPath} not written within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Race a promise against a deadline, resolving `timeoutValue` on expiry. */
function withDeadline<T>(promise: Promise<T>, ms: number, timeoutValue: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      const timer = setTimeout(() => resolve(timeoutValue), ms);
      timer.unref();
    }),
  ]);
}

/**
 * Deadline-bounded probe for a usable forkpty backend. Under Bun POSIX
 * getPty() routes to bun-pty (no process groups, so the group-kill branch
 * under test is unreachable there), which is why the lydell backend is
 * loaded directly here. @lydell/node-pty can spawn children that exit
 * without delivering any output under the Bun test runner
 * (oven-sh/bun#25822), so a single-spawn check is not trustworthy: the
 * probe requires PROBE_ROUNDS consecutive spawns that each deliver output
 * within the deadline. The suite skips when any round fails.
 */
const PROBE_ROUNDS = 3;

async function probeUsableForkptyPty(): Promise<PtyImplementation> {
  const ptyInfo = await withDeadline(loadNodePty(), 5000, null);
  if (ptyInfo === null) {
    return null;
  }
  for (let round = 0; round < PROBE_ROUNDS; round++) {
    const ok = await withDeadline(
      new Promise<boolean>((resolve, reject) => {
        let dataDisposable: { dispose(): void } | undefined;
        let exitDisposable: { dispose(): void } | undefined;
        let settled = false;
        const settle = (ok: boolean, error?: unknown): void => {
          if (settled) {
            return;
          }
          settled = true;
          dataDisposable?.dispose();
          exitDisposable?.dispose();
          if (error !== undefined) {
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
          }
          resolve(ok);
        };
        try {
          const probe = ptyInfo.module.spawn(
            'bash',
            ['-c', 'echo PTY_PROBE_OK'],
            {
              cols: 80,
              rows: 30,
              env: { ...process.env, TERM: 'xterm-256color' },
            },
          );
          dataDisposable = probe.onData((chunk: string) => {
            if (chunk.includes('PTY_PROBE_OK')) {
              settle(true);
            }
          });
          exitDisposable = probe.onExit(() => settle(false));
        } catch (error) {
          settle(false, error);
        }
      }),
      5000,
      false,
    );
    if (!ok) {
      return null;
    }
  }
  return ptyInfo;
}

const forkptyBackend = isWindows ? null : await probeUsableForkptyPty();

describe.skipIf(isWindows || forkptyBackend === null)(
  'PTY abort group reap (POSIX, forkpty backend, issue #3517)',
  () => {
    it('kills a TERM-immune grandchild before the abort result resolves', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pty-abort-'));
      const marker = path.join(dir, 'grandchild.pid');
      const { executable, argsPrefix, shell } = getShellConfiguration();
      const guardedCommand = ensureNativeExitCodePropagated(
        ensurePromptvarsDisabled(
          // The subshell stays in the pty shell's process group; `trap '' TERM`
          // sets SIG_IGN, a disposition that survives `exec sleep 30`. The
          // foreground `sleep 30` keeps the pty leader alive until the abort.
          `( trap '' TERM; exec sleep 30 ) & echo $! > ${marker}; sleep 30`,
          shell,
        ),
        shell,
      );
      const backend = forkptyBackend as NonNullable<PtyImplementation>;
      const ptyProcess: IPty = backend.module.spawn(
        executable,
        [...argsPrefix, guardedCommand],
        {
          cwd: dir,
          name: 'xterm-256color',
          cols: 80,
          rows: 30,
          env: { ...process.env, TERM: 'xterm-256color' },
        },
      );
      const abortController = new AbortController();
      const activePtys = new Map<number, ActivePty>();
      try {
        const resultPromise = createPtyResultPromise(
          ptyProcess,
          false,
          80,
          30,
          () => undefined,
          abortController.signal,
          { scrollback: 10 },
          backend,
          activePtys,
          { value: null },
        );
        const grandchildPid = Number(await waitForMarker(marker, 8000));
        expect(grandchildPid).toBeGreaterThan(0);

        abortController.abort();
        const result = await resultPromise;

        expect(result.aborted).toBe(true);
        // Escalation succeeded within the reap window: no survivor flag.
        expect(result.survivingGroupMembersOnAbort).toBeUndefined();
        // THE assertion (AC1+AC2): the TERM-immune grandchild is dead by the
        // time the abort result exists. It was reparented when the pty leader
        // died, so a signal-0 probe proves real death.
        expect(isPidAlive(grandchildPid)).toBe(false);
      } finally {
        if (Number.isInteger(ptyProcess.pid) && ptyProcess.pid > 0) {
          try {
            process.kill(-ptyProcess.pid, 'SIGKILL');
          } catch {
            // Already gone.
          }
        }
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, 30000);
  },
);
