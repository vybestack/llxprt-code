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
import {
  redactSensitiveValues,
  isSensitiveSettingKey,
  REDACTED_VALUE,
  isSessionScopedSettingKey,
  assertSessionScopedKey,
} from './settingsRegistry.js';
import { SessionSettingsOverlay } from './SessionSettingsOverlay.js';

function redactEventValue(key: string, value: unknown): unknown {
  return isSensitiveSettingKey(key) ? REDACTED_VALUE : value;
}

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

/**
 * Snapshot returned by {@link SettingsService.getDiagnosticsData}.
 * Sensitive setting values (e.g. `auth-key`) are replaced with
 * `[REDACTED]`; all other values are preserved verbatim.
 */
export interface DiagnosticsData {
  provider: string;
  model: string;
  profile: string | null;
  providerSettings: Record<string, unknown>;
  ephemeralSettings: Record<string, unknown>;
  modelParams: Record<string, unknown>;
  allSettings: {
    providers: Record<string, Record<string, unknown>>;
  };
}

/**
 * Options for constructing a {@link SettingsService}. When `sessionSource` is
 * provided, the new service **shares the source's {@link SessionSettingsOverlay}
 * by reference** (not the source's full settings), so session-scoped overrides
 * (e.g. `/dumpcontext`) stay in sync across foreground and child instances.
 *
 * A service constructed without a source gets a fresh overlay and is its
 * **owner**: only the owner may write or clear session-scoped overrides via
 * {@link SettingsService.setSessionScoped} /
 * {@link SettingsService.clearSessionScoped}. A child constructed with a
 * source is a read-only consumer; attempts to mutate the shared overlay fail
 * fast so a subagent can never alter foreground session state. Chained
 * children (child-of-child) share the same overlay read-only.
 */
export interface SettingsServiceInit {
  sessionSource?: SettingsService | null;
}

function copyStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((name) => String(name)) : [];
}

export class SettingsService extends EventEmitter {
  private settings: EphemeralSettings;
  private readonly sessionOverlay: SessionSettingsOverlay;
  private readonly isSessionOverlayOwner: boolean;
  private eventEmitter: EventEmitter;

  constructor(options: SettingsServiceInit = {}) {
    super();
    this.settings = {
      providers: {},
      global: {},
      activeProvider: null,
    };
    this.isSessionOverlayOwner =
      options.sessionSource === undefined || options.sessionSource === null;
    this.sessionOverlay =
      options.sessionSource?.sessionOverlay ?? new SessionSettingsOverlay();
    this.eventEmitter = new EventEmitter();
  }

  get(key: string): unknown {
    // A session-scoped key must be checked against the overlay first. The
    // registry module-load invariant guarantees session-scoped specs never
    // use dotted keys or aliases, so the raw key is the canonical overlay
    // key and a genuine dotted path always falls through to nested/local
    // storage.
    if (isSessionScopedSettingKey(key) && this.sessionOverlay.has(key)) {
      return this.sessionOverlay.get(key);
    }
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

    // Preserve historical emission for ordinary/local writes. A local write
    // shadowed by an explicit session override cannot change the effective
    // value, so it must not emit a phantom transition. The registry
    // module-load invariant guarantees session-scoped specs never use
    // aliases, so the raw key is the canonical overlay key.
    if (isSessionScopedSettingKey(key) && this.sessionOverlay.has(key)) {
      return;
    }

    this.eventEmitter.emit('change', {
      key,
      oldValue: redactEventValue(key, oldValue),
      newValue: redactEventValue(key, value),
    });
  }

  /**
   * Writes a session-scoped override that survives profile application and is
   * shared by reference with child services constructed from this service.
   *
   * Only the overlay **owner** (the foreground service) may call this; a
   * child constructed with `sessionSource` is a read-only consumer and will
   * get a fail-fast error.
   *
   * The key is validated by {@link assertSessionScopedKey}: only
   * registry-classified session-scoped keys are accepted (canonicalised
   * first), so arbitrary keys like `auth-key` or `model` can never enter the
   * shared overlay.
   */
  setSessionScoped(key: string, value: unknown): void {
    this.assertSessionOverlayOwner(key);
    const canonicalKey = assertSessionScopedKey(key);
    const oldValue = this.get(key);
    this.sessionOverlay.set(canonicalKey, value);
    const effectiveNewValue = this.get(key);
    if (oldValue === effectiveNewValue) {
      return;
    }
    this.eventEmitter.emit('change', {
      key,
      oldValue: redactEventValue(key, oldValue),
      newValue: redactEventValue(key, effectiveNewValue),
    });
  }

  /**
   * Reads a session-scoped override, bypassing the local/profile store.
   * Returns `undefined` when no explicit session override exists.
   *
   * The key is validated by {@link assertSessionScopedKey} to fail fast for
   * non-session keys.
   */
  getSessionScoped(key: string): unknown {
    const canonicalKey = assertSessionScopedKey(key);
    return this.sessionOverlay.get(canonicalKey);
  }

  /**
   * Removes a session-scoped override so subsequent reads fall back to the
   * local/profile value.
   *
   * Only the overlay **owner** (the foreground service) may call this; a
   * child constructed with `sessionSource` is a read-only consumer and will
   * get a fail-fast error.
   */
  clearSessionScoped(key: string): void {
    this.assertSessionOverlayOwner(key);
    const canonicalKey = assertSessionScopedKey(key);
    const oldValue = this.get(key);
    this.sessionOverlay.delete(canonicalKey);
    const effectiveNewValue = this.get(key);
    if (oldValue === effectiveNewValue) {
      return;
    }
    this.eventEmitter.emit('change', {
      key,
      oldValue: redactEventValue(key, oldValue),
      newValue: redactEventValue(key, effectiveNewValue),
    });
  }

  private assertSessionOverlayOwner(key: string): void {
    if (!this.isSessionOverlayOwner) {
      throw new Error(
        `Cannot mutate session-scoped setting "${key}": this SettingsService ` +
          'is a read-only consumer of a shared session overlay. Only the ' +
          'foreground owner may write or clear session-scoped settings.',
      );
    }
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
      oldValue: redactEventValue(key, oldValue),
      newValue: redactEventValue(key, value),
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

    // Overlay session-scoped overrides last so they take precedence over
    // profile/local values while preserving the snapshot immutability.
    const sessionValues = this.sessionOverlay.toObject();
    for (const [key, value] of Object.entries(sessionValues)) {
      snapshot[key] = value;
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

  getDiagnosticsData(): Promise<DiagnosticsData> {
    const globalSettings = this.getAllGlobalSettings();
    const globalActiveProvider = globalSettings.activeProvider;
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

    const redactedProviders: Record<string, Record<string, unknown>> = {};
    for (const [provider, settings] of Object.entries(
      this.settings.providers,
    )) {
      if (settings !== undefined) {
        redactedProviders[provider] = redactSensitiveValues(settings);
      }
    }

    return Promise.resolve({
      provider: activeProvider,
      model,
      profile: this.getCurrentProfileName(),
      providerSettings: redactSensitiveValues(providerSettings),
      ephemeralSettings: redactSensitiveValues(globalSettings),
      modelParams: redactSensitiveValues(modelParams),
      allSettings: {
        providers: redactedProviders,
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
