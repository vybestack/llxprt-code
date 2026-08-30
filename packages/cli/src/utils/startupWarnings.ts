/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import os from 'os';
import { join as pathJoin } from 'node:path';
import { getErrorMessage } from '@vybestack/llxprt-code-core';
import { SSH_AGENT_EMPTY_WARNING } from './sandbox-ssh.js';

const warningsFilePath = pathJoin(os.tmpdir(), 'gemini-cli-warnings.txt');

/**
 * Returns the empty-SSH-agent warning when the sandbox supervisor handed the
 * condition across the host→container boundary via
 * `LLXPRT_SANDBOX_SSH_AGENT_EMPTY=1`, undefined otherwise. The flag is only
 * ever set by the supervisor; a non-sandbox run never sees it.
 */
export function getSandboxHandoffWarning(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.LLXPRT_SANDBOX_SSH_AGENT_EMPTY === '1') {
    return SSH_AGENT_EMPTY_WARNING;
  }
  return undefined;
}

export async function getStartupWarnings(): Promise<string[]> {
  try {
    await fs.access(warningsFilePath); // Check if file exists
    const warningsContent = await fs.readFile(warningsFilePath, 'utf-8');
    const warnings = warningsContent
      .split('\n')
      .filter((line) => line.trim() !== '');
    try {
      await fs.unlink(warningsFilePath);
    } catch {
      warnings.push('Warning: Could not delete temporary warnings file.');
    }
    return warnings;
  } catch (err: unknown) {
    // If fs.access throws, it means the file doesn't exist or is not accessible.
    // This is not an error in the context of fetching warnings, so return empty.
    // Only return an error message if it's not a "file not found" type error.
    // However, the original logic returned an error message for any fs.existsSync failure.
    // To maintain closer parity while making it async, we'll check the error code.
    // ENOENT is "Error NO ENTry" (file not found).
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return []; // File not found, no warnings to return.
    }
    // For other errors (permissions, etc.), return the error message.
    return [`Error checking/reading warnings file: ${getErrorMessage(err)}`];
  }
}
