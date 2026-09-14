/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  initializeModelRegistry,
  listImageOutputModels,
} from '@vybestack/llxprt-code-core';
import { loadProviderAliasEntries } from '@vybestack/llxprt-code-providers/composition.js';
import { isLocalImageEndpoint } from '@vybestack/llxprt-code-providers/openai/imageEndpoint.js';
import {
  getImageModelsForAlias,
  listOpenAiCompatibleModels,
  ImageProviderAliasError,
} from '@vybestack/llxprt-code-providers';

/**
 * Discover models using the image provider's source, without manual entries.
 * @param provider Provider alias selected for image operations.
 * @param options Optional transport for local endpoint discovery.
 * @returns Model IDs in source order.
 * @throws ImageProviderAliasError for unknown aliases; ImageBackendError for endpoint failures.
 */
export async function listImageModelChoices(
  provider: string,
  options: { readonly fetchImpl?: typeof fetch } = {},
): Promise<string[]> {
  const aliases = loadProviderAliasEntries();
  const entry = aliases.find((candidate) => candidate.alias === provider);
  if (!entry)
    throw new ImageProviderAliasError(
      provider,
      aliases.map((candidate) => candidate.alias),
    );
  if (provider === 'codex') return getImageModelsForAlias(provider);
  const baseUrl = entry.config['base-url'];
  if (baseUrl && isLocalImageEndpoint(baseUrl)) {
    return listOpenAiCompatibleModels(baseUrl, undefined, options);
  }
  await initializeModelRegistry();
  return listImageOutputModels(provider);
}
