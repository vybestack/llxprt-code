/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from './session-settings-owner.js';

describe('shared settings model selection ownership', () => {
  it('keeps owner selections independent while caller writes update both live owners', async () => {
    const settings = new SettingsService();
    settings.set('activeProvider', 'openai');
    settings.setProviderSetting('openai', 'model', 'initial');
    const first = new SessionSettingsOwner(settings);
    const second = new SessionSettingsOwner(settings);
    try {
      first.chooseModel('alpha');
      second.chooseModel('beta');
      expect(first.readSelectedModel()).toBe('alpha');
      expect(second.readSelectedModel()).toBe('beta');
      settings.setProviderSetting('openai', 'model', 'external');
      expect(first.readSelectedModel()).toBe('external');
      expect(second.readSelectedModel()).toBe('external');
      first.chooseModel('gamma');
      expect(first.readSelectedModel()).toBe('gamma');
      expect(second.readSelectedModel()).toBe('external');
      await first.dispose();
      settings.setProviderSetting('openai', 'model', 'survivor');
      expect(second.readSelectedModel()).toBe('survivor');
      expect(() => first.readSelectedModel()).toThrow('closed');
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });
});
