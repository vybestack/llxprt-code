import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  maybePromptForSettings,
  getMissingSettings,
  formatSettingPrompt,
} from './settingsPrompt.js';
import type { ExtensionSetting } from './extensionSettings.js';

// Mock readline for testing prompts
const mockQuestion = vi.fn();
const mockClose = vi.fn();
vi.mock('node:readline', () => ({
  createInterface: vi.fn().mockReturnValue({
    question: mockQuestion,
    close: mockClose,
  }),
}));

describe('getMissingSettings', () => {
  it('should return all settings when none have values', () => {
    const settings: ExtensionSetting[] = [
      { name: 'apiKey', envVar: 'API_KEY', sensitive: true },
      { name: 'apiUrl', envVar: 'API_URL', sensitive: false },
    ];
    const existingValues: Record<string, string | undefined> = {};

    const missing = getMissingSettings(settings, existingValues);

    expect(missing).toHaveLength(2);
    expect(missing[0].envVar).toBe('API_KEY');
    expect(missing[1].envVar).toBe('API_URL');
  });

  it('should return only missing settings', () => {
    const settings: ExtensionSetting[] = [
      { name: 'apiKey', envVar: 'API_KEY', sensitive: true },
      { name: 'apiUrl', envVar: 'API_URL', sensitive: false },
    ];
    const existingValues = { API_URL: 'https://api.example.com' };

    const missing = getMissingSettings(settings, existingValues);

    expect(missing).toHaveLength(1);
    expect(missing[0].envVar).toBe('API_KEY');
  });

  it('should return empty array when all settings have values', () => {
    const settings: ExtensionSetting[] = [
      { name: 'apiKey', envVar: 'API_KEY', sensitive: true },
    ];
    const existingValues = { API_KEY: 'secret123' };

    const missing = getMissingSettings(settings, existingValues);

    expect(missing).toHaveLength(0);
  });

  it('should consider empty string as missing', () => {
    const settings: ExtensionSetting[] = [
      { name: 'apiKey', envVar: 'API_KEY', sensitive: true },
    ];
    const existingValues = { API_KEY: '' };

    const missing = getMissingSettings(settings, existingValues);

    expect(missing).toHaveLength(1);
  });
});

describe('formatSettingPrompt', () => {
  it('should format prompt with setting name', () => {
    const setting: ExtensionSetting = {
      name: 'API Key',
      envVar: 'API_KEY',
      sensitive: true,
    };

    const prompt = formatSettingPrompt(setting);

    expect(prompt).toContain('API Key');
  });

  it('should include description when provided', () => {
    const setting: ExtensionSetting = {
      name: 'API Key',
      description: 'Your secret API key from the dashboard',
      envVar: 'API_KEY',
      sensitive: true,
    };

    const prompt = formatSettingPrompt(setting);

    expect(prompt).toContain('Your secret API key from the dashboard');
  });

  it('should indicate sensitive setting', () => {
    const setting: ExtensionSetting = {
      name: 'API Key',
      envVar: 'API_KEY',
      sensitive: true,
    };

    const prompt = formatSettingPrompt(setting);

    expect(prompt.toLowerCase()).toMatch(/sensitive|secret|hidden/);
  });
});

describe('maybePromptForSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return existing values when no settings are missing', async () => {
    const settings: ExtensionSetting[] = [
      { name: 'apiKey', envVar: 'API_KEY', sensitive: true },
    ];
    const existingValues = { API_KEY: 'already-set' };

    const result = await maybePromptForSettings(settings, existingValues);

    expect(result).toEqual({ API_KEY: 'already-set' });
    expect(mockQuestion).not.toHaveBeenCalled();
  });

  it('should prompt for missing settings', async () => {
    const settings: ExtensionSetting[] = [
      { name: 'API Key', envVar: 'API_KEY', sensitive: true },
    ];
    const existingValues: Record<string, string | undefined> = {};

    // Simulate user entering a value
    mockQuestion.mockImplementation((prompt, callback) => {
      callback('user-entered-value');
    });

    const result = await maybePromptForSettings(settings, existingValues);

    expect(mockQuestion).toHaveBeenCalled();
    expect(result).toEqual({ API_KEY: 'user-entered-value' });
  });

  it('should return null when user enters empty value for required setting', async () => {
    const settings: ExtensionSetting[] = [
      { name: 'API Key', envVar: 'API_KEY', sensitive: true },
    ];
    const existingValues: Record<string, string | undefined> = {};

    // Simulate user pressing enter without value (cancel)
    mockQuestion.mockImplementation((prompt, callback) => {
      callback('');
    });

    const result = await maybePromptForSettings(settings, existingValues);

    expect(result).toBeNull();
  });

  it('should merge new values with existing values', async () => {
    const settings: ExtensionSetting[] = [
      { name: 'API Key', envVar: 'API_KEY', sensitive: true },
      { name: 'API URL', envVar: 'API_URL', sensitive: false },
    ];
    const existingValues = { API_URL: 'https://api.example.com' };

    mockQuestion.mockImplementation((prompt, callback) => {
      callback('new-api-key');
    });

    const result = await maybePromptForSettings(settings, existingValues);

    expect(result).toEqual({
      API_KEY: 'new-api-key',
      API_URL: 'https://api.example.com',
    });
  });

  it('should close readline interface after prompting', async () => {
    const settings: ExtensionSetting[] = [
      { name: 'API Key', envVar: 'API_KEY', sensitive: true },
    ];

    mockQuestion.mockImplementation((prompt, callback) => {
      callback('value');
    });

    await maybePromptForSettings(settings, {});

    expect(mockClose).toHaveBeenCalled();
  });
});
