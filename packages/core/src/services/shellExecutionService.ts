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

function needsShell(command: string): boolean {
  // Detect shell operators and substitutions
  return /[|;&><]/.test(command) || /(\$\(|`)/.test(command);
}

function pickUserShell(): {
  shell: string;
  argsFor(command: string): string[];
} {
  const platform = os.platform();
  if (platform === 'win32') {
    // Prefer PowerShell if detectable, else cmd.exe
    const isPowerShell =
      /powershell/i.test(process.env.ComSpec || '') ||
      !!process.env.PSModulePath;
    if (isPowerShell) {
      return {
        shell: 'powershell.exe',
        argsFor: (cmd: string) => [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          cmd,
        ],
      };
    }
    return {
      shell: 'cmd.exe',
      argsFor: (cmd: string) => ['/d', '/s', '/c', cmd],
    };
  }
  const userShell = process.env.SHELL || 'bash';
  return { shell: userShell, argsFor: (cmd: string) => ['-c', cmd] };
}

export class ShellExecutionService {
  static execute(
    commandToExecute: string,
    cwd: string,
    onOutputEvent: (event: ShellOutputEvent) => void,
    abortSignal: AbortSignal,
  ): ShellExecutionHandle {
    const isWindows = os.platform() === 'win32';

    // Choose execution strategy: use a shell only when necessary
    const { shell, argsFor } = pickUserShell();
    const useShell = needsShell(commandToExecute);

    const child = spawn(
      useShell ? shell : commandToExecute.split(/\s+/)[0],
      useShell
        ? argsFor(commandToExecute)
        : commandToExecute.split(/\s+/).slice(1),
      {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: !isWindows,
        env: { ...process.env, LLXPRT_CLI: '1' },
        shell: false,
      },
    );

    const result = new Promise<ShellExecutionResult>((resolve) => {
      // Determine encoding once per process
      const encoding = getSystemEncoding() || 'utf-8';
      const stdoutDecoder = new TextDecoder(encoding);
      const stderrDecoder = new TextDecoder(encoding);

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
