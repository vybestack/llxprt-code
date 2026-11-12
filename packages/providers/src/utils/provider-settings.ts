/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProviderConfig } from '../types/IProviderConfig.js';

export function extractModelParams(
  settings: Record<string, unknown>,
): Record<string, unknown> | undefined {
  // Extract model parameters from settings, excluding standard fields
  const {
    enabled: _enabled,
    'auth-key': _authKey,
    'auth-keyfile': _authKeyfile,
    'base-url': _baseUrl,
    model: _model,
    max_tokens,
    temperature,
    // Defensive: strip legacy sensitive aliases that should never reach
    // the model params pass-through, even if present in imported/malformed
    // provider settings data.
    apiKey: _legacyApiKey,
    apiKeyfile: _legacyApiKeyfile,
    'api-key': _legacyApiKeyDash,
    'api-keyfile': _legacyApiKeyfileDash,
    ...additionalSettings
  } = settings;

  // Include registered model parameters when present
  const params: Record<string, unknown> = {};
  if (temperature !== undefined) params.temperature = temperature;
  if (max_tokens !== undefined) params.max_tokens = max_tokens;

  return Object.keys(params).length > 0 ||
    Object.keys(additionalSettings).length > 0
    ? { ...params, ...additionalSettings }
    : undefined;
}

/**
 * Helper function to check if a value is falsy-like.
 * Used for determining when to use fallback values for provider settings.
 */
export function isFalsyLikeValue(value: unknown): boolean {
  // Check undefined/null first
  if (value === undefined || value === null) return true;
  // Check false, empty string, or 0
  if (value === false || value === '' || value === 0) return true;
  // Check NaN for numbers
  return typeof value === 'number' && Number.isNaN(value);
}

export interface ProviderSettings {
  enabled: boolean;
  'auth-key'?: string;
  'auth-keyfile'?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  [key: string]: unknown;
}

export function captureProviderDefaults(
  config: IProviderConfig | undefined,
  baseURL: string | undefined,
  getDefaultModel: () => string,
): Record<string, unknown> {
  return {
    defaultModel: config?.defaultModel ?? getDefaultModel(),
    baseUrl: config?.baseUrl ?? baseURL,
    temperature: config?.temperature,
    maxTokens: config?.maxTokens,
    streaming: config?.streaming,
    timeout: config?.timeout,
    openaiResponsesEnabled: config?.openaiResponsesEnabled,
    providerSpecific: config?.providerSpecific,
    ephemerals: config?.readConnectionPolicy?.(),
    enableTextToolCallParsing: config?.enableTextToolCallParsing,
    textToolCallModels: config?.textToolCallModels,
    providerToolFormatOverrides: config?.providerToolFormatOverrides,
    organizationId: config?.organizationId,
    projectId: config?.projectId,
  };
}
