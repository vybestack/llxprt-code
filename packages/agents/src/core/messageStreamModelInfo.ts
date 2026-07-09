/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ModelInfo } from './turn.js';

export interface ModelInfoDeps {
  config: Config;
  getProviderName: () => string;
  getEffectiveModel: () => string;
}

export function resolveModelForInfo(deps: ModelInfoDeps): string {
  const providerManager =
    deps.config.getContentGeneratorConfig()?.providerManager;
  const activeProvider = providerManager?.getActiveProvider();
  if (activeProvider != null) {
    const activeModel: unknown = activeProvider.getCurrentModel?.();
    if (typeof activeModel === 'string' && activeModel.trim() !== '')
      return activeModel;
    const defaultModel: unknown = activeProvider.getDefaultModel?.();
    if (typeof defaultModel === 'string' && defaultModel.trim() !== '')
      return defaultModel;
  }
  return deps.getEffectiveModel();
}

export function buildModelInfo(deps: ModelInfoDeps): ModelInfo {
  const model = resolveModelForInfo(deps);
  const providerName = deps.getProviderName();
  const profileName = getProfileName(deps.config);
  const hasProfile = typeof profileName === 'string' && profileName !== '';
  return {
    model,
    providerName,
    profileName,
    displayLabel: hasProfile ? profileName : model,
  };
}

export function modelIdentityKey(info: ModelInfo): string {
  return JSON.stringify([
    info.providerName ?? '',
    info.profileName ?? '',
    info.model,
  ]);
}

export function getProfileName(config: Config): string | null {
  try {
    const settingsService = (
      config as unknown as {
        getSettingsService?: () => {
          getCurrentProfileName?: () => string | null;
          get?: (key: string) => unknown;
        };
      }
    ).getSettingsService?.();
    if (settingsService?.getCurrentProfileName)
      return settingsService.getCurrentProfileName();
    if (settingsService?.get) {
      const profile = settingsService.get('currentProfile');
      return typeof profile === 'string' ? profile : null;
    }
  } catch {
    return null;
  }
  return null;
}
