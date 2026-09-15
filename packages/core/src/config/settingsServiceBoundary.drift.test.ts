/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Drift test: tools' SettingsServiceBoundary is a hand-declared structural
 * mirror of the real SettingsService in @vybestack/llxprt-code-settings
 * (tools cannot depend on that package, so the subset is declared exactly
 * once). This test lives in core — a package that sees BOTH — and fails at
 * typecheck time if the mirror's signatures drift from the owner's, and at
 * runtime if the mirrored methods disappear or change behavior shape
 * (#2534 review Finding 4).
 */

import { describe, it, expect } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { SettingsServiceBoundary } from '@vybestack/llxprt-code-tools';

/**
 * Structural assignment: if SettingsService ever stops satisfying the
 * boundary (method renamed, signature narrowed), compiling this file fails.
 */
function assertImplements<T>(_: T): void {
  // Compile-time enforcement only; no runtime work.
}

describe('SettingsServiceBoundary drift (tools mirror vs settings owner)', () => {
  it('a real SettingsService is assignable to the boundary', () => {
    const service: SettingsServiceBoundary = new SettingsService();
    assertImplements<SettingsServiceBoundary>(service);
  });

  it('the boundary members exist as functions on a real service instance', () => {
    const service = new SettingsService() as unknown as Record<string, unknown>;
    for (const member of ['get', 'set', 'getAllGlobalSettings']) {
      expect(typeof service[member]).toBe('function');
    }
  });

  it('the boundary members behave per contract on a real service', () => {
    const service: SettingsServiceBoundary = new SettingsService();

    // set(key, value) then get(key) returns the value.
    service.set('activeProvider', 'openai');
    service.set('theme', 'dark');
    expect(service.get('activeProvider')).toBe('openai');
    expect(service.get('theme')).toBe('dark');
    // Unknown keys yield undefined, not an error.
    expect(service.get('never-set')).toBeUndefined();

    // getAllGlobalSettings returns the full global record including the
    // keys set through the boundary.
    const globals = service.getAllGlobalSettings();
    expect(globals['activeProvider']).toBe('openai');
    expect(globals['theme']).toBe('dark');
    // The record is a fresh copy each call: mutating it must not leak
    // back into the service (tool-registry relies on reading, but the
    // contract "get all" must not hand out live state).
    globals['activeProvider'] = 'tampered';
    expect(service.get('activeProvider')).toBe('openai');
  });
});
