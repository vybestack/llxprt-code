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
import { SIGKILL_TIMEOUT_MS, taskkillTree } from './shellProcessKill.js';
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
const { Terminal } = headless;

// We want to allow shell outputs that are close to the context window in size.
export const SCROLLBACK_LIMIT = 600000;

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
  const headlessTerminal = new Terminal({
    allowProposedApi: true,
    cols,
    rows,
    scrollback: shellExecutionConfig.scrollback ?? SCROLLBACK_LIMIT,
  });
  headlessTerminal.scrollToTop();

  const exitedGuard = createExitGuard();
  const inactivityTimeoutMs = shellExecutionConfig.inactivityTimeoutMs;
  const { reset: resetInactivityTimer, controller: inactivityAbortController } =
    makeInactivityTimer(inactivityTimeoutMs, exitedGuard);

  const activePtyEntry: ActivePty = {
    ptyProcess,
    headlessTerminal,
  };
  activePtys.set(ptyProcess.pid, activePtyEntry);
  lastActivePtyIdRef.value = ptyProcess.pid;

  const state: PtyExecState = {
    ptyProcess,
    headlessTerminal,
    activePtyEntry,
    isWindows,
    abortSignal,
    onOutputEvent,
    shellExecutionConfig,
    ptyInfo,
    inactivityAbortController,
    resetInactivityTimer,
    exitedGuard,
    decoder: null,
    output: null,
    outputChunks: [],
    error: null,
    isStreamingRawContent: true,
    sniffedBytes: 0,
    isWriting: false,
    hasStartedOutput: false,
    hasResolved: false,
    abortFinalizeTimeout: null,
    processingChain: Promise.resolve(),
  };

  return new Promise<ShellExecutionResult>((resolve) => {
    setupPtyEventHandlers(state, resolve, activePtys, lastActivePtyIdRef);
  });
}

function setupPtyEventHandlers(
  state: PtyExecState,
  resolve: (value: ShellExecutionResult) => void,
  activePtys: Map<number, ActivePty>,
  lastActivePtyIdRef: { value: number | null },
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
      if (!state.isWriting) {
        render();
      }
    },
  );

  setupPtyInactivityHandler(state, resolveResult);
  const abortHandler = setupPtyAbortHandler(state, resolveResult);

  registerPtyDataHandler(state, render);
  registerPtyExitHandler(state, resolveResult, abortHandler);

  state.abortSignal.addEventListener('abort', abortHandler, { once: true });
}

function teardownPtyState(
  state: PtyExecState,
  activePtys: Map<number, ActivePty>,
  lastActivePtyIdRef: { value: number | null },
): void {
  if (state.abortFinalizeTimeout) {
    clearTimeout(state.abortFinalizeTimeout);
    state.abortFinalizeTimeout = null;
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

function setupPtyInactivityHandler(
  state: PtyExecState,
  resolveResult: (resultValue: ShellExecutionResult) => void,
): void {
  const inactivityTimeoutMs = state.shellExecutionConfig.inactivityTimeoutMs;
  if (inactivityTimeoutMs === undefined || inactivityTimeoutMs <= 0) {
    return;
  }
  state.inactivityAbortController.signal.addEventListener(
    'abort',
    () => {
      void ptyInactivityAbortAction(state, resolveResult);
    },
    { once: true },
  );
  state.resetInactivityTimer();
}

async function ptyInactivityAbortAction(
  state: PtyExecState,
  resolveResult: (resultValue: ShellExecutionResult) => void,
): Promise<void> {
  if (state.ptyProcess.pid === 0 || state.exitedGuard.isExited()) {
    return;
  }
  const pid = state.ptyProcess.pid;
  if (state.isWindows) {
    taskkillTree(pid);
    finalizeInactivityKill(state, resolveResult);
    return;
  }
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
  finalizeInactivityKill(state, resolveResult);
}

function finalizeInactivityKill(
  state: PtyExecState,
  resolveResult: (resultValue: ShellExecutionResult) => void,
): void {
  if (state.exitedGuard.isExited()) {
    return;
  }
  state.abortFinalizeTimeout = setTimeout(() => {
    resolveResult(buildPtyResult(state, 1, null, state.abortSignal.aborted));
  }, SIGKILL_TIMEOUT_MS);
}

function setupPtyAbortHandler(
  state: PtyExecState,
  resolveResult: (resultValue: ShellExecutionResult) => void,
): () => void {
  return () => {
    void ptyAbortAction(state, resolveResult);
  };
}

async function ptyAbortAction(
  state: PtyExecState,
  resolveResult: (resultValue: ShellExecutionResult) => void,
): Promise<void> {
  // Preserve old truthiness semantics: skip pid 0 (invalid process ID)
  if (state.ptyProcess.pid === 0 || state.exitedGuard.isExited()) {
    return;
  }
  const pid = state.ptyProcess.pid;
  if (state.isWindows) {
    taskkillTree(pid);
    resolveResult(buildPtyResult(state, 1, null, true));
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // Process may already be terminated.
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

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Process may already be terminated.
  }
  try {
    state.ptyProcess.kill('SIGKILL');
  } catch {
    // PTY may already be terminated.
  }

  state.abortFinalizeTimeout = setTimeout(() => {
    resolveResult(buildPtyResult(state, 1, null, true));
  }, SIGKILL_TIMEOUT_MS);
}

function registerPtyExitHandler(
  state: PtyExecState,
  resolveResult: (resultValue: ShellExecutionResult) => void,
  abortHandler: () => void,
): void {
  const finalizeResult = (exitCode: number, signal?: number | null) => {
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
      state.exitedGuard.markExited();
      state.abortSignal.removeEventListener('abort', abortHandler);

      if (state.abortSignal.aborted) {
        finalizeResult(exitCode, signal ?? null);
        return;
      }

      ptyExitRace(state, exitCode, signal, finalizeResult);
    },
  );
}

function ptyExitRace(
  state: PtyExecState,
  exitCode: number,
  signal: number | undefined,
  finalizeResult: (exitCode: number, signal?: number | null) => void,
): void {
  const processingComplete = state.processingChain.then(() => 'processed');
  let raceAbortListener: (() => void) | null = null;

  const cleanupRaceListener = () => {
    if (raceAbortListener) {
      state.abortSignal.removeEventListener('abort', raceAbortListener);
      raceAbortListener = null;
    }
  };

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
