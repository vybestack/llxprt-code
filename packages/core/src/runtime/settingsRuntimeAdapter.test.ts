/**
 * @plan PLAN-20260608-ISSUE1588.P06
 * @requirement TEST-ADAPTER-01 through TEST-ADAPTER-08
 *
 * Comprehensive adapter tests proving:
 * - activateSettingsRuntimeContext bridges settings singleton + runtime context
 * - deactivateSettingsRuntimeContext clears both
 * - Settings package register/reset alone does NOT affect runtime context
 * - Idempotent activation and double-deactivation behavior
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  activateSettingsRuntimeContext,
  deactivateSettingsRuntimeContext,
} from './settingsRuntimeAdapter.js';
import {
  peekActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
} from './providerRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  getSettingsService as getSettingsServiceCore,
  resetSettingsService as resetSettingsServiceCore,
} from '@vybestack/llxprt-code-settings';
import {
  registerSettingsService as registerSettingsServicePkg,
  resetSettingsService as resetSettingsServicePkg,
  getSettingsService as getSettingsServicePkg,
} from '@vybestack/llxprt-code-settings';

describe('settingsRuntimeAdapter', () => {
  beforeEach(() => {
    resetSettingsServiceCore();
    clearActiveProviderRuntimeContext();
  });

  // TEST-ADAPTER-01
  it('TEST-ADAPTER-01: activate creates ProviderRuntimeContext AND calls registerSettingsService', () => {
    const service = new SettingsService();

    activateSettingsRuntimeContext(service, 'adapter-01');

    // Runtime context is created and active
    const ctx = peekActiveProviderRuntimeContext();
    expect(ctx).not.toBeNull();
    expect(ctx!.settingsService).toBe(service);

    // Settings-package singleton returns the service
    const pkgService = getSettingsServicePkg();
    expect(pkgService).toBe(service);

    // Core singleton also returns the service
    const coreService = getSettingsServiceCore();
    expect(coreService).toBe(service);
  });

  // TEST-ADAPTER-02
  it('TEST-ADAPTER-02: deactivate clears context AND resets settings state', () => {
    const service = new SettingsService();
    activateSettingsRuntimeContext(service, 'adapter-02');

    // Precondition
    expect(peekActiveProviderRuntimeContext()).not.toBeNull();
    expect(getSettingsServicePkg()).toBe(service);

    deactivateSettingsRuntimeContext();

    // Runtime context is cleared
    expect(peekActiveProviderRuntimeContext()).toBeNull();

    // Settings-package singleton throws
    expect(() => getSettingsServicePkg()).toThrow(
      'No SettingsService registered',
    );
  });

  // TEST-ADAPTER-03
  it('TEST-ADAPTER-03: activate with s2 after s1 switches active context', () => {
    const s1 = new SettingsService();
    const s2 = new SettingsService();

    activateSettingsRuntimeContext(s1, 'first');
    activateSettingsRuntimeContext(s2, 'second');

    const ctx = peekActiveProviderRuntimeContext();
    expect(ctx).not.toBeNull();
    expect(ctx!.settingsService).toBe(s2);
    expect(ctx!.runtimeId).toBe('second');

    expect(getSettingsServicePkg()).toBe(s2);
    expect(getSettingsServiceCore()).toBe(s2);
  });

  // TEST-ADAPTER-04
  it('TEST-ADAPTER-04: settings registerSettingsService alone does NOT create ProviderRuntimeContext', () => {
    const service = new SettingsService();

    // Call settings-package register directly, without adapter
    registerSettingsServicePkg(service);

    // Settings package should return the service
    expect(getSettingsServicePkg()).toBe(service);

    // But NO runtime context should exist
    expect(peekActiveProviderRuntimeContext()).toBeNull();

    // Cleanup
    resetSettingsServicePkg();
  });

  // TEST-ADAPTER-05
  it('TEST-ADAPTER-05: settings resetSettingsService does NOT call clearActiveProviderRuntimeContext', () => {
    const service = new SettingsService();
    activateSettingsRuntimeContext(service, 'adapter-05');

    // Precondition: context is active
    expect(peekActiveProviderRuntimeContext()).not.toBeNull();

    // Call settings-package reset directly
    resetSettingsServicePkg();

    // Runtime context should STILL be active — settings reset does not clear it
    const ctx = peekActiveProviderRuntimeContext();
    expect(ctx).not.toBeNull();
    expect(ctx!.settingsService).toBe(service);

    // Cleanup
    clearActiveProviderRuntimeContext();
  });

  // TEST-ADAPTER-06
  it('TEST-ADAPTER-06: activate twice with same service is idempotent — second replaces first', () => {
    const service = new SettingsService();

    activateSettingsRuntimeContext(service, 'idempotent-1');
    activateSettingsRuntimeContext(service, 'idempotent-2');

    // Should have an active context with the same service
    const ctx = peekActiveProviderRuntimeContext();
    expect(ctx).not.toBeNull();
    expect(ctx!.settingsService).toBe(service);
    expect(ctx!.runtimeId).toBe('idempotent-2');

    // Settings singleton still returns the service
    expect(getSettingsServicePkg()).toBe(service);
  });

  // TEST-ADAPTER-07
  it('TEST-ADAPTER-07: deactivate when no context is active does not throw', () => {
    // No context active — should not throw
    expect(() => deactivateSettingsRuntimeContext()).not.toThrow();
    expect(peekActiveProviderRuntimeContext()).toBeNull();
  });

  // TEST-ADAPTER-08 structural test is verified by the enforcing scan script,
  // not by a runtime test. This test verifies the adapter file's role.
  it('TEST-ADAPTER-08: adapter is the sole bridge — providerRuntimeContext is settings-agnostic', async () => {
    // Read providerRuntimeContext source and verify it does NOT import settings functions
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sourcePath = path.join(
      import.meta.dirname,
      'providerRuntimeContext.ts',
    );
    const source = fs.readFileSync(sourcePath, 'utf-8');

    const forbiddenPatterns = [
      'SettingsService',
      'registerSettingsService',
      'resetSettingsService',
      'getSettingsService',
      '@vybestack/llxprt-code-settings',
    ];

    for (const pattern of forbiddenPatterns) {
      expect(
        source.includes(pattern),
        `providerRuntimeContext.ts must NOT contain "${pattern}"`,
      ).toBe(false);
    }
  });
});
