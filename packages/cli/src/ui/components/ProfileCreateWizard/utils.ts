/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PROVIDER_OPTIONS } from './constants.js';
import { WizardStep } from './types.js';
import type { WizardState, ConnectionTestResult } from './types.js';

function expandTilde(filePath: string): string {
  // Handle ~/ for home directory
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  // Handle bare ~ for home directory
  if (filePath === '~') {
    return os.homedir();
  }
  // Handle ./ for current directory (resolve to absolute path)
  if (filePath.startsWith('./')) {
    return path.resolve(filePath);
  }
  // Handle / for absolute path (already absolute)
  if (filePath.startsWith('/')) {
    return filePath;
  }
  // Relative path - resolve to absolute
  return path.resolve(filePath);
}

export function needsBaseUrlConfig(provider: string | null): boolean {
  if (!provider) return false;
  const providerOption = PROVIDER_OPTIONS.find((p) => p.value === provider);
  const result = providerOption?.needsBaseUrl ?? false;
  return result;
}

export function generateProfileNameSuggestions(
  config: WizardState['config'],
): string[] {
  const suggestions: string[] = [];

  // Suggestion 1: provider-model (cleaned)
  if (config.provider && config.model) {
    const cleanProvider = config.provider.replace(/[^a-z0-9]/gi, '-');
    const cleanModel = config.model.replace(/[^a-z0-9.]/gi, '-');
    suggestions.push(`${cleanProvider}-${cleanModel}`);
  }

  // Suggestion 2: provider-custom
  if (config.provider) {
    suggestions.push(`${config.provider}-custom`);
  }

  // Suggestion 3: model-only
  if (config.model) {
    const cleanModel = config.model.replace(/[^a-z0-9.]/gi, '-');
    suggestions.push(cleanModel);
  }

  return suggestions.slice(0, 3); // Max 3 suggestions
}

export function buildProfileJSON(state: WizardState): Record<string, unknown> {
  const profile: Record<string, unknown> = {
    version: 1,
    provider:
      state.config.provider === 'custom' ? 'openai' : state.config.provider,
    model: state.config.model,
    modelParams: {},
    ephemeralSettings: {},
  };

  // Add base URL if present
  if (state.config.baseUrl) {
    (profile.ephemeralSettings as Record<string, unknown>)['base-url'] =
      state.config.baseUrl;
  }

  // Add authentication
  if (state.config.auth.type === 'apikey') {
    (profile.ephemeralSettings as Record<string, unknown>)['auth-key'] =
      state.config.auth.value;
  } else if (state.config.auth.type === 'keyfile') {
    (profile.ephemeralSettings as Record<string, unknown>)['auth-keyfile'] =
      state.config.auth.value;
  } else if (state.config.auth.type === 'oauth') {
    profile.auth = {
      type: 'oauth',
      buckets: state.config.auth.buckets || ['default'],
    };
  }

  // Add parameters if configured
  if (state.config.params) {
    if (state.config.params.temperature !== undefined) {
      (profile.modelParams as Record<string, unknown>).temperature =
        state.config.params.temperature;
    }
    if (state.config.params.maxTokens !== undefined) {
      (profile.modelParams as Record<string, unknown>).max_tokens =
        state.config.params.maxTokens;
    }
    if (state.config.params.contextLimit !== undefined) {
      (profile.ephemeralSettings as Record<string, unknown>)['context-limit'] =
        state.config.params.contextLimit;
    }
  }

  return profile;
}

export async function saveProfile(
  name: string,
  config: Record<string, unknown>,
  opts: { overwrite?: boolean } = {},
): Promise<{
  success: boolean;
  error?: string;
  path?: string;
  alreadyExists?: boolean;
}> {
  try {
    const profilesDir = path.join(os.homedir(), '.llxprt', 'profiles');

    // Ensure directory exists with restrictive permissions (owner-only)
    await fs.mkdir(profilesDir, { recursive: true, mode: 0o700 });

    // Write profile with restrictive permissions (owner read/write only)
    const profilePath = path.join(profilesDir, `${name}.json`);
    const data = JSON.stringify(config, null, 2);
    await fs.writeFile(profilePath, data, {
      encoding: 'utf-8',
      mode: 0o600,
      flag: opts.overwrite ? 'w' : 'wx',
    });

    return { success: true, path: profilePath };
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'EEXIST'
    ) {
      return {
        success: false,
        alreadyExists: true,
        error: 'Profile name already exists',
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function formatConfigSummary(state: WizardState): string {
  const lines: string[] = [];

  // Provider
  const providerDisplay =
    state.config.provider === 'custom'
      ? 'OpenAI-compatible'
      : state.config.provider;
  lines.push(`Provider: ${providerDisplay}`);

  // Base URL (if present)
  if (state.config.baseUrl) {
    lines.push(`Base URL: ${state.config.baseUrl}`);
  }

  // Model
  lines.push(`Model: ${state.config.model}`);

  // Auth
  const authDisplay =
    state.config.auth.type === 'apikey'
      ? 'API key (stored in profile)'
      : state.config.auth.type === 'keyfile'
        ? `Key file (${state.config.auth.value})`
        : state.config.auth.type === 'oauth'
          ? 'OAuth (lazy authentication)'
          : 'None';
  lines.push(`Auth: ${authDisplay}`);

  // Parameters (if configured)
  if (state.config.params) {
    if (state.config.params.temperature !== undefined) {
      lines.push(`Temperature: ${state.config.params.temperature}`);
    }
    if (state.config.params.maxTokens !== undefined) {
      lines.push(`Max Tokens: ${state.config.params.maxTokens}`);
    }
    if (state.config.params.contextLimit !== undefined) {
      lines.push(`Context Limit: ${state.config.params.contextLimit}`);
    }
  }

  return lines.join('\n');
}

export async function testConnectionWithTimeout(
  provider: string,
  baseUrl: string | undefined,
  model: string,
  authKind: 'apikey' | 'keyfile',
  authValue: string,
  timeoutMs = 30000,
): Promise<ConnectionTestResult> {
  // Create timeout sentinel that resolves (not rejects) to avoid unhandled rejections
  const TIMEOUT_SENTINEL = { success: false, timedOut: true } as const;
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timeoutId = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
  });

  // Wrap testConnection to handle its own rejections
  const testPromise = testConnection(
    provider,
    baseUrl,
    model,
    authKind,
    authValue,
  )
    .then((res) => res)
    .catch(
      (err): ConnectionTestResult => ({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
    );

  // Race the promises
  const result = await Promise.race([testPromise, timeoutPromise]);

  // Clear timeout to prevent it from firing
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }

  return result;
}

/**
 * Tests connection to the provider with the given configuration.
 *
 * NOTE: This is currently a placeholder implementation that only validates
 * the API key is non-empty. A full implementation would:
 * 1. Create a temporary provider instance with the given configuration
 * 2. Make a minimal API call (e.g., list models, get account info)
 * 3. Verify the response is successful
 *
 * This requires adding a testProviderConnection() method to RuntimeApi
 * that can create isolated provider instances without affecting the
 * active runtime state.
 *
 * @see Design doc section "Connection Testing" (lines 673-704)
 */
async function testConnection(
  _provider: string,
  _baseUrl: string | undefined,
  _model: string,
  authKind: 'apikey' | 'keyfile',
  authValue: string,
): Promise<ConnectionTestResult> {
  try {
    // Read key from file if keyfile type
    const apiKey =
      authKind === 'keyfile'
        ? await fs
            .readFile(expandTilde(authValue), 'utf-8')
            .then((k) => k.trim())
        : authValue;

    // Basic validation: ensure we have a non-empty key
    if (!apiKey || apiKey.trim().length === 0) {
      return { success: false, error: 'API key is empty' };
    }

    // TODO: Implement actual API testing
    // This requires adding a testProviderConnection() method to the runtime
    // that can create an isolated provider instance and make a test request
    // without affecting the active runtime state.
    //
    // Example implementation:
    // const runtime = getRuntimeApi();
    // const testResult = await runtime.testProviderConnection({
    //   provider,
    //   baseUrl,
    //   model,
    //   apiKey,
    // });
    // return { success: testResult.ok };

    // For now, return success if we have a non-empty key
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getNextStep(
  current: WizardStep,
  state: WizardState,
): WizardStep {
  switch (current) {
    case WizardStep.PROVIDER_SELECT:
      // Show base URL only for local/custom providers
      if (needsBaseUrlConfig(state.config.provider)) {
        return WizardStep.BASE_URL_CONFIG;
      }
      return WizardStep.MODEL_SELECT;

    case WizardStep.BASE_URL_CONFIG:
      return WizardStep.MODEL_SELECT;

    case WizardStep.MODEL_SELECT:
      return WizardStep.AUTHENTICATION;

    case WizardStep.AUTHENTICATION:
      return WizardStep.ADVANCED_PARAMS;

    case WizardStep.ADVANCED_PARAMS:
      return WizardStep.SAVE_PROFILE;

    case WizardStep.SAVE_PROFILE:
      return WizardStep.SUCCESS_SUMMARY;

    default:
      return current;
  }
}

export function getPreviousStep(state: WizardState): WizardStep {
  // Pop from step history
  return (
    state.stepHistory[state.stepHistory.length - 2] ||
    WizardStep.PROVIDER_SELECT
  );
}

export function getStepPosition(state: WizardState): {
  current: number;
  total: number;
} {
  // Current position is based on how many steps we've taken
  const current = state.stepHistory.length;

  // Total steps depends on whether we need base URL step
  // 1. Provider Select
  // 2. Base URL (conditional)
  // 3. Model Select
  // 4. Authentication
  // 5. Advanced Params
  // 6. Save Profile
  // 7. Success Summary
  const baseSteps = 6; // All steps except BASE_URL_CONFIG
  const needsBaseUrl = needsBaseUrlConfig(state.config.provider);
  const total = needsBaseUrl ? baseSteps + 1 : baseSteps;

  return { current, total };
}
