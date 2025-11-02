/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'events';
import {
  ISettingsService,
  GlobalSettings,
  ProviderSettings,
  SettingsChangeEvent,
  EventListener,
  EventUnsubscribe,
  DiagnosticsInfo,
} from './types.js';

/**
 * In-memory ephemeral settings structure
 */
interface EphemeralSettings {
  providers: Record<string, Record<string, unknown>>;
  global: Record<string, unknown>;
  activeProvider: string | null;
  tools?: {
    allowed?: string[];
    disabled?: string[];
  };
  // Required properties for correct TypeScript handling in tests
  n?: unknown;
}

export class SettingsService extends EventEmitter implements ISettingsService {
  private settings: EphemeralSettings;
  private eventEmitter: EventEmitter;

  constructor() {
    super();
    // Lines 05-14: Initialize in-memory only, no repository parameter
    this.settings = {
      providers: {},
      global: {},
      activeProvider: null,
      tools: {},
    };
    this.eventEmitter = new EventEmitter();
  }

  // Lines 16-23: Direct synchronous access to settings object
  get(key: string): unknown {
    if (key.includes('.')) {
      return this.getNestedValue(this.settings, key);
    }
    return this.settings.global[key];
  }

  // Lines 25-38: Store old value, update in-memory object, emit change event, NO file writes
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

  // Lines 40-54: Provider-specific methods - direct manipulation of settings.providers
  getProviderSettings(provider: string): Record<string, unknown> {
    return this.settings.providers[provider] || {};
  }

  setProviderSetting(provider: string, key: string, value: unknown): void {
    if (!this.settings.providers[provider]) {
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

  // Lines 56-64: Clear method - reset to empty state, emit cleared event
  clear(): void {
    this.settings = {
      providers: {},
      global: {},
      activeProvider: null,
    };
    this.eventEmitter.emit('cleared');
  }

  // Public method to get all global settings
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

  // Helper methods for nested key support
  private getNestedValue(obj: unknown, key: string): unknown {
    const keys = key.split('.');
    let current = obj as Record<string, unknown>;

    for (const k of keys) {
      if (current && typeof current === 'object' && k in current) {
        current = current[k] as Record<string, unknown>;
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

    // Security: Check for dangerous keys that can pollute prototypes
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    for (const k of keys) {
      if (dangerousKeys.includes(k)) {
        throw new Error(`Cannot set dangerous property: ${k}`);
      }
    }

    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!current[k] || typeof current[k] !== 'object') {
        current[k] = {};
      }
      current = current[k] as Record<string, unknown>;
    }

    current[keys[keys.length - 1]] = value;
  }

  // Event handling
  override on(
    event: 'settings_changed',
    listener: EventListener<SettingsChangeEvent>,
  ): EventUnsubscribe;
  override on(
    eventName: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this;
  override on(
    event: string | symbol | 'settings_changed',
    listener: unknown,
  ): EventUnsubscribe | this {
    if (event === 'settings_changed') {
      return this.onSettingsChanged(
        listener as EventListener<SettingsChangeEvent>,
      );
    }
    this.eventEmitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  override off(event: string, listener: (...args: unknown[]) => void): this {
    this.eventEmitter.off(event, listener);
    return this;
  }

  // Legacy interface methods (maintained for compatibility but simplified)
  getSettings(): Promise<GlobalSettings>;
  getSettings(provider: string): Promise<ProviderSettings>;
  getSettings(provider?: string): Promise<GlobalSettings | ProviderSettings> {
    if (provider === undefined) {
      return Promise.resolve({
        providers: this.settings.providers as Record<string, ProviderSettings>,
      });
    }
    return Promise.resolve(
      this.getProviderSettings(provider) as ProviderSettings,
    );
  }

  updateSettings(changes: Partial<GlobalSettings>): Promise<void>;
  updateSettings(
    provider: string,
    changes: Partial<ProviderSettings>,
  ): Promise<void>;
  updateSettings(
    providerOrChanges?: string | Partial<GlobalSettings>,
    changes?: Partial<ProviderSettings>,
  ): Promise<void> {
    if (typeof providerOrChanges === 'string' && changes) {
      // Provider-specific update
      for (const [key, value] of Object.entries(changes)) {
        this.setProviderSetting(providerOrChanges, key, value);
      }
    } else if (providerOrChanges && typeof providerOrChanges === 'object') {
      // Global update
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
    // Get activeProvider from global settings first, then fallback to direct field or default
    const activeProvider =
      (this.settings.global.activeProvider as string) ||
      this.settings.activeProvider ||
      'openai';

    const allowedValue = this.get('tools.allowed');
    const disabledValue = this.get('tools.disabled');
    const legacyDisabled = this.get('disabled-tools');

    const allowedTools = Array.isArray(allowedValue)
      ? (allowedValue as string[]).slice()
      : [];
    const disabledTools = Array.isArray(disabledValue)
      ? (disabledValue as string[]).slice()
      : Array.isArray(legacyDisabled)
        ? (legacyDisabled as string[]).slice()
        : [];

    return Promise.resolve({
      defaultProvider: activeProvider,
      providers: this.settings.providers as Record<string, ProviderSettings>,
      tools: {
        allowed: allowedTools,
        disabled: disabledTools,
      },
    });
  }

  importFromProfile(profileData: unknown) {
    // Don't clear ALL settings - just clear provider settings
    // Keep global settings like activeProvider if it's already set correctly
    this.settings.providers = {};

    // Import profile data
    if (profileData && typeof profileData === 'object') {
      const data = profileData as {
        defaultProvider?: string;
        providers?: Record<string, Record<string, unknown>>;
        tools?: {
          allowed?: unknown;
          disabled?: unknown;
        };
      };

      // Set the active provider
      if (data.defaultProvider) {
        this.set('activeProvider', data.defaultProvider);
        this.settings.activeProvider = data.defaultProvider;
      }

      // Import provider settings
      if (data.providers) {
        for (const [provider, settings] of Object.entries(data.providers)) {
          if (settings && typeof settings === 'object') {
            for (const [key, value] of Object.entries(settings)) {
              this.setProviderSetting(provider, key, value);
            }
          }
        }
      }

      const toolsAllowed = Array.isArray(data.tools?.allowed)
        ? (data.tools?.allowed as unknown[]).map((name) => String(name))
        : [];
      const toolsDisabled = Array.isArray(data.tools?.disabled)
        ? (data.tools?.disabled as unknown[]).map((name) => String(name))
        : [];

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

  setCurrentProfileName(profileName: string | null): void {
    this.set('currentProfile', profileName);
  }

  getCurrentProfileName(): string | null {
    return this.get('currentProfile') as string | null;
  }

  getDiagnosticsData(): Promise<DiagnosticsInfo> {
    // Get activeProvider from global settings (set via set() method) or fallback to direct field or default
    const activeProvider =
      (this.settings.global.activeProvider as string) ||
      this.settings.activeProvider ||
      'openai';
    const providerSettings = this.getProviderSettings(
      activeProvider,
    ) as ProviderSettings;

    // Get the model from provider settings, fallback to 'unknown' if not set
    const model = (providerSettings.model as string) || 'unknown';

    // Extract model parameters from provider settings (exclude 'model' itself)
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
        providers: this.settings.providers as Record<string, ProviderSettings>,
      },
    });
  }

  onSettingsChanged(
    listener: EventListener<SettingsChangeEvent>,
  ): EventUnsubscribe {
    this.eventEmitter.on('settings_changed', listener);
    return () => this.eventEmitter.removeListener('settings_changed', listener);
  }
}
