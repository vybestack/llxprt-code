/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RuntimeApi } from '../contexts/RuntimeContext.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { AboutDetails } from './aboutCommand.js';

function shouldRenderRuntimeModelLabel(
  activeProviderName: string,
  modelName: string | null,
  provider: string,
): modelName is string {
  return (
    activeProviderName !== '' && modelName !== null && provider !== 'Unknown'
  );
}

function getProviderDetailsFromRuntime(runtimeApi: RuntimeApi): {
  modelVersion: string;
  provider: string;
  baseURL: string;
} {
  const snapshot = runtimeApi.getRuntimeDiagnosticsSnapshot();
  const modelVersion = snapshot.modelName ?? 'Unknown';
  let provider = snapshot.providerName ?? 'Unknown';
  let baseURL = '';

  const activeProviderName = runtimeApi.getActiveProviderName();
  let resolvedModelVersion = modelVersion;
  if (
    shouldRenderRuntimeModelLabel(
      activeProviderName,
      snapshot.modelName,
      provider,
    )
  ) {
    resolvedModelVersion = `${activeProviderName}:${snapshot.modelName}`;
  }

  const details = runtimeApi.getActiveProviderDetails();
  if (details) {
    provider = details.name;
    baseURL = details.baseURL;
  }

  if (baseURL === '') {
    const runtimeBaseUrl = runtimeApi.getEphemeralSetting('base-url');
    if (typeof runtimeBaseUrl === 'string') {
      baseURL = runtimeBaseUrl;
    }
  }

  return { modelVersion: resolvedModelVersion, provider, baseURL };
}

export function bindAboutDetails(
  api: RuntimeApi,
  config: CliUiRuntime | null,
  settings: LoadedSettings,
): () => Promise<AboutDetails> {
  return async () => {
    let modelVersion = 'Unknown';
    let provider = 'Unknown';
    let baseURL = '';
    try {
      const details = getProviderDetailsFromRuntime(api);
      modelVersion = details.modelVersion;
      provider = details.provider;
      baseURL = details.baseURL;
    } catch {
      modelVersion = config?.getModel() ?? modelVersion;
    }
    if (modelVersion === 'Unknown')
      modelVersion = config?.getModel() ?? modelVersion;
    if (baseURL === '') {
      const value = config?.getEphemeralSetting('base-url');
      baseURL = typeof value === 'string' ? value : '';
    }
    if (provider === 'Unknown') {
      const configured = config?.getProvider();
      if (configured !== undefined && configured !== '') provider = configured;
    }
    const ideClient =
      config?.getIdeMode() === true
        ? (config.getIdeClient()?.getDetectedIdeDisplayName() ?? '')
        : '';
    let keyfile = '';
    try {
      const providerName = api.providerStatus().providerName;
      if (providerName !== null && providerName !== '')
        keyfile = settings.getProviderKeyfile(providerName) ?? '';
    } catch {
      // Ignore errors and leave defaults
    }
    return { modelVersion, provider, baseURL, ideClient, keyfile };
  };
}
