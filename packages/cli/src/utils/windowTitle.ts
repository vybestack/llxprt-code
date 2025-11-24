/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Computes the window title for the LLxprt CLI application.
 *
 * @param folderName - The name of the current folder/workspace to display in the title
 * @returns The computed window title, either from CLI_TITLE environment variable or the default LLxprt title
 */
export function computeWindowTitle(folderName: string): string {
  const title = process.env['CLI_TITLE'] || `LLxprt - ${folderName}`;

  // Remove control characters that could cause issues in terminal titles
  return title.replace(
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1F\x7F]/g,
    '',
  );
}
