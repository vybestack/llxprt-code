/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';

export async function invokeConsumer(
  executable: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; input: string; timeout: number },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const result = spawnSync(executable, args, {
    ...options,
    encoding: 'utf8',
    windowsHide: true,
    windowsVerbatimArguments: executable.toLowerCase().endsWith('cmd.exe'),
  });
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') throw new Error('consumer timed out');
    throw result.error;
  }
  if (result.signal) throw new Error(`consumer signal: ${result.signal}`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
