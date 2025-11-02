/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getCliVersion } from '../../utils/version.js';
import { CommandKind, SlashCommand } from './types.js';
import process from 'node:process';
import { MessageType, type HistoryItemAbout } from '../types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';

export const aboutCommand: SlashCommand = {
  name: 'about',
  description: 'show version info',
  kind: CommandKind.BUILT_IN,
  action: async (context) => {
    const osVersion = process.platform;
    let sandboxEnv = 'no sandbox';
    if (process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec') {
      sandboxEnv = process.env.SANDBOX;
    } else if (process.env.SANDBOX === 'sandbox-exec') {
      sandboxEnv = `sandbox-exec (${
        process.env.SEATBELT_PROFILE || 'unknown'
      })`;
    }
    // Determine the currently selected model/provider using runtime diagnostics
    let modelVersion = 'Unknown';
    let provider = 'Unknown';
    let baseURL = '';
    let runtimeApi: ReturnType<typeof getRuntimeApi> | null = null;
    try {
      runtimeApi = getRuntimeApi();
    } catch {
      runtimeApi = null;
    }

    if (runtimeApi) {
      try {
        const snapshot = runtimeApi.getRuntimeDiagnosticsSnapshot();
        if (snapshot.modelName) {
          modelVersion = snapshot.modelName;
        }

        if (snapshot.providerName) {
          provider = snapshot.providerName;
        }

        const activeProviderName = runtimeApi.getActiveProviderName?.();
        if (
          activeProviderName &&
          snapshot.modelName &&
          provider !== 'Unknown'
        ) {
          modelVersion = `${activeProviderName}:${snapshot.modelName}`;
        }

        const providerManager = runtimeApi.getCliProviderManager?.();
        if (
          providerManager &&
          typeof providerManager.getActiveProvider === 'function'
        ) {
          const activeProvider = providerManager.getActiveProvider();
          if (activeProvider) {
            provider = activeProvider.name ?? provider;
            let finalProvider: unknown = activeProvider;
            if (
              'wrappedProvider' in activeProvider &&
              activeProvider.wrappedProvider
            ) {
              finalProvider = activeProvider.wrappedProvider;
            }
            const providerWithGetBaseURL = finalProvider as {
              getBaseURL?: () => string | undefined;
            };
            if (typeof providerWithGetBaseURL.getBaseURL === 'function') {
              baseURL = providerWithGetBaseURL.getBaseURL?.() ?? '';
            }
          }
        }

        if (!baseURL) {
          const runtimeBaseUrl = runtimeApi.getEphemeralSetting?.('base-url');
          if (typeof runtimeBaseUrl === 'string') {
            baseURL = runtimeBaseUrl;
          }
        }
      } catch {
        modelVersion = context.services.config?.getModel() || modelVersion;
      }

      if (modelVersion === 'Unknown') {
        modelVersion = context.services.config?.getModel() || modelVersion;
      }
    } else {
      modelVersion = context.services.config?.getModel() || modelVersion;
    }

    if (!baseURL) {
      const fallbackBaseUrl = context.services.config?.getEphemeralSetting?.(
        'base-url',
      ) as string | undefined;
      if (fallbackBaseUrl) {
        baseURL = fallbackBaseUrl;
      }
    }

    if (provider === 'Unknown') {
      const fallbackProvider =
        context.services.config?.getProvider?.() ?? undefined;
      if (fallbackProvider) {
        provider = fallbackProvider;
      }
    }

    const cliVersion = await getCliVersion();
    const selectedAuthType =
      context.services.settings.merged.selectedAuthType || '';
    const gcpProject = process.env.GOOGLE_CLOUD_PROJECT || '';
    const ideClient =
      (context.services.config?.getIdeMode() &&
        context.services.config?.getIdeClient()?.getDetectedIdeDisplayName()) ||
      '';

    // Determine keyfile path and key status for the active provider (if any)
    let keyfilePath = '';
    const keyStatus = '';
    try {
      const { getProviderManager } = await import(
        '../../providers/providerManagerInstance.js'
      );
      const providerManager = getProviderManager();
      const providerName = providerManager.getActiveProviderName();
      if (providerName) {
        keyfilePath =
          context.services.settings.getProviderKeyfile?.(providerName) || '';
        // We don't check for API keys anymore - they're only in profiles
      }
    } catch {
      // Ignore errors and leave defaults
    }

    const aboutItem: Omit<HistoryItemAbout, 'id'> = {
      type: MessageType.ABOUT,
      cliVersion,
      osVersion,
      sandboxEnv,
      modelVersion,
      selectedAuthType,
      gcpProject,
      keyfile: keyfilePath,
      key: keyStatus,
      ideClient,
      provider,
      baseURL,
    };

    context.ui.addItem(aboutItem, Date.now());
  },
};
