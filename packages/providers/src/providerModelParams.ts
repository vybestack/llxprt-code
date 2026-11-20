/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Model parameters carried by a provider settings record: everything except
 * the standard connection fields and legacy credential aliases.
 */
export function extractModelParams(
  settings: Readonly<Record<string, unknown>>,
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
