/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import * as acquisition from '../acquisition/index.js';

/**
 * Acquisition package-boundary coverage.
 *
 * The shared acquisition layer must own bounded collection primitives and
 * LLxprt-owned read-loop adapters (HTTP, stream). It must NOT interpret raw
 * settings policy — that belongs in the owning core/CLI modules.
 *
 * These tests assert the public surface so accidental re-coupling is a
 * test failure, not a silent regression.
 */
describe('acquisition package boundary', () => {
  describe('primitives and collectors are exported', () => {
    it('exports createByteBudget', () => {
      expect(typeof acquisition.createByteBudget).toBe('function');
    });

    it('exports createDefaultByteBudget', () => {
      expect(typeof acquisition.createDefaultByteBudget).toBe('function');
    });

    it('exports BoundedStreamCollector', () => {
      expect(typeof acquisition.BoundedStreamCollector).toBe('function');
    });

    it('exports BoundedCombinedCollector', () => {
      expect(typeof acquisition.BoundedCombinedCollector).toBe('function');
    });

    it('exports budget constants', () => {
      expect(acquisition.ACQUISITION_HARD_MAX_BYTES).toBeGreaterThan(0);
      expect(acquisition.DEFAULT_ACQUISITION_BUDGET_BYTES).toBeGreaterThan(0);
    });
  });

  describe('HTTP adapter is exported from acquisition', () => {
    it('exports acquireBoundedHttpBody', () => {
      expect(typeof acquisition.acquireBoundedHttpBody).toBe('function');
    });

    it('exports disposeHttpResponseBody', () => {
      expect(typeof acquisition.disposeHttpResponseBody).toBe('function');
    });

    it('exports HttpBodyTooLargeError', () => {
      expect(typeof acquisition.HttpBodyTooLargeError).toBe('function');
    });
  });

  describe('raw settings policy is NOT in the acquisition surface', () => {
    it('does not export resolveByteBudgetFromSetting', () => {
      expect(acquisition).not.toHaveProperty('resolveByteBudgetFromSetting');
    });
  });
});
