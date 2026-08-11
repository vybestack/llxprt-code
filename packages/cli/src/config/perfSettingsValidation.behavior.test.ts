/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for settings validation of telemetry.perf.
 * Tests the actual Zod validation pipeline (no mocks) to prove
 * that the persisted shape is accepted/rejected correctly.
 *
 * EVIDENCE-AC2: settings validation acceptance/rejection for the perf object.
 */

import { describe, it, expect } from 'bun:test';
import { validateSettings } from './settings-validation.js';

describe('settings validation — telemetry.perf shape', () => {
  describe('accepted shapes', () => {
    it('accepts telemetry.perf as an object with enabled and memory booleans', () => {
      const result = validateSettings({
        telemetry: {
          perf: { enabled: true, memory: true },
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts telemetry.perf with only enabled', () => {
      const result = validateSettings({
        telemetry: {
          perf: { enabled: true },
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts telemetry.perf with only memory', () => {
      const result = validateSettings({
        telemetry: {
          perf: { memory: true },
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts telemetry.perf as an empty object', () => {
      const result = validateSettings({
        telemetry: {
          perf: {},
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts telemetry with both false booleans', () => {
      const result = validateSettings({
        telemetry: {
          perf: { enabled: false, memory: false },
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts telemetry without perf alongside other telemetry fields', () => {
      const result = validateSettings({
        telemetry: {
          enabled: true,
          logPrompts: true,
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('rejected shapes', () => {
    it('rejects telemetry.perf as a boolean true (D2: perf is NOT a boolean)', () => {
      const result = validateSettings({
        telemetry: {
          perf: true,
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects telemetry.perf as a boolean false (D2: perf is NOT a boolean)', () => {
      const result = validateSettings({
        telemetry: {
          perf: false,
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects telemetry.perf.enabled as a non-boolean', () => {
      const result = validateSettings({
        telemetry: {
          perf: { enabled: 'yes' },
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects telemetry.perf.memory as a non-boolean', () => {
      const result = validateSettings({
        telemetry: {
          perf: { memory: 1 },
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects telemetry.perf with unknown properties (additionalProperties: false)', () => {
      const result = validateSettings({
        telemetry: {
          perf: { enabled: true, extra: 'field' },
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects telemetry.perf as a string', () => {
      const result = validateSettings({
        telemetry: {
          perf: 'enabled',
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects telemetry.perf as a number', () => {
      const result = validateSettings({
        telemetry: {
          perf: 1,
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects telemetry.perf as an array', () => {
      const result = validateSettings({
        telemetry: {
          perf: [true],
        },
      });
      expect(result.success).toBe(false);
    });
  });
});
