/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TextDecoder } from 'node:util';
import { getCachedEncodingForBuffer } from '../utils/systemEncoding.js';
import { isBinary } from '../utils/textUtils.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import type { PtyExecState } from './shellPtyState.js';
import type { ShellExecutionResult } from './shellExecutionTypes.js';
import { MAX_SNIFF_SIZE } from './shellOutputUtils.js';
import {
  getFullBufferText,
  serializeTerminalForRender,
  findLastNonEmptyLineIndex,
  maybeEmitRenderedOutput,
} from './shellPtyHelpers.js';

const shellDebug = new DebugLogger('llxprt:shell:render');

/** Build a ShellExecutionResult for the PTY path. */
export function buildPtyResult(
  state: PtyExecState,
  exitCode: number,
  signal: number | null,
  aborted: boolean,
): ShellExecutionResult {
  return {
    rawOutput: Buffer.concat(state.outputChunks),
    output: getFullBufferText(state.headlessTerminal),
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

/** PTY data handler factory — processes incoming output chunks. */
export function registerPtyDataHandler(
  state: PtyExecState,
  render: () => void,
): void {
  const handleOutput = (data: Buffer) => {
    state.resetInactivityTimer();

    state.processingChain = state.processingChain.then(
      () =>
        new Promise<void>((res) => {
          if (!state.decoder) {
            const encoding = getCachedEncodingForBuffer(data);
            try {
              state.decoder = new TextDecoder(encoding);
            } catch {
              state.decoder = new TextDecoder('utf-8');
            }
          }

          state.outputChunks.push(data);

          if (
            state.isStreamingRawContent &&
            state.sniffedBytes < MAX_SNIFF_SIZE
          ) {
            const sniffBuffer = Buffer.concat(state.outputChunks.slice(0, 20));
            state.sniffedBytes = sniffBuffer.length;

            if (isBinary(sniffBuffer)) {
              state.isStreamingRawContent = false;
              state.onOutputEvent({ type: 'binary_detected' });
            }
          }

          if (state.isStreamingRawContent) {
            const decodedChunk = state.decoder.decode(data, { stream: true });
            if (decodedChunk.length === 0) {
              res();
              return;
            }
            state.isWriting = true;
            state.headlessTerminal.write(decodedChunk, () => {
              render();
              state.isWriting = false;
              res();
            });
          } else {
            const totalBytes = state.outputChunks.reduce(
              (sum, chunk) => sum + chunk.length,
              0,
            );
            state.onOutputEvent({
              type: 'binary_progress',
              bytesReceived: totalBytes,
            });
            res();
          }
        }),
    );
    state.processingChain.catch(() => {});
  };

  state.activePtyEntry.onDataDisposable = state.ptyProcess.onData(
    (data: string) => {
      cancelWatchdog(state);
      const bufferData = Buffer.from(data, 'utf-8');
      handleOutput(bufferData);
    },
  );
}

/** Cancel the silent-hang watchdog on first PTY data/exit event. */
export function cancelWatchdog(state: PtyExecState): void {
  state.hasReceivedEvent = true;
  if (state.watchdogTimer) {
    clearTimeout(state.watchdogTimer);
    state.watchdogTimer = null;
  }
}
