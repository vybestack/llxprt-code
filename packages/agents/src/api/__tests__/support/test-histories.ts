import { ScratchRootOwner } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
const historyScratchRoots = new ScratchRootOwner();

export function trackTestHistories(): () => HistoryService {
  const histories = new Set<HistoryService>();
  afterEach(async () => {
    for (const history of histories) await history.dispose();
    histories.clear();
  });
  return () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    histories.add(history);
    return history;
  };
}
