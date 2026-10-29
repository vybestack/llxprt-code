/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi } from 'bun:test';
import type { CompressionIndexedRows } from '@vybestack/llxprt-code-core/services/history/compressionInput.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export function installPinnedCandidateValues(
  rows: CompressionIndexedRows,
  values: readonly IContent[],
): void {
  const readRow = rows.readRow.bind(rows);
  vi.spyOn(rows, 'readRow').mockImplementation(async (index) => {
    await readRow(0);
    return values[index];
  });
  Object.defineProperty(rows, 'length', {
    configurable: true,
    get: () => values.length,
  });
  if ('sourceOrdinalAt' in rows) {
    Object.defineProperty(rows, 'sourceOrdinalAt', {
      configurable: true,
      value: () => undefined,
    });
  }
}
