/**
 * @plan PLAN-20260608-ISSUE1588.P05
 *
 * SettingsService — migrated from core.
 * Explicit temporary duplicate; core copy remains until P09.
 */

import { EventEmitter } from 'events';
import {
  createTrustedProviderRecord,
  isDangerousPropertyKey,
  isPlainObject,
  parseProfileImport,
  parseProviderSettingsRecord,
  type TrustedProviderRecord,
  type TrustedProvidersMap,
} from './validation.js';

interface EphemeralSettings {
  providers: TrustedProvidersMap;
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

function copyStringArray(value: unknown): string[] {
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
      return this.getNestedValue(key);
    }
    return this.settings.global[key];
  }

  set(key: string, value: unknown): void {
    const oldValue = this.get(key);

    if (key.includes('.')) {
      this.setNestedValue(key, value);
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
    return this.settings.providers[provider] ?? {};
  }

  setProviderSetting(provider: string, key: string, value: unknown): void {
    this.assertSafePath([provider]);
    const entry = this.getOrCreateProvider(provider);
    const oldValue = entry[key];
    Object.defineProperty(entry, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });

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

  private getNestedValue(key: string): unknown {
    const keys = key.split('.');
    if (keys[0] === 'providers') {
      return this.getProviderPathValue(keys);
    }

    let current: unknown = this.settings.global;
    for (const part of keys) {
      if (isPlainObject(current) && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }
    return current;
  }

  private getProviderPathValue(keys: string[]): unknown {
    if (keys.length === 1) {
      return this.settings.providers;
    }
    const provider = keys[1];
    const providerSettings = this.settings.providers[provider];
    if (providerSettings === undefined) {
      return undefined;
    }
    if (keys.length === 2) {
      return providerSettings;
    }
    let current: unknown = providerSettings;
    for (const part of keys.slice(2)) {
      if (isPlainObject(current) && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }
    return current;
  }

  private setNestedValue(key: string, value: unknown): void {
    const keys = key.split('.');
    this.assertSafePath(keys);

    if (keys[0] === 'providers') {
      this.setProviderPathValue(keys, value);
      return;
    }

    let current = this.settings.global;
    for (const part of keys.slice(0, -1)) {
      current = this.getObjectChild(current, part);
    }

    const finalKey = keys[keys.length - 1];
    Object.defineProperty(current, finalKey, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  private getObjectChild(
    container: Record<string, unknown>,
    key: string,
  ): Record<string, unknown> {
    const next = container[key];
    if (isPlainObject(next)) {
      return next;
    }
    const child: Record<string, unknown> = {};
    container[key] = child;
    return child;
  }

  private setProviderPathValue(keys: string[], value: unknown): void {
    if (keys.length <= 2) {
      return;
    }
    const provider = keys[1];

    const entry = this.getOrCreateProvider(provider);
    let current: Record<string, unknown> = entry;
    for (const part of keys.slice(2, -1)) {
      current = this.getObjectChild(current, part);
    }

    const finalKey = keys[keys.length - 1];
    Object.defineProperty(current, finalKey, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  private getOrCreateProvider(provider: string): TrustedProviderRecord {
    const existing = this.settings.providers[provider];
    if (existing !== undefined) {
      return existing;
    }
    const created = createTrustedProviderRecord();
    this.settings.providers[provider] = created;
    return created;
  }

  private assertSafePath(keys: string[]): void {
    for (const key of keys) {
      if (isDangerousPropertyKey(key)) {
        throw new Error(`Cannot set dangerous property: ${key}`);
      }
    }
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
      const providerChanges = parseProviderSettingsRecord(changes);
      if (providerChanges !== undefined) {
        for (const [key, value] of Object.entries(providerChanges)) {
          this.setProviderSetting(providerOrChanges, key, value);
        }
      }
    } else if (isPlainObject(providerOrChanges)) {
      for (const [key, value] of Object.entries(providerOrChanges)) {
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

    const allowedTools = copyStringArray(allowedValue);

    let disabledTools: string[];
    if (Array.isArray(disabledValue)) {
      disabledTools = copyStringArray(disabledValue);
    } else if (Array.isArray(legacyDisabled)) {
      disabledTools = copyStringArray(legacyDisabled);
    } else {
      disabledTools = [];
    }

    const providers: Record<string, Record<string, unknown>> = {};
    for (const [provider, settings] of Object.entries(
      this.settings.providers,
    )) {
      if (settings !== undefined) {
        providers[provider] = settings;
      }
    }

    return Promise.resolve({
      defaultProvider: activeProvider,
      providers,
      tools: {
        allowed: allowedTools,
        disabled: disabledTools,
      },
    });
  }

  importFromProfile(profileData: unknown) {
    const data = parseProfileImport(profileData);
    if (data === null) {
      return Promise.resolve();
    }

    this.settings.providers = {};

    if (data.defaultProvider !== undefined) {
      this.set('activeProvider', data.defaultProvider);
      this.settings.activeProvider = data.defaultProvider;
    }

    this.settings.providers = data.providers;

    const toolsAllowed = data.tools.allowed;
    const toolsDisabled = data.tools.disabled;

    this.settings.tools = this.settings.tools ?? {};
    this.settings.tools.allowed = toolsAllowed;
    this.settings.tools.disabled = toolsDisabled;
    this.settings.global['tools'] = {
      allowed: toolsAllowed,
      disabled: toolsDisabled,
    };
    this.settings.global['disabled-tools'] = toolsDisabled;

    return Promise.resolve();
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
