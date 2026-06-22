/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'child_process';
import * as path from 'path';

export type CliRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

// Helper to run the CLI with given arguments
export async function runCli(
  args: string[],
  env: Partial<Record<string, string>> = {},
  input?: string,
): Promise<CliRunResult> {
  return new Promise((resolve) => {
    // Use the compiled CLI entry point
    const cliPath = path.join(process.cwd(), 'dist', 'index.js');

    const child = spawn('node', [cliPath, ...args], {
      env: {
        ...process.env,
        ...env,
        // Disable telemetry and other features that might interfere
        LLXPRT_TELEMETRY: 'false',
        LLXPRT_CLI_NO_RELAUNCH: 'true',
        // Set HOME to temp directory to isolate profile loading
        HOME: env.HOME ?? process.env.HOME ?? '',
        // Ensure providers are registered in test environment
        NODE_ENV: 'production',
        // Disable browser-based authentication for CI environments
        LLXPRT_NO_BROWSER_AUTH: 'true',
        CI: 'true',
      },
      cwd: process.cwd(),
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    if (input) {
      child.stdin.write(input);
      child.stdin.end();
    }

    // Add a timeout to prevent hanging tests
    const timeout = setTimeout(() => {
      child.kill();
      resolve({
        stdout,
        stderr,
        exitCode: -1,
      });
    }, 5000); // 5 second timeout - shorter for CI

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      });
    });
  });
}
