/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type SettingCategory =
  | 'model-behavior'
  | 'provider-config'
  | 'cli-behavior'
  | 'model-param'
  | 'custom-header';

/**
 * Owner of a settings key: which component's state the value belongs to.
 * - `application`: LLxprt-application behavior (UI, dumps, emoji filter).
 * - `provider-connection`: how the CLI connects to a provider (auth,
 *   endpoint, socket, headers).
 * - `model`: model behavior/choice (reasoning, compression, context limits).
 * - `agent-policy`: how the agent executes (tools, shell, loops, timeouts,
 *   task-list continuation).
 */
export type SettingOwner =
  | 'application'
  | 'provider-connection'
  | 'model'
  | 'agent-policy';

/**
 * How a change to this setting reaches running state.
 * - `render-immediate`: takes effect for the next rendered output.
 * - `next-turn`: takes effect at the next turn boundary.
 * - `service-reconfigure`: requires a service reconfiguration.
 * - `profile-transition`: applies when a profile is loaded/unloaded.
 * - `restart-required`: only takes effect on restart.
 */
export type SettingPropagation =
  | 'render-immediate'
  | 'next-turn'
  | 'service-reconfigure'
  | 'profile-transition'
  | 'restart-required';

export interface ValidationResult {
  success: boolean;
  value?: unknown;
  message?: string;
}

export interface SettingSpec {
  key: string;
  aliases?: readonly string[];
  category: SettingCategory;
  owner: SettingOwner;
  propagation: SettingPropagation;
  providers?: readonly string[];
  description: string;
  hint?: string;
  type: 'boolean' | 'number' | 'string' | 'enum' | 'json' | 'string-array';
  enumValues?: readonly string[];
  validate?: (value: unknown) => ValidationResult;
  parse?: (raw: string) => unknown;
  normalize?: (value: unknown) => unknown;
  default?: unknown;
  persistToProfile: boolean;
  completionOptions?: ReadonlyArray<{ value: string; description?: string }>;
  /** When true, the value is secret and must be masked in diagnostics. */
  sensitive?: boolean;
  /**
   * When true, the setting is session-scoped: isolated child settings services
   * read its live value from the foreground session source rather than only
   * from their own profile-populated store.
   */
  sessionScope?: boolean;
}

export interface SeparatedSettings {
  cliSettings: Record<string, unknown>;
  modelBehavior: Record<string, unknown>;
  modelParams: Record<string, unknown>;
  customHeaders: Record<string, string>;
}

export const COMPRESSION_STRATEGIES = [
  'middle-out',
  'top-down-truncation',
  'one-shot',
  'high-density',
] as const;
