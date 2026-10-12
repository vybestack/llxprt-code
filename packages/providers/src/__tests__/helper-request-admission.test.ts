/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { normalizeRuntimeInputs } from './helper-request-admission.js';

describe('fixture request admission settings ownership', () => {
  it('admits selected settings independently of conflicting runtime settings', () => {
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'model', 'local-model');
    settings.setProviderSetting('openai', 'base-url', 'https://local.test/v1');
    settings.setProviderSetting('openai', 'auth-key', 'local-key');
    const foreign = new SettingsService();
    foreign.setProviderSetting('openai', 'model', 'foreign-model');
    foreign.setProviderSetting('openai', 'base-url', 'https://foreign.test/v1');
    foreign.setProviderSetting('openai', 'auth-key', 'foreign-key');

    const admitted = normalizeRuntimeInputs(
      {
        contents: [],
        runtime: { runtimeId: 'same-label' },
      },
      settings,
      {
        getActiveProviderName: () => 'openai',
        getProvider: () => undefined,
      },
    );
    settings.setProviderSetting('openai', 'model', 'later-model');

    expect(admitted.resolved).toMatchObject({
      model: 'local-model',
      baseURL: 'https://local.test/v1',
      authToken: 'local-key',
    });
    expect(admitted.invocation?.runtimeId).toBe('same-label');
    expect(admitted.invocation?.getProviderOverrides('openai')).toMatchObject({
      model: 'local-model',
    });
  });
});
