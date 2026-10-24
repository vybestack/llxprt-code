/**
 * Model info resolution helpers extracted from MessageStreamOrchestrator
 * to keep it within the max-lines lint limit.
 */

import type { ModelInfo } from './turn.js';

export interface EffectiveModelIdentity {
  readonly providerName: string;
  readonly model: string;
}

export type RoutedModelProvider = {
  readonly name: string;
  readonly getCurrentModel?: () => string | undefined;
  readonly getDefaultModel?: () => string | undefined;
};

function nonBlank(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function readModel(
  getModel: (() => string | undefined) | undefined,
): string | undefined {
  try {
    return nonBlank(getModel?.());
  } catch {
    return undefined;
  }
}

export function buildEffectiveModelIdentity(
  routedProviderName: string,
  routedProvider: RoutedModelProvider | undefined,
  currentSequenceModel: string | null,
  configFallback: string,
): EffectiveModelIdentity {
  const sequenceModel = nonBlank(currentSequenceModel);
  if (sequenceModel) {
    return { providerName: routedProviderName, model: sequenceModel };
  }

  const currentModel = readModel(() => routedProvider?.getCurrentModel?.());
  if (currentModel) {
    return { providerName: routedProviderName, model: currentModel };
  }

  const defaultModel = readModel(() => routedProvider?.getDefaultModel?.());
  return {
    providerName: routedProviderName,
    model: defaultModel ?? configFallback,
  };
}

export function buildModelInfo(
  identity: EffectiveModelIdentity,
  profileName: string | null,
): ModelInfo {
  return {
    model: identity.model,
    providerName: identity.providerName,
    profileName,
    displayLabel:
      profileName && profileName !== ''
        ? `${profileName}:${identity.model}`
        : identity.model,
  };
}

/** Builds a stable identity key for a ModelInfo. */
export function modelIdentityKey(info: ModelInfo): string {
  return JSON.stringify([
    info.providerName ?? '',
    info.profileName ?? '',
    info.model,
  ]);
}

export function resolveClientModelIdentity(
  configFallback: string,
  runtimeProviderName: string,
  currentSequenceModel: string | null,
  chat:
    | { resolveProviderForRuntime(operation: string): RoutedModelProvider }
    | undefined,
): EffectiveModelIdentity {
  let routedProviderName = runtimeProviderName;
  let routedProvider: RoutedModelProvider | undefined = undefined;
  if (chat && typeof chat.resolveProviderForRuntime === 'function') {
    try {
      const provider = chat.resolveProviderForRuntime(
        'AgentClient.getEffectiveModelIdentity',
      );
      routedProviderName = provider.name;
      routedProvider = provider;
    } catch {
      routedProviderName = runtimeProviderName;
      routedProvider = undefined;
    }
  }
  return buildEffectiveModelIdentity(
    routedProviderName,
    routedProvider,
    currentSequenceModel,
    configFallback,
  );
}
