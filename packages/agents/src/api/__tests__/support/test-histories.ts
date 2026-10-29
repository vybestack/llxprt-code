/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

export function trackTestHistories(): () => HistoryService {
  const histories = new Set<HistoryService>();
  afterEach(async () => {
    for (const history of histories) await history.dispose();
    histories.clear();
  });
  return () => {
    const history = new HistoryService();
    histories.add(history);
    return history;
  };
}
