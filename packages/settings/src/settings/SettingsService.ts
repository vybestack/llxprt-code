/**
 * @plan PLAN-20260608-ISSUE1588.P05
 *
 * SettingsService — migrated from core.
 * Explicit temporary duplicate; core copy remains until P09.
 */

import { EventEmitter } from 'events';

interface EphemeralSettings {
  providers: Record<string, Record<string, unknown>>;
  global: Record<string, unknown>;
  activeProvider: string | null;
  tools?: {
    allowed?: string[];
    disabled?: string[];
    apiKeys?: Record<string, string>;
    apiKeyFiles?: Record<string, string>;
  };
}

interface SettingsChangeEvent {
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

interface ProviderSettingsChangeEvent extends SettingsChangeEvent {
  provider: string;
}

type SettingsEventListener =
  | ((event: SettingsChangeEvent) => void)
  | ((event: ProviderSettingsChangeEvent) => void)
  | (() => void)
  | ((...args: unknown[]) => void);

function isProviderSettingsRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  return true;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((name) => String(name)) : [];
}

export class SettingsService extends EventEmitter {
  private settings: EphemeralSettings;
  private eventEmitter: EventEmitter;

  constructor() {
    super();
    this.settings = {
      providers: {},
      global: {},
      activeProvider: null,
    };
    this.eventEmitter = new EventEmitter();
  }

  get(key: string): unknown {
    if (key.includes('.')) {
      return this.getNestedValue(this.settings, key);
    }
    return this.settings.global[key];
  }

  set(key: string, value: unknown): void {
    const oldValue = this.get(key);

    if (key.includes('.')) {
      const settingsRecord = this.settings as unknown as Record<
        string,
        unknown
      >;

      this.setNestedValue(settingsRecord, key, value);

      const [root, ...rest] = key.split('.');
      if (root && root !== 'providers') {
        const rootValue = settingsRecord[root];
        if (rootValue !== undefined) {
          this.settings.global[root] = rootValue;
        }

        if (rest.length === 0) {
          this.settings.global[root] = rootValue;
        }
      }
    } else {
      this.settings.global[key] = value;
    }

    this.eventEmitter.emit('change', {
      key,
      oldValue,
      newValue: value,
    });
  }

  getProviderSettings(provider: string): Record<string, unknown> {
    const entry = this.settings.providers[provider] as unknown;
    if (isProviderSettingsRecord(entry)) {
      return entry;
    }
    return {};
  }

  setProviderSetting(provider: string, key: string, value: unknown): void {
    const entry = this.settings.providers[provider] as unknown;
    if (!isProviderSettingsRecord(entry)) {
      this.settings.providers[provider] = {};
    }

    const oldValue = this.settings.providers[provider][key];
    this.settings.providers[provider][key] = value;

    this.eventEmitter.emit('provider-change', {
      provider,
      key,
      oldValue,
      newValue: value,
    });
  }

  clear(): void {
    this.settings = {
      providers: {},
      global: {},
      activeProvider: null,
    };
    this.eventEmitter.emit('cleared');
  }

  getAllGlobalSettings(): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {
      ...this.settings.global,
    };

    if (this.settings.tools) {
      const tools = this.settings.tools;
      snapshot.tools = { ...tools };

      if (Array.isArray(tools.allowed)) {
        snapshot['tools.allowed'] = [...tools.allowed];
      }
      if (Array.isArray(tools.disabled)) {
        snapshot['tools.disabled'] = [...tools.disabled];
      }
    }

    return snapshot;
  }

  private getNestedValue(obj: unknown, key: string): unknown {
    const keys = key.split('.');
    let current: unknown = obj;

    for (const k of keys) {
      if (isProviderSettingsRecord(current) && k in current) {
        current = current[k];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private setNestedValue(
    obj: Record<string, unknown>,
    key: string,
    value: unknown,
  ): void {
    const keys = key.split('.');

    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    for (const k of keys) {
      if (dangerousKeys.includes(k)) {
        throw new Error(`Cannot set dangerous property: ${k}`);
      }
    }

    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      const next = current[k];
      if (!isProviderSettingsRecord(next)) {
        current[k] = {};
      }
      current = current[k] as Record<string, unknown>;
    }

    current[keys[keys.length - 1]] = value;
  }

  override on(
    event: 'change',
    listener: (event: SettingsChangeEvent) => void,
  ): this;
  override on(
    event: 'provider-change',
    listener: (event: ProviderSettingsChangeEvent) => void,
  ): this;
  override on(event: 'cleared', listener: () => void): this;
  override on(event: 'settings-changed', listener: () => void): this;
  override on(
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this;
  override on(event: string | symbol, listener: SettingsEventListener): this {
    this.eventEmitter.on(event, listener);
    return this;
  }

  override off(
    event: 'change',
    listener: (event: SettingsChangeEvent) => void,
  ): this;
  override off(
    event: 'provider-change',
    listener: (event: ProviderSettingsChangeEvent) => void,
  ): this;
  override off(event: 'cleared', listener: () => void): this;
  override off(event: 'settings-changed', listener: () => void): this;
  override off(event: string, listener: (...args: unknown[]) => void): this;
  override off(event: string, listener: SettingsEventListener): this {
    this.eventEmitter.off(event, listener);
    return this;
  }

  getSettings(): Promise<Record<string, unknown>>;
  getSettings(provider: string): Promise<Record<string, unknown>>;
  getSettings(provider?: string): Promise<Record<string, unknown>> {
    if (provider === undefined) {
      return Promise.resolve({
        providers: this.settings.providers,
      });
    }
    return Promise.resolve(this.getProviderSettings(provider));
  }

  updateSettings(changes: Record<string, unknown>): Promise<void>;
  updateSettings(
    provider: string,
    changes: Record<string, unknown>,
  ): Promise<void>;
  updateSettings(providerOrChanges: unknown, changes?: unknown): Promise<void> {
    if (typeof providerOrChanges === 'string') {
      if (isProviderSettingsRecord(changes)) {
        const runtimeChanges: Record<string, unknown> = changes;
        for (const [key, value] of Object.entries(runtimeChanges)) {
          this.setProviderSetting(providerOrChanges, key, value);
        }
      }
    } else if (isProviderSettingsRecord(providerOrChanges)) {
      const globalChanges: Record<string, unknown> = providerOrChanges;
      for (const [key, value] of Object.entries(globalChanges)) {
        this.set(key, value);
      }
    }
    return Promise.resolve();
  }

  switchProvider(newProvider: string): Promise<void> {
    this.set('activeProvider', newProvider);
    return Promise.resolve();
  }

  exportForProfile() {
    const globalActive = this.settings.global.activeProvider;
    let activeProvider: string;
    if (typeof globalActive === 'string' && globalActive !== '') {
      activeProvider = globalActive;
    } else if (
      typeof this.settings.activeProvider === 'string' &&
      this.settings.activeProvider !== ''
    ) {
      activeProvider = this.settings.activeProvider;
    } else {
      activeProvider = 'openai';
    }

    const allowedValue = this.get('tools.allowed');
    const disabledValue = this.get('tools.disabled');
    const legacyDisabled = this.get('disabled-tools');

    const allowedTools = Array.isArray(allowedValue)
      ? (allowedValue as string[]).slice()
      : [];

    let disabledTools: string[];
    if (Array.isArray(disabledValue)) {
      disabledTools = (disabledValue as string[]).slice();
    } else if (Array.isArray(legacyDisabled)) {
      disabledTools = (legacyDisabled as string[]).slice();
    } else {
      disabledTools = [];
    }

    return Promise.resolve({
      defaultProvider: activeProvider,
      providers: { ...this.settings.providers },
      tools: {
        allowed: allowedTools,
        disabled: disabledTools,
      },
    });
  }

  importFromProfile(profileData: unknown) {
    this.settings.providers = {};

    if (isProviderSettingsRecord(profileData)) {
      const data = profileData as {
        defaultProvider?: string;
        providers?: Record<string, Record<string, unknown>>;
        tools?: {
          allowed?: unknown;
          disabled?: unknown;
        };
      };

      if (data.defaultProvider) {
        this.set('activeProvider', data.defaultProvider);
        this.settings.activeProvider = data.defaultProvider;
      }

      if (data.providers) {
        this.importProviderEntries(data.providers);
      }

      const toolsAllowed = asStringArray(data.tools?.allowed);
      const toolsDisabled = asStringArray(data.tools?.disabled);

      this.settings.tools = this.settings.tools ?? {};
      (this.settings.tools as Record<string, unknown>)['allowed'] =
        toolsAllowed;
      (this.settings.tools as Record<string, unknown>)['disabled'] =
        toolsDisabled;
      this.settings.global['tools'] = {
        allowed: toolsAllowed,
        disabled: toolsDisabled,
      };
      this.settings.global['disabled-tools'] = toolsDisabled;
    }

    return Promise.resolve();
  }

  private importProviderEntries(providers: Record<string, unknown>): void {
    for (const [provider, settings] of Object.entries(providers)) {
      if (isProviderSettingsRecord(settings)) {
        const providerSettings: Record<string, unknown> = settings;
        for (const [key, value] of Object.entries(providerSettings)) {
          this.setProviderSetting(provider, key, value);
        }
      }
    }
  }

  setCurrentProfileName(profileName: string | null): void {
    this.set('currentProfile', profileName);
  }

  getCurrentProfileName(): string | null {
    const value = this.get('currentProfile');
    return typeof value === 'string' ? value : null;
  }

  getDiagnosticsData(): Promise<Record<string, unknown>> {
    const globalActiveProvider = this.settings.global.activeProvider;
    const fallbackActiveProvider =
      typeof this.settings.activeProvider === 'string' &&
      this.settings.activeProvider !== ''
        ? this.settings.activeProvider
        : 'openai';
    const activeProvider =
      typeof globalActiveProvider === 'string' && globalActiveProvider !== ''
        ? globalActiveProvider
        : fallbackActiveProvider;
    const providerSettings = this.getProviderSettings(activeProvider);

    const model = (providerSettings.model as string) || 'unknown';

    const modelParams: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(providerSettings)) {
      if (key !== 'model' && value !== undefined) {
        modelParams[key] = value;
      }
    }

    return Promise.resolve({
      provider: activeProvider,
      model,
      profile: this.getCurrentProfileName(),
      providerSettings,
      ephemeralSettings: this.settings.global,
      modelParams,
      allSettings: {
        providers: this.settings.providers,
      },
    });
  }

  onSettingsChanged(
    listener: (event: Record<string, unknown>) => void,
  ): () => void {
    this.eventEmitter.on('settings_changed', listener);
    return () => this.eventEmitter.removeListener('settings_changed', listener);
  }
}
