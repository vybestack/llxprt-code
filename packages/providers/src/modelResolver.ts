/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model resolution and hydration for providers.
 * Extracted from ProviderManager to keep the main file under the lint
 * line budget.
 */

import type { IProvider } from './IProvider.js';
import {
  hydrateModelsWithRegistry,
  getModelsDevProviderIds,
  type HydratedModel,
} from '@vybestack/llxprt-code-core/models/hydration.js';
import {
  initializeModelRegistry,
  getModelRegistry,
} from '@vybestack/llxprt-code-core/models/registry.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

const logger = new DebugLogger('llxprt:provider:manager');

/**
 * Build the list of available models for a provider, hydrating with
 * models.dev data and falling back to the registry when the provider
 * returns none.
 */
export async function resolveAvailableModels(
  provider: IProvider,
): Promise<HydratedModel[]> {
  // Step 1: Get models from provider (live API or fallback)
  const baseModels = await provider.getModels();

  // Step 2: Initialize registry if needed (non-blocking failure)
  try {
    await initializeModelRegistry();
  } catch {
    logger.debug(
      () =>
        `[getAvailableModels] Registry init failed for provider: ${provider.name}`,
    );
    return baseModels
      .filter((m) => m.supportedToolFormats.length > 0)
      .map((m) => ({ ...m, hydrated: false }));
  }

  // Step 3: Get modelsDevProviderIds for hydration lookup
  const modelsDevProviderIds = getModelsDevProviderIds(provider.name);

  // Step 4: If provider returned no models, fall back to registry-only models
  const registryModels = collectRegistryModels(
    baseModels,
    modelsDevProviderIds,
    provider.name,
  );
  if (registryModels) {
    return registryModels;
  }

  logger.debug(
    () =>
      `[getAvailableModels] Hydrating ${baseModels.length} models for provider: ${provider.name} with modelsDevIds: ${JSON.stringify(modelsDevProviderIds)}`,
  );

  // Step 5: Hydrate with models.dev data
  const hydratedModels = await hydrateModelsWithRegistry(
    baseModels,
    modelsDevProviderIds,
  );

  // Step 6: Filter to only models with tool support (required for CLI)
  return hydratedModels.filter((m) => m.capabilities?.toolCalling !== false);
}

/**
 * If the provider returned no models, collect models from the registry.
 * Returns the models array if found, or undefined to continue hydration.
 */
function collectRegistryModels(
  baseModels: Awaited<ReturnType<IProvider['getModels']>>,
  modelsDevProviderIds: string[],
  providerName: string,
): HydratedModel[] | undefined {
  if (baseModels.length > 0 || modelsDevProviderIds.length === 0) {
    return undefined;
  }

  logger.debug(
    () =>
      `[getAvailableModels] Provider ${providerName} returned 0 models, falling back to registry`,
  );
  const registry = getModelRegistry();
  if (!registry.isInitialized()) {
    return undefined;
  }

  const registryModels: HydratedModel[] = [];
  for (const providerId of modelsDevProviderIds) {
    const providerModels = registry.getByProvider(providerId);
    collectSupportedModels(providerModels, providerName, registryModels);
  }

  return registryModels.length > 0 ? registryModels : undefined;
}

/**
 * Collect models that do not explicitly disable tool support.
 */
function collectSupportedModels(
  registryModels: ReturnType<
    ReturnType<typeof getModelRegistry>['getByProvider']
  >,
  providerName: string,
  output: HydratedModel[],
): void {
  for (const rm of registryModels) {
    const capabilities = (rm as { capabilities?: typeof rm.capabilities })
      .capabilities;
    if (capabilities?.toolCalling === false) {
      continue;
    }
    output.push({
      id: rm.modelId,
      name: rm.name,
      provider: providerName,
      supportedToolFormats: [],
      contextWindow: rm.contextWindow,
      maxOutputTokens: rm.maxOutputTokens,
      capabilities: rm.capabilities,
      pricing: rm.pricing,
      limits: rm.limits,
      metadata: rm.metadata,
      providerId: rm.providerId,
      modelId: rm.modelId,
      family: rm.family,
      hydrated: true,
    });
  }
}
