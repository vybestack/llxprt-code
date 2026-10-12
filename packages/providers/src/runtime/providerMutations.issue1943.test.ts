/**
 * @issue #1943 - /toolformat is persisted into profile ephemerals
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { useRuntimeTestOwners } from './__tests__/runtime-owner-test-helpers.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { setActiveToolFormatOverride } from './providerMutations.js';

const activeProvider = {
  name: 'openai',
  getToolFormat: () => 'openai',
  getModels: async () => [],
  async *generateChatCompletion() {},
};

describe('setActiveToolFormatOverride ephemeral persistence (issue #1943)', () => {
  const roots = useRuntimeTestOwners();
  let settings: SettingsService;
  let owner: SessionSettingsOwner;

  beforeEach(() => {
    settings = new SettingsService();
    settings.set('activeProvider', 'openai');
    owner = roots.config('tool-format-profile', settings).settingsOwner;
  });

  it('writes "openai" to the captured user parameters when setting toolFormat to "openai"', async () => {
    await setActiveToolFormatOverride('openai', owner, activeProvider);
    expect(settings.getProviderSettings('openai').toolFormat).toBe('openai');
    expect(owner.captureUserParameters().toolFormat).toBe('openai');
  });

  it('writes "auto" to the captured user parameters when clearing override', async () => {
    await setActiveToolFormatOverride(null, owner, activeProvider);
    expect(settings.getProviderSettings('openai').toolFormat).toBe('auto');
    expect(owner.captureUserParameters().toolFormat).toBe('auto');
  });

  it('writes "auto" to the captured user parameters when explicitly setting to "auto"', async () => {
    await setActiveToolFormatOverride('auto', owner, activeProvider);
    expect(settings.getProviderSettings('openai').toolFormat).toBe('auto');
    expect(owner.captureUserParameters().toolFormat).toBe('auto');
  });

  it('writes "kimi" to the captured user parameters when setting toolFormat to "kimi"', async () => {
    await setActiveToolFormatOverride('kimi', owner, activeProvider);
    expect(settings.getProviderSettings('openai').toolFormat).toBe('kimi');
    expect(owner.captureUserParameters().toolFormat).toBe('kimi');
  });

  it('updates provider settings and profile capture together', async () => {
    owner.recordModelDefaults(['toolFormat']);
    await setActiveToolFormatOverride('openai', owner, activeProvider);
    expect(settings.getProviderSettings('openai').toolFormat).toBe('openai');
    expect(owner.captureUserParameters().toolFormat).toBe('openai');
  });
});
