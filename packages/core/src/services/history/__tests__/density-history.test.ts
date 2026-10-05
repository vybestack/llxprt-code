/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect, beforeEach } from 'bun:test';

import {
  observeDensityCase3,
  observeDensityCase4,
  observeDensityCase5,
  observeDensityCase6,
  observeDensityCase7,
  observeDensityCase8,
  observeDensityCase9,
  observeDensityCase10,
  observeDensityCase11,
  observeDensityCase12,
  observeDensityCase13,
  initializeDensityService,
} from './density-history-test-fixtures.js';
describe('HistoryService — Density Extensions', () => {
  beforeEach(initializeDensityService);
  describe('applyDensityResult — ordering', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-003.1, REQ-HD-003.2
     * @pseudocode history-service.md lines 58-70
     */
    it('applies replacements before removals', async () => {
      const { actual, expected0 } = await observeDensityCase3();
      expect(actual).toStrictEqual(expected0);
    });

    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-003.3
     * @pseudocode history-service.md lines 63-70
     */
    it('removes in reverse index order', async () => {
      const { actual, expected0 } = await observeDensityCase4();
      expect(actual).toStrictEqual(expected0);
    });

    it('handles removals-only (no replacements)', async () => {
      const { actual, expected0 } = await observeDensityCase5();
      expect(actual).toStrictEqual(expected0);
    });

    it('handles replacements-only (no removals)', async () => {
      const { actual, expected0 } = await observeDensityCase6();
      expect(actual).toStrictEqual(expected0);
    });

    it('handles empty result (no-op)', async () => {
      const { actual, expected0 } = await observeDensityCase7();
      expect(actual).toStrictEqual(expected0);
    });
  });
  describe('applyDensityResult — validation', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-001.6
     * @pseudocode history-service.md lines 33-38
     */
    it('rejects conflicting index in removals and replacements', async () => {
      const { actual, expected0 } = await observeDensityCase8();
      expect(actual).toMatchObject(expected0);
    });

    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-001.7
     * @pseudocode history-service.md lines 41-46
     */
    it('rejects removal index out of bounds', async () => {
      const { actual, expected0 } = await observeDensityCase9();
      expect(actual).toMatchObject(expected0);
    });

    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-001.7
     * @pseudocode history-service.md lines 49-54
     */
    it('rejects replacement index out of bounds', async () => {
      const { actual, expected0 } = await observeDensityCase10();
      expect(actual).toMatchObject(expected0);
    });

    /**
     * @requirement REQ-HD-001.7
     */
    it('rejects negative removal index', async () => {
      const { actual, expected0 } = await observeDensityCase11();
      expect(actual).toMatchObject(expected0);
    });

    /**
     * @pseudocode history-service.md lines 25-30
     */
    it('rejects duplicate removal indices', async () => {
      const { actual, expected0 } = await observeDensityCase12();
      await expect(actual).rejects.toThrow(expected0);
    });
  });
  describe('applyDensityResult — token recalculation', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-003.4
     * @pseudocode history-service.md lines 81-82
     */
    it('triggers token recalculation after mutation', async () => {
      expect(await observeDensityCase13()).toBeGreaterThan(0);
    });
  });
});
