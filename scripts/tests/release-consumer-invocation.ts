/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';

export async function invokeConsumer(
  executable: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; input: string; timeout: number },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: executable.toLowerCase().endsWith('cmd.exe'),
    });
    let stdout = '';
    let stderr = '';
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new Error(`${executable}: consumer timed out`);
      if (process.platform === 'win32' && child.pid !== undefined) {
        const cleanup = spawn(
          'taskkill.exe',
          ['/pid', String(child.pid), '/t', '/f'],
          { stdio: 'ignore', windowsHide: true, timeout: 5000 },
        );
        cleanup.once('error', () => child.kill('SIGKILL'));
        cleanup.once('close', () => child.kill('SIGKILL'));
      } else {
        child.kill('SIGKILL');
      }
    }, options.timeout);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdin.once('error', (error) => {
      failure = error;
      child.kill('SIGKILL');
    });
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (signal)
        reject(new Error(`${executable}: consumer signal ${signal}`));
      else resolve({ status, stdout, stderr });
    });
    child.stdin.end(options.input);
  });
}
