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

interface ModelProvider {
  getCurrentModel?: () => unknown;
  getDefaultModel?: () => unknown;
}

function isModelProvider(value: unknown): value is ModelProvider {
  if (typeof value !== 'object' || value === null) return false;
  const currentModel =
    'getCurrentModel' in value ? value.getCurrentModel : undefined;
  const defaultModel =
    'getDefaultModel' in value ? value.getDefaultModel : undefined;
  return (
    (currentModel === undefined || typeof currentModel === 'function') &&
    (defaultModel === undefined || typeof defaultModel === 'function')
  );
}

export function resolveModelForInfo(deps: ModelInfoDeps): string {
  const providerManager =
    deps.config.getContentGeneratorConfig()?.providerManager;
  let activeProvider: unknown;
  try {
    activeProvider = providerManager?.getActiveProvider();
  } catch {
    return deps.getEffectiveModel();
  }
  if (isModelProvider(activeProvider)) {
    const activeModel = activeProvider.getCurrentModel?.();
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
    displayLabel: hasProfile ? `${profileName}:${model}` : model,
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
    const settingsService = config.getSettingsService();
    const profileName = settingsService.getCurrentProfileName();
    if (profileName !== null) return profileName;
    const profile = settingsService.get('currentProfile');
    return typeof profile === 'string' && profile !== '' ? profile : null;
  } catch {
    return null;
  }
}
