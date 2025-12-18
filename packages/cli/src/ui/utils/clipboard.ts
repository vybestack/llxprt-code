/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { copyToClipboard } from './commandUtils.js';

/**
 * Result of a clipboard copy operation.
 * Issue #885: Provides feedback on copy success/failure for better error handling.
 */
export interface CopyResult {
  /** Whether the copy was successful */
  success: boolean;
  /** The text that was copied (or attempted to be copied) */
  text: string;
  /** Error message if the copy failed */
  error?: string;
}

export function buildOsc52(text: string): string {
  const base64 = Buffer.from(text).toString('base64');
  const osc52 = `\u001b]52;c;${base64}\u0007`;
  if (process.env.TMUX) {
    return `\u001bPtmux;\u001b${osc52}\u001b\\`;
  }
  return osc52;
}

export function writeOsc52ToTerminal(
  text: string,
  stdout: NodeJS.WriteStream = process.stdout,
): void {
  if (text.length === 0) return;
  try {
    stdout.write(buildOsc52(text));
  } catch {
    // ignore terminal write failures
  }
}

/**
 * Copy text to the system clipboard.
 * Issue #885: Returns a result object indicating success/failure for better error handling.
 *
 * @param text - The text to copy
 * @param stdout - The stdout stream to use for OSC52 (default: process.stdout)
 * @returns CopyResult indicating success/failure
 */
export async function copyTextToClipboard(
  text: string,
  stdout: NodeJS.WriteStream = process.stdout,
): Promise<CopyResult> {
  if (text.length === 0) {
    return { success: true, text };
  }

  // First attempt OSC52 (terminal escape sequence)
  writeOsc52ToTerminal(text, stdout);

  // Then attempt system clipboard
  try {
    await copyToClipboard(text);
    return { success: true, text };
  } catch (err) {
    // System clipboard failed, but OSC52 was still attempted
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown clipboard error';
    return { success: false, text, error: errorMessage };
  }
}
