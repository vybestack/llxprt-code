/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

const TURN_REPORT_HISTORY_TAIL = 8;

/**
 * @plan PLAN-20260807-ISSUE3113.P06
 * @requirement REQ-3113-1.1
 * @pseudocode lines 300-322
 * Adds endpoint diagnostics for error reports (@issue #2231).
 */
export async function buildErrorReportContext(
  history: Iterable<IContent> | AsyncIterable<IContent>,
  request: string | object | readonly unknown[],
  baseUrl?: string,
): Promise<Record<string, unknown>> {
  let recentHistory: readonly IContent[] = [];
  let count = 0;
  for await (const row of history) {
    recentHistory = [
      ...recentHistory.slice(-(TURN_REPORT_HISTORY_TAIL - 1)),
      row,
    ];
    count++;
  }
  return {
    request,
    recentHistory,
    omittedHistoryCount: Math.max(0, count - TURN_REPORT_HISTORY_TAIL),
    ...(baseUrl === undefined ? {} : { baseUrl }),
  };
}
