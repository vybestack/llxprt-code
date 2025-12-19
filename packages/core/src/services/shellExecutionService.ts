/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getPty, type PtyImplementation } from '../utils/getPty.js';
import { spawn as cpSpawn } from 'child_process';
import { TextDecoder } from 'util';
import os from 'os';
import { getCachedEncodingForBuffer } from '../utils/systemEncoding.js';
import { isBinary } from '../utils/textUtils.js';
import pkg from '@xterm/headless';
import stripAnsi from 'strip-ansi';
const { Terminal } = pkg;

const SIGKILL_TIMEOUT_MS = 200;
const MAX_CHILD_PROCESS_BUFFER_SIZE = 16 * 1024 * 1024; // 16MB
const ANSI_ESCAPE = '\u001b';
const ANSI_CSI = '\u009b';

function stripAnsiIfPresent(value: string): string {
  return value.includes(ANSI_ESCAPE) || value.includes(ANSI_CSI)
    ? stripAnsi(value)
    : value;
}

// @ts-expect-error getFullText is not a public API.
const getFullText = (terminal: Terminal) => {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    lines.push(line ? line.translateToString(true) : '');
  }
  return lines.join('\n').trim();
};

/** A structured result from a shell command execution. */
export interface ShellExecutionResult {
  rawOutput: Buffer;
  /** The combined, decoded output as a string. */
  output: string;
  /** The decoded stdout as a string. */
  stdout: string;
  /** The decoded stderr as a string. */
  stderr: string;
  /** The process exit code, or null if terminated by a signal. */
  exitCode: number | null;
  /** The signal that terminated the process, if any. */
  signal: number | null;
  /** An error object if the process failed to spawn. */
  error: Error | null;
  aborted: boolean;
  pid: number | undefined;
  /** The method used to execute the shell command. */
  executionMethod: 'lydell-node-pty' | 'node-pty' | 'child_process' | 'none';
}

export interface ShellExecutionHandle {
  pid: number | undefined;
  result: Promise<ShellExecutionResult>;
}

export type ShellOutputEvent =
  | {
      /** The event contains a chunk of output data. */
      type: 'data';
      /** The decoded string chunk. */
      chunk: string;
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

export class ShellExecutionService {
  /**
   * Executes a shell command using `node-pty`, capturing all output and lifecycle events.
   *
   * @param commandToExecute The exact command string to run.
   * @param cwd The working directory to execute the command in.
   * @param onOutputEvent A callback for streaming structured events about the execution, including data chunks and status updates.
   * @param abortSignal An AbortSignal to terminate the process and its children.
   * @param terminalColumns The terminal width for the pty.
   * @param terminalRows The terminal height for the pty.
   * @returns An object containing the process ID (pid) and a promise that
   *          resolves with the complete execution result.
   */
  static async execute(
    commandToExecute: string,
    cwd: string,
    onOutputEvent: (event: ShellOutputEvent) => void,
    abortSignal: AbortSignal,
    shouldUseNodePty: boolean,
    terminalColumns?: number,
    terminalRows?: number,
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
            terminalColumns,
            terminalRows,
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

      const envVars: NodeJS.ProcessEnv = {
        ...process.env,
        LLXPRT_CODE: '1',
        TERM: 'xterm-256color',
        PAGER: 'cat',
      };
      delete envVars.BASH_ENV;

      const child = cpSpawn(commandToExecute, [], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsVerbatimArguments: true,
        shell: isWindows ? true : 'bash',
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

        const handleExit = (
          code: number | null,
          signal: NodeJS.Signals | null,
        ) => {
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
            stdout,
            stderr,
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

        child.on('exit', (code, signal) => {
          handleExit(code, signal);
        });

        function cleanup() {
          exited = true;
          abortSignal.removeEventListener('abort', abortHandler);
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
          stdout: '',
          stderr: '',
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
    terminalColumns: number | undefined,
    terminalRows: number | undefined,
    ptyInfo: PtyImplementation | undefined,
  ): ShellExecutionHandle {
    try {
      const cols = terminalColumns ?? 80;
      const rows = terminalRows ?? 30;
      const isWindows = os.platform() === 'win32';
      const shell = isWindows ? 'cmd.exe' : 'bash';
      const args = isWindows
        ? `/c ${commandToExecute}`
        : ['-c', commandToExecute];

      const envVars: NodeJS.ProcessEnv = {
        ...process.env,
        LLXPRT_CODE: '1',
        TERM: 'xterm-256color',
        PAGER: 'cat',
      };
      delete envVars.BASH_ENV;

      const ptyProcess = ptyInfo?.module.spawn(shell, args, {
        cwd,
        name: 'xterm-color',
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
        });
        let processingChain = Promise.resolve();
        let decoder: TextDecoder | null = null;
        const outputChunks: Buffer[] = [];
        const error: Error | null = null;
        let exited = false;

        let isStreamingRawContent = true;
        const MAX_SNIFF_SIZE = 4096;
        let sniffedBytes = 0;
        let sniffBuffer = Buffer.alloc(0);
        let totalBytesReceived = 0;

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

                if (isStreamingRawContent) {
                  const decodedChunk = decoder.decode(data, { stream: true });
                  headlessTerminal.write(decodedChunk, () => {
                    onOutputEvent({
                      type: 'data',
                      chunk: stripAnsiIfPresent(decodedChunk),
                    });
                    resolve();
                  });
                } else {
                  onOutputEvent({
                    type: 'binary_progress',
                    bytesReceived: totalBytesReceived,
                  });
                  resolve();
                }
              }),
          );
        };

        ptyProcess.onData((data: string) => {
          const bufferData = Buffer.from(data, 'utf-8');
          handleOutput(bufferData);
        });

        ptyProcess.onExit(
          ({ exitCode, signal }: { exitCode: number; signal?: number }) => {
            exited = true;
            abortSignal.removeEventListener('abort', abortHandler);

            const finalize = () => {
              const finalBuffer = Buffer.concat(outputChunks);

              const fullOutput = getFullText(headlessTerminal);
              resolve({
                rawOutput: finalBuffer,
                output: fullOutput,
                stdout: fullOutput, // For PTY, stdout and stderr are combined
                stderr: '', // PTY combines output streams
                exitCode,
                signal: signal ?? null,
                error,
                aborted: abortSignal.aborted,
                pid: ptyProcess.pid,
                executionMethod: ptyInfo?.name ?? 'node-pty',
              });
            };

            if (abortSignal.aborted) {
              finalize();
              return;
            }

            const processingComplete = processingChain.then(() => 'processed');
            const abortFired = new Promise<'aborted'>((res) => {
              if (abortSignal.aborted) {
                res('aborted');
                return;
              }
              abortSignal.addEventListener('abort', () => res('aborted'), {
                once: true,
              });
            });

            Promise.race([processingComplete, abortFired]).then(() => {
              finalize();
            });
          },
        );

        const abortHandler = async () => {
          if (ptyProcess.pid && !exited) {
            const pid = ptyProcess.pid;
            if (isWindows) {
              cpSpawn('taskkill', ['/pid', pid.toString(), '/f', '/t']);
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
          stdout: '',
          stderr: '',
          exitCode: 1,
          signal: null,
          aborted: false,
          pid: undefined,
          executionMethod: 'none',
        }),
      };
    }
  }
}
