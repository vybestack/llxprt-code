/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settings service interfaces and types
 */

/**
 * Emoji filter configuration
 * @requirement REQ-003.2 - Default configuration in settings.json
 * @plan PLAN-20250113-EMOJIFILTER.P08
 */
export interface EmojiFilterSettings {
  mode: 'allowed' | 'auto' | 'warn' | 'error';
}

/**
 * Global settings schema matching the specification
 */
export interface GlobalSettings {
  defaultProvider?: string;
  providers: Record<string, ProviderSettings>;
  ui?: UISettings | null;
  telemetry?: TelemetrySettings;
  advanced?: AdvancedSettings;
  /**
   * Emoji filter configuration
   * @requirement REQ-003.2 - Default configuration in settings.json
   * @plan PLAN-20250113-EMOJIFILTER.P08
   */
  emojiFilter?: EmojiFilterSettings;
}

/**
 * Provider-specific settings
 */
export interface ProviderSettings {
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  toolFormat?:
    | 'auto'
    | 'openai'
    | 'qwen'
    | 'kimi'
    | 'hermes'
    | 'xml'
    | 'anthropic'
    | 'deepseek'
    | 'gemma'
    | 'llama';
  /**
   * Anthropic/OpenAI prompt caching configuration
   * - 'off': No caching
   * - '5m': 5-minute cache TTL (Anthropic only)
   * - '1h': 1-hour cache TTL (default, Anthropic only)
   * - '24h': 24-hour cache TTL (OpenAI only)
   */
  'prompt-caching'?: 'off' | '5m' | '1h' | '24h';
  /** Whether to include folder structure in system prompts (default: false) */
  'include-folder-structure'?: boolean;
  [key: string]: unknown;
}

/**
 * UI-related settings
 */
export interface UISettings {
  theme?: 'light' | 'dark' | 'auto';
  fontSize?: number;
  compactMode?: boolean;
}

/**
 * Telemetry settings
 */
export interface TelemetrySettings {
  enabled: boolean;
  level?: 'minimal' | 'standard' | 'detailed';
}

/**
 * Advanced settings
 */
export interface AdvancedSettings {
  debug?: boolean;
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  maxRetries?: number;
  timeout?: number;
}

/**
 * Event emitted when settings change
 */
export interface SettingsChangeEvent {
  type: 'settings_changed';
  changes: Partial<GlobalSettings>;
  timestamp: Date;
}

/**
 * Event listener function type
 */
export type EventListener<T = unknown> = (event: T) => void;

/**
 * Event unsubscribe function type
 */
export type EventUnsubscribe = () => void;

/**
 * Comprehensive diagnostics information from SettingsService
 */
export interface DiagnosticsInfo {
  provider: string;
  model: string;
  profile: string | null;
  providerSettings: ProviderSettings;
  ephemeralSettings: Record<string, unknown>;
  modelParams: Record<string, unknown>;
  allSettings: GlobalSettings;
}

/**
 * Settings service interface
 */
export interface ISettingsService {
  /**
   * Get current global settings
   */
  getSettings(): Promise<GlobalSettings>;
  getSettings(provider: string): Promise<ProviderSettings>;

  /**
   * Update global settings (partial update)
   */
  updateSettings(updates: Partial<GlobalSettings>): Promise<void>;
  updateSettings(
    provider: string,
    updates: Partial<ProviderSettings>,
  ): Promise<void>;

  /**
   * Switch to a different provider and update settings
   */
  switchProvider(providerId: string): Promise<void>;

  /**
   * Subscribe to settings change events
   */
  onSettingsChanged(
    listener: EventListener<SettingsChangeEvent>,
  ): EventUnsubscribe;

  /**
   * Subscribe to settings change events (legacy method)
   */
  on(
    event: 'settings_changed',
    listener: EventListener<SettingsChangeEvent>,
  ): EventUnsubscribe;

  /**
   * Emit a settings change event
   */
  emit(event: 'settings_changed', data: SettingsChangeEvent): void;

  /**
   * Get comprehensive diagnostics data from centralized source
   */
  getDiagnosticsData?(): Promise<DiagnosticsInfo>;

  /**
   * Export current settings for profile storage
   */
  exportForProfile?(): Promise<{
    defaultProvider: string;
    providers: Record<string, ProviderSettings>;
    ui?: UISettings;
    telemetry?: TelemetrySettings;
    advanced?: AdvancedSettings;
    emojiFilter?: EmojiFilterSettings;
  }>;

  /**
   * Import settings from profile data
   */
  importFromProfile?(profileData: {
    defaultProvider: string;
    providers: Record<string, ProviderSettings>;
    ui?: UISettings;
    telemetry?: TelemetrySettings;
    advanced?: AdvancedSettings;
    emojiFilter?: EmojiFilterSettings;
  }): Promise<void>;

  /**
   * Set the current profile name (for tracking)
   */
  setCurrentProfileName?(profileName: string | null): void;

  /**
   * Get the current profile name
   */
  getCurrentProfileName?(): string | null;
}
