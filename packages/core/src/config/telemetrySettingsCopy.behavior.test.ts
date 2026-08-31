/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for resolveTelemetrySettings copy isolation of the
 * nested perf sub-object. EVIDENCE-AC2: getTelemetrySettings must not leak
 * nested mutable state; resolveTelemetrySettings must not mutate caller.
 *
 * The resolved perf object is a defensive clone (not frozen). Copy isolation
 * is provided by cloning on ingress (resolveTelemetrySettings and
 * Config.updateTelemetrySettings) and on egress (Config.getTelemetrySettings).
 * Tests assert reference-separation and that cloning — not freezing — provides
 * isolation.
 */

import { describe, it, expect } from 'bun:test';
import { resolveTelemetrySettings } from './configConstructor.js';
import type { TelemetrySettings } from './configTypes.js';

describe('resolveTelemetrySettings — perf copy isolation', () => {
  it('returns a perf object that is a copy, not the caller reference', () => {
    const input: TelemetrySettings = {
      perf: { enabled: true, memory: false },
    };
    const resolved = resolveTelemetrySettings(input);
    expect(resolved.perf).toStrictEqual({ enabled: true, memory: false });
    expect(resolved.perf).not.toBe(input.perf);
  });

  it('the resolved perf is a mutable copy — isolation is by cloning, not freezing', () => {
    const input: TelemetrySettings = {
      perf: { enabled: true, memory: true },
    };
    const resolved = resolveTelemetrySettings(input);
    // Copy policy, not freeze: the resolved perf is not frozen.
    expect(Object.isFrozen(resolved.perf)).toBe(false);
    // Mutation succeeds (no throw), yet cloning still isolates the input.
    expect(() => {
      (resolved.perf as { enabled: boolean }).enabled = false;
    }).not.toThrow();
    expect(input.perf?.enabled).toBe(true);
  });

  it('mutations to the input perf after resolution do not affect the resolved copy', () => {
    const input: TelemetrySettings = {
      perf: { enabled: true, memory: false },
    };
    const resolved = resolveTelemetrySettings(input);
    input.perf!.enabled = false;
    expect(resolved.perf?.enabled).toBe(true);
  });

  it('does not mutate the caller settings object', () => {
    const input: TelemetrySettings = {
      enabled: true,
      perf: { enabled: true, memory: true },
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    resolveTelemetrySettings(input);
    expect(input).toStrictEqual(snapshot);
  });

  it('resolves undefined perf to undefined (absent, not a fabricated object)', () => {
    const resolved = resolveTelemetrySettings({ enabled: true });
    expect(resolved.perf).toBeUndefined();
  });

  it('preserves perf fields from input through resolution', () => {
    const input: TelemetrySettings = {
      perf: { enabled: true, memory: true },
    };
    const resolved = resolveTelemetrySettings(input);
    expect(resolved.perf).toStrictEqual({ enabled: true, memory: true });
  });
});
