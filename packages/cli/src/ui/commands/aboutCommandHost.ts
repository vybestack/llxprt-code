/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GetActiveProviderDetailsOperation,
  type GetActiveProviderNameOperation,
  type GetEphemeralSettingOperation,
  type GetRuntimeDiagnosticsSnapshotOperation,
  type ProviderStatusOperation,
} from '../contexts/RuntimeContext.js';

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

function readProviderDetails(
  readSnapshot: GetRuntimeDiagnosticsSnapshotOperation,
  readActiveProvider: GetActiveProviderNameOperation,
  readActiveDetails: GetActiveProviderDetailsOperation,
  readSetting: GetEphemeralSettingOperation,
): { modelVersion: string; provider: string; baseURL: string } {
  const snapshot = readSnapshot();
  const modelVersion = snapshot.modelName ?? 'Unknown';
  let provider = snapshot.providerName ?? 'Unknown';
  let baseURL = '';
  const activeProviderName = readActiveProvider();
  const resolvedModelVersion = shouldRenderRuntimeModelLabel(
    activeProviderName,
    snapshot.modelName,
    provider,
  )
    ? `${activeProviderName}:${snapshot.modelName}`
    : modelVersion;
  const details = readActiveDetails();
  if (details) {
    provider = details.name;
    baseURL = details.baseURL;
  }
  if (baseURL === '') {
    const value = readSetting('base-url');
    if (typeof value === 'string') baseURL = value;
  }
  return { modelVersion: resolvedModelVersion, provider, baseURL };
}

export function bindAboutDetails(
  readSnapshot: GetRuntimeDiagnosticsSnapshotOperation,
  readActiveProvider: GetActiveProviderNameOperation,
  readActiveDetails: GetActiveProviderDetailsOperation,
  readRuntimeSetting: GetEphemeralSettingOperation,
  readConfiguredModel: () => string | undefined,
  readConfiguredSetting: GetEphemeralSettingOperation,
  readConfiguredProvider: () => string | undefined,
  readIdeClient: () => string,
  readProviderStatus: ProviderStatusOperation,
  readKeyfile: (provider: string) => string | undefined,
): () => Promise<AboutDetails> {
  return async () => {
    let modelVersion = 'Unknown';
    let provider = 'Unknown';
    let baseURL = '';
    try {
      const details = readProviderDetails(
        readSnapshot,
        readActiveProvider,
        readActiveDetails,
        readRuntimeSetting,
      );
      modelVersion = details.modelVersion;
      provider = details.provider;
      baseURL = details.baseURL;
    } catch {
      modelVersion = readConfiguredModel() ?? modelVersion;
    }
    if (modelVersion === 'Unknown')
      modelVersion = readConfiguredModel() ?? modelVersion;
    if (baseURL === '') {
      const value = readConfiguredSetting('base-url');
      baseURL = typeof value === 'string' ? value : '';
    }
    if (provider === 'Unknown') {
      const configured = readConfiguredProvider();
      if (configured !== undefined && configured !== '') provider = configured;
    }
    const ideClient = readIdeClient();
    let keyfile = '';
    try {
      const providerName = readProviderStatus().providerName;
      if (providerName !== null && providerName !== '')
        keyfile = readKeyfile(providerName) ?? '';
    } catch {
      // Ignore errors and leave defaults
    }
    return { modelVersion, provider, baseURL, ideClient, keyfile };
  };
}
