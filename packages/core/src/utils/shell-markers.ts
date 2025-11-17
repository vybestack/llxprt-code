/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Removes runtime marker lines injected for subcommand tracking.
 * These markers are added by the shell tool to enable precise "Running: ..." display
 * in the CLI UI, but should be filtered from both user-facing output and model-facing content.
 *
 * @param text The text containing potential marker lines
 * @returns The text with all __LLXPRT_CMD__: marker lines removed
 */
export function stripShellMarkers(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('__LLXPRT_CMD__:'))
    .join('\n')
    .trimEnd();
}
