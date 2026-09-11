/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
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
import { GROUP_REAP_WINDOW_MS } from './shellProcessKill.js';
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
// Abort vs exit ordering (fake pty, issue #3517)
// ---------------------------------------------------------------------------

describe('PTY abort signal fidelity (fake pty, issue #3517)', () => {
  it.skipIf(isWindows)(
    'non-group-target pid gets direct-only escalation, never a group signal (fake pty, issue #3517)',
    async () => {
      const processSignals: Array<
        [number, NodeJS.Signals | number | undefined]
      > = [];
      const killSignals: Array<string | undefined> = [];
      const killSpy = vi
        .spyOn(process, 'kill')
        .mockImplementation((pid: number, signal?: NodeJS.Signals | number) => {
          processSignals.push([pid, signal]);
          return true;
        });
      const { state } = makeFakeState({
        pid: 1,
        isWindows: false,
        supportsProcessGroupKill: true,
      });
      let exitListener:
        | ((event: { exitCode: number; signal?: number }) => void)
        | undefined;
      const ptyProcess: IPty = {
        ...state.ptyProcess,
        kill: (signal) => {
          killSignals.push(signal);
        },
        onData: () => ({ dispose: () => undefined }),
        onExit: (listener) => {
          exitListener = listener;
          return { dispose: () => undefined };
        },
      };
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
          state.ptyInfo,
          activePtys,
          { value: null },
        );
        if (exitListener === undefined) {
          throw new Error('PTY exit handler was not registered');
        }
        abortController.abort();
        const result = await resultPromise;

        expect(result.aborted).toBe(true);
        expect(result.survivingGroupMembersOnAbort).toBeUndefined();
        expect(killSignals).toContain('SIGTERM');
        expect(killSignals).toContain('SIGKILL');
        expect(processSignals.every(([pid]) => pid !== -1)).toBe(true);
      } finally {
        // Keep the signal stub installed until even an early resolution's
        // escalation grace has passed, so the red test is safe as well.
        await new Promise((resolve) => setTimeout(resolve, 250));
        disposeFakeState(state);
        killSpy.mockRestore();
      }
    },
  );

  for (const scenario of [
    {
      name: 'inactivity kill without caller abort waits for group reaping and reports survivors (fake pty)',
      groupSurvives: true,
    },
    {
      name: 'inactivity kill resolves promptly with no survivor flag when the group dies (fake pty)',
      groupSurvives: false,
    },
  ]) {
    it.skipIf(isWindows)(
      scenario.name,
      async () => {
        const groupSignals: Array<string | number | undefined> = [];
        const groupProbes: number[] = [];
        let inactivityStartedAt = 0;
        let onData: ((data: string) => void) | undefined;
        let onExit:
          | ((event: { exitCode: number; signal?: number }) => void)
          | undefined;
        // Fabricated pids must never reach real groups, including signal-0
        // probes. Deliver exit after the kill chain registers (Issue #3517).
        const killSpy = vi
          .spyOn(process, 'kill')
          .mockImplementation((pid, signal) => {
            if (signal === 0) {
              groupProbes.push(pid);
              if (!scenario.groupSurvives) {
                throw Object.assign(new Error('Group is gone'), {
                  code: 'ESRCH',
                });
              }
            } else {
              groupSignals.push(signal);
              if (signal === 'SIGTERM') {
                inactivityStartedAt = Date.now();
                queueMicrotask(() => onExit?.({ exitCode: 143, signal: 15 }));
              }
            }
            return true;
          });
        const { state } = makeFakeState({
          pid: 999995,
          isWindows: false,
          supportsProcessGroupKill: true,
        });
        const activePtys = new Map<number, ActivePty>();
        const ptyProcess: IPty = {
          ...state.ptyProcess,
          onData: (listener) => {
            onData = listener;
            return { dispose: () => undefined };
          },
          onExit: (listener) => {
            onExit = listener;
            return { dispose: () => undefined };
          },
        };
        try {
          const resultPromise = createPtyResultPromise(
            ptyProcess,
            false,
            80,
            30,
            () => undefined,
            new AbortController().signal,
            { scrollback: 10, inactivityTimeoutMs: 10 },
            state.ptyInfo,
            activePtys,
            { value: null },
          );
          if (onData === undefined || onExit === undefined) {
            throw new Error('PTY handlers were not registered');
          }
          onData('output before inactivity');
          const result = await resultPromise;
          const elapsed = Date.now() - inactivityStartedAt;

          expect(inactivityStartedAt).toBeGreaterThan(0);
          expect(groupSignals).toContain('SIGTERM');
          expect(groupProbes.length).toBeGreaterThan(0);
          expect(result.aborted).toBe(false);
          expect(result.exitCode).toBe(143);
          expect(result.signal).toBe(15);
          if (scenario.groupSurvives) {
            expect(elapsed).toBeGreaterThanOrEqual(GROUP_REAP_WINDOW_MS);
            expect(result.survivingGroupMembersOnAbort).toBe(true);
            expect(groupSignals).toContain('SIGKILL');
          } else {
            expect(elapsed).toBeLessThan(GROUP_REAP_WINDOW_MS);
            expect(result.survivingGroupMembersOnAbort).toBeUndefined();
          }
        } finally {
          // Keep the signal stub installed until even an early resolution's
          // escalation grace has passed, so the red test is safe as well.
          await new Promise((resolve) => setTimeout(resolve, 250));
          disposeFakeState(state);
          killSpy.mockRestore();
        }
      },
      10000,
    );
  }

  it.skipIf(isWindows)(
    'inactivity kill with a non-group-target pid still kills the PTY directly (fake pty, issue #3517)',
    async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      const inputs = { pid: 1, isWindows, supportsProcessGroupKill: true };
      const { state, killSignals } = makeFakeState(inputs);
      try {
        const result = await createPtyResultPromise(
          state.ptyProcess,
          false,
          80,
          30,
          () => undefined,
          new AbortController().signal,
          { scrollback: 10, inactivityTimeoutMs: 10 },
          state.ptyInfo,
          new Map(),
          { value: null },
        );

        expect(result.aborted).toBe(false);
        expect(result.survivingGroupMembersOnAbort).toBeUndefined();
        expect(killSignals.slice(0, 2)).toStrictEqual(['SIGTERM', 'SIGKILL']);
        expect(killSpy.mock.calls.some(([pid]) => pid === -1)).toBe(false);
      } finally {
        disposeFakeState(state);
        killSpy.mockRestore();
      }
    },
  );

  it.skipIf(isWindows)(
    'never broadcasts to pid -1 on abort or inactivity',
    async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      const { state } = makeFakeState({
        pid: 1,
        isWindows: false,
        supportsProcessGroupKill: true,
      });
      try {
        await ptyAbortAction(state, () => undefined);
        await ptyInactivityAbortAction(state, () => undefined);
        expect(killSpy.mock.calls.some(([pid]) => pid === -1)).toBe(false);
      } finally {
        disposeFakeState(state);
        killSpy.mockRestore();
      }
    },
  );

  it.skipIf(isWindows)(
    'never broadcasts to pid -1 when abort wins the exit drain race',
    async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      const { state } = makeFakeState({
        pid: 1,
        isWindows: false,
        supportsProcessGroupKill: true,
      });
      let onData: ((data: string) => void) | undefined;
      let onExit:
        | ((event: { exitCode: number; signal?: number }) => void)
        | undefined;
      const ptyProcess: IPty = {
        ...state.ptyProcess,
        onData: (listener) => {
          onData = listener;
          return { dispose: () => undefined };
        },
        onExit: (listener) => {
          onExit = listener;
          return { dispose: () => undefined };
        },
      };
      try {
        const abortController = new AbortController();
        const resultPromise = createPtyResultPromise(
          ptyProcess,
          false,
          80,
          30,
          () => undefined,
          abortController.signal,
          { scrollback: 10 },
          state.ptyInfo,
          new Map(),
          { value: null },
        );
        if (onData === undefined || onExit === undefined) {
          throw new Error('PTY handlers were not registered');
        }
        onData('draining output');
        onExit({ exitCode: 0 });
        abortController.abort();
        const result = await resultPromise;
        expect(result.exitCode).toBe(0);
        expect(result.aborted).toBe(true);
        expect(killSpy.mock.calls.some(([pid]) => pid === -1)).toBe(false);
      } finally {
        disposeFakeState(state);
        killSpy.mockRestore();
      }
    },
  );

  it.skipIf(isWindows)(
    'inactivity during caller abort waits for group reaping and reports survivors',
    async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      const { state } = makeFakeState({
        pid: 999996,
        isWindows: false,
        supportsProcessGroupKill: true,
      });
      const completed = Promise.withResolvers<ShellExecutionResult>();
      const startedAt = Date.now();
      const abortAction = ptyAbortAction(state, completed.resolve);
      try {
        await ptyInactivityAbortAction(state, completed.resolve);
        const result = await completed.promise;
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
          GROUP_REAP_WINDOW_MS,
        );
        expect(result.survivingGroupMembersOnAbort).toBe(true);
      } finally {
        await abortAction;
        disposeFakeState(state);
        killSpy.mockRestore();
      }
    },
    10000,
  );

  it('real exit signal wins over the synthetic abort result when the exit fires before the group-reap chain settles', async () => {
    // process.kill is stubbed for the whole test, so the fabricated pid is
    // never aimed at a real process group (the suite's standing rule). The
    // stub makes every signal-0 group probe report "alive" without throwing,
    // which forces the bounded reap window to expire (the chain resolves
    // false instead of confirming the group empty) while absorbing every
    // real signal as a no-op.
    const realProcessKill = process.kill;
    const groupProbes: number[] = [];
    process.kill = ((pid: number, signal?: string | number) => {
      if (signal === 0) {
        groupProbes.push(pid);
      }
      return true;
    }) as unknown as typeof process.kill;

    const killSignals: string[] = [];
    let exitListener:
      | ((event: { exitCode: number; signal?: number }) => void)
      | undefined;
    const ptyProcess = {
      pid: 999998,
      kill: (signal?: string | number): void => {
        killSignals.push(signal === undefined ? '<none>' : String(signal));
      },
      onData: () => ({ dispose: () => undefined }),
      onExit: (
        listener: (event: { exitCode: number; signal?: number }) => void,
      ) => {
        exitListener = listener;
        return { dispose: () => undefined };
      },
    } as unknown as IPty;

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
        { scrollback: 10 } as ShellExecutionConfig,
        {
          name: 'node-pty',
          module: {},
          supportsBackpressure: true,
        } as NonNullable<PtyImplementation>,
        activePtys,
        { value: null },
      );

      // The abort listener runs armPtyGroupAbortKill's synchronous SIGTERM
      // prefix (and its chain registration) before abort() returns; the real
      // exit event is then delivered well before the chain settles inside
      // its bounded kill + reap window.
      abortController.abort();
      if (exitListener === undefined) {
        throw new Error('PTY exit handler was not registered');
      }
      exitListener({ exitCode: 137, signal: 9 });

      const result = await resultPromise;

      // The chain really ran: the group got the fake pty's SIGTERM and the
      // stubbed probe kept reporting members, so the window expired.
      expect(killSignals).toContain('SIGTERM');
      expect(groupProbes.length).toBeGreaterThan(0);

      // Ordering guarantee: ptyAbortAction saw exitedGuard marked by the
      // real exit and deferred to the exit handler's chain continuation
      // instead of resolving its synthetic (exitCode 1, signal null) result.
      expect(result.exitCode).toBe(137);
      expect(result.signal).toBe(9);
      expect(result.aborted).toBe(true);
      // The chain could not confirm the group empty, so the survivor flag
      // must still reach the finalized result.
      expect(result.survivingGroupMembersOnAbort).toBe(true);
    } finally {
      process.kill = realProcessKill;
    }
  }, 10000);

  it('abort during natural-exit drain resolves only after the group-reap chain settles (fake pty)', async () => {
    // process.kill is stubbed for the whole test, so the fabricated pid is
    // never aimed at a real process group. Signal-0 probes report the group
    // alive so the bounded reap window must expire; the result may only be
    // produced after that chain settles.
    const realProcessKill = process.kill;
    const groupProbes: number[] = [];
    process.kill = ((pid: number, signal?: string | number) => {
      if (signal === 0) {
        groupProbes.push(pid);
      }
      return true;
    }) as unknown as typeof process.kill;

    const killSignals: string[] = [];
    let dataListener: ((data: string | Buffer) => void) | undefined;
    let exitListener:
      | ((event: { exitCode: number; signal?: number | null }) => void)
      | undefined;
    const ptyProcess = {
      pid: 999997,
      kill: (signal?: string | number): void => {
        killSignals.push(signal === undefined ? '<none>' : String(signal));
      },
      onData: (listener: (data: string | Buffer) => void) => {
        dataListener = listener;
        return { dispose: () => undefined };
      },
      onExit: (
        listener: (event: { exitCode: number; signal?: number | null }) => void,
      ) => {
        exitListener = listener;
        return { dispose: () => undefined };
      },
    } as unknown as IPty;

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
        { scrollback: 10 } as ShellExecutionConfig,
        {
          name: 'node-pty',
          module: {},
          supportsBackpressure: true,
        } as NonNullable<PtyImplementation>,
        activePtys,
        { value: null },
      );
      if (dataListener === undefined || exitListener === undefined) {
        throw new Error('PTY data/exit handlers were not registered');
      }

      // Pending output processing: xterm processes writes asynchronously, so
      // delivering data and then the exit event without an intervening await
      // leaves processingChain unsettled when the race is armed.
      dataListener('draining output\n');
      // Natural exit while the caller signal is not yet aborted: the exit
      // race runs with processingComplete still pending.
      exitListener({ exitCode: 0, signal: null });
      // The caller abort lands during the drain and wins the race. The exit
      // handler already detached the regular abort handler, so the race's
      // abort-win arm must kill the group itself.
      const abortTime = Date.now();
      abortController.abort();

      const result = await resultPromise;

      // The result was gated on the bounded group-reap chain (escalation
      // grace + reap window with lying-alive probes), so it cannot have
      // resolved early.
      expect(Date.now() - abortTime).toBeGreaterThanOrEqual(
        GROUP_REAP_WINDOW_MS,
      );
      // The chain really ran: the group was TERMed and probed.
      expect(killSignals).toContain('SIGTERM');
      expect(groupProbes.length).toBeGreaterThan(0);
      // The natural-exit values win, and the chain outcome (window expired,
      // group not confirmed empty) is carried on the result.
      expect(result.exitCode).toBe(0);
      expect(result.aborted).toBe(true);
      expect(result.survivingGroupMembersOnAbort).toBe(true);
    } finally {
      process.kill = realProcessKill;
    }
  }, 20000);
});

// ---------------------------------------------------------------------------
// Real forkpty abort behavior (POSIX, issue #3517)
// ---------------------------------------------------------------------------

/** Signal-0 existence check. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ESRCH';
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
function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  timeoutValue: T,
): Promise<T> {
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

// A probe rejection (e.g. a synchronous forkpty spawn throw surfacing through
// the withDeadline race) must skip only the real-PTY suite below: letting it
// propagate would fail the whole file and lose the deterministic fake-pty
// tests too. The probe itself is unchanged and stays as strict as before.
let forkptyBackend: PtyImplementation | null = null;
if (!isWindows) {
  try {
    forkptyBackend = await probeUsableForkptyPty();
  } catch {
    forkptyBackend = null;
  }
}

describe.skipIf(isWindows || forkptyBackend === null)(
  'PTY abort group reap (POSIX, forkpty backend, issue #3517)',
  () => {
    // jest/require-top-level-describe does not recognize bun's
    // describe.skipIf form, so the case sits in a plain describe block.
    describe('foreground abort', () => {
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
    });
  },
);
