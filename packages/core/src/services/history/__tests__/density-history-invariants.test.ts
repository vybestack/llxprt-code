/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';

import {
  observeDensityCase18,
  observeDensityCase19,
  observeDensityCase20,
  observeDensityCase21,
  observeDensityCase22,
  observeDensityCase23,
  observeDensityCase24,
  initializeDensityService,
} from './density-history-test-fixtures.js';
describe('HistoryService — Density Extensions', () => {
  beforeEach(initializeDensityService);
  describe('property-based tests', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-003.1
     */
    it('history length after removal equals original minus removal count', async () => {
      const { property0, property1 } = await observeDensityCase18();
      await fc.assert(property0, property1);
    }, 60_000);

    /**
     * @requirement REQ-HD-003.1
     */
    it('non-removed non-replaced entries are unchanged (same reference)', async () => {
      const { property0, property1 } = await observeDensityCase19();
      await fc.assert(property0, property1);
    }, 60_000);

    /**
     * @requirement REQ-HD-003.1
     */
    it('replaced entries match the replacement content', async () => {
      const { property0, property1 } = await observeDensityCase20();
      await fc.assert(property0, property1);
    }, 60_000);

    /**
     * @requirement REQ-HD-001.6
     */
    it('all conflict combinations are caught (index in both removals and replacements)', async () => {
      const { property0, property1 } = await observeDensityCase21();
      await fc.assert(property0, property1);
    }, 60_000);

    /**
     * @requirement REQ-HD-003.5
     */
    it('getRawHistory length equals number of add() calls', async () => {
      const { property0, property1 } = await observeDensityCase22();
      await fc.assert(property0, property1);
    }, 60_000);

    /**
     * @requirement REQ-HD-001.7
     */
    it('out-of-bounds indices always throw regardless of history size', async () => {
      const { property0, property1 } = await observeDensityCase23();
      await fc.assert(property0, property1);
    }, 60_000);

    /**
     * @requirement REQ-HD-003.4
     */
    it('totalTokens is non-negative after any valid density operation', async () => {
      const { property0, property1 } = await observeDensityCase24();
      await fc.assert(property0, property1);
    }, 60_000);
  });
});
