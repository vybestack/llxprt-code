/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getCliVersion } from '../../utils/version.js';
import type { CommandContext, SlashCommand } from './types.js';
import { CommandKind } from './types.js';
import process from 'node:process';
import { MessageType, type HistoryItemAbout } from '../types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';

type ProviderWithBaseURL = {
  getBaseURL?: () => string | undefined;
};

type WrappedProvider = {
  wrappedProvider?: unknown;
};

type RuntimeProviderManager = ReturnType<
  ReturnType<typeof getRuntimeApi>['getCliProviderManager']
>;

type RuntimeActiveProvider = ReturnType<
  RuntimeProviderManager['getActiveProvider']
>;

function getSandboxEnv(): string {
  if (process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec') {
    return process.env.SANDBOX;
  }

  if (process.env.SANDBOX === 'sandbox-exec') {
    return `sandbox-exec (${process.env.SEATBELT_PROFILE ?? 'unknown'})`;
  }

  return 'no sandbox';
}

function getRuntimeApiOrNull(): ReturnType<typeof getRuntimeApi> | null {
  try {
    return getRuntimeApi();
  } catch {
    return null;
  }
}

function getProviderBaseURL(provider: unknown): string {
  const providerWithGetBaseURL = provider as ProviderWithBaseURL;
  if (typeof providerWithGetBaseURL.getBaseURL === 'function') {
    return providerWithGetBaseURL.getBaseURL() ?? '';
  }

  return '';
}

function getActiveProviderOrNull(
  providerManager: RuntimeProviderManager,
): RuntimeActiveProvider | null {
  try {
    return providerManager.getActiveProvider();
  } catch {
    return null;
  }
}

function shouldRenderRuntimeModelLabel(
  activeProviderName: string,
  modelName: string | null,
  provider: string,
): modelName is string {
  return (
    activeProviderName !== '' && modelName !== null && provider !== 'Unknown'
  );
}

function getProviderDetailsFromRuntime(
  runtimeApi: ReturnType<typeof getRuntimeApi>,
): {
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

  const providerManager = runtimeApi.getCliProviderManager();
  const activeProvider = getActiveProviderOrNull(providerManager);
  if (activeProvider !== null) {
    provider = activeProvider.name;
    const wrappedProvider = (activeProvider as WrappedProvider).wrappedProvider;
    const finalProvider = wrappedProvider ?? activeProvider;
    baseURL = getProviderBaseURL(finalProvider);
  }

  if (baseURL === '') {
    const runtimeBaseUrl = runtimeApi.getEphemeralSetting('base-url');
    if (typeof runtimeBaseUrl === 'string') {
      baseURL = runtimeBaseUrl;
    }
  }

  return { modelVersion: resolvedModelVersion, provider, baseURL };
}

function getConfigModel(context: CommandContext): string | undefined {
  return context.services.config?.getModel();
}

function getFallbackBaseURL(context: CommandContext): string {
  const fallbackBaseUrl =
    context.services.config?.getEphemeralSetting('base-url');
  return typeof fallbackBaseUrl === 'string' ? fallbackBaseUrl : '';
}

function getFallbackProvider(context: CommandContext): string {
  const getProvider = context.services.config?.getProvider;
  return typeof getProvider === 'function'
    ? (getProvider.call(context.services.config) ?? '')
    : '';
}

function getIdeClientDisplayName(context: CommandContext): string {
  const config = context.services.config;
  if (config?.getIdeMode() !== true) {
    return '';
  }

  return config.getIdeClient()?.getDetectedIdeDisplayName() ?? '';
}

async function getKeyfilePath(context: CommandContext): Promise<string> {
  try {
    const { getProviderManager } = await import(
      '../../providers/providerManagerInstance.js'
    );
    const providerManager = getProviderManager();
    const providerName = providerManager.getActiveProviderName();
    if (providerName !== '') {
      return context.services.settings.getProviderKeyfile(providerName) ?? '';
    }
  } catch {
    // Ignore errors and leave defaults
  }

  return '';
}

export const aboutCommand: SlashCommand = {
  name: 'about',
  description: 'show version info',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context) => {
    const osVersion = process.platform;
    const sandboxEnv = getSandboxEnv();
    // Determine the currently selected model/provider using runtime diagnostics
    let modelVersion = 'Unknown';
    let provider = 'Unknown';
    let baseURL = '';
    const runtimeApi = getRuntimeApiOrNull();

    if (runtimeApi !== null) {
      try {
        const runtimeDetails = getProviderDetailsFromRuntime(runtimeApi);
        modelVersion = runtimeDetails.modelVersion;
        provider = runtimeDetails.provider;
        baseURL = runtimeDetails.baseURL;
      } catch {
        modelVersion = getConfigModel(context) ?? modelVersion;
      }
    } else {
      modelVersion = getConfigModel(context) ?? modelVersion;
    }

    if (modelVersion === 'Unknown') {
      modelVersion = getConfigModel(context) ?? modelVersion;
    }

    if (baseURL === '') {
      baseURL = getFallbackBaseURL(context);
    }

    if (provider === 'Unknown') {
      provider = getFallbackProvider(context) || provider;
    }

    const cliVersion = await getCliVersion();
    const gcpProject = process.env.GOOGLE_CLOUD_PROJECT ?? '';
    const ideClient = getIdeClientDisplayName(context);

    // Determine keyfile path and key status for the active provider (if any)
    const keyfilePath = await getKeyfilePath(context);
    const keyStatus = '';

    const aboutItem: Omit<HistoryItemAbout, 'id'> = {
      type: MessageType.ABOUT,
      cliVersion,
      osVersion,
      sandboxEnv,
      modelVersion,
      gcpProject,
      keyfile: keyfilePath,
      key: keyStatus,
      ideClient,
      provider,
      baseURL,
    };

    context.ui.addItem(aboutItem);
  },
};
