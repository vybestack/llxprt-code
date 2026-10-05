/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';

describe('raw history public cursor contract', () => {
  it('does not expose the removed raw array getter on the service', () => {
    const history = new HistoryService();
    try {
      expect('getRawHistory' in history).toBe(false);
      expect(typeof history.streamRawHistory).toBe('function');
    } finally {
      history.dispose();
    }
  });
});
