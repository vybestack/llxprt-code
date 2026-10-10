/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

export function installHistoryDensityTracking(
  history: HistoryService,
  markDirty: () => void,
  marker: symbol,
): (() => void) | undefined {
  if (typeof history.add !== 'function') return undefined;
  if (Reflect.get(history, marker) === true) return undefined;
  const originalAdd = history.add.bind(history);
  history.add = (...args: Parameters<typeof originalAdd>) => {
    const result = originalAdd(...args);
    markDirty();
    return result;
  };
  Reflect.set(history, marker, true);
  return () => {
    history.add = originalAdd;
    Reflect.deleteProperty(history, marker);
  };
}
