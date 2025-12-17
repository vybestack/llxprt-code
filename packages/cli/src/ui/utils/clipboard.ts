/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { copyToClipboard } from './commandUtils.js';

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

export async function copyTextToClipboard(
  text: string,
  stdout: NodeJS.WriteStream = process.stdout,
): Promise<void> {
  if (text.length === 0) return;
  writeOsc52ToTerminal(text, stdout);
  try {
    await copyToClipboard(text);
  } catch {
    // ignore copy failures; OSC52 will still have been attempted
  }
}
