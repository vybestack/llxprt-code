/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '../../../packages/core/src/services/history/HistoryService.js';
import { exportSummaryRow } from '../../../packages/core/src/services/history/export-summary-test-helpers.js';
import { suffixSeeder } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';

export function seedRows(history: HistoryService, size: number): Promise<void> {
  return suffixSeeder(history)(
    Array.from({ length: size }, (_, index) => exportSummaryRow(index)),
  );
}
