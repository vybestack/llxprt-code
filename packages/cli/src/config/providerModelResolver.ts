/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_GEMINI_MODEL, DebugLogger } from '@vybestack/llxprt-code-core';
import { loadProviderAliasEntries } from '../providers/providerAliases.js';

const logger = new DebugLogger('llxprt:config:providerModelResolver');

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
  readonly provider: string;
  readonly model: string;
}

/**
 * Looks up the default model for a known provider alias.
 * Returns undefined if the alias is not found or has no defaultModel.
 */
function getAliasDefaultModel(provider: string): string | undefined {
  try {
    const entry = loadProviderAliasEntries().find(
      (candidate: { alias: string }) => candidate.alias === provider,
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
 * Provider: CLI --provider > profile > LLXPRT_DEFAULT_PROVIDER env > 'gemini'
 * Model: CLI --model > profile > settings > env vars > alias default > Gemini default
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

  let provider: string;
  if (cliProvider) {
    provider = cliProvider;
  } else if (profileProvider && profileProvider.trim() !== '') {
    provider = profileProvider;
  } else if (envDefaultProvider) {
    provider = envDefaultProvider;
  } else {
    provider = 'gemini';
  }

  logger.debug(
    () =>
      `Provider selection: cli=${cliProvider}, profile=${profileProvider}, env=${envDefaultProvider}, final=${provider}`,
  );

  const aliasDefaultModel = getAliasDefaultModel(provider);

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty model string should fall back to next source */
  const model: string =
    cliModel ||
    profileModel ||
    settingsModel ||
    envDefaultModel ||
    envGeminiModel ||
    (provider === 'gemini' ? DEFAULT_GEMINI_MODEL : aliasDefaultModel || '');
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

  return { provider, model };
}
