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
      let error: Error | null = null;
      let exited = false;

      let isStreamingRawContent = true;
      const MAX_SNIFF_SIZE = 4096;
      let sniffedBytes = 0;

      const handleOutput = (data: Buffer, stream: 'stdout' | 'stderr') => {
        outputChunks.push(data);

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

        if (stream === 'stdout') stdout += strippedChunk;
        else stderr += strippedChunk;

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
        error = err;
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

      child.on('exit', (code, signal) => {
        exited = true;
        abortSignal.removeEventListener('abort', abortHandler);

        stdout += stripAnsi(stdoutDecoder.decode());
        stderr += stripAnsi(stderrDecoder.decode());

        const finalBuffer = Buffer.concat(outputChunks);

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
    });

    return { pid: child.pid, result };
  }
}
