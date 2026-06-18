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

export interface ValidationResult {
  success: boolean;
  value?: unknown;
  message?: string;
}

export interface SettingSpec {
  key: string;
  aliases?: readonly string[];
  category: SettingCategory;
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
