/**
 * Model info resolution helpers extracted from MessageStreamOrchestrator
 * to keep it within the max-lines lint limit.
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { AgentEventType } from '@vybestack/llxprt-code-core/core/turn.js';
import type { ServerAgentStreamEvent } from '@vybestack/llxprt-code-core/core/turn.js';
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

/** Resolves the current profile name from the config's settings service. */
export function resolveProfileName(config: Config): string | null {
  try {
    const svc = (
      config as unknown as {
        getSettingsService?: () => {
          getCurrentProfileName?: () => string | null;
          get?: (key: string) => unknown;
        };
      }
    ).getSettingsService?.();
    if (svc?.getCurrentProfileName) return svc.getCurrentProfileName();
    if (svc?.get) {
      const p = svc.get('currentProfile');
      return typeof p === 'string' ? p : null;
    }
  } catch {
    /* Settings service unavailable */
  }
  return null;
}

export function buildModelInfo(
  config: Config,
  identity: EffectiveModelIdentity,
): ModelInfo {
  const profileName = resolveProfileName(config);
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

/** Emits a ModelInfo event for a new sequence (always emitted). */
export async function* emitModelInfoForNewSequence(
  config: Config,
  identity: EffectiveModelIdentity,
): AsyncGenerator<ServerAgentStreamEvent, void> {
  yield {
    type: AgentEventType.ModelInfo,
    value: buildModelInfo(config, identity),
  };
}
