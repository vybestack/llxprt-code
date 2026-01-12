/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Relaunch utilities for the CLI.
 * Handles spawning child processes with modified arguments/environment.
 */

import { spawn } from 'node:child_process';

/**
 * Sanitize NODE_OPTIONS to remove --localstorage-file flags that may cause warnings.
 * Node emits a warning when --localstorage-file is present without a valid path.
 * This can happen when IDEs like VSCode set NODE_OPTIONS in the environment.
 *
 * @param nodeOptions - The NODE_OPTIONS environment variable value
 * @returns Sanitized NODE_OPTIONS string, or undefined if empty
 */
export function sanitizeNodeOptions(
  nodeOptions: string | undefined,
): string | undefined {
  if (!nodeOptions) return undefined;
  const sanitized = nodeOptions
    .replace(/\s*--localstorage-file(?:(?:\s*=\s*|\s+)(?!-)\S+)?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || undefined;
}

/**
 * Relaunch the current application in a child process with additional Node.js arguments.
 * This is used to restart with higher memory limits or enter sandboxed environments.
 *
 * The child process inherits stdio for seamless I/O, and receives an environment
 * variable to prevent infinite relaunch loops.
 *
 * @param additionalArgs - Additional Node.js arguments (e.g., --max-old-space-size=4096)
 * @returns Promise that resolves to the child process exit code
 */
export async function relaunchAppInChildProcess(
  additionalArgs: string[],
): Promise<number> {
  const nodeArgs = [...additionalArgs, ...process.argv.slice(1)];
  const sanitizedNodeOptions = sanitizeNodeOptions(process.env.NODE_OPTIONS);
  const newEnv: Record<string, string | undefined> = {
    ...process.env,
    LLXPRT_CODE_NO_RELAUNCH: 'true',
    NODE_OPTIONS: sanitizedNodeOptions,
  };

  const child = spawn(process.execPath, nodeArgs, {
    stdio: 'inherit',
    env: newEnv,
  });

  return new Promise((resolve) => {
    child.on('close', (code) => {
      resolve(code ?? 0);
    });
  });
}
