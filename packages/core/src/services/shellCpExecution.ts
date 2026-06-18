/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChildProcess } from 'node:child_process';
import type {
  ShellOutputEvent,
  ShellExecutionResult,
} from './shellExecutionTypes.js';
import { createExitGuard } from './shellExitGuard.js';
import { makeInactivityTimer } from './shellOutputUtils.js';
import { killProcessWithEscalation } from './shellProcessKill.js';
import {
  type CpExecState,
  handleCpOutput,
  cleanupCpResources,
  buildCpExitResult,
  registerCpExitHandlers,
} from './shellCpHelpers.js';

/** Create the child_process result promise with all event handlers. */
export function createCpResultPromise(
  child: ChildProcess,
  isWindows: boolean,
  onOutputEvent: (event: ShellOutputEvent) => void,
  abortSignal: AbortSignal,
  inactivityTimeoutMs: number | undefined,
): Promise<ShellExecutionResult> {
  const exitedGuard = createExitGuard();
  const { reset: resetInactivityTimer, controller: inactivityAbortController } =
    makeInactivityTimer(inactivityTimeoutMs, exitedGuard);

  const state: CpExecState = {
    child,
    isWindows,
    abortSignal,
    onOutputEvent,
    inactivityAbortController,
    resetInactivityTimer,
    exitedGuard,
    stdoutDecoder: null,
    stderrDecoder: null,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    outputChunks: [],
    error: null,
    isStreamingRawContent: true,
    sniffedBytes: 0,
    sniffBuffer: Buffer.alloc(0),
    totalBytesReceived: 0,
    hasResolved: false,
    cleanedUp: false,
  };

  return new Promise<ShellExecutionResult>((resolve) => {
    setupCpInactivityHandler(state, inactivityTimeoutMs, resetInactivityTimer);
    const abortHandler = setupCpAbortHandler(state);

    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (state.hasResolved) {
        return;
      }
      state.hasResolved = true;
      const { finalBuffer } = cleanupCpResources(state, abortHandler);
      resolve(buildCpExitResult(state, code, signal, finalBuffer));
    };

    child.stdout?.on('data', (data) => handleCpOutput(state, data, 'stdout'));
    child.stderr?.on('data', (data) => handleCpOutput(state, data, 'stderr'));
    child.on('error', (err) => {
      state.error = err;
      handleExit(1, null);
    });

    abortSignal.addEventListener('abort', abortHandler, { once: true });
    registerCpExitHandlers(state, handleExit);
  });
}

function setupCpInactivityHandler(
  state: CpExecState,
  inactivityTimeoutMs: number | undefined,
  resetInactivityTimer: () => void,
): void {
  if (inactivityTimeoutMs === undefined || inactivityTimeoutMs <= 0) {
    return;
  }
  state.inactivityAbortController.signal.addEventListener(
    'abort',
    () => {
      void cpKillOnAbort(state);
    },
    { once: true },
  );
  resetInactivityTimer();
}

function setupCpAbortHandler(state: CpExecState): () => void {
  return () => {
    void cpKillOnAbort(state);
  };
}

/** Kill the child process group on abort or inactivity timeout. */
async function cpKillOnAbort(state: CpExecState): Promise<void> {
  // Preserve old truthiness semantics: skip pid 0 and undefined
  if (
    state.child.pid !== undefined &&
    state.child.pid !== 0 &&
    !state.exitedGuard.isExited()
  ) {
    await killProcessWithEscalation(
      state.child.pid,
      state.isWindows,
      () => state.child.kill('SIGKILL'),
      state.exitedGuard,
    );
  }
}
