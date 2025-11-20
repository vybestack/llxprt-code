/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { SettingsService } from '../../settings/SettingsService.js';
import { createProviderCallOptions } from '../providerCallOptions.js';

describe('createProviderCallOptions', () => {
  it('populates provider-specific ephemerals in the invocation snapshot', () => {
    const settings = new SettingsService();
    settings.set('global-setting', 'enabled');
    settings.setProviderSetting('openai', 'temperature', 0.42);
    settings.setProviderSetting('openai', 'maxTokens', 256);

    const options = createProviderCallOptions({
      providerName: 'openai',
      contents: [],
      settings,
    });

    expect(options.invocation).toBeDefined();
    expect(options.invocation.runtimeId).toMatch(/^openai\.runtime\./);
    expect(options.invocation.settings).toBe(settings);
    expect(options.invocation.ephemerals['global-setting']).toBe('enabled');
    expect(options.invocation.ephemerals.openai).toMatchObject({
      temperature: 0.42,
      maxTokens: 256,
    });
  });

  it('merges runtime metadata with explicit metadata overrides', () => {
    const options = createProviderCallOptions({
      providerName: 'anthropic',
      metadata: { explicit: true },
      settingsOverrides: {
        provider: { callId: 'test-call' },
      },
      runtimeMetadata: { injected: true },
      runtimeId: 'custom-runtime',
    });

    expect(options.runtime.runtimeId).toBe('custom-runtime');
    expect(options.metadata).toMatchObject({
      source: 'test-utils#createProviderCallOptions',
      explicit: true,
      injected: true,
    });
    expect(options.invocation.metadata).toMatchObject({
      explicit: true,
      injected: true,
    });
  });
});
