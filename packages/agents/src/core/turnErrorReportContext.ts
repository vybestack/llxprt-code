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
 */
export function buildErrorReportContext(
  history: readonly IContent[],
  request: string | object | readonly unknown[],
): Record<string, unknown> {
  return {
    request,
    recentHistory: history.slice(-TURN_REPORT_HISTORY_TAIL),
    omittedHistoryCount: Math.max(0, history.length - TURN_REPORT_HISTORY_TAIL),
  };
}
