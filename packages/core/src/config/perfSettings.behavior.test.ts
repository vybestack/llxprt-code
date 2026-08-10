/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for resolvePerfSettings and the perf-related
 * TelemetrySettings resolution. EVIDENCE-AC2: default-off, master-gates-memory,
 * input immutability, and nested-return copy isolation.
 */

import { describe, it, expect } from 'bun:test';
import { resolvePerfSettings } from './configConstructor.js';
import type { TelemetrySettings } from './configTypes.js';

describe('resolvePerfSettings', () => {
  describe('default-off (absent settings)', () => {
    it('resolves undefined to fully disabled', () => {
      expect(resolvePerfSettings(undefined)).toEqual({
        enabled: false,
        memory: false,
      });
    });

    it('resolves an empty object to fully disabled', () => {
      expect(resolvePerfSettings({})).toEqual({
        enabled: false,
        memory: false,
      });
    });

    it('resolves a telemetry object with no perf key to fully disabled', () => {
      const settings: TelemetrySettings = { enabled: true };
      expect(resolvePerfSettings(settings)).toEqual({
        enabled: false,
        memory: false,
      });
    });

    it('resolves a telemetry object with an empty perf object to fully disabled', () => {
      const settings: TelemetrySettings = { perf: {} };
      expect(resolvePerfSettings(settings)).toEqual({
        enabled: false,
        memory: false,
      });
    });
  });

  describe('enabled only (master on, memory omitted)', () => {
    it('resolves enabled:true, memory absent to { enabled: true, memory: false }', () => {
      const settings: TelemetrySettings = { perf: { enabled: true } };
      expect(resolvePerfSettings(settings)).toEqual({
        enabled: true,
        memory: false,
      });
    });
  });

  describe('memory gated off (master off, memory on)', () => {
    it('resolves enabled:false, memory:true to fully disabled (master gates memory)', () => {
      const settings: TelemetrySettings = {
        perf: { enabled: false, memory: true },
      };
      expect(resolvePerfSettings(settings)).toEqual({
        enabled: false,
        memory: false,
      });
    });

    it('resolves enabled absent, memory:true to fully disabled (master gates memory)', () => {
      const settings: TelemetrySettings = { perf: { memory: true } };
      expect(resolvePerfSettings(settings)).toEqual({
        enabled: false,
        memory: false,
      });
    });
  });

  describe('both on', () => {
    it('resolves enabled:true, memory:true to { enabled: true, memory: true }', () => {
      const settings: TelemetrySettings = {
        perf: { enabled: true, memory: true },
      };
      expect(resolvePerfSettings(settings)).toEqual({
        enabled: true,
        memory: true,
      });
    });
  });

  describe('false overrides', () => {
    it('resolves enabled:false, memory:false to fully disabled', () => {
      const settings: TelemetrySettings = {
        perf: { enabled: false, memory: false },
      };
      expect(resolvePerfSettings(settings)).toEqual({
        enabled: false,
        memory: false,
      });
    });

    it('resolves enabled:true, memory:false to enabled without memory', () => {
      const settings: TelemetrySettings = {
        perf: { enabled: true, memory: false },
      };
      expect(resolvePerfSettings(settings)).toEqual({
        enabled: true,
        memory: false,
      });
    });
  });

  describe('input immutability', () => {
    it('does not mutate the caller settings object', () => {
      const settings: TelemetrySettings = {
        perf: { enabled: true, memory: true },
      };
      const snapshot = JSON.parse(JSON.stringify(settings));
      resolvePerfSettings(settings);
      expect(settings).toEqual(snapshot);
    });

    it('does not mutate the perf sub-object', () => {
      const perf = { enabled: true, memory: true };
      const settings: TelemetrySettings = { perf };
      resolvePerfSettings(settings);
      expect(perf).toEqual({ enabled: true, memory: true });
    });

    it('does not mutate a settings object with enabled:false, memory:true', () => {
      const settings: TelemetrySettings = {
        perf: { enabled: false, memory: true },
      };
      const snapshot = JSON.parse(JSON.stringify(settings));
      resolvePerfSettings(settings);
      expect(settings).toEqual(snapshot);
    });
  });

  describe('nested-return copy isolation', () => {
    it('returns a fresh object whose mutation does not affect subsequent calls', () => {
      const settings: TelemetrySettings = {
        perf: { enabled: true, memory: true },
      };
      const result1 = resolvePerfSettings(settings);
      result1.enabled = false;
      result1.memory = false;
      const result2 = resolvePerfSettings(settings);
      expect(result2).toEqual({ enabled: true, memory: true });
    });

    it('returns primitive booleans (no shared reference to input perf)', () => {
      const perf = { enabled: true, memory: false };
      const settings: TelemetrySettings = { perf };
      const result = resolvePerfSettings(settings);
      // The returned object is a new object; mutating it does not change the input
      result.enabled = false;
      expect(perf.enabled).toBe(true);
      expect(settings.perf?.enabled).toBe(true);
    });
  });

  describe('return type safety', () => {
    it('always returns enabled as a boolean', () => {
      const cases: Array<TelemetrySettings | undefined> = [
        undefined,
        {},
        { perf: {} },
        { perf: { enabled: true } },
        { perf: { enabled: false } },
        { perf: { enabled: true, memory: true } },
      ];
      for (const settings of cases) {
        const result = resolvePerfSettings(settings);
        expect(typeof result.enabled).toBe('boolean');
        expect(typeof result.memory).toBe('boolean');
      }
    });
  });
});
