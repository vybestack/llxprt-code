/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IPty } from '@lydell/node-pty';
import headless from '@xterm/headless';
import type { PtyImplementation } from '../utils/getPty.js';
import type {
  ShellOutputEvent,
  ShellExecutionConfig,
  ShellExecutionResult,
} from './shellExecutionTypes.js';
import { createExitGuard } from './shellExitGuard.js';
import { makeInactivityTimer } from './shellOutputUtils.js';
import {
  SIGKILL_TIMEOUT_MS,
  isKillablePid,
  taskkillTree,
} from './shellProcessKill.js';
import type { PtyExecState } from './shellPtyState.js';
import type { ActivePty } from './shellPtyHelpers.js';
import {
  cleanupPtyEntryResources,
  cleanupPtyEntryByPid,
} from './shellPtyHelpers.js';
import {
  buildPtyResult,
  ptyRenderFn,
  registerPtyDataHandler,
} from './shellPtyExecution.js';
import { resolveShellRetentionBudget } from './shellAcquisitionConfig.js';
import {
  BoundedCombinedCollector,
  type ByteBudget,
} from '@vybestack/llxprt-code-tools/acquisition.js';
const { Terminal } = headless;

/**
 * Default scrollback limit when no explicit scrollback is configured.
 * This is intentionally bounded (Issue #3200); the old value of 600,000
 * lines could retain hundreds of MB of terminal state.
 */
export const SCROLLBACK_LIMIT = 10000;

/**
 * Maximum scrollback lines. Even when an explicit scrollback is configured
 * via settings, it is capped at this value to prevent unbounded terminal
 * state growth (Issue #3200).
 */
const MAX_SCROLLBACK_LINES = 50000;

/**
 * Conservative retained-memory estimate per terminal cell. A cell needs more
 * than its visible code point once xterm attributes and JavaScript storage are
 * included, so scrollback is coupled to the byte budget with this multiplier.
 */
const ESTIMATED_BYTES_PER_TERMINAL_CELL = 8;

/** Derive the effective xterm scrollback without exceeding the byte budget. */
function deriveScrollbackFromBudget(
  budget: ByteBudget,
  cols: number,
  configuredScrollback: number | undefined,
): number {
  const effectiveCols = Math.max(cols, 1);
  const budgetLineLimit = Math.min(
    Math.floor(
      budget.bytes / (effectiveCols * ESTIMATED_BYTES_PER_TERMINAL_CELL),
    ),
    MAX_SCROLLBACK_LINES,
  );
  const requested = Number.isFinite(configuredScrollback)
    ? Math.max(Math.floor(configuredScrollback ?? 0), 0)
    : SCROLLBACK_LIMIT;
  return Math.min(requested, budgetLineLimit);
}

function createTerminalTrackingState(scrollback: number, rows: number) {
  return {
    terminalMaxBufferLines: scrollback + rows,
    terminalScrollbackCapacity: scrollback,
    terminalScrollbackAtCapacity: scrollback === 0,
    terminalContentEvicted: false,
  };
}

/** Clean up and resolve the active PTY entry from a map. */
export function cleanupActivePtyEntry(
  state: PtyExecState,
  activePtys: Map<number, ActivePty>,
  getLastId: () => number | null,
  setLastId: (id: number | null) => void,
): void {
  cleanupPtyEntryByPid(state.ptyProcess.pid, activePtys, getLastId, setLastId);
}

/** Create the PTY result promise with all event handlers. */
export function createPtyResultPromise(
  ptyProcess: IPty,
  isWindows: boolean,
  cols: number,
  rows: number,
  onOutputEvent: (event: ShellOutputEvent) => void,
  abortSignal: AbortSignal,
  shellExecutionConfig: ShellExecutionConfig,
  ptyInfo: NonNullable<PtyImplementation>,
  activePtys: Map<number, ActivePty>,
  lastActivePtyIdRef: { value: number | null },
): Promise<ShellExecutionResult> {
  const budget = resolveShellRetentionBudget(
    shellExecutionConfig.outputRetentionMaxBytes,
  );

  const effectiveScrollback = deriveScrollbackFromBudget(
    budget,
    cols,
    shellExecutionConfig.scrollback,
  );

  const headlessTerminal = new Terminal({
    allowProposedApi: true,
    cols,
    rows,
    scrollback: effectiveScrollback,
  });
  headlessTerminal.scrollToTop();

  const state = initializePtyExecState({
    ptyProcess,
    headlessTerminal,
    isWindows,
    abortSignal,
    onOutputEvent,
    shellExecutionConfig,
    ptyInfo,
    budget,
    effectiveScrollback,
    rows,
  });

  activePtys.set(ptyProcess.pid, state.activePtyEntry);
  lastActivePtyIdRef.value = ptyProcess.pid;

  return new Promise<ShellExecutionResult>((resolve) => {
    setupPtyEventHandlers(
      state,
      resolve,
      activePtys,
      lastActivePtyIdRef,
      budget,
    );
  });
}

/**
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-02
 * @requirement REQ-3329-03
 */
function initializePtyExecState(execution: {
  ptyProcess: IPty;
  headlessTerminal: PtyExecState['headlessTerminal'];
  isWindows: boolean;
  abortSignal: AbortSignal;
  onOutputEvent: (event: ShellOutputEvent) => void;
  shellExecutionConfig: ShellExecutionConfig;
  ptyInfo: NonNullable<PtyImplementation>;
  budget: ByteBudget;
  effectiveScrollback: number;
  rows: number;
}): PtyExecState {
  const exitedGuard = createExitGuard();
  const inactivityTimeoutMs =
    execution.shellExecutionConfig.inactivityTimeoutMs;
  const {
    reset: resetInactivityTimer,
    cancel: cancelInactivityTimer,
    controller: inactivityAbortController,
  } = makeInactivityTimer(inactivityTimeoutMs, exitedGuard);

  const activePtyEntry: ActivePty = {
    ptyProcess: execution.ptyProcess,
    headlessTerminal: execution.headlessTerminal,
    supportsProcessGroupKill: execution.ptyInfo.name !== 'bun-pty',
  };

  return {
    ptyProcess: execution.ptyProcess,
    headlessTerminal: execution.headlessTerminal,
    activePtyEntry,
    isWindows: execution.isWindows,
    abortSignal: execution.abortSignal,
    onOutputEvent: execution.onOutputEvent,
    shellExecutionConfig: execution.shellExecutionConfig,
    ptyInfo: execution.ptyInfo,
    supportsProcessGroupKill: execution.ptyInfo.name !== 'bun-pty',
    inactivityAbortController,
    resetInactivityTimer,
    cancelInactivityTimer,
    inactivityAbortHandler: null,
    callerAbortHandler: null,
    exitRaceCleanup: null,
    exitedGuard,
    output: null,
    rawCollector: new BoundedCombinedCollector({ budget: execution.budget }),
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
    supportsBackpressure: execution.ptyInfo.supportsBackpressure,
    backpressurePaused: false,
    queueOverflowed: false,
    ...createTerminalTrackingState(
      execution.effectiveScrollback,
      execution.rows,
    ),
  };
}

function setupPtyEventHandlers(
  state: PtyExecState,
  resolve: (value: ShellExecutionResult) => void,
  activePtys: Map<number, ActivePty>,
  lastActivePtyIdRef: { value: number | null },
  budget: ByteBudget,
): void {
  const resolveResult = makePtyResolveResult(
    state,
    resolve,
    activePtys,
    lastActivePtyIdRef,
  );
  const renderFn = () => {
    ptyRenderFn(state);
  };
  const render = makePtyRender(state, renderFn);

  state.activePtyEntry.onScrollDisposable = state.headlessTerminal.onScroll(
    () => {
      const atCapacity =
        state.terminalScrollbackCapacity === 0 ||
        state.headlessTerminal.buffer.active.baseY >=
          state.terminalScrollbackCapacity;
      if (state.isWriting && state.terminalScrollbackAtCapacity && atCapacity) {
        state.terminalContentEvicted = true;
      }
      state.terminalScrollbackAtCapacity = atCapacity;
      if (!state.isWriting) {
        render();
      }
    },
  );

  setupPtyInactivityHandler(state, resolveResult);
  const abortHandler = setupPtyAbortHandler(state, resolveResult);

  registerPtyDataHandler(state, render, budget, (error) => {
    if (state.hasResolved) {
      return;
    }
    state.error = error;
    if (!isKillablePid(state.ptyProcess.pid)) {
      resolveResult(buildPtyResult(state, 1, null, false));
      return;
    }
    void ptyAbortAction(state, resolveResult, false);
  });

  registerPtyExitHandler(state, resolveResult, abortHandler);

  state.callerAbortHandler = abortHandler;
  state.abortSignal.addEventListener('abort', abortHandler, { once: true });
}

/**
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-01
 * @requirement REQ-3329-02
 */
function teardownPtyState(
  state: PtyExecState,
  activePtys: Map<number, ActivePty>,
  lastActivePtyIdRef: { value: number | null },
): void {
  // Marking the guard here stops every abort/inactivity kill chain that is
  // still mid-flight (they re-check isExited after each escalation sleep),
  // so none can schedule a fallback timeout after this execution resolved.
  state.exitedGuard.markExited();
  state.cancelInactivityTimer();
  if (state.callerAbortHandler !== null) {
    state.abortSignal.removeEventListener('abort', state.callerAbortHandler);
    state.callerAbortHandler = null;
  }
  if (state.exitRaceCleanup !== null) {
    // ptyExitRace's temporary listener would otherwise stay on the caller
    // signal until pending output processing settles; a stalled write chain
    // would retain this execution's closure graph indefinitely.
    state.exitRaceCleanup();
    state.exitRaceCleanup = null;
  }
  if (state.inactivityAbortHandler !== null) {
    state.inactivityAbortController.signal.removeEventListener(
      'abort',
      state.inactivityAbortHandler,
    );
    state.inactivityAbortHandler = null;
  }
  if (state.abortFinalizeTimeout) {
    clearTimeout(state.abortFinalizeTimeout);
    state.abortFinalizeTimeout = null;
  }
  if (state.backpressurePaused) {
    try {
      state.ptyProcess.resume();
    } catch {
      // PTY teardown below remains authoritative.
    }
    state.backpressurePaused = false;
  }
  cleanupActivePtyEntry(
    state,
    activePtys,
    () => lastActivePtyIdRef.value,
    (id) => {
      lastActivePtyIdRef.value = id;
    },
  );
}

/** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-03 */
function makePtyResolveResult(
  state: PtyExecState,
  resolve: (value: ShellExecutionResult) => void,
  activePtys: Map<number, ActivePty>,
  lastActivePtyIdRef: { value: number | null },
): (resultValue: ShellExecutionResult) => void {
  return (resultValue: ShellExecutionResult) => {
    if (state.hasResolved) {
      return;
    }
    state.hasResolved = true;
    teardownPtyState(state, activePtys, lastActivePtyIdRef);
    state.rawCollector = null;
    resolve(resultValue);
  };
}

function makePtyRender(
  state: PtyExecState,
  renderFn: () => void,
): (finalRender?: boolean) => void {
  return (finalRender = false) => {
    if (finalRender) {
      if (state.activePtyEntry.renderTimeout) {
        clearTimeout(state.activePtyEntry.renderTimeout);
        state.activePtyEntry.renderTimeout = undefined;
      }
      renderFn();
      return;
    }

    if (state.activePtyEntry.renderTimeout) {
      return;
    }

    state.activePtyEntry.renderTimeout = setTimeout(() => {
      state.activePtyEntry.renderTimeout = undefined;
      renderFn();
    }, 16);
  };
}

/** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-02 */
function setupPtyInactivityHandler(
  state: PtyExecState,
  resolveResult: (resultValue: ShellExecutionResult) => void,
): void {
  const inactivityTimeoutMs = state.shellExecutionConfig.inactivityTimeoutMs;
  if (inactivityTimeoutMs === undefined || inactivityTimeoutMs <= 0) {
    return;
  }
  const inactivityAbortHandler = () => {
    void ptyInactivityAbortAction(state, resolveResult);
  };
  state.inactivityAbortHandler = inactivityAbortHandler;
  state.inactivityAbortController.signal.addEventListener(
    'abort',
    inactivityAbortHandler,
    { once: true },
  );
  state.resetInactivityTimer();
}

export async function ptyInactivityAbortAction(
  state: PtyExecState,
  resolveResult: (resultValue: ShellExecutionResult) => void,
): Promise<void> {
  // A non-killable pid (0, negative, NaN, Infinity) must never reach
  // process.kill(-pid): pid 0 would signal the caller's own process group.
  if (!isKillablePid(state.ptyProcess.pid) || state.exitedGuard.isExited()) {
    return;
  }
  const pid = state.ptyProcess.pid;
  if (state.isWindows) {
    taskkillTree(pid);
    finalizeInactivityKill(state, resolveResult);
    return;
  }
  if (state.supportsProcessGroupKill) {
    try {
      process.kill(-pid, 'SIGTERM');
      await new Promise((res) => setTimeout(res, SIGKILL_TIMEOUT_MS));
      if (!state.exitedGuard.isExited()) {
        process.kill(-pid, 'SIGKILL');
      }
    } catch {
      if (!state.exitedGuard.isExited()) {
        state.ptyProcess.kill('SIGKILL');
      }
    }
  } else {
    state.ptyProcess.kill('SIGTERM');
    await new Promise((res) => setTimeout(res, SIGKILL_TIMEOUT_MS));
    if (!state.exitedGuard.isExited()) {
      state.ptyProcess.kill('SIGKILL');
    }
  }
  finalizeInactivityKill(state, resolveResult);
}

/**
 * Schedule the post-escalation fallback resolution. Single-owner: a pending
 * fallback is cleared first so staggered abort/inactivity chains cannot leak
 * timers past one another. The callback re-checks hasResolved before
 * building the result because a timeout that already fired can have its
 * callback queued behind another resolution path, after the collector was
 * torn down. The aborted flag is evaluated when the timeout fires so an
 * overlapping caller abort is still reported.
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-03
 */
function schedulePtyAbortFallback(
  state: PtyExecState,
  resolveResult: (resultValue: ShellExecutionResult) => void,
  getAborted: () => boolean,
): void {
  if (state.abortFinalizeTimeout !== null) {
    clearTimeout(state.abortFinalizeTimeout);
  }
  state.abortFinalizeTimeout = setTimeout(() => {
    state.abortFinalizeTimeout = null;
    if (state.hasResolved) {
      return;
    }
    resolveResult(buildPtyResult(state, 1, null, getAborted()));
  }, SIGKILL_TIMEOUT_MS);
}

function finalizeInactivityKill(
  state: PtyExecState,
  resolveResult: (resultValue: ShellExecutionResult) => void,
): void {
  if (state.exitedGuard.isExited()) {
    return;
  }
  schedulePtyAbortFallback(
    state,
    resolveResult,
    () => state.abortSignal.aborted,
  );
}

function setupPtyAbortHandler(
  state: PtyExecState,
  resolveResult: (resultValue: ShellExecutionResult) => void,
): () => void {
  return () => {
    void ptyAbortAction(state, resolveResult);
  };
}

export async function ptyAbortAction(
  state: PtyExecState,
  resolveResult: (resultValue: ShellExecutionResult) => void,
  aborted = true,
): Promise<void> {
  // A non-killable pid (0, negative, NaN, Infinity) must never reach
  // process.kill(-pid): pid 0 would signal the caller's own process group.
  if (!isKillablePid(state.ptyProcess.pid) || state.exitedGuard.isExited()) {
    return;
  }
  const pid = state.ptyProcess.pid;
  if (state.isWindows) {
    taskkillTree(pid);
    resolveResult(buildPtyResult(state, 1, null, aborted));
    return;
  }

  if (state.supportsProcessGroupKill) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // Process group may already be terminated.
    }
  }
  try {
    state.ptyProcess.kill('SIGTERM');
  } catch {
    // PTY may already be terminated.
  }

  await new Promise((res) => setTimeout(res, SIGKILL_TIMEOUT_MS));
  if (state.exitedGuard.isExited()) {
    return;
  }

  if (state.supportsProcessGroupKill) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Process group may already be terminated.
    }
  }
  try {
    state.ptyProcess.kill('SIGKILL');
  } catch {
    // PTY may already be terminated.
  }

  schedulePtyAbortFallback(state, resolveResult, () => aborted);
}

function registerPtyExitHandler(
  state: PtyExecState,
  resolveResult: (resultValue: ShellExecutionResult) => void,
  abortHandler: () => void,
): void {
  const finalizeResult = (exitCode: number, signal?: number | null) => {
    if (state.hasResolved) {
      return;
    }
    ptyRenderFn(state);
    resolveResult(
      buildPtyResult(
        state,
        exitCode,
        signal ?? null,
        state.abortSignal.aborted,
      ),
    );
  };

  state.activePtyEntry.onExitDisposable = state.ptyProcess.onExit(
    ({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      // node-pty reports a signal value of 0 for clean exits; normalize it to
      // null exactly once at this boundary so downstream formatting treats it
      // as "no signal" (preserving undefined/null and all nonzero signals).
      const normalizedSignal = signal === 0 ? null : (signal ?? null);
      state.exitedGuard.markExited();
      state.abortSignal.removeEventListener('abort', abortHandler);

      if (state.abortSignal.aborted) {
        finalizeResult(exitCode, normalizedSignal);
        return;
      }

      ptyExitRace(state, exitCode, normalizedSignal, finalizeResult);
    },
  );
}

function ptyExitRace(
  state: PtyExecState,
  exitCode: number,
  signal: number | null,
  finalizeResult: (exitCode: number, signal?: number | null) => void,
): void {
  const processingComplete = state.processingChain.then(() => 'processed');
  let raceAbortListener: (() => void) | null = null;

  const cleanupRaceListener = () => {
    if (raceAbortListener) {
      state.abortSignal.removeEventListener('abort', raceAbortListener);
      raceAbortListener = null;
    }
    state.exitRaceCleanup = null;
  };
  // Teardown can detach this listener before the race settles (a kill-chain
  // fallback resolved first); the detacher must stay reachable from state.
  state.exitRaceCleanup = cleanupRaceListener;

  const abortFired = new Promise<'aborted'>((res) => {
    if (state.abortSignal.aborted) {
      res('aborted');
      return;
    }
    raceAbortListener = () => res('aborted');
    state.abortSignal.addEventListener('abort', raceAbortListener, {
      once: true,
    });
  });

  Promise.race([processingComplete, abortFired])
    .then(() => {
      cleanupRaceListener();
      finalizeResult(exitCode, signal ?? null);
    })
    .catch(() => {
      cleanupRaceListener();
      finalizeResult(exitCode, signal ?? null);
    });
}

export { cleanupPtyEntryResources };
