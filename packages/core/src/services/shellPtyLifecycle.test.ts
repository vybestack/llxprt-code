/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import type { IPty } from '@lydell/node-pty';
import headless from '@xterm/headless';

import type { PtyExecState } from './shellPtyState.js';
import type {
  ShellExecutionConfig,
  ShellExecutionResult,
} from './shellExecutionTypes.js';
import { createExitGuard } from './shellExitGuard.js';
import {
  ptyAbortAction,
  ptyInactivityAbortAction,
} from './shellPtyLifecycle.js';
import type { PtyImplementation } from '../utils/getPty.js';
import {
  BoundedCombinedCollector,
  createByteBudget,
} from '@vybestack/llxprt-code-tools/acquisition.js';

const { Terminal } = headless;

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
    ptyInfo: { name: 'node-pty', module: {} } as NonNullable<PtyImplementation>,
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
    expect(killSignals).toEqual([]);
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

    expect(killSignals).toEqual([]);
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

    expect(killSignals).toEqual([]);
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
    expect(killSignals).toEqual([]);
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
    expect(killSignals).toEqual([]);
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

    expect(killSignals).toEqual([]);
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
