/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { captureProviderInvocation } from './providerRequestContext.js';

describe('explicit provider invocation settings', () => {
  it('uses the session provider endpoint and model even when globals contain undefined', () => {
    const settingsService = new SettingsService();
    settingsService.set('activeProvider', 'openai');
    settingsService.set('base-url', undefined);
    settingsService.setProviderSetting('openai', 'model', 'selected-model');
    settingsService.setProviderSetting(
      'openai',
      'base-url',
      'http://127.0.0.1:8080/v1',
    );
    const invocation = captureProviderInvocation(
      {
        runtimeId: 'request-settings',
        globalSettings: settingsService.getAllGlobalSettings(),
        providerSettings: settingsService.getProviderSettings('openai'),
      },
      'openai',
    );
    expect(invocation.ephemerals['base-url']).toBe('http://127.0.0.1:8080/v1');
    expect(invocation.ephemerals.model).toBe('selected-model');
  });
});
