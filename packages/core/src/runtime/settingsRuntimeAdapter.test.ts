/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2616 PR A: the settings runtime adapter is reduced to the pure
 * single-owner construction seam (createRuntimeSettingsService). Every
 * ambient helper — resolve/get/maybeGet runtime settings service, settings
 * runtime context creation, activate/deactivate — is deleted. The tests
 * prove the surviving seam constructs isolated services and that the
 * deleted helpers no longer exist on the module.
 */

import { describe, it, expect } from 'bun:test';
import { createRuntimeSettingsService } from './settingsRuntimeAdapter.js';

const DELETED_HELPERS = [
  'resolveRuntimeSettingsService',
  'getRuntimeSettingsService',
  'maybeGetRuntimeSettingsService',
  'createSettingsProviderRuntimeContext',
  'setSettingsProviderRuntimeContext',
  'clearSettingsProviderRuntimeContext',
  'activateSettingsRuntimeContext',
  'deactivateSettingsRuntimeContext',
] as const;

describe('createRuntimeSettingsService', () => {
  it('constructs a working settings service', () => {
    const service = createRuntimeSettingsService();

    service.set('probe-key', 'probe-value');
    expect(service.get('probe-key')).toBe('probe-value');
  });

  it('constructs isolated services — writes to one never leak to another', () => {
    const first = createRuntimeSettingsService();
    const second = createRuntimeSettingsService();

    first.set('probe-key', 'first-value');

    expect(first.get('probe-key')).toBe('first-value');
    expect(second.get('probe-key')).toBeUndefined();
    expect(first).not.toBe(second);
  });

  it('exposes the settings registry surface needed by consumers', () => {
    const service = createRuntimeSettingsService();

    service.setProviderSetting('test-provider', 'model', 'test-model');
    expect(service.getProviderSettings('test-provider')).toStrictEqual({
      model: 'test-model',
    });
    expect(typeof service.getAllGlobalSettings()).toBe('object');
  });
});

describe('settingsRuntimeAdapter deleted ambient surface', () => {
  it('exports none of the deleted ambient helpers', async () => {
    const mod: Record<string, unknown> = await import(
      './settingsRuntimeAdapter.js'
    );

    for (const helper of DELETED_HELPERS) {
      expect(mod[helper]).toBeUndefined();
    }
  });

  it('exposes only the construction seam at runtime', async () => {
    const mod: Record<string, unknown> = await import(
      './settingsRuntimeAdapter.js'
    );

    const runtimeExports = Object.keys(mod).filter(
      (key) => key !== '__esModule',
    );
    expect(runtimeExports.sort()).toStrictEqual([
      'createRuntimeSettingsService',
    ]);
    expect(typeof mod['createRuntimeSettingsService']).toBe('function');
  });
});
