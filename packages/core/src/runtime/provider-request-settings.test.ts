/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { Config } from '../config/config.js';
import { captureProviderInvocation } from './providerRequestContext.js';

describe('explicit provider invocation settings', () => {
  it('uses the session provider endpoint and model even when globals contain undefined and Config describes a different model', () => {
    const config = new Config({
      sessionId: 'request-settings',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'declaration-model',
    });
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
      { settingsService, config, runtimeId: 'request-settings' },
      'openai',
    );
    expect(invocation.ephemerals['base-url']).toBe('http://127.0.0.1:8080/v1');
    expect(invocation.ephemerals.model).toBe('selected-model');
  });
});
