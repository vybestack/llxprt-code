/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Renders the retained-history byte breakdown shown by `/perf memory`.
 *
 * `/perf` on its own answers "is memory growing". This answers "what is holding
 * it", in application terms — block types, tool names, and the individual tool
 * responses carrying the most bytes — so a large session can be traced to the
 * messages responsible instead of an object-class histogram.
 */

import {
  computeHistorySizeBreakdown,
  type HistorySizeBreakdown,
  type IContent,
} from '@vybestack/llxprt-code-core';

/** How many individual tool responses to list. */
const TOP_RESPONSES = 10;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const abs = Math.abs(bytes);
  const sign = bytes < 0 ? '-' : '';
  if (abs < 1024) return `${sign}${abs} B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(1)} KiB`;
  if (abs < 1024 * 1024 * 1024) {
    return `${sign}${(abs / (1024 * 1024)).toFixed(1)} MiB`;
  }
  return `${sign}${(abs / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function percent(part: number, whole: number): string {
  if (whole <= 0) return '0.0%';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/** Entries sorted by bytes descending, largest first. */
function sortedEntries(
  record: Readonly<Record<string, number>>,
): Array<[string, number]> {
  return Object.entries(record).sort((a, b) => b[1] - a[1]);
}

function renderBlockTypes(
  breakdown: HistorySizeBreakdown,
  lines: string[],
): void {
  lines.push('By block type:');
  const entries = sortedEntries(breakdown.bytesByBlockType);
  if (entries.length === 0) {
    lines.push('  (none)');
    return;
  }
  for (const [type, bytes] of entries) {
    const count = breakdown.countsByBlockType[type] ?? 0;
    lines.push(
      `  ${type.padEnd(16)}${formatBytes(bytes).padStart(11)}  ` +
        `${percent(bytes, breakdown.totalBytes).padStart(6)}  (${count} blocks)`,
    );
  }
}

function renderTools(breakdown: HistorySizeBreakdown, lines: string[]): void {
  const entries = sortedEntries(breakdown.bytesByToolName);
  if (entries.length === 0) {
    return;
  }
  lines.push('');
  lines.push('By tool:');
  for (const [tool, bytes] of entries) {
    lines.push(
      `  ${tool.padEnd(20)}${formatBytes(bytes).padStart(11)}  ` +
        `${percent(bytes, breakdown.totalBytes).padStart(6)}`,
    );
  }
}

function renderLargest(breakdown: HistorySizeBreakdown, lines: string[]): void {
  if (breakdown.largestToolResponses.length === 0) {
    return;
  }
  lines.push('');
  lines.push('Largest individual tool responses:');
  for (const response of breakdown.largestToolResponses) {
    lines.push(
      `  ${formatBytes(response.bytes).padStart(11)}  ` +
        `${response.toolName} (history #${response.historyIndex}, ` +
        `call ${response.callId})`,
    );
  }
}

/**
 * Formats the breakdown for a history array.
 *
 * Exported separately from the command so the rendering is testable without
 * constructing a CommandContext.
 */
export function formatHistoryMemoryBreakdown(
  history: readonly IContent[],
): string {
  const breakdown = computeHistorySizeBreakdown(history, TOP_RESPONSES);
  const lines: string[] = [];

  lines.push('History Memory (retained conversation)');
  lines.push('======================================');
  lines.push('');

  if (breakdown.itemCount === 0) {
    lines.push('History is empty.');
    return lines.join('\n');
  }

  lines.push(
    `Total: ${formatBytes(breakdown.totalBytes)} across ` +
      `${breakdown.itemCount} history items`,
  );
  lines.push('');

  renderBlockTypes(breakdown, lines);
  renderTools(breakdown, lines);
  renderLargest(breakdown, lines);

  lines.push('');
  lines.push(
    'Sizes are logical byte estimates of retained content. Under Bun a string ' +
      'built by concatenation stays a lazy rope until read, so the live heap ' +
      'can sit below these figures until that content is next materialized.',
  );

  return lines.join('\n');
}
