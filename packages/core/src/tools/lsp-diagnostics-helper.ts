/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import type { Config } from '../config/config.js';

/**
 * Timeout for LSP diagnostics collection to prevent hanging on unresponsive LSP servers.
 */
const LSP_DIAGNOSTICS_TIMEOUT_MS = 5000;

/**
 * Collects LSP diagnostics for a file and formats them for LLM consumption.
 *
 * @plan PLAN-20250212-LSP.P31
 * @requirement REQ-DIAG-010
 *
 * This helper:
 * - Checks if LSP client is alive
 * - Calls checkFile() with a timeout to prevent hangs
 * - Filters diagnostics by configured severities
 * - Limits diagnostics per maxDiagnosticsPerFile
 * - Formats with <diagnostics> XML tags
 * - Returns null if no diagnostics or LSP unavailable
 *
 * The caller should wrap this in try-catch to satisfy REQ-GRACE-050/055.
 *
 * @param config - The Config instance to get LSP client and settings
 * @param absolutePath - The absolute path of the file to check
 * @returns Formatted diagnostics block or null if none
 */
export async function collectLspDiagnosticsBlock(
  config: Config,
  absolutePath: string,
): Promise<string | null> {
  const lspClient = config.getLspServiceClient();
  if (!lspClient || !lspClient.isAlive()) {
    return null;
  }

  // Wrap checkFile in a timeout to prevent indefinite hangs
  const diagnosticsPromise = lspClient.checkFile(absolutePath);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error('LSP diagnostics timeout')),
      LSP_DIAGNOSTICS_TIMEOUT_MS,
    ),
  );

  const diagnostics = await Promise.race([diagnosticsPromise, timeoutPromise]);

  const lspConfig = config.getLspConfig();
  const includeSeverities = lspConfig?.includeSeverities ?? ['error'];
  const filtered = diagnostics.filter((d) =>
    includeSeverities.includes(d.severity),
  );

  if (filtered.length === 0) {
    return null;
  }

  const maxPerFile = lspConfig?.maxDiagnosticsPerFile ?? 20;
  const relPath = path.relative(config.getTargetDir(), absolutePath);
  const limited = filtered
    .sort(
      (a, b) =>
        (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0),
    )
    .slice(0, maxPerFile);

  // Build severity-reflective header based on actual severities present
  const severitiesPresent = [...new Set(limited.map((d) => d.severity))];
  const severityLabel =
    severitiesPresent.length === 1 ? `${severitiesPresent[0]}s` : 'diagnostics';

  const diagLines = limited
    .map((d) => {
      const codeStr = d.code !== undefined ? ` (${d.code})` : '';
      return `${d.severity.toUpperCase()} [${d.line ?? 1}:${d.column ?? 1}] ${d.message}${codeStr}`;
    })
    .join('\n');

  const suffix =
    filtered.length > maxPerFile
      ? `\n... and ${filtered.length - maxPerFile} more`
      : '';

  // Return without leading \n\n - caller uses join('\n\n') to separate parts
  return `LSP ${severityLabel} detected in this file, please fix:\n<diagnostics file="${relPath}">\n${diagLines}${suffix}\n</diagnostics>`;
}
