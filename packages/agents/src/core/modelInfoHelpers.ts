/**
 * Model info resolution helpers extracted from MessageStreamOrchestrator
 * to keep it within the max-lines lint limit.
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { AgentEventType } from '@vybestack/llxprt-code-core/core/turn.js';
import type { ServerAgentStreamEvent } from '@vybestack/llxprt-code-core/core/turn.js';
import type { ModelInfo } from './turn.js';

/** Resolves the effective model from the active provider or falls back. */
export function resolveActiveModel(config: Config, fallback: string): string {
  const activeProvider = config
    .getContentGeneratorConfig()
    ?.providerManager?.getActiveProvider();
  if (activeProvider) {
    const activeModel = activeProvider.getCurrentModel?.();
    if (typeof activeModel === 'string' && activeModel.trim() !== '')
      return activeModel;
    const defaultModel = activeProvider.getDefaultModel?.();
    if (typeof defaultModel === 'string' && defaultModel.trim() !== '')
      return defaultModel;
  }
  return fallback;
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

/** Resolves the provider name from config. */
export function resolveProviderName(config: Config): string {
  const activeName = config
    .getContentGeneratorConfig()
    ?.providerManager?.getActiveProviderName();
  return activeName && activeName.length > 0 ? activeName : 'backend';
}

/** Builds the full ModelInfo from config. */
export function buildModelInfo(
  config: Config,
  fallbackModel: string,
): ModelInfo {
  const model = resolveActiveModel(config, fallbackModel);
  const profileName = resolveProfileName(config);
  return {
    model,
    providerName: resolveProviderName(config),
    profileName,
    displayLabel:
      profileName && profileName !== '' ? `${profileName}:${model}` : model,
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
  fallbackModel: string,
): AsyncGenerator<ServerAgentStreamEvent, void> {
  yield {
    type: AgentEventType.ModelInfo,
    value: buildModelInfo(config, fallbackModel),
  };
}
