/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

export function setupHistoryServices(): () => HistoryService {
  const histories: HistoryService[] = [];
  afterEach(async () => {
    for (const history of histories.splice(0)) await history.dispose();
  });
  return () => {
    const history = new HistoryService();
    histories.push(history);
    return history;
  };
}
