/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_GEMINI_MODEL } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { loadProviderAliasEntries } from '@vybestack/llxprt-code-providers/composition.js';
import { firstNonEmptyString } from '../utils/coalesce.js';

const logger = new DebugLogger('llxprt:config:providerModelResolver');

/**
 * Trims a string candidate; returns undefined for whitespace-only strings so
 * they are treated as absent by firstNonEmptyString.
 */
function trimIfString(value: string | undefined | null): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export interface ProviderModelInput {
  cliProvider: string | undefined;
  profileProvider: string | undefined;
  envDefaultProvider: string | undefined;
  cliModel: string | undefined;
  profileModel: string | undefined;
  settingsModel: string | undefined;
  envDefaultModel: string | undefined;
  envGeminiModel: string | undefined;
}

export interface ProviderModelResult {
  readonly provider: string | undefined;
  readonly model: string;
}

/**
 * Looks up the default model for a known provider alias.
 * Returns undefined if the alias is not found or has no defaultModel.
 */
function getAliasDefaultModel(provider: string): string | undefined {
  try {
    const entry = loadProviderAliasEntries().find(
      (candidate: { alias: string; config: { baseProvider: string } }) =>
        candidate.alias === provider &&
        candidate.alias !== candidate.config.baseProvider,
    );
    const candidate = entry?.config.defaultModel;
    return typeof candidate === 'string' && candidate.trim()
      ? candidate.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves provider (4-level precedence) and model (6-level precedence).
 *
 * Provider: CLI --provider > profile > LLXPRT_DEFAULT_PROVIDER env > undefined
 * (no implicit hosted provider fallback)
 * Model: CLI --model > profile > settings > alias default > env vars > Gemini default
 */
export function resolveProviderAndModel(
  input: ProviderModelInput,
): ProviderModelResult {
  const {
    cliProvider,
    profileProvider,
    envDefaultProvider,
    cliModel,
    profileModel,
    settingsModel,
    envDefaultModel,
    envGeminiModel,
  } = input;

  let provider: string | undefined;
  if (cliProvider && cliProvider.trim() !== '') {
    provider = cliProvider.trim();
  } else if (profileProvider && profileProvider.trim() !== '') {
    provider = profileProvider.trim();
  } else if (envDefaultProvider && envDefaultProvider.trim() !== '') {
    provider = envDefaultProvider.trim();
  } else {
    provider = undefined;
  }

  logger.debug(
    () =>
      `Provider selection: cli=${cliProvider}, profile=${profileProvider}, env=${envDefaultProvider}, final=${provider ?? '(none)'}`,
  );

  const aliasDefaultModel =
    provider !== undefined ? getAliasDefaultModel(provider) : undefined;

  const providerDefault =
    provider === 'gemini' ? DEFAULT_GEMINI_MODEL : (aliasDefaultModel ?? '');
  const configuredModel = firstNonEmptyString(
    trimIfString(cliModel),
    trimIfString(profileModel),
    trimIfString(settingsModel),
  );
  // GEMINI_MODEL env is only relevant for the gemini provider — it must
  // never leak to non-Gemini providers.
  const scopedEnvModel =
    provider === 'gemini' ? trimIfString(envGeminiModel) : undefined;
  const environmentModel = firstNonEmptyString(
    trimIfString(envDefaultModel),
    scopedEnvModel,
  );
  const model: string =
    firstNonEmptyString(configuredModel, aliasDefaultModel, environmentModel) ??
    providerDefault;

  return { provider, model };
}
