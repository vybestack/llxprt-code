/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect, beforeEach } from 'bun:test';

import { collectRawHistory } from '../../../test-utils/collect-raw-history.js';
import {
  densityFixture1_service,
  observeDensityCase14,
  observeDensityCase15,
  observeDensityCase16,
  observeDensityCase17,
  initializeDensityService,
} from './density-history-test-fixtures.js';
describe('HistoryService — Density Extensions', () => {
  beforeEach(initializeDensityService);
  describe('getRawHistory', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-003.5
     * @pseudocode history-service.md lines 10-15
     */
    it('returns the raw history array', async () => {
      const { actual, expected0 } = await observeDensityCase14();
      expect(actual).toBe(expected0);
    });

    /**
     * @requirement REQ-HD-003.5
     */
    it('returns entries that getCurated filters', async () => {
      expect(await observeDensityCase15()).toBe(false);
    });

    it('returns empty array for empty history', async () => {
      const raw = await collectRawHistory(densityFixture1_service);
      expect(raw).toHaveLength(0);
    });
  });
  describe('recalculateTotalTokens', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-003.6
     * @pseudocode history-service.md lines 90-120
     */
    it('updates totalTokens for current entries', async () => {
      const { actual, expected0 } = await observeDensityCase16();
      expect(actual).toBe(expected0);
    });

    /**
     * @requirement REQ-HD-003.6
     * @pseudocode history-service.md lines 94-118
     */
    it('serializes through tokenizerLock', async () => {
      expect(await observeDensityCase17()).toBeGreaterThanOrEqual(0);
    });
  });
});
