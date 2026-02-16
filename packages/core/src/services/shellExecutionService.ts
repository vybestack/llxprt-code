/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import stripAnsi from 'strip-ansi';
import type { PtyImplementation } from '../utils/getPty.js';
import { getPty } from '../utils/getPty.js';
import { spawn as cpSpawn } from 'node:child_process';
import { TextDecoder } from 'node:util';
import os from 'node:os';
import type { IPty } from '@lydell/node-pty';
import { getCachedEncodingForBuffer } from '../utils/systemEncoding.js';
import { getShellConfiguration, type ShellType } from '../utils/shell-utils.js';
import { isBinary } from '../utils/textUtils.js';
import pkg from '@xterm/headless';
import {
  serializeTerminalToObject,
  type AnsiOutput,
} from '../utils/terminalSerializer.js';
import { DebugLogger } from '../debug/DebugLogger.js';
const { Terminal } = pkg;

const shellDebug = new DebugLogger('llxprt:shell:render');

const SIGKILL_TIMEOUT_MS = 200;
const MAX_CHILD_PROCESS_BUFFER_SIZE = 16 * 1024 * 1024; // 16MB
const ANSI_ESCAPE = '\u001b';
const ANSI_CSI = '\u009b';

// We want to allow shell outputs that are close to the context window in size.
// 600,000 lines is roughly equivalent to a large context window, ensuring
// we capture significant output from long-running commands.
export const SCROLLBACK_LIMIT = 600000;

function stripAnsiIfPresent(value: string): string {
  return value.includes(ANSI_ESCAPE) || value.includes(ANSI_CSI)
    ? stripAnsi(value)
    : value;
}

// Note: getFullText was removed as the PTY path now uses truncatedOutput

// for bounded memory instead of extracting the full xterm terminal buffer.

const BASH_SHOPT_OPTIONS = 'promptvars nullglob extglob nocaseglob dotglob';
const BASH_SHOPT_GUARD = `shopt -u ${BASH_SHOPT_OPTIONS};`;

function ensurePromptvarsDisabled(command: string, shell: ShellType): string {
  if (shell !== 'bash') {
    return command;
  }

  const trimmed = command.trimStart();
  if (trimmed.startsWith(BASH_SHOPT_GUARD)) {
    return command;
  }

  return `${BASH_SHOPT_GUARD} ${command}`;
}

/** A structured result from a shell command execution. */
export interface ShellExecutionResult {
  /** The raw, unprocessed output buffer. */
  rawOutput: Buffer;
  /** The combined, decoded output as a string. */
  output: string;
  /** The process exit code, or null if terminated by a signal. */
  exitCode: number | null;
  /** The signal that terminated the process, if any. */
  signal: number | null;
  /** An error object if the process failed to spawn. */
  error: Error | null;
  /** A boolean indicating if the command was aborted by the user. */
  aborted: boolean;
  /** The process ID of the spawned shell. */
  pid: number | undefined;
  /** The method used to execute the shell command. */
  executionMethod: 'lydell-node-pty' | 'node-pty' | 'child_process' | 'none';
}

export interface ShellExecutionHandle {
  pid: number | undefined;
  result: Promise<ShellExecutionResult>;
}

export interface ShellExecutionConfig {
  terminalWidth?: number;
  terminalHeight?: number;
  pager?: string;
  showColor?: boolean;
  defaultFg?: string;
  defaultBg?: string;
  // Used for testing
  disableDynamicLineTrimming?: boolean;
  scrollback?: number;
}

export type ShellOutputEvent =
  | {
      /** The event contains a chunk of output data. */
      type: 'data';
      /** The decoded string chunk or AnsiOutput for PTY mode. */
      chunk: string | AnsiOutput;
    }
  | {
      /** Signals that the output stream has been identified as binary. */
      type: 'binary_detected';
    }
  | {
      /** Provides progress updates for a binary stream. */
      type: 'binary_progress';
      /** The total number of bytes received so far. */
      bytesReceived: number;
    };

interface ActivePty {
  ptyProcess: IPty;
  headlessTerminal: pkg.Terminal;
  onDataDisposable?: { dispose(): void };
  onExitDisposable?: { dispose(): void };
  onScrollDisposable?: { dispose(): void };
  terminationTimeout?: NodeJS.Timeout;
  renderTimeout?: NodeJS.Timeout;
}

/**
 * Returns true when the error is a benign race where the PTY has already
 * exited before a resize/scroll call reaches it (Unix ESRCH or Windows
 * message-based error).
 */
function isIgnorablePtyExitError(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return (
    err.code === 'ESRCH' ||
    !!err.message?.includes('Cannot resize a pty that has already exited')
  );
}

/**
 * Safely tears down a PTY process, preferring destroy() (which closes the
 * underlying FD/socket) when available at runtime, with a kill() fallback.
 */
function safePtyDestroy(ptyProcess: IPty): void {
  try {
    const pty = ptyProcess as IPty & { destroy?: () => void };
    if (typeof pty.destroy === 'function') {
      pty.destroy();
    } else {
      ptyProcess.kill();
    }
  } catch (_) {
    /* ignore – PTY may already be exited */
  }
}

function cleanupPtyEntryResources(entry: ActivePty): void {
  try {
    entry.onDataDisposable?.dispose();
  } catch (_) {
    /* ignore */
  }
  try {
    entry.onExitDisposable?.dispose();
  } catch (_) {
    /* ignore */
  }
  try {
    entry.onScrollDisposable?.dispose();
  } catch (_) {
    /* ignore */
  }
  if (entry.terminationTimeout) {
    clearTimeout(entry.terminationTimeout);
    entry.terminationTimeout = undefined;
  }
  if (entry.renderTimeout) {
    clearTimeout(entry.renderTimeout);
    entry.renderTimeout = undefined;
  }
  safePtyDestroy(entry.ptyProcess);
  try {
    if (typeof entry.headlessTerminal.dispose === 'function') {
      entry.headlessTerminal.dispose();
    }
  } catch (_) {
    /* ignore */
  }
}

export class ShellExecutionService {
  private static activePtys = new Map<number, ActivePty>();
  private static lastActivePtyId: number | null = null;
  /**
   * Executes a shell command using `node-pty`, capturing all output and lifecycle events.
   *
   * @param commandToExecute The exact command string to run.
   * @param cwd The working directory to execute the command in.
   * @param onOutputEvent A callback for streaming structured events about the execution, including data chunks and status updates.
   * @param abortSignal An AbortSignal to terminate the process and its children.
   * @param shouldUseNodePty Whether to use PTY mode.
   * @param shellExecutionConfig Configuration for shell execution.
   * @returns An object containing the process ID (pid) and a promise that
   *          resolves with the complete execution result.
   */
  static async execute(
    commandToExecute: string,
    cwd: string,
    onOutputEvent: (event: ShellOutputEvent) => void,
    abortSignal: AbortSignal,
    shouldUseNodePty: boolean,
    shellExecutionConfig: ShellExecutionConfig = {},
  ): Promise<ShellExecutionHandle> {
    if (shouldUseNodePty) {
      const ptyInfo = await getPty();
      if (ptyInfo) {
        try {
          return this.executeWithPty(
            commandToExecute,
            cwd,
            onOutputEvent,
            abortSignal,
            shellExecutionConfig,
            ptyInfo,
          );
        } catch (_e) {
          // Fallback to child_process
        }
      }
    }

    return this.childProcessFallback(
      commandToExecute,
      cwd,
      onOutputEvent,
      abortSignal,
    );
  }

  private static appendAndTruncate(
    currentBuffer: string,
    chunk: string,
    maxSize: number,
  ): { newBuffer: string; truncated: boolean } {
    const chunkLength = chunk.length;
    const currentLength = currentBuffer.length;
    const newTotalLength = currentLength + chunkLength;

    if (newTotalLength <= maxSize) {
      return { newBuffer: currentBuffer + chunk, truncated: false };
    }

    // Truncation is needed.
    if (chunkLength >= maxSize) {
      // The new chunk is larger than or equal to the max buffer size.
      // The new buffer will be the tail of the new chunk.
      return {
        newBuffer: chunk.substring(chunkLength - maxSize),
        truncated: true,
      };
    }

    // The combined buffer exceeds the max size, but the new chunk is smaller than it.
    // We need to truncate the current buffer from the beginning to make space.
    const charsToTrim = newTotalLength - maxSize;
    const truncatedBuffer = currentBuffer.substring(charsToTrim);
    return { newBuffer: truncatedBuffer + chunk, truncated: true };
  }

  private static childProcessFallback(
    commandToExecute: string,
    cwd: string,
    onOutputEvent: (event: ShellOutputEvent) => void,
    abortSignal: AbortSignal,
  ): ShellExecutionHandle {
    try {
      const isWindows = os.platform() === 'win32';
      const { executable, argsPrefix, shell } = getShellConfiguration();
      const guardedCommand = ensurePromptvarsDisabled(commandToExecute, shell);
      const spawnArgs = [...argsPrefix, guardedCommand];

      const envVars: NodeJS.ProcessEnv = {
        ...process.env,
        LLXPRT_CODE: '1',
        TERM: 'xterm-256color',
        PAGER: 'cat',
      };
      delete envVars.BASH_ENV;

      const child = cpSpawn(executable, spawnArgs, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsVerbatimArguments: isWindows ? false : undefined,
        shell: false,
        detached: !isWindows,
        env: envVars,
      });

      const result = new Promise<ShellExecutionResult>((resolve) => {
        let stdoutDecoder: TextDecoder | null = null;
        let stderrDecoder: TextDecoder | null = null;

        let stdout = '';
        let stderr = '';
        let stdoutTruncated = false;
        let stderrTruncated = false;
        const outputChunks: Buffer[] = [];
        let error: Error | null = null;
        let exited = false;

        let isStreamingRawContent = true;
        const MAX_SNIFF_SIZE = 4096;
        let sniffedBytes = 0;
        let sniffBuffer = Buffer.alloc(0);
        let totalBytesReceived = 0;

        const handleOutput = (data: Buffer, stream: 'stdout' | 'stderr') => {
          if (!stdoutDecoder || !stderrDecoder) {
            const encoding = getCachedEncodingForBuffer(data);
            try {
              stdoutDecoder = new TextDecoder(encoding);
              stderrDecoder = new TextDecoder(encoding);
            } catch {
              stdoutDecoder = new TextDecoder('utf-8');
              stderrDecoder = new TextDecoder('utf-8');
            }
          }

          totalBytesReceived += data.length;
          outputChunks.push(data);

          if (isStreamingRawContent && sniffedBytes < MAX_SNIFF_SIZE) {
            const remaining = MAX_SNIFF_SIZE - sniffedBytes;
            if (remaining > 0) {
              const slice = data.subarray(0, remaining);
              sniffBuffer =
                sniffBuffer.length === 0
                  ? Buffer.from(slice)
                  : Buffer.concat([sniffBuffer, slice]);
              sniffedBytes = sniffBuffer.length;

              if (isBinary(sniffBuffer)) {
                isStreamingRawContent = false;
                onOutputEvent({ type: 'binary_detected' });
              }
            }
          }

          const decoder = stream === 'stdout' ? stdoutDecoder : stderrDecoder;
          const decodedChunk = decoder.decode(data, { stream: true });
          const strippedChunk = stripAnsiIfPresent(decodedChunk);

          if (stream === 'stdout') {
            const { newBuffer, truncated } = this.appendAndTruncate(
              stdout,
              strippedChunk,
              MAX_CHILD_PROCESS_BUFFER_SIZE,
            );
            stdout = newBuffer;
            if (truncated) {
              stdoutTruncated = true;
            }
          } else {
            const { newBuffer, truncated } = this.appendAndTruncate(
              stderr,
              strippedChunk,
              MAX_CHILD_PROCESS_BUFFER_SIZE,
            );
            stderr = newBuffer;
            if (truncated) {
              stderrTruncated = true;
            }
          }

          if (isStreamingRawContent) {
            onOutputEvent({ type: 'data', chunk: strippedChunk });
          } else {
            onOutputEvent({
              type: 'binary_progress',
              bytesReceived: totalBytesReceived,
            });
          }
        };

        let hasResolved = false;
        let cleanedUp = false;

        const handleExit = (
          code: number | null,
          signal: NodeJS.Signals | null,
        ) => {
          if (hasResolved) {
            return;
          }
          hasResolved = true;
          const { finalBuffer } = cleanup();
          // Ensure we don't add an extra newline if stdout already ends with one.
          const separator = stdout.endsWith('\n') ? '' : '\n';
          let combinedOutput =
            stdout + (stderr ? (stdout ? separator : '') + stderr : '');

          if (stdoutTruncated || stderrTruncated) {
            const truncationMessage = `\n[LLXPRT_CODE_WARNING: Output truncated. The buffer is limited to ${
              MAX_CHILD_PROCESS_BUFFER_SIZE / (1024 * 1024)
            }MB.]`;
            combinedOutput += truncationMessage;
          }

          resolve({
            rawOutput: finalBuffer,
            output: combinedOutput.trim(),
            exitCode: code,
            signal: signal ? (os.constants.signals[signal] ?? null) : null,
            error,
            aborted: abortSignal.aborted,
            pid: child.pid,
            executionMethod: 'child_process',
          });
        };

        child.stdout.on('data', (data) => handleOutput(data, 'stdout'));
        child.stderr.on('data', (data) => handleOutput(data, 'stderr'));
        child.on('error', (err) => {
          error = err;
          handleExit(1, null);
        });

        const abortHandler = async () => {
          if (child.pid && !exited) {
            if (isWindows) {
              cpSpawn('taskkill', ['/pid', child.pid.toString(), '/f', '/t']);
            } else {
              try {
                process.kill(-child.pid, 'SIGTERM');
                await new Promise((res) => setTimeout(res, SIGKILL_TIMEOUT_MS));
                if (!exited) {
                  process.kill(-child.pid, 'SIGKILL');
                }
              } catch (_e) {
                if (!exited) child.kill('SIGKILL');
              }
            }
          }
        };

        abortSignal.addEventListener('abort', abortHandler, { once: true });

        if (child.once) {
          child.once('exit', (code, signal) => {
            handleExit(code, signal);
          });
          child.once('close', (code, signal) => {
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

        function cleanup() {
          exited = true;
          abortSignal.removeEventListener('abort', abortHandler);

          if (!cleanedUp) {
            cleanedUp = true;
            child.stdout?.removeAllListeners('data');
            child.stderr?.removeAllListeners('data');
            child.removeAllListeners('error');
            child.removeAllListeners('exit');
            child.removeAllListeners('close');
          }

          if (stdoutDecoder) {
            const remaining = stdoutDecoder.decode();
            if (remaining) {
              stdout += stripAnsiIfPresent(remaining);
            }
          }
          if (stderrDecoder) {
            const remaining = stderrDecoder.decode();
            if (remaining) {
              stderr += stripAnsiIfPresent(remaining);
            }
          }

          const finalBuffer = Buffer.concat(outputChunks);

          return { stdout, stderr, finalBuffer };
        }
      });

      return { pid: child.pid, result };
    } catch (e) {
      const error = e as Error;
      return {
        pid: undefined,
        result: Promise.resolve({
          error,
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 1,
          signal: null,
          aborted: false,
          pid: undefined,
          executionMethod: 'none',
        }),
      };
    }
  }

  private static executeWithPty(
    commandToExecute: string,
    cwd: string,
    onOutputEvent: (event: ShellOutputEvent) => void,
    abortSignal: AbortSignal,
    shellExecutionConfig: ShellExecutionConfig,
    ptyInfo: PtyImplementation | null,
  ): ShellExecutionHandle {
    if (!ptyInfo) {
      throw new Error('PTY implementation not found');
    }
    try {
      const isWindows = os.platform() === 'win32';
      const cols = shellExecutionConfig.terminalWidth ?? 80;
      const rows = shellExecutionConfig.terminalHeight ?? 30;
      const { executable, argsPrefix, shell } = getShellConfiguration();
      const guardedCommand = ensurePromptvarsDisabled(commandToExecute, shell);
      const args = [...argsPrefix, guardedCommand];

      const envVars: NodeJS.ProcessEnv = {
        ...process.env,
        LLXPRT_CODE: '1',
        TERM: 'xterm-256color',
        PAGER: shellExecutionConfig.pager ?? 'cat',
      };
      delete envVars.BASH_ENV;

      const ptyProcess = ptyInfo.module.spawn(executable, args, {
        cwd,
        name: 'xterm-256color',
        cols,
        rows,
        env: envVars,
        handleFlowControl: true,
      });

      const result = new Promise<ShellExecutionResult>((resolve) => {
        const headlessTerminal = new Terminal({
          allowProposedApi: true,
          cols,
          rows,
          scrollback: shellExecutionConfig.scrollback ?? SCROLLBACK_LIMIT,
        });
        headlessTerminal.scrollToTop();

        let processingChain = Promise.resolve();
        let decoder: TextDecoder | null = null;
        let output: string | AnsiOutput | null = null;
        const outputChunks: Buffer[] = [];
        const error: Error | null = null;
        let exited = false;
        let hasResolved = false;
        let abortFinalizeTimeout: NodeJS.Timeout | null = null;

        let isStreamingRawContent = true;
        const MAX_SNIFF_SIZE = 4096;
        let sniffedBytes = 0;
        let isWriting = false;
        let hasStartedOutput = false;

        const activePtyEntry: ActivePty = {
          ptyProcess,
          headlessTerminal,
        };
        ShellExecutionService.activePtys.set(ptyProcess.pid, activePtyEntry);
        ShellExecutionService.lastActivePtyId = ptyProcess.pid;

        const cleanupActivePty = () => {
          const entry = ShellExecutionService.activePtys.get(ptyProcess.pid);
          if (entry) {
            cleanupPtyEntryResources(entry);
            ShellExecutionService.activePtys.delete(ptyProcess.pid);
          }
          if (ShellExecutionService.lastActivePtyId === ptyProcess.pid) {
            ShellExecutionService.lastActivePtyId = null;
          }
        };

        const resolveResult = (resultValue: ShellExecutionResult) => {
          if (hasResolved) {
            return;
          }
          hasResolved = true;
          if (abortFinalizeTimeout) {
            clearTimeout(abortFinalizeTimeout);
            abortFinalizeTimeout = null;
          }
          cleanupActivePty();
          resolve(resultValue);
        };

        const getFullBufferText = (terminal: pkg.Terminal): string => {
          const buffer = terminal.buffer.active;
          const lines: string[] = [];
          for (let i = 0; i < buffer.length; i++) {
            const line = buffer.getLine(i);
            if (!line) {
              continue;
            }
            // If the NEXT line is wrapped, it means it's a continuation of THIS line.
            // We should not trim the right side of this line because trailing spaces
            // might be significant parts of the wrapped content.
            // If it's not wrapped, we trim normally.
            let trimRight = true;
            if (i + 1 < buffer.length) {
              const nextLine = buffer.getLine(i + 1);
              if (nextLine?.isWrapped) {
                trimRight = false;
              }
            }

            const lineContent = line.translateToString(trimRight);

            if (line.isWrapped && lines.length > 0) {
              lines[lines.length - 1] += lineContent;
            } else {
              lines.push(lineContent);
            }
          }

          // Remove trailing empty lines
          while (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
          }

          return lines.join('\n');
        };

        const renderFn = () => {
          activePtyEntry.renderTimeout = undefined;

          if (!isStreamingRawContent) {
            shellDebug.log('renderFn: skipped (not streaming raw content)');
            return;
          }

          if (!shellExecutionConfig.disableDynamicLineTrimming) {
            if (!hasStartedOutput) {
              const bufferText = getFullBufferText(headlessTerminal);
              if (bufferText.trim().length === 0) {
                shellDebug.log('renderFn: skipped (no output yet)');
                return;
              }
              hasStartedOutput = true;
            }
          }

          const buffer = headlessTerminal.buffer.active;
          let newOutput: AnsiOutput;
          if (shellExecutionConfig.showColor) {
            newOutput = serializeTerminalToObject(headlessTerminal);
          } else {
            newOutput = (serializeTerminalToObject(headlessTerminal) || []).map(
              (line) =>
                line.map((token) => {
                  token.fg = '';
                  token.bg = '';
                  return token;
                }),
            );
          }

          let lastNonEmptyLine = -1;
          for (let i = newOutput.length - 1; i >= 0; i--) {
            const line = newOutput[i];
            if (
              line
                .map((segment) => segment.text)
                .join('')
                .trim().length > 0
            ) {
              lastNonEmptyLine = i;
              break;
            }
          }

          if (buffer.cursorY > lastNonEmptyLine) {
            lastNonEmptyLine = buffer.cursorY;
          }

          const trimmedOutput = newOutput.slice(0, lastNonEmptyLine + 1);

          const finalOutput = shellExecutionConfig.disableDynamicLineTrimming
            ? newOutput
            : trimmedOutput;

          // Using stringify for a quick deep comparison.
          const finalJson = JSON.stringify(finalOutput);
          const outputJson = JSON.stringify(output);
          if (outputJson !== finalJson) {
            // Extract text from cursor line for debug
            const cursorLine = finalOutput[buffer.cursorY];
            const cursorLineText =
              cursorLine
                ?.map((t) => t.text)
                .join('')
                .trimEnd() ?? '(no line)';
            shellDebug.log(
              'renderFn: CHANGED cursorY=%d cursorX=%d lines=%d cursorLine=%s',
              buffer.cursorY,
              buffer.cursorX,
              finalOutput.length,
              JSON.stringify(cursorLineText),
            );
            output = finalOutput;
            onOutputEvent({
              type: 'data',
              chunk: finalOutput,
            });
          } else {
            shellDebug.log(
              'renderFn: no change (cursorY=%d cursorX=%d)',
              buffer.cursorY,
              buffer.cursorX,
            );
          }
        };

        const finalizeResult = (exitCode: number, signal?: number | null) => {
          render(true);
          const finalBuffer = Buffer.concat(outputChunks);
          const fullOutput = getFullBufferText(headlessTerminal);
          resolveResult({
            rawOutput: finalBuffer,
            output: fullOutput,
            exitCode,
            signal: signal ?? null,
            error,
            aborted: abortSignal.aborted,
            pid: ptyProcess.pid,
            executionMethod: ptyInfo.name ?? 'node-pty',
          });
        };

        const render = (finalRender = false) => {
          if (finalRender) {
            if (activePtyEntry.renderTimeout) {
              clearTimeout(activePtyEntry.renderTimeout);
              activePtyEntry.renderTimeout = undefined;
            }
            renderFn();
            return;
          }

          // Coalesce rapid writes (e.g. initial shell prompt burst) but
          // keep latency low for interactive typing by using a short timer.
          if (activePtyEntry.renderTimeout) {
            return;
          }

          activePtyEntry.renderTimeout = setTimeout(() => {
            activePtyEntry.renderTimeout = undefined;
            renderFn();
          }, 16);
        };

        activePtyEntry.onScrollDisposable = headlessTerminal.onScroll(() => {
          if (!isWriting) {
            render();
          }
        });

        const handleOutput = (data: Buffer) => {
          processingChain = processingChain.then(
            () =>
              new Promise<void>((resolve) => {
                if (!decoder) {
                  const encoding = getCachedEncodingForBuffer(data);
                  try {
                    decoder = new TextDecoder(encoding);
                  } catch {
                    decoder = new TextDecoder('utf-8');
                  }
                }

                outputChunks.push(data);

                if (isStreamingRawContent && sniffedBytes < MAX_SNIFF_SIZE) {
                  const sniffBuffer = Buffer.concat(outputChunks.slice(0, 20));
                  sniffedBytes = sniffBuffer.length;

                  if (isBinary(sniffBuffer)) {
                    isStreamingRawContent = false;
                    onOutputEvent({ type: 'binary_detected' });
                  }
                }

                if (isStreamingRawContent) {
                  const decodedChunk = decoder.decode(data, { stream: true });
                  if (decodedChunk.length === 0) {
                    resolve();
                    return;
                  }
                  isWriting = true;
                  headlessTerminal.write(decodedChunk, () => {
                    render();
                    isWriting = false;
                    resolve();
                  });
                } else {
                  const totalBytes = outputChunks.reduce(
                    (sum, chunk) => sum + chunk.length,
                    0,
                  );
                  onOutputEvent({
                    type: 'binary_progress',
                    bytesReceived: totalBytes,
                  });
                  resolve();
                }
              }),
          );
          // Prevent unhandled rejection warnings; errors are caught later
          // by the Promise.race in onExit.
          processingChain.catch(() => {});
        };

        activePtyEntry.onDataDisposable = ptyProcess.onData((data: string) => {
          const bufferData = Buffer.from(data, 'utf-8');
          handleOutput(bufferData);
        });

        activePtyEntry.onExitDisposable = ptyProcess.onExit(
          ({ exitCode, signal }: { exitCode: number; signal?: number }) => {
            exited = true;
            abortSignal.removeEventListener('abort', abortHandler);

            if (abortSignal.aborted) {
              finalizeResult(exitCode, signal ?? null);
              return;
            }

            const processingComplete = processingChain.then(() => 'processed');
            let raceAbortListener: (() => void) | null = null;

            const cleanupRaceListener = () => {
              if (raceAbortListener) {
                abortSignal.removeEventListener('abort', raceAbortListener);
                raceAbortListener = null;
              }
            };

            const abortFired = new Promise<'aborted'>((res) => {
              if (abortSignal.aborted) {
                res('aborted');
                return;
              }
              raceAbortListener = () => res('aborted');
              abortSignal.addEventListener('abort', raceAbortListener, {
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
          },
        );

        const abortHandler = async () => {
          if (ptyProcess.pid && !exited) {
            const pid = ptyProcess.pid;
            if (isWindows) {
              cpSpawn('taskkill', ['/pid', pid.toString(), '/f', '/t']);
              cleanupActivePty();
              resolveResult({
                rawOutput: Buffer.concat(outputChunks),
                output: getFullBufferText(headlessTerminal),
                exitCode: 1,
                signal: null,
                error,
                aborted: true,
                pid,
                executionMethod: ptyInfo.name ?? 'node-pty',
              });
              return;
            }

            try {
              process.kill(-pid, 'SIGTERM');
            } catch (_e) {
              // ignore
            }
            try {
              ptyProcess.kill('SIGTERM');
            } catch (_e) {
              // ignore
            }

            await new Promise((res) => setTimeout(res, SIGKILL_TIMEOUT_MS));
            if (exited) {
              return;
            }

            try {
              process.kill(-pid, 'SIGKILL');
            } catch (_e) {
              // ignore
            }
            try {
              ptyProcess.kill('SIGKILL');
            } catch (_e) {
              // ignore
            }

            abortFinalizeTimeout = setTimeout(() => {
              resolveResult({
                rawOutput: Buffer.concat(outputChunks),
                output: getFullBufferText(headlessTerminal),
                exitCode: 1,
                signal: null,
                error,
                aborted: true,
                pid,
                executionMethod: ptyInfo.name ?? 'node-pty',
              });
            }, SIGKILL_TIMEOUT_MS);
          }
        };

        abortSignal.addEventListener('abort', abortHandler, { once: true });
      });

      return { pid: ptyProcess.pid, result };
    } catch (e) {
      const error = e as Error;
      return {
        pid: undefined,
        result: Promise.resolve({
          error,
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 1,
          signal: null,
          aborted: false,
          pid: undefined,
          executionMethod: 'none',
        }),
      };
    }
  }

  /**
   * Writes a string to the pseudo-terminal (PTY) of a running process.
   *
   * @param pid The process ID of the target PTY.
   * @param input The string to write to the terminal.
   */
  static writeToPty(pid: number, input: string): void {
    const activePty = this.activePtys.get(pid);
    if (activePty) {
      activePty.ptyProcess.write(input);
      return;
    }

    const fallbackPtyId = this.lastActivePtyId;
    if (fallbackPtyId && fallbackPtyId !== pid) {
      const fallbackPty = this.activePtys.get(fallbackPtyId);
      if (fallbackPty) {
        fallbackPty.ptyProcess.write(input);
      }
    }
  }

  static isPtyActive(pid: number): boolean {
    try {
      // process.kill with signal 0 is a way to check for the existence of a process.
      // It doesn't actually send a signal.
      return process.kill(pid, 0);
    } catch (_) {
      return false;
    }
  }

  static isActivePty(pid: number): boolean {
    return this.activePtys.has(pid);
  }

  /**
   * Resizes the pseudo-terminal (PTY) of a running process.
   *
   * @param pid The process ID of the target PTY.
   * @param cols The new number of columns.
   * @param rows The new number of rows.
   */
  static resizePty(pid: number, cols: number, rows: number): void {
    if (!this.isPtyActive(pid)) {
      return;
    }

    const activePty = this.activePtys.get(pid);
    if (activePty) {
      try {
        activePty.ptyProcess.resize(cols, rows);
        activePty.headlessTerminal.resize(cols, rows);
      } catch (e) {
        if (!isIgnorablePtyExitError(e)) {
          throw e;
        }
      }
    }
  }

  static getLastActivePtyId(): number | null {
    return this.lastActivePtyId;
  }

  /**
   * Terminates the pseudo-terminal (PTY) process.
   *
   * @param pid The process ID of the target PTY.
   */
  static terminatePty(pid: number): void {
    const activePty = this.activePtys.get(pid);
    if (!activePty) {
      return;
    }

    try {
      process.kill(-pid, 'SIGTERM');
    } catch (_e) {
      // ignore
    }

    try {
      activePty.ptyProcess.kill('SIGTERM');
    } catch (_e) {
      // ignore
    }

    activePty.terminationTimeout = setTimeout(() => {
      if (!this.activePtys.has(pid)) {
        return;
      }
      try {
        process.kill(-pid, 'SIGKILL');
      } catch (_e) {
        // ignore
      }
      try {
        activePty.ptyProcess.kill('SIGKILL');
      } catch (_e) {
        // ignore
      }
    }, SIGKILL_TIMEOUT_MS);
  }

  /**
   * Scrolls the pseudo-terminal (PTY) of a running process.
   *
   * @param pid The process ID of the target PTY.
   * @param lines The number of lines to scroll.
   */
  static scrollPty(pid: number, lines: number): void {
    const activePty = this.activePtys.get(pid);
    const fallbackPtyId = this.lastActivePtyId;
    const targetPty = activePty
      ? { id: pid, pty: activePty }
      : fallbackPtyId
        ? { id: fallbackPtyId, pty: this.activePtys.get(fallbackPtyId) }
        : null;

    if (!targetPty?.pty) {
      return;
    }

    try {
      targetPty.pty.headlessTerminal.scrollLines(lines);
      if (targetPty.pty.headlessTerminal.buffer.active.viewportY < 0) {
        targetPty.pty.headlessTerminal.scrollToTop();
      }
    } catch (e) {
      if (!isIgnorablePtyExitError(e)) {
        throw e;
      }
    }
  }

  /**
   * Destroys all active PTY processes by sending kill signals and cleaning up
   * resources. Safe to call when no PTYs are active.
   */
  static destroyAllPtys(): void {
    for (const [pid, entry] of this.activePtys) {
      cleanupPtyEntryResources(entry);
      this.activePtys.delete(pid);
    }
    this.lastActivePtyId = null;
  }
}
