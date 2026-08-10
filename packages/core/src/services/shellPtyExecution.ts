/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isBinary } from '../utils/textUtils.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import type { PtyExecState } from './shellPtyState.js';
import type { ShellExecutionResult } from './shellExecutionTypes.js';
import { MAX_SNIFF_SIZE, stripAnsiIfPresent } from './shellOutputUtils.js';
import {
  getFullBufferText,
  serializeTerminalForRender,
  findLastNonEmptyLineIndex,
  maybeEmitRenderedOutput,
} from './shellPtyHelpers.js';
import type {
  ByteBudget,
  CombinedAcquisitionResult,
  TruncationMetadata,
} from '@vybestack/llxprt-code-tools/acquisition.js';

const shellDebug = new DebugLogger('llxprt:shell:render');

export const PTY_QUEUE_HIGH_WATER_BYTES = 2 * 1024 * 1024;
export const PTY_QUEUE_LOW_WATER_BYTES = 1024 * 1024;
export const PTY_QUEUE_HARD_LIMIT_BYTES = 8 * 1024 * 1024;
export const PTY_QUEUE_HIGH_WATER_ITEMS = 1024;
export const PTY_QUEUE_LOW_WATER_ITEMS = 512;
export const PTY_QUEUE_HARD_LIMIT_ITEMS = 4096;
const PTY_UTF8_ENCODING_CHUNK_CODE_UNITS = 64 * 1024;

const PTY_QUEUE_OVERFLOW_NOTICE =
  '[LLXPRT output truncated: processing queue overflow terminated output acquisition]';
const PTY_RETAINED_OUTPUT_LABEL = '[Retained PTY output]';
const PTY_FINAL_SCREEN_LABEL = '[Final terminal screen]';

function joinNonEmptySections(sections: Array<string | null>): string {
  return sections
    .filter(
      (section): section is string => section !== null && section.length > 0,
    )
    .join('\n');
}

function buildRetainedPtyText(
  acquisition: CombinedAcquisitionResult,
  notice: string | null,
): string {
  if (!acquisition.metadata.truncated) {
    return joinNonEmptySections([stripAnsiIfPresent(acquisition.text), notice]);
  }
  return joinNonEmptySections([
    stripAnsiIfPresent(acquisition.headText),
    notice,
    stripAnsiIfPresent(acquisition.tailText),
  ]);
}

function buildPtyTextOutput(
  state: PtyExecState,
  acquisition: CombinedAcquisitionResult,
  terminalOutput: string,
): string {
  const useRetainedOutput =
    state.queueOverflowed ||
    state.terminalContentEvicted ||
    acquisition.metadata.truncated;
  if (!useRetainedOutput) {
    return terminalOutput;
  }

  const notice = state.queueOverflowed
    ? PTY_QUEUE_OVERFLOW_NOTICE
    : acquisition.omissionNotice;
  const retainedOutput = buildRetainedPtyText(acquisition, notice);
  return joinNonEmptySections([
    PTY_RETAINED_OUTPUT_LABEL,
    retainedOutput,
    terminalOutput.length > 0 ? PTY_FINAL_SCREEN_LABEL : null,
    terminalOutput,
  ]);
}

function buildPtyTruncationMetadata(
  state: PtyExecState,
  acquisition: CombinedAcquisitionResult,
): TruncationMetadata | undefined {
  if (state.queueOverflowed) {
    return {
      ...acquisition.metadata,
      omittedBytesExact: false,
      truncated: true,
    };
  }
  return acquisition.metadata.truncated ? acquisition.metadata : undefined;
}

/** Build a ShellExecutionResult for the PTY path. */
export function buildPtyResult(
  state: PtyExecState,
  exitCode: number,
  signal: number | null,
  aborted: boolean,
): ShellExecutionResult {
  const acquisition = state.rawCollector.getResult();
  const terminalOutput = getFullBufferText(state.headlessTerminal);

  return {
    rawOutput: state.rawCollector.getBoundedRawBuffer(),
    output: buildPtyTextOutput(state, acquisition, terminalOutput),
    outputTruncation: buildPtyTruncationMetadata(state, acquisition),
    exitCode,
    signal,
    error: state.error,
    aborted,
    inactivityTimedOut: state.inactivityAbortController.signal.aborted,
    pid: state.ptyProcess.pid,
    executionMethod: state.ptyInfo.name,
  };
}

/** Render the headless terminal, emitting a data event if content changed. */
export function ptyRenderFn(state: PtyExecState): void {
  state.activePtyEntry.renderTimeout = undefined;

  if (!state.isStreamingRawContent) {
    shellDebug.log('renderFn: skipped (not streaming raw content)');
    return;
  }

  if (
    state.shellExecutionConfig.disableDynamicLineTrimming !== true &&
    !state.hasStartedOutput
  ) {
    const bufferText = getFullBufferText(state.headlessTerminal);
    if (bufferText.trim().length === 0) {
      shellDebug.log('renderFn: skipped (no output yet)');
      return;
    }
    state.hasStartedOutput = true;
  }

  renderTerminalOutput(state);
}

function renderTerminalOutput(state: PtyExecState): void {
  const buffer = state.headlessTerminal.buffer.active;
  const newOutput = serializeTerminalForRender(
    state.headlessTerminal,
    state.shellExecutionConfig.showColor,
  );

  const lastNonEmptyLine = findLastNonEmptyLineIndex(newOutput, buffer.cursorY);
  const trimmedOutput = newOutput.slice(0, lastNonEmptyLine + 1);

  const finalOutput: AnsiOutput =
    state.shellExecutionConfig.disableDynamicLineTrimming === true
      ? newOutput
      : trimmedOutput;

  maybeEmitRenderedOutput(
    { current: state.output },
    (event) => {
      state.output = event.chunk;
      state.onOutputEvent(event);
    },
    finalOutput,
    buffer,
  );
}

/**
 * Error thrown when the PTY pending processing queue exceeds the hard bound.
 * Callers should terminate the process tree and resolve with a truncated
 * result (Issue #3200).
 */
export class PtyQueueOverflowError extends Error {
  constructor(
    message: string,
    readonly pendingBytes: number,
    readonly byteLimit: number,
    readonly pendingItems: number,
    readonly itemLimit: number,
  ) {
    super(message);
    this.name = 'PtyQueueOverflowError';
  }
}

/**
 * PTY data handler factory — processes incoming output chunks.
 *
 * Each chunk is fed to xterm in order (no head/tail dropping for the terminal
 * stream) while the raw byte collector bounds retention for rawOutput
 * compatibility (Issue #3200). The pending queue is tracked so backends
 * without usable backpressure can fail fast.
 *
 * @param onOverflow Called when the pending queue exceeds the hard limit on
 *   a backend without usable backpressure. The caller should terminate the
 *   process tree and resolve with a truncated result.
 */
function exceedsQueueHardLimit(state: PtyExecState): boolean {
  return (
    state.pendingQueueBytes > PTY_QUEUE_HARD_LIMIT_BYTES ||
    state.pendingQueueItems > PTY_QUEUE_HARD_LIMIT_ITEMS
  );
}

function triggerQueueOverflow(
  state: PtyExecState,
  onOverflow: (error: PtyQueueOverflowError) => void,
): void {
  if (state.queueOverflowed) {
    return;
  }
  state.queueOverflowed = true;
  if (state.backpressurePaused) {
    try {
      state.ptyProcess.resume();
    } catch {
      // Termination below remains authoritative if the backend cannot resume.
    }
    state.backpressurePaused = false;
  }
  onOverflow(
    new PtyQueueOverflowError(
      'PTY pending queue exceeded its hard byte or item limit; terminating the process tree',
      state.pendingQueueBytes,
      PTY_QUEUE_HARD_LIMIT_BYTES,
      state.pendingQueueItems,
      PTY_QUEUE_HARD_LIMIT_ITEMS,
    ),
  );
}

function pausePtyAtHighWater(
  state: PtyExecState,
  onOverflow: (error: PtyQueueOverflowError) => void,
): void {
  if (
    !state.supportsBackpressure ||
    state.backpressurePaused ||
    (state.pendingQueueBytes < PTY_QUEUE_HIGH_WATER_BYTES &&
      state.pendingQueueItems < PTY_QUEUE_HIGH_WATER_ITEMS)
  ) {
    return;
  }
  try {
    state.ptyProcess.pause();
    state.backpressurePaused = true;
  } catch {
    state.supportsBackpressure = false;
    if (exceedsQueueHardLimit(state)) {
      triggerQueueOverflow(state, onOverflow);
    }
  }
}

function finishQueueEntry(
  state: PtyExecState,
  dataLength: number,
  onOverflow: (error: PtyQueueOverflowError) => void,
): void {
  state.pendingQueueBytes = Math.max(0, state.pendingQueueBytes - dataLength);
  state.pendingQueueItems = Math.max(0, state.pendingQueueItems - 1);
  if (
    state.queueOverflowed ||
    !state.backpressurePaused ||
    state.pendingQueueBytes > PTY_QUEUE_LOW_WATER_BYTES ||
    state.pendingQueueItems > PTY_QUEUE_LOW_WATER_ITEMS
  ) {
    return;
  }
  try {
    state.ptyProcess.resume();
    state.backpressurePaused = false;
  } catch {
    triggerQueueOverflow(state, onOverflow);
  }
}

function appendPtyOutput(
  state: PtyExecState,
  data: string | Buffer,
): { text: string; byteLength: number } {
  if (Buffer.isBuffer(data)) {
    state.rawCollector.append(data, 'stdout');
    return { text: data.toString('utf8'), byteLength: data.length };
  }

  let offset = 0;
  let observedBytes = 0;
  while (offset < data.length) {
    let end = Math.min(
      offset + PTY_UTF8_ENCODING_CHUNK_CODE_UNITS,
      data.length,
    );
    const finalCodeUnit = data.charCodeAt(end - 1);
    if (
      end < data.length &&
      finalCodeUnit >= 0xd800 &&
      finalCodeUnit <= 0xdbff
    ) {
      end -= 1;
    }
    const encoded = Buffer.from(data.slice(offset, end), 'utf8');
    state.rawCollector.append(encoded, 'stdout');
    observedBytes += encoded.length;
    offset = end;
  }
  return { text: data, byteLength: observedBytes };
}

function inspectPtyBinaryPrefix(state: PtyExecState, budget: ByteBudget): void {
  if (!state.isStreamingRawContent || state.sniffedBytes >= MAX_SNIFF_SIZE) {
    return;
  }
  const sniffBuffer = state.rawCollector.getHeadBytes(
    Math.min(MAX_SNIFF_SIZE, budget.bytes),
  );
  state.sniffedBytes = Math.min(
    state.rawCollector.observedByteCount,
    MAX_SNIFF_SIZE,
    budget.bytes,
  );
  if (isBinary(sniffBuffer)) {
    state.isStreamingRawContent = false;
    state.onOutputEvent({ type: 'binary_detected' });
  }
}

function processPtyChunk(
  state: PtyExecState,
  data: string,
  dataByteLength: number,
  render: () => void,
  budget: ByteBudget,
  onOverflow: (error: PtyQueueOverflowError) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      finishQueueEntry(state, dataByteLength, onOverflow);
      resolve();
    };
    const fail = (error: unknown) => {
      if (!finished) {
        finished = true;
        finishQueueEntry(state, dataByteLength, onOverflow);
      }
      reject(error);
    };

    try {
      if (state.hasResolved || state.queueOverflowed) {
        finish();
        return;
      }
      inspectPtyBinaryPrefix(state, budget);
      if (!state.isStreamingRawContent) {
        state.onOutputEvent({
          type: 'binary_progress',
          bytesReceived: state.rawCollector.observedByteCount,
        });
        finish();
        return;
      }
      state.isWriting = true;
      const wasAtCap =
        state.headlessTerminal.buffer.active.length >=
        state.terminalMaxBufferLines;
      state.headlessTerminal.write(data, () => {
        if (
          wasAtCap &&
          state.headlessTerminal.buffer.active.length >=
            state.terminalMaxBufferLines
        ) {
          state.terminalContentEvicted = true;
        }
        render();
        state.isWriting = false;
        finish();
      });
    } catch (error) {
      state.isWriting = false;
      fail(error);
    }
  });
}

export function registerPtyDataHandler(
  state: PtyExecState,
  render: () => void,
  budget: ByteBudget,
  onOverflow: (error: PtyQueueOverflowError) => void,
): void {
  const handleOutput = (data: string | Buffer) => {
    if (state.hasResolved || state.queueOverflowed || data.length === 0) {
      return;
    }
    state.resetInactivityTimer();
    const { text, byteLength: dataByteLength } = appendPtyOutput(state, data);
    state.pendingQueueBytes += dataByteLength;
    state.pendingQueueItems += 1;

    if (exceedsQueueHardLimit(state)) {
      triggerQueueOverflow(state, onOverflow);
      finishQueueEntry(state, dataByteLength, onOverflow);
      return;
    }
    pausePtyAtHighWater(state, onOverflow);

    state.processingChain = state.processingChain
      .then(() =>
        processPtyChunk(
          state,
          text,
          dataByteLength,
          render,
          budget,
          onOverflow,
        ),
      )
      .catch((error: unknown) => {
        state.error = error instanceof Error ? error : new Error(String(error));
      });
  };

  state.activePtyEntry.onDataDisposable = state.ptyProcess.onData(handleOutput);
}
