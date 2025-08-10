/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'child_process';
import { TextDecoder } from 'util';
import os from 'os';
import stripAnsi from 'strip-ansi';
import { getSystemEncoding } from '../utils/systemEncoding.js';
import { isBinary } from '../utils/textUtils.js';

const SIGKILL_TIMEOUT_MS = 200;
// Maximum output size to keep in memory (10MB) to prevent OOM errors
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;
// Maximum string accumulation (5MB) to prevent string concatenation OOM
const MAX_STRING_SIZE = 5 * 1024 * 1024;

/** A structured result from a shell command execution. */
export interface ShellExecutionResult {
  rawOutput: Buffer;
  output: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error: Error | null;
  aborted: boolean;
  pid: number | undefined;
}

export interface ShellExecutionHandle {
  pid: number | undefined;
  result: Promise<ShellExecutionResult>;
}

export type ShellOutputEvent =
  | { type: 'data'; stream: 'stdout' | 'stderr'; chunk: string }
  | { type: 'binary_detected' }
  | { type: 'binary_progress'; bytesReceived: number };

export class ShellExecutionService {
  static execute(
    commandToExecute: string,
    cwd: string,
    onOutputEvent: (event: ShellOutputEvent) => void,
    abortSignal: AbortSignal,
  ): ShellExecutionHandle {
    const isWindows = os.platform() === 'win32';

    // On Windows, always use shell mode for simplicity and compatibility
    // On Unix-like systems, use bash
    const child = spawn(commandToExecute, [], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Use bash unless in Windows (since it doesn't support bash).
      // For windows, just use the default.
      shell: isWindows ? true : 'bash',
      // Use process groups on non-Windows for robust killing.
      // Windows process termination is handled by `taskkill /t`.
      detached: !isWindows,
      env: {
        ...process.env,
        LLXPRT_CLI: '1',
      },
    });

    const result = new Promise<ShellExecutionResult>((resolve) => {
      // Determine encoding once per process
      const encoding = getSystemEncoding() || 'utf-8';
      // Use 'fatal: false' to avoid throwing on invalid sequences
      // This will insert replacement characters (U+FFFD) for invalid bytes
      // but won't crash the process
      const stdoutDecoder = new TextDecoder(encoding, { fatal: false });
      const stderrDecoder = new TextDecoder(encoding, { fatal: false });

      let stdout = '';
      let stderr = '';
      const outputChunks: Buffer[] = [];
      let totalOutputSize = 0;
      let outputTruncated = false;
      let error: Error | null = null;
      let exited = false;

      let isStreamingRawContent = true;
      const MAX_SNIFF_SIZE = 4096;
      let sniffedBytes = 0;

      const handleOutput = (data: Buffer, stream: 'stdout' | 'stderr') => {
        // Check if we've exceeded max output size
        if (totalOutputSize + data.length > MAX_OUTPUT_SIZE) {
          outputTruncated = true;
          // Only keep data up to the limit
          const remainingSpace = MAX_OUTPUT_SIZE - totalOutputSize;
          if (remainingSpace > 0) {
            data = data.slice(0, remainingSpace);
            outputChunks.push(data);
            totalOutputSize += data.length;
          }
          // Stop processing more output
          return;
        }

        outputChunks.push(data);
        totalOutputSize += data.length;

        if (isStreamingRawContent && sniffedBytes < MAX_SNIFF_SIZE) {
          const sniffBuffer = Buffer.concat(outputChunks.slice(0, 20));
          sniffedBytes = sniffBuffer.length;
          if (isBinary(sniffBuffer)) {
            isStreamingRawContent = false;
            onOutputEvent({ type: 'binary_detected' });
          }
        }

        const decodedChunk =
          stream === 'stdout'
            ? stdoutDecoder.decode(data, { stream: true })
            : stderrDecoder.decode(data, { stream: true });
        const strippedChunk = stripAnsi(decodedChunk);

        // Prevent string concatenation OOM
        if (stream === 'stdout' && stdout.length < MAX_STRING_SIZE) {
          const remaining = MAX_STRING_SIZE - stdout.length;
          stdout += strippedChunk.slice(0, remaining);
        } else if (stream === 'stderr' && stderr.length < MAX_STRING_SIZE) {
          const remaining = MAX_STRING_SIZE - stderr.length;
          stderr += strippedChunk.slice(0, remaining);
        }

        if (isStreamingRawContent) {
          onOutputEvent({ type: 'data', stream, chunk: strippedChunk });
        } else {
          const totalBytes = outputChunks.reduce((sum, c) => sum + c.length, 0);
          onOutputEvent({ type: 'binary_progress', bytesReceived: totalBytes });
        }
      };

      child.stdout.on('data', (data) => handleOutput(data, 'stdout'));
      child.stderr.on('data', (data) => handleOutput(data, 'stderr'));
      child.on('error', (err) => {
        const { stdout, stderr, finalBuffer } = cleanup();
        error = err;
        resolve({
          error,
          stdout,
          stderr,
          rawOutput: finalBuffer,
          output: stdout + (stderr ? `\n${stderr}` : ''),
          exitCode: 1,
          signal: null,
          aborted: false,
          pid: child.pid,
        });
      });

      const abortHandler = async () => {
        if (child.pid && !exited) {
          if (isWindows) {
            spawn('taskkill', ['/pid', child.pid.toString(), '/f', '/t']);
          } else {
            try {
              process.kill(-child.pid, 'SIGTERM');
              await new Promise((res) => setTimeout(res, SIGKILL_TIMEOUT_MS));
              if (!exited) process.kill(-child.pid, 'SIGKILL');
            } catch (_e) {
              if (!exited) child.kill('SIGKILL');
            }
          }
        }
      };

      abortSignal.addEventListener('abort', abortHandler, { once: true });

      child.on('exit', (code: number, signal: NodeJS.Signals) => {
        const { stdout, stderr, finalBuffer } = cleanup();

        resolve({
          rawOutput: finalBuffer,
          output: stdout + (stderr ? `\n${stderr}` : ''),
          stdout,
          stderr,
          exitCode: code,
          signal,
          error,
          aborted: abortSignal.aborted,
          pid: child.pid,
        });
      });

      /**
       * Cleans up a process (and it's accompanying state) that is exiting or
       * erroring and returns output formatted output buffers and strings
       */
      function cleanup() {
        exited = true;
        abortSignal.removeEventListener('abort', abortHandler);
        if (stdoutDecoder && stdout.length < MAX_STRING_SIZE) {
          const decoded = stripAnsi(stdoutDecoder.decode());
          const remaining = MAX_STRING_SIZE - stdout.length;
          stdout += decoded.slice(0, remaining);
        }
        if (stderrDecoder && stderr.length < MAX_STRING_SIZE) {
          const decoded = stripAnsi(stderrDecoder.decode());
          const remaining = MAX_STRING_SIZE - stderr.length;
          stderr += decoded.slice(0, remaining);
        }

        const finalBuffer = Buffer.concat(outputChunks);

        // Add truncation warning if output was truncated
        if (outputTruncated) {
          const warning =
            '\n... (output truncated to prevent memory overflow) ...';
          if (stdout.length < MAX_STRING_SIZE) {
            stdout += warning;
          }
        }

        return { stdout, stderr, finalBuffer };
      }
    });

    return { pid: child.pid, result };
  }
}
