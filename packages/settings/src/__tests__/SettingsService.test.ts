/**
 * @plan PLAN-20260608-ISSUE1588.P04
 * @requirement REQ-SVC-001
 *
 * Behavioral TDD tests for SettingsService.
 *
 * These tests define the expected behavior that will be satisfied
 * when the full SettingsService implementation is migrated from core
 * in P05. Tests fail against the current stub because methods throw
 * instead of returning values or changing state.
 */

import { describe, it, expect } from 'vitest';
import { SettingsService } from '../settings/SettingsService.js';

describe('SettingsService — global reads and writes', () => {
  it('returns undefined for a key that was never set', () => {
    const svc = new SettingsService();
    const result = svc.get('unknownKey');
    expect(result).toBeUndefined();
  });

  it('stores and retrieves a global string value', () => {
    const svc = new SettingsService();
    svc.set('shell-replacement', 'none');
    expect(svc.get('shell-replacement')).toBe('none');
  });

  it('stores and retrieves a global boolean value', () => {
    const svc = new SettingsService();
    svc.set('reasoning.enabled', true);
    expect(svc.get('reasoning.enabled')).toBe(true);
  });

  it('stores and retrieves a global number value', () => {
    const svc = new SettingsService();
    svc.set('temperature', 0.7);
    expect(svc.get('temperature')).toBe(0.7);
  });

  it('overwrites a previously set value', () => {
    const svc = new SettingsService();
    svc.set('shell-replacement', 'none');
    expect(svc.get('shell-replacement')).toBe('none');
    svc.set('shell-replacement', 'all');
    expect(svc.get('shell-replacement')).toBe('all');
  });

  it('resolves nested dot-notation keys', () => {
    const svc = new SettingsService();
    svc.set('reasoning.enabled', true);
    expect(svc.get('reasoning.enabled')).toBe(true);
  });
});

describe('SettingsService — provider-specific reads and writes', () => {
  it('returns empty object for a provider with no settings', () => {
    const svc = new SettingsService();
    const result = svc.getProviderSettings('openai');
    expect(result).toStrictEqual({});
  });

  it('stores and retrieves a provider-specific setting', () => {
    const svc = new SettingsService();
    svc.setProviderSetting('openai', 'model', 'gpt-4');
    expect(svc.getProviderSettings('openai')).toStrictEqual({ model: 'gpt-4' });
  });

  it('stores multiple settings for a single provider', () => {
    const svc = new SettingsService();
    svc.setProviderSetting('anthropic', 'model', 'claude-3');
    svc.setProviderSetting('anthropic', 'temperature', 0.5);
    const settings = svc.getProviderSettings('anthropic');
    expect(settings.model).toBe('claude-3');
    expect(settings.temperature).toBe(0.5);
  });

  it('isolates settings between providers', () => {
    const svc = new SettingsService();
    svc.setProviderSetting('openai', 'model', 'gpt-4');
    svc.setProviderSetting('anthropic', 'model', 'claude-3');
    expect(svc.getProviderSettings('openai').model).toBe('gpt-4');
    expect(svc.getProviderSettings('anthropic').model).toBe('claude-3');
  });
});

describe('SettingsService — change events', () => {
  it('emits a change event when a global setting is set', async () => {
    const svc = new SettingsService();
    let receivedKey: string | undefined;
    let receivedNewValue: unknown;

    svc.on(
      'change',
      (evt: { key: string; oldValue: unknown; newValue: unknown }) => {
        receivedKey = evt.key;
        receivedNewValue = evt.newValue;
      },
    );

    svc.set('temperature', 0.7);
    expect(receivedKey).toBe('temperature');
    expect(receivedNewValue).toBe(0.7);
  });

  it('includes the old value in the change event', async () => {
    const svc = new SettingsService();
    let receivedOldValue: unknown;

    svc.set('temperature', 0.5);
    svc.on('change', (evt: { oldValue: unknown }) => {
      receivedOldValue = evt.oldValue;
    });
    svc.set('temperature', 0.9);

    expect(receivedOldValue).toBe(0.5);
  });

  it('emits a provider-change event when a provider setting is set', () => {
    const svc = new SettingsService();
    let receivedProvider: string | undefined;
    let receivedKey: string | undefined;

    svc.on('provider-change', (evt: { provider: string; key: string }) => {
      receivedProvider = evt.provider;
      receivedKey = evt.key;
    });

    svc.setProviderSetting('openai', 'model', 'gpt-4');
    expect(receivedProvider).toBe('openai');
    expect(receivedKey).toBe('model');
  });
});

describe('SettingsService — provider switching', () => {
  it('switchProvider updates the active provider', async () => {
    const svc = new SettingsService();
    await svc.switchProvider('anthropic');
    expect(svc.get('activeProvider')).toBe('anthropic');
  });
});

describe('SettingsService — profile import/export', () => {
  it('exportForProfile returns default provider and provider settings', async () => {
    const svc = new SettingsService();
    svc.setProviderSetting('openai', 'model', 'gpt-4');
    const exported = (await svc.exportForProfile()) as {
      defaultProvider: string;
      providers: Record<string, Record<string, unknown>>;
    };
    expect(typeof exported.defaultProvider).toBe('string');
    expect(exported.providers).toStrictEqual(
      expect.objectContaining({
        openai: expect.objectContaining({ model: 'gpt-4' }),
      }),
    );
  });

  it('importFromProfile applies provider settings', async () => {
    const svc = new SettingsService();
    await svc.importFromProfile({
      defaultProvider: 'anthropic',
      providers: {
        anthropic: { model: 'claude-3', temperature: 0.5 },
      },
      tools: { allowed: [], disabled: [] },
    });
    expect(svc.get('activeProvider')).toBe('anthropic');
  });

  it('importFromProfile sets activeProvider from defaultProvider', async () => {
    const svc = new SettingsService();
    await svc.importFromProfile({
      defaultProvider: 'openai',
      providers: {},
      tools: { allowed: [], disabled: [] },
    });
    expect(svc.get('activeProvider')).toBe('openai');
  });
});

describe('SettingsService — current profile behavior', () => {
  it('setCurrentProfileName stores the profile name', () => {
    const svc = new SettingsService();
    svc.setCurrentProfileName('my-profile');
    expect(svc.getCurrentProfileName()).toBe('my-profile');
  });

  it('getCurrentProfileName returns null initially', () => {
    const svc = new SettingsService();
    expect(svc.getCurrentProfileName()).toBeNull();
  });

  it('setCurrentProfileName with null clears the profile name', () => {
    const svc = new SettingsService();
    svc.setCurrentProfileName('my-profile');
    svc.setCurrentProfileName(null);
    expect(svc.getCurrentProfileName()).toBeNull();
  });
});

describe('SettingsService — clear behavior', () => {
  it('clear removes all global settings', () => {
    const svc = new SettingsService();
    svc.set('temperature', 0.7);
    svc.set('shell-replacement', 'none');
    svc.clear();
    expect(svc.get('temperature')).toBeUndefined();
    expect(svc.get('shell-replacement')).toBeUndefined();
  });

  it('clear removes all provider settings', () => {
    const svc = new SettingsService();
    svc.setProviderSetting('openai', 'model', 'gpt-4');
    svc.clear();
    expect(svc.getProviderSettings('openai')).toStrictEqual({});
  });

  it('clear emits a cleared event', () => {
    const svc = new SettingsService();
    let clearedEmitted = false;
    svc.on('cleared', () => {
      clearedEmitted = true;
    });
    svc.clear();
    expect(clearedEmitted).toBe(true);
  });
});

describe('SettingsService — getAllGlobalSettings', () => {
  it('returns all set global settings', () => {
    const svc = new SettingsService();
    svc.set('temperature', 0.7);
    svc.set('shell-replacement', 'none');
    const all = svc.getAllGlobalSettings();
    expect(all.temperature).toBe(0.7);
    expect(all['shell-replacement']).toBe('none');
  });

  it('returns empty object when no settings are set', () => {
    const svc = new SettingsService();
    const all = svc.getAllGlobalSettings();
    expect(Object.keys(all).length).toBe(0);
  });
});

describe('SettingsService — getSettings / updateSettings', () => {
  it('getSettings without provider returns global settings object with providers map', async () => {
    const svc = new SettingsService();
    svc.setProviderSetting('openai', 'model', 'gpt-4');
    const settings = (await svc.getSettings()) as {
      providers: Record<string, { model: string }>;
    };
    expect(typeof settings.providers).toBe('object');
    expect(settings.providers.openai.model).toBe('gpt-4');
  });

  it('getSettings with provider returns provider settings', async () => {
    const svc = new SettingsService();
    svc.setProviderSetting('openai', 'model', 'gpt-4');
    const settings = (await svc.getSettings('openai')) as { model: string };
    expect(settings.model).toBe('gpt-4');
  });

  it('updateSettings with provider string updates provider settings', async () => {
    const svc = new SettingsService();
    await svc.updateSettings('openai', { model: 'gpt-4' });
    expect(svc.getProviderSettings('openai').model).toBe('gpt-4');
  });

  it('updateSettings with object updates global settings', async () => {
    const svc = new SettingsService();
    await svc.updateSettings({ temperature: 0.5 });
    expect(svc.get('temperature')).toBe(0.5);
  });
});

describe('SettingsService — empty-string activeProvider fallback', () => {
  it('exportForProfile falls back to openai when imported activeProvider is empty', async () => {
    const svc = new SettingsService();
    await svc.importFromProfile({
      defaultProvider: '',
      providers: {},
      tools: { allowed: [], disabled: [] },
    });
    const exported = (await svc.exportForProfile()) as {
      defaultProvider: string;
    };
    expect(exported.defaultProvider).toBe('openai');
  });

  it('exportForProfile uses a non-empty imported activeProvider', async () => {
    const svc = new SettingsService();
    await svc.importFromProfile({
      defaultProvider: 'anthropic',
      providers: {},
      tools: { allowed: [], disabled: [] },
    });
    const exported = (await svc.exportForProfile()) as {
      defaultProvider: string;
    };
    expect(exported.defaultProvider).toBe('anthropic');
  });

  it('exportForProfile falls back to openai when switchProvider sets empty string', async () => {
    const svc = new SettingsService();
    svc.setProviderSetting('openai', 'model', 'gpt-4');
    await svc.switchProvider('');
    const exported = (await svc.exportForProfile()) as {
      defaultProvider: string;
    };
    expect(exported.defaultProvider).toBe('openai');
  });

  it('getDiagnosticsData falls back to openai when imported activeProvider is empty', async () => {
    const svc = new SettingsService();
    await svc.importFromProfile({
      defaultProvider: '',
      providers: {},
      tools: { allowed: [], disabled: [] },
    });
    const diag = (await svc.getDiagnosticsData()) as {
      provider: string;
    };
    expect(diag.provider).toBe('openai');
  });

  it('getDiagnosticsData uses a non-empty imported activeProvider', async () => {
    const svc = new SettingsService();
    await svc.importFromProfile({
      defaultProvider: 'anthropic',
      providers: {},
      tools: { allowed: [], disabled: [] },
    });
    const diag = (await svc.getDiagnosticsData()) as {
      provider: string;
    };
    expect(diag.provider).toBe('anthropic');
  });

  it('exportForProfile defaults to openai with no provider set at all', async () => {
    const svc = new SettingsService();
    const exported = (await svc.exportForProfile()) as {
      defaultProvider: string;
    };
    expect(exported.defaultProvider).toBe('openai');
  });

  it('getDiagnosticsData defaults to openai with no provider set at all', async () => {
    const svc = new SettingsService();
    const diag = (await svc.getDiagnosticsData()) as {
      provider: string;
    };
    expect(diag.provider).toBe('openai');
  });
});

describe('SettingsService — provider trust boundary', () => {
  it('does not allow dotted provider root writes to store non-record values', () => {
    const svc = new SettingsService();

    svc.set('providers.openai', 'not-a-record');

    expect(svc.get('providers.openai')).toBeUndefined();
    expect(svc.getProviderSettings('openai')).toStrictEqual({});
  });

  it('routes dotted provider leaf writes through provider settings storage', () => {
    const svc = new SettingsService();

    svc.set('providers.openai.model', 'gpt-4');

    expect(svc.getProviderSettings('openai')).toStrictEqual({ model: 'gpt-4' });
    expect(svc.get('providers.openai.model')).toBe('gpt-4');
  });

  it('rejects dangerous provider path segments before writing', () => {
    const svc = new SettingsService();

    expect(() => svc.set('providers.__proto__.model', 'polluted')).toThrow(
      'Cannot set dangerous property: __proto__',
    );
    expect(svc.getProviderSettings('__proto__')).toStrictEqual({});
  });

  it('allows provider setting keys that would be dangerous path segments', () => {
    const svc = new SettingsService();

    svc.setProviderSetting('openai', '__proto__', false);
    svc.setProviderSetting('openai', 'constructor', 'safe-value');

    const settings = svc.getProviderSettings('openai');
    expect(settings['__proto__']).toBe(false);
    expect(settings.constructor).toBe('safe-value');
  });
  it('imports only record-shaped provider entries from profile data', async () => {
    const svc = new SettingsService();

    await svc.importFromProfile({
      defaultProvider: 'openai',
      providers: {
        openai: { model: 'gpt-4' },
        broken: 'not-a-record',
      },
      tools: { allowed: ['read_file'], disabled: ['shell'] },
    });

    expect(svc.getProviderSettings('openai')).toStrictEqual({ model: 'gpt-4' });
    expect(svc.getProviderSettings('broken')).toStrictEqual({});
    expect(svc.get('tools.allowed')).toStrictEqual(['read_file']);
    expect(svc.get('tools.disabled')).toStrictEqual(['shell']);
  });
});
