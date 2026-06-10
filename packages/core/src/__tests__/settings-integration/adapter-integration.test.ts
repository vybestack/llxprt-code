/**
 * @plan PLAN-20260608-ISSUE1588.P04b, P06
 * @requirement REQ-TEST-001.2, TEST-ADAPTER-01 through TEST-ADAPTER-05
 *
 * Core vertical-slice integration test for the settings runtime adapter.
 * Exercises activateSettingsRuntimeContext / deactivateSettingsRuntimeContext
 * directly (not through configConstructor) and asserts intended behavior:
 * activation registers the service so getSettingsService() returns it,
 * creates/sets the provider runtime context, deactivation clears context
 * and resets settings state, and reactivation switches the active service.
 *
 * Uses settings-package singleton helpers to verify bridging behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  activateSettingsRuntimeContext,
  deactivateSettingsRuntimeContext,
} from '../../runtime/settingsRuntimeAdapter.js';
import {
  SettingsService,
  getSettingsService,
  getSettingsService as getSettingsServicePkg,
  resetSettingsService,
} from '@vybestack/llxprt-code-settings';
import {
  peekActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
} from '../../runtime/providerRuntimeContext.js';

describe('Settings Runtime Adapter — vertical-slice integration', () => {
  beforeEach(() => {
    resetSettingsService();
    clearActiveProviderRuntimeContext();
  });

  it('activation registers the provided service so getSettingsService returns it', () => {
    const service = new SettingsService();

    activateSettingsRuntimeContext(service, 'test-runtime-1');

    // Core singleton should return the registered service
    const retrieved = getSettingsService();
    expect(retrieved).toBe(service);

    // Settings package singleton should also return the registered service
    const retrievedPkg = getSettingsServicePkg();
    expect(retrievedPkg).toBe(service);
  });

  it('activation creates and sets the provider runtime context', () => {
    const service = new SettingsService();

    activateSettingsRuntimeContext(service, 'test-runtime-2');

    const activeContext = peekActiveProviderRuntimeContext();
    expect(activeContext).not.toBeNull();
    expect(activeContext!.settingsService).toBe(service);
  });

  it('deactivation clears context and resets settings state after successful activation', () => {
    const service = new SettingsService();
    activateSettingsRuntimeContext(service, 'test-runtime-3');

    const preDeactivation = getSettingsService();
    expect(preDeactivation).toBe(service);
    expect(peekActiveProviderRuntimeContext()).not.toBeNull();

    deactivateSettingsRuntimeContext();

    const activeContext = peekActiveProviderRuntimeContext();
    expect(activeContext).toBeNull();

    expect(() => getSettingsService()).toThrow('No SettingsService registered');
    expect(() => getSettingsServicePkg()).toThrow(
      'No SettingsService registered',
    );
  });

  it('reactivation switches the active service and context', () => {
    const service1 = new SettingsService();
    const service2 = new SettingsService();

    activateSettingsRuntimeContext(service1, 'runtime-first');
    activateSettingsRuntimeContext(service2, 'runtime-second');

    const activeContext = peekActiveProviderRuntimeContext();
    expect(activeContext).not.toBeNull();
    expect(activeContext!.settingsService).toBe(service2);

    const retrieved = getSettingsService();
    expect(retrieved).toBe(service2);
    expect(retrieved).not.toBe(service1);

    const retrievedPkg = getSettingsServicePkg();
    expect(retrievedPkg).toBe(service2);
  });

  it('activation with runtimeId propagates the id into the context', () => {
    const service = new SettingsService();

    activateSettingsRuntimeContext(service, 'custom-id-42');

    const activeContext = peekActiveProviderRuntimeContext();
    expect(activeContext).not.toBeNull();
    expect(activeContext!.runtimeId).toBe('custom-id-42');
  });
});
