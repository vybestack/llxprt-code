/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'node:os';
import { TextDecoder } from 'node:util';
import type { ChildProcess } from 'node:child_process';
import { getCachedEncodingForBuffer } from '../utils/systemEncoding.js';
import { isBinary } from '../utils/textUtils.js';
import type {
  ShellOutputEvent,
  ShellExecutionResult,
} from './shellExecutionTypes.js';
import type { ExitGuard } from './shellExitGuard.js';
import { decodeClixmlStderr } from './shellJobTail.js';
import { stripAnsiIfPresent, MAX_SNIFF_SIZE } from './shellOutputUtils.js';
import { BoundedCombinedCollector } from '@vybestack/llxprt-code-tools/acquisition.js';
import type { ByteBudget } from '@vybestack/llxprt-code-tools/acquisition.js';

/**
 * State bag shared across child_process helper closures.
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-02
 * @requirement REQ-3329-03
 */
export interface CpExecState {
  isWindows: boolean;
  abortSignal: AbortSignal;
  onOutputEvent: (event: ShellOutputEvent) => void;
  inactivityAbortController: AbortController;
  resetInactivityTimer: () => void;
  cancelInactivityTimer: () => void;
  inactivityAbortHandler: (() => void) | null;
  exitedGuard: ExitGuard;
  stdoutDecoder: TextDecoder | null;
  stderrDecoder: TextDecoder | null;
  retentionBudget: ByteBudget;
  rawCollector: BoundedCombinedCollector | null;
  error: Error | null;
  isStreamingRawContent: boolean;
  sniffedBytes: number;
  sniffBuffer: Buffer | null;
  hasResolved: boolean;
  cleanedUp: boolean;
  /**
   * Bounded grace timer armed when the child 'exit' event arrives while
   * stdio streams are still delivering data (see createCpResultPromise).
   */
  drainGraceTimeout: NodeJS.Timeout | null;
}

/** Create decoders and the bounded collector from the detected encoding. */
export function ensureDecoders(
  state: CpExecState,
  data: Buffer,
): BoundedCombinedCollector {
  if (state.stdoutDecoder && state.stderrDecoder && state.rawCollector) {
    return state.rawCollector;
  }
  const detectedEncoding = getCachedEncodingForBuffer(data);
  let encoding = detectedEncoding;
  try {
    state.stdoutDecoder = new TextDecoder(encoding);
    state.stderrDecoder = new TextDecoder(encoding);
  } catch {
    encoding = 'utf-8';
    state.stdoutDecoder = new TextDecoder(encoding);
    state.stderrDecoder = new TextDecoder(encoding);
  }
  state.rawCollector = new BoundedCombinedCollector({
    budget: state.retentionBudget,
    encoding,
  });
  return state.rawCollector;
}

/** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-03 */
function requireSniffBuffer(state: CpExecState): Buffer {
  if (state.sniffBuffer === null) {
    throw new Error('CP sniff buffer accessed after execution teardown');
  }
  return state.sniffBuffer;
}

/**
 * Sniff initial output for binary content detection.
 *
 * Uses a fixed-capacity pre-allocated buffer (state.sniffBuffer is
 * Buffer.alloc(MAX_SNIFF_SIZE) at init) and writes incrementally with
 * Buffer.copy — O(1) per chunk, no quadratic concat (Issue #3200).
 */
function checkBinarySniff(state: CpExecState, data: Buffer): void {
  if (!state.isStreamingRawContent || state.sniffedBytes >= MAX_SNIFF_SIZE) {
    return;
  }
  const remaining = MAX_SNIFF_SIZE - state.sniffedBytes;
  if (remaining <= 0) {
    return;
  }
  const sniffBuffer = requireSniffBuffer(state);
  const writeLen = Math.min(data.length, remaining);
  data.copy(sniffBuffer, state.sniffedBytes, 0, writeLen);
  state.sniffedBytes += writeLen;

  if (isBinary(sniffBuffer.subarray(0, state.sniffedBytes))) {
    state.isStreamingRawContent = false;
    state.onOutputEvent({ type: 'binary_detected' });
  }
}

/** Process incoming data from child_process stdout/stderr. */
export function handleCpOutput(
  state: CpExecState,
  data: Buffer,
  stream: 'stdout' | 'stderr',
): void {
  state.resetInactivityTimer();
  const rawCollector = ensureDecoders(state, data);
  rawCollector.append(data, stream);

  checkBinarySniff(state, data);

  const decoder =
    stream === 'stdout' ? state.stdoutDecoder : state.stderrDecoder;
  const decodedChunk = decoder!.decode(data, { stream: true });
  const strippedChunk = stripAnsiIfPresent(decodedChunk);

  if (state.isStreamingRawContent) {
    state.onOutputEvent({ type: 'data', chunk: strippedChunk });
  } else {
    state.onOutputEvent({
      type: 'binary_progress',
      bytesReceived: rawCollector.observedByteCount,
    });
  }
}

function emitFinalDecodedChunk(
  state: CpExecState,
  decoder: TextDecoder | null,
): void {
  const finalChunk = stripAnsiIfPresent(decoder?.decode() ?? '');
  if (state.isStreamingRawContent && finalChunk !== '') {
    state.onOutputEvent({ type: 'data', chunk: finalChunk });
  }
}

/**
 * Clean up child_process listeners and materialize bounded raw output.
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-01
 * @requirement REQ-3329-02
 */
export function cleanupCpResources(
  state: CpExecState,
  child: ChildProcess,
  abortHandler: () => void,
): { finalBuffer: Buffer } {
  state.exitedGuard.markExited();
  state.cancelInactivityTimer();
  if (state.drainGraceTimeout !== null) {
    clearTimeout(state.drainGraceTimeout);
    state.drainGraceTimeout = null;
  }
  if (state.inactivityAbortHandler !== null) {
    state.inactivityAbortController.signal.removeEventListener(
      'abort',
      state.inactivityAbortHandler,
    );
    state.inactivityAbortHandler = null;
  }
  state.abortSignal.removeEventListener('abort', abortHandler);

  if (!state.cleanedUp) {
    state.cleanedUp = true;
    child.stdout?.removeAllListeners('data');
    child.stderr?.removeAllListeners('data');
    child.removeAllListeners('error');
    child.removeAllListeners('exit');
    child.removeAllListeners('close');
  }

  emitFinalDecodedChunk(state, state.stdoutDecoder);
  emitFinalDecodedChunk(state, state.stderrDecoder);

  const finalBuffer =
    state.rawCollector?.getBoundedRawBuffer() ?? Buffer.alloc(0);
  return { finalBuffer };
}

function combineOutputSections(first: string, second: string): string {
  if (first === '') {
    return second;
  }
  if (second === '') {
    return first;
  }
  return first + (first.endsWith('\n') ? '' : '\n') + second;
}

/**
 * Build the ShellExecutionResult for a child_process exit.
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-03
 */
export function buildCpExitResult(
  state: CpExecState,
  child: ChildProcess,
  code: number | null,
  signal: NodeJS.Signals | null,
  finalBuffer: Buffer,
): ShellExecutionResult {
  const rawResult = state.rawCollector?.getResult();
  const rawMetadata = rawResult?.metadata;

  let combinedOutput = '';
  if (rawResult !== undefined) {
    const stdout = stripAnsiIfPresent(rawResult.stdoutText);
    const retainedStderr = rawResult.stderrText;
    const decodedStderr = state.isWindows
      ? decodeClixmlStderr(retainedStderr)
      : retainedStderr;
    const stderr = stripAnsiIfPresent(decodedStderr);
    const sourceOutput = combineOutputSections(stdout, stderr);
    const decodedClixml = decodedStderr !== retainedStderr;

    if (rawResult.metadata.truncated && !decodedClixml) {
      combinedOutput = stripAnsiIfPresent(rawResult.text);
    } else {
      combinedOutput = combineOutputSections(
        sourceOutput,
        rawResult.metadata.truncated ? (rawResult.omissionNotice ?? '') : '',
      );
    }
  }

  return {
    rawOutput: finalBuffer,
    output: combinedOutput.trim(),
    outputTruncation: rawMetadata?.truncated === true ? rawMetadata : undefined,
    exitCode: code,
    signal: signal ? os.constants.signals[signal] : null,
    error: state.error,
    aborted: state.abortSignal.aborted,
    inactivityTimedOut: state.inactivityAbortController.signal.aborted,
    pid: child.pid,
    executionMethod: 'child_process',
  };
}

/**
 * Register exit/close event handlers on the child process.
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-03
 */
export function registerCpExitHandlers(
  child: ChildProcess,
  handleExit: (code: number | null, signal: NodeJS.Signals | null) => void,
): void {
  const childOnce = child.once as
    | ((
        event: 'exit' | 'close',
        listener: (code: number | null, signal: NodeJS.Signals | null) => void,
      ) => ChildProcess)
    | undefined;
  if (childOnce !== undefined) {
    childOnce.call(child, 'exit', (code, signal) => {
      handleExit(code, signal);
    });
    childOnce.call(child, 'close', (code, signal) => {
      handleExit(code, signal);
    });
  } else {
    child.on('exit', (code, signal) => {
      handleExit(code, signal);
    });
    child.on('close', (code, signal) => {
      handleExit(code, signal);
    });
  }
}
