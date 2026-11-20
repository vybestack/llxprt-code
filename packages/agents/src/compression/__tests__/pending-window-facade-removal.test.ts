/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { CompressionHandler } from '../CompressionHandler.js';
import * as builders from '../compressionContextBuilder.js';
describe('pending-window eager facade removal', () => {
  it('exposes no eager curated or compression-context array facade', () => {
    expect('getCurated' in HistoryService.prototype).toBe(false);
    expect('buildCompressionContext' in CompressionHandler.prototype).toBe(
      false,
    );
    expect('buildCompressionContext' in builders).toBe(false);
  });
});
