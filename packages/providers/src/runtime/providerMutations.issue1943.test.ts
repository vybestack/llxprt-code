/**
 * @issue #1943 - /toolformat is not persisted into profile ephemerals
 *
 * Behavioral tests for setActiveToolFormatOverride() writing to both
 * SettingsService AND Config ephemeral settings, so the tool-format value
 * is captured during profile saves.
 *
 * Before the fix, only settingsService.updateSettings() was called.
 * After the fix, config.setEphemeralSetting('tool-format', value) is also called,
 * mirroring the pattern used by updateActiveProviderBaseUrl.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConfig = {
  setEphemeralSetting: vi.fn(),
  getEphemeralSetting: vi.fn().mockReturnValue(undefined),
};

const mockSettingsService = {
  updateSettings: vi.fn().mockResolvedValue(undefined),
  getProviderSettings: vi.fn().mockReturnValue({}),
};

const mockProviderManager = {
  getActiveProvider: vi.fn().mockReturnValue({ name: 'openai' }),
  getActiveProviderName: vi.fn().mockReturnValue('openai'),
};

vi.mock('./runtimeAccessors.js', () => ({
  getCliRuntimeServices: () => ({
    config: mockConfig,
    settingsService: mockSettingsService,
    providerManager: mockProviderManager,
  }),
  _internal: {
    getActiveProviderOrThrow: () => ({ name: 'openai' }),
    getProviderSettingsSnapshot: () => ({}),
  },
}));

import { setActiveToolFormatOverride } from './providerMutations.js';

describe('setActiveToolFormatOverride ephemeral persistence (issue #1943)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService.getProviderSettings.mockReturnValue({});
  });

  it('writes "openai" to config.setEphemeralSetting when setting toolFormat to "openai"', async () => {
    await setActiveToolFormatOverride('openai');

    expect(mockSettingsService.updateSettings).toHaveBeenCalledWith('openai', {
      toolFormat: 'openai',
    });
    expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
      'tool-format',
      'openai',
    );
  });

  it('writes "auto" to config.setEphemeralSetting when clearing override', async () => {
    await setActiveToolFormatOverride(null);

    expect(mockSettingsService.updateSettings).toHaveBeenCalledWith('openai', {
      toolFormat: 'auto',
    });
    expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
      'tool-format',
      'auto',
    );
  });

  it('writes "auto" to config.setEphemeralSetting when explicitly setting to "auto"', async () => {
    await setActiveToolFormatOverride('auto');

    expect(mockSettingsService.updateSettings).toHaveBeenCalledWith('openai', {
      toolFormat: 'auto',
    });
    expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
      'tool-format',
      'auto',
    );
  });

  it('writes "kimi" to config.setEphemeralSetting when setting toolFormat to "kimi"', async () => {
    await setActiveToolFormatOverride('kimi');

    expect(mockSettingsService.updateSettings).toHaveBeenCalledWith('openai', {
      toolFormat: 'kimi',
    });
    expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
      'tool-format',
      'kimi',
    );
  });

  it('calls both settingsService and config (mirrors updateActiveProviderBaseUrl pattern)', async () => {
    await setActiveToolFormatOverride('openai');

    // Both should be called exactly once
    expect(mockSettingsService.updateSettings).toHaveBeenCalledTimes(1);
    expect(mockConfig.setEphemeralSetting).toHaveBeenCalledTimes(1);
  });
});
