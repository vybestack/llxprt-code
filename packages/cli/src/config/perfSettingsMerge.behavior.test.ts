/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for the real settings merge pipeline as it applies to
 * telemetry.perf. Uses production mergeSettings code (no mocks) to prove
 * the actual precedence and merge semantics.
 *
 * EVIDENCE-AC2: persisted settings merge precedence for telemetry.perf.
 */

import { describe, it, expect } from 'bun:test';
import { mergeSettings } from './settingsMerge.js';
import type { Settings } from './settingsSchema.js';

function emptySettings(): Settings {
  return {} as Settings;
}

describe('telemetry.perf — real mergeSettings behavior', () => {
  describe('absent in all layers', () => {
    it('produces no perf key in merged telemetry', () => {
      const merged = mergeSettings(
        emptySettings(),
        emptySettings(),
        emptySettings(),
        emptySettings(),
        true,
      );
      expect(merged.telemetry.perf).toBeUndefined();
    });
  });

  describe('user-only perf', () => {
    it('user telemetry.perf.enabled flows through merge', () => {
      const user = {
        telemetry: { perf: { enabled: true } },
      } as Settings;
      const merged = mergeSettings(
        emptySettings(),
        emptySettings(),
        user,
        emptySettings(),
        true,
      );
      expect(merged.telemetry.perf).toStrictEqual({ enabled: true });
    });
  });

  describe('workspace overrides user (higher precedence)', () => {
    it('workspace telemetry.perf replaces user telemetry.perf (shallow merge at telemetry level)', () => {
      // The established merge behavior is shallow-spread for the telemetry
      // object section. This means a higher-precedence layer's perf object
      // replaces the lower-precedence one entirely (documented, not a defect).
      const user = {
        telemetry: { perf: { enabled: true } },
      } as Settings;
      const workspace = {
        telemetry: { perf: { memory: true } },
      } as Settings;
      const merged = mergeSettings(
        emptySettings(),
        emptySettings(),
        user,
        workspace,
        true,
      );
      // Shallow merge: workspace.perf replaces user.perf entirely
      expect(merged.telemetry.perf).toStrictEqual({ memory: true });
    });
  });

  describe('both layers set perf.enabled', () => {
    it('workspace perf.enabled wins over user perf.enabled', () => {
      const user = {
        telemetry: { perf: { enabled: false } },
      } as Settings;
      const workspace = {
        telemetry: { perf: { enabled: true } },
      } as Settings;
      const merged = mergeSettings(
        emptySettings(),
        emptySettings(),
        user,
        workspace,
        true,
      );
      expect(merged.telemetry.perf?.enabled).toBe(true);
    });
  });

  describe('telemetry scalar fields still merge across layers', () => {
    it('user telemetry.enabled and workspace telemetry.perf coexist', () => {
      const user = {
        telemetry: { enabled: true },
      } as Settings;
      const workspace = {
        telemetry: { perf: { enabled: true, memory: true } },
      } as Settings;
      const merged = mergeSettings(
        emptySettings(),
        emptySettings(),
        user,
        workspace,
        true,
      );
      expect(merged.telemetry.enabled).toBe(true);
      expect(merged.telemetry.perf).toStrictEqual({
        enabled: true,
        memory: true,
      });
    });
  });

  describe('untrusted workspace is ignored', () => {
    it('workspace telemetry.perf is not applied when isTrusted=false', () => {
      const workspace = {
        telemetry: { perf: { enabled: true } },
      } as Settings;
      const merged = mergeSettings(
        emptySettings(),
        emptySettings(),
        emptySettings(),
        workspace,
        false,
      );
      expect(merged.telemetry.perf).toBeUndefined();
    });
  });

  describe('system layer (highest file precedence)', () => {
    it('system telemetry.perf wins over user and workspace', () => {
      const system = {
        telemetry: { perf: { enabled: true, memory: true } },
      } as Settings;
      const workspace = {
        telemetry: { perf: { enabled: false } },
      } as Settings;
      const merged = mergeSettings(
        system,
        emptySettings(),
        emptySettings(),
        workspace,
        true,
      );
      expect(merged.telemetry.perf).toStrictEqual({
        enabled: true,
        memory: true,
      });
    });
  });

  describe('system defaults layer', () => {
    it('systemDefaults telemetry.perf is overridden by user telemetry.perf', () => {
      const systemDefaults = {
        telemetry: { perf: { enabled: true } },
      } as Settings;
      const user = {
        telemetry: { perf: { enabled: false, memory: false } },
      } as Settings;
      const merged = mergeSettings(
        emptySettings(),
        systemDefaults,
        user,
        emptySettings(),
        true,
      );
      expect(merged.telemetry.perf).toStrictEqual({
        enabled: false,
        memory: false,
      });
    });
  });
});
