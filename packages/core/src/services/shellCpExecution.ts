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
import {
  isKillablePid,
  killProcessWithEscalation,
} from './shellProcessKill.js';
import {
  type CpExecState,
  handleCpOutput,
  cleanupCpResources,
  buildCpExitResult,
  registerCpExitHandlers,
} from './shellCpHelpers.js';
import { resolveShellRetentionBudget } from './shellAcquisitionConfig.js';
import { MAX_SNIFF_SIZE } from './shellOutputUtils.js';

/**
 * Upper bound on how long finalization waits for stdio streams to close
 * after the child exits. Normally 'close' follows 'exit' within a tick;
 * the bound only matters when a grandchild inherits the pipe fds.
 */
const CP_OUTPUT_DRAIN_GRACE_MS = 500;

/**
 * Create the child_process result promise with all event handlers.
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-01
 * @requirement REQ-3329-02
 * @requirement REQ-3329-03
 */
export function createCpResultPromise(
  child: ChildProcess,
  isWindows: boolean,
  onOutputEvent: (event: ShellOutputEvent) => void,
  abortSignal: AbortSignal,
  inactivityTimeoutMs: number | undefined,
  outputRetentionMaxBytes: number | undefined,
): Promise<ShellExecutionResult> {
  const exitedGuard = createExitGuard();
  const {
    reset: resetInactivityTimer,
    cancel: cancelInactivityTimer,
    controller: inactivityAbortController,
  } = makeInactivityTimer(inactivityTimeoutMs, exitedGuard);

  const budget = resolveShellRetentionBudget(outputRetentionMaxBytes);

  const state: CpExecState = {
    isWindows,
    abortSignal,
    onOutputEvent,
    inactivityAbortController,
    resetInactivityTimer,
    cancelInactivityTimer,
    inactivityAbortHandler: null,
    exitedGuard,
    stdoutDecoder: null,
    stderrDecoder: null,
    retentionBudget: budget,
    rawCollector: null,
    error: null,
    isStreamingRawContent: true,
    sniffedBytes: 0,
    sniffBuffer: Buffer.alloc(MAX_SNIFF_SIZE),
    hasResolved: false,
    cleanedUp: false,
    drainGraceTimeout: null,
  };

  return new Promise<ShellExecutionResult>((resolve) => {
    setupCpInactivityHandler(
      state,
      child,
      inactivityTimeoutMs,
      resetInactivityTimer,
    );
    const abortHandler = setupCpAbortHandler(state, child);
    const handleExit = createCpExitFinalizer(
      state,
      child,
      abortHandler,
      resolve,
    );

    child.stdout?.on('data', (data: Buffer) =>
      handleCpOutput(state, data, 'stdout'),
    );
    child.stderr?.on('data', (data: Buffer) =>
      handleCpOutput(state, data, 'stderr'),
    );
    child.on('error', (err) => {
      state.error = err;
      handleExit(1, null);
    });

    abortSignal.addEventListener('abort', abortHandler, { once: true });
    registerCpExitHandlers(child, handleExit);
  });
}
/**
 * Test doubles may be bare EventEmitters without Readable flags; treat
 * objects lacking both flags as settled (they cannot deliver more data).
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-01
 */
function isCpStreamSettled(
  stream: NonNullable<ChildProcess['stdout']>,
): boolean {
  const flags = stream as {
    destroyed?: boolean;
    readableEnded?: boolean;
  };
  if (flags.destroyed === undefined && flags.readableEnded === undefined) {
    return true;
  }
  return flags.destroyed === true || flags.readableEnded === true;
}

/**
 * Build the exit/error finalizer for a child_process execution.
 *
 * Node and Bun can emit 'exit' before the final 'data' chunks arrive on the
 * stdio pipes; finalizing at 'exit' drops that output (Issue #3329 test
 * path). Instead, when Readable stdio streams are still open, defer
 * finalization until every stream has settled ('end' or 'close'; Bun does
 * not always emit 'close' for child stdio). The grace timer bounds the wait
 * so a grandchild holding the pipe fds cannot delay resolution
 * indefinitely. Objects that do not implement the Readable settle contract
 * cannot deliver further data and count as settled, keeping 'exit' the
 * prompt finalization trigger for them.
 *
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-01
 * @requirement REQ-3329-03
 */
function createCpExitFinalizer(
  state: CpExecState,
  child: ChildProcess,
  abortHandler: () => void,
  resolve: (value: ShellExecutionResult) => void,
): (code: number | null, signal: NodeJS.Signals | null) => void {
  const streamSettledListeners = new Map<
    NonNullable<ChildProcess['stdout']>,
    () => void
  >();

  const finalize = (
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void => {
    if (state.hasResolved) {
      return;
    }
    state.hasResolved = true;
    for (const [stream, listener] of streamSettledListeners) {
      stream.removeListener('close', listener);
      stream.removeListener('end', listener);
    }
    streamSettledListeners.clear();
    const { finalBuffer } = cleanupCpResources(state, child, abortHandler);
    const result = buildCpExitResult(state, child, code, signal, finalBuffer);
    state.rawCollector = null;
    state.sniffBuffer = null;
    resolve(result);
  };

  return (code: number | null, signal: NodeJS.Signals | null): void => {
    if (state.hasResolved) {
      return;
    }
    const openStreams = [child.stdout, child.stderr].filter(
      (stream): stream is NonNullable<ChildProcess['stdout']> =>
        stream !== null && !isCpStreamSettled(stream),
    );
    if (openStreams.length === 0) {
      finalize(code, signal);
      return;
    }
    if (state.drainGraceTimeout !== null) {
      return;
    }
    state.drainGraceTimeout = setTimeout(
      () => finalize(code, signal),
      CP_OUTPUT_DRAIN_GRACE_MS,
    );
    for (const stream of openStreams) {
      const onSettled = (): void => {
        // Remove both registrations: whichever of 'end'/'close' fires, the
        // other may never arrive (Bun does not always emit 'close'), and a
        // lingering once-listener would retain the finalizer closure.
        stream.removeListener('close', onSettled);
        stream.removeListener('end', onSettled);
        streamSettledListeners.delete(stream);
        if (state.hasResolved) {
          return;
        }
        const stillOpen = [child.stdout, child.stderr].some(
          (candidate) => candidate !== null && !isCpStreamSettled(candidate),
        );
        if (!stillOpen) {
          finalize(code, signal);
        }
      };
      streamSettledListeners.set(stream, onSettled);
      stream.once('close', onSettled);
      stream.once('end', onSettled);
    }
  };
}

/**
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-02
 */
function setupCpInactivityHandler(
  state: CpExecState,
  child: ChildProcess,
  inactivityTimeoutMs: number | undefined,
  resetInactivityTimer: () => void,
): void {
  if (inactivityTimeoutMs === undefined || inactivityTimeoutMs <= 0) {
    return;
  }
  const inactivityAbortHandler = () => {
    void cpKillOnAbort(state, child);
  };
  state.inactivityAbortHandler = inactivityAbortHandler;
  state.inactivityAbortController.signal.addEventListener(
    'abort',
    inactivityAbortHandler,
    { once: true },
  );
  resetInactivityTimer();
}

function setupCpAbortHandler(
  state: CpExecState,
  child: ChildProcess,
): () => void {
  return () => {
    void cpKillOnAbort(state, child);
  };
}

/** Kill the child process group on abort or inactivity timeout. */
async function cpKillOnAbort(
  state: CpExecState,
  child: ChildProcess,
): Promise<void> {
  // Guard the pid before it can reach process.kill(-pid): pid 0 would signal
  // the caller's own process group. isKillablePid also rejects negative and
  // non-finite pids, which the previous `!== 0` check let through.
  if (isKillablePid(child.pid) && !state.exitedGuard.isExited()) {
    await killProcessWithEscalation(
      child.pid,
      state.isWindows,
      () => child.kill('SIGKILL'),
      state.exitedGuard,
    );
  }
}
