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
import { stripAnsiIfPresent, MAX_SNIFF_SIZE } from './shellOutputUtils.js';

export const MAX_CHILD_PROCESS_BUFFER_SIZE = 16 * 1024 * 1024; // 16MB

/** State bag shared across child_process helper closures. */
export interface CpExecState {
  child: ChildProcess;
  isWindows: boolean;
  abortSignal: AbortSignal;
  onOutputEvent: (event: ShellOutputEvent) => void;
  inactivityAbortController: AbortController;
  resetInactivityTimer: () => void;
  exitedGuard: ExitGuard;
  stdoutDecoder: TextDecoder | null;
  stderrDecoder: TextDecoder | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  outputChunks: Buffer[];
  error: Error | null;
  isStreamingRawContent: boolean;
  sniffedBytes: number;
  sniffBuffer: Buffer;
  totalBytesReceived: number;
  hasResolved: boolean;
  cleanedUp: boolean;
}

/** Append a decoded chunk to stdout or stderr with truncation tracking. */
export function appendDecodedChunk(
  currentBuffer: string,
  strippedChunk: string,
  maxSize: number,
): { newBuffer: string; truncated: boolean } {
  const chunkLength = strippedChunk.length;
  const currentLength = currentBuffer.length;
  const newTotalLength = currentLength + chunkLength;

  if (newTotalLength <= maxSize) {
    return { newBuffer: currentBuffer + strippedChunk, truncated: false };
  }

  if (chunkLength >= maxSize) {
    return {
      newBuffer: strippedChunk.substring(chunkLength - maxSize),
      truncated: true,
    };
  }

  const charsToTrim = newTotalLength - maxSize;
  const truncatedBuffer = currentBuffer.substring(charsToTrim);
  return { newBuffer: truncatedBuffer + strippedChunk, truncated: true };
}

/** Create decoders for stdout/stderr from the first data chunk's encoding. */
export function ensureDecoders(state: CpExecState, data: Buffer): void {
  if (state.stdoutDecoder && state.stderrDecoder) {
    return;
  }
  const encoding = getCachedEncodingForBuffer(data);
  try {
    state.stdoutDecoder = new TextDecoder(encoding);
    state.stderrDecoder = new TextDecoder(encoding);
  } catch {
    state.stdoutDecoder = new TextDecoder('utf-8');
    state.stderrDecoder = new TextDecoder('utf-8');
  }
}

/** Sniff initial output for binary content detection. */
function checkBinarySniff(state: CpExecState, data: Buffer): void {
  if (!state.isStreamingRawContent || state.sniffedBytes >= MAX_SNIFF_SIZE) {
    return;
  }
  const remaining = MAX_SNIFF_SIZE - state.sniffedBytes;
  if (remaining <= 0) {
    return;
  }
  const slice = data.subarray(0, remaining);
  state.sniffBuffer =
    state.sniffBuffer.length === 0
      ? Buffer.from(slice)
      : Buffer.concat([state.sniffBuffer, slice]);
  state.sniffedBytes = state.sniffBuffer.length;

  if (isBinary(state.sniffBuffer)) {
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
  ensureDecoders(state, data);

  state.totalBytesReceived += data.length;
  state.outputChunks.push(data);

  checkBinarySniff(state, data);

  const decoder =
    stream === 'stdout' ? state.stdoutDecoder : state.stderrDecoder;
  const decodedChunk = decoder!.decode(data, { stream: true });
  const strippedChunk = stripAnsiIfPresent(decodedChunk);

  if (stream === 'stdout') {
    const { newBuffer, truncated } = appendDecodedChunk(
      state.stdout,
      strippedChunk,
      MAX_CHILD_PROCESS_BUFFER_SIZE,
    );
    state.stdout = newBuffer;
    if (truncated) {
      state.stdoutTruncated = true;
    }
  } else {
    const { newBuffer, truncated } = appendDecodedChunk(
      state.stderr,
      strippedChunk,
      MAX_CHILD_PROCESS_BUFFER_SIZE,
    );
    state.stderr = newBuffer;
    if (truncated) {
      state.stderrTruncated = true;
    }
  }

  if (state.isStreamingRawContent) {
    state.onOutputEvent({ type: 'data', chunk: strippedChunk });
  } else {
    state.onOutputEvent({
      type: 'binary_progress',
      bytesReceived: state.totalBytesReceived,
    });
  }
}

function flushDecoder(
  decoder: TextDecoder | null,
  append: (text: string) => void,
): void {
  if (!decoder) {
    return;
  }
  const remaining = decoder.decode();
  if (remaining) {
    append(remaining);
  }
}

/** Clean up child_process listeners and flush remaining decoder bytes. */
export function cleanupCpResources(
  state: CpExecState,
  abortHandler: () => void,
): { stdout: string; stderr: string; finalBuffer: Buffer } {
  state.exitedGuard.markExited();
  state.abortSignal.removeEventListener('abort', abortHandler);

  if (!state.cleanedUp) {
    state.cleanedUp = true;
    state.child.stdout?.removeAllListeners('data');
    state.child.stderr?.removeAllListeners('data');
    state.child.removeAllListeners('error');
    state.child.removeAllListeners('exit');
    state.child.removeAllListeners('close');
  }

  flushDecoder(state.stdoutDecoder, (text) => {
    state.stdout += stripAnsiIfPresent(text);
  });
  flushDecoder(state.stderrDecoder, (text) => {
    state.stderr += stripAnsiIfPresent(text);
  });

  const finalBuffer = Buffer.concat(state.outputChunks);
  return { stdout: state.stdout, stderr: state.stderr, finalBuffer };
}

/** Build the ShellExecutionResult for a child_process exit. */
export function buildCpExitResult(
  state: CpExecState,
  code: number | null,
  signal: NodeJS.Signals | null,
  finalBuffer: Buffer,
): ShellExecutionResult {
  const separator = state.stdout.endsWith('\n') ? '' : '\n';
  let combinedOutput = state.stdout;
  if (state.stderr) {
    combinedOutput += (state.stdout !== '' ? separator : '') + state.stderr;
  }

  if (state.stdoutTruncated || state.stderrTruncated) {
    const truncationMessage = `\n[LLXPRT_CODE_WARNING: Output truncated. The buffer is limited to ${
      MAX_CHILD_PROCESS_BUFFER_SIZE / (1024 * 1024)
    }MB.]`;
    combinedOutput += truncationMessage;
  }

  return {
    rawOutput: finalBuffer,
    output: combinedOutput.trim(),
    exitCode: code,
    signal: signal ? os.constants.signals[signal] : null,
    error: state.error,
    aborted: state.abortSignal.aborted,
    inactivityTimedOut: state.inactivityAbortController.signal.aborted,
    pid: state.child.pid,
    executionMethod: 'child_process',
  };
}

/** Register exit/close event handlers on the child process. */
export function registerCpExitHandlers(
  state: CpExecState,
  handleExit: (code: number | null, signal: NodeJS.Signals | null) => void,
): void {
  const childOnce = state.child.once as
    | ((
        event: 'exit' | 'close',
        listener: (code: number | null, signal: NodeJS.Signals | null) => void,
      ) => typeof state.child)
    | undefined;
  if (childOnce !== undefined) {
    childOnce.call(state.child, 'exit', (code, signal) => {
      handleExit(code, signal);
    });
    childOnce.call(state.child, 'close', (code, signal) => {
      handleExit(code, signal);
    });
  } else {
    state.child.on('exit', (code, signal) => {
      handleExit(code, signal);
    });
    state.child.on('close', (code, signal) => {
      handleExit(code, signal);
    });
  }
}
