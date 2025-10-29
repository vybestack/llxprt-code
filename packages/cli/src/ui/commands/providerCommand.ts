/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  CommandContext,
  OpenDialogActionReturn,
  MessageActionReturn,
  CommandKind,
} from './types.js';
import {
  getProviderManager,
  refreshAliasProviders,
} from '../../providers/providerManagerInstance.js';
import { MessageType } from '../types.js';
import { AuthType } from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-core/src/settings/SettingsService.js';
import {
  writeProviderAliasConfig,
  type ProviderAliasConfig,
} from '../../providers/providerAliases.js';
import type { IProvider } from '@vybestack/llxprt-code-core/providers/IProvider.js';

/**
 * Get SettingsService instance for provider switching
 */
async function getSettingsServiceForProvider(): Promise<SettingsService> {
  try {
    const { getSettingsService } = await import('@vybestack/llxprt-code-core');

    return getSettingsService();
  } catch (error) {
    if (process.env.DEBUG) {
      console.warn(
        'Failed to get SettingsService for provider switching:',
        error,
      );
    }
    throw error;
  }
}

function unwrapProvider(provider: IProvider): IProvider {
  if (
    provider &&
    typeof provider === 'object' &&
    'wrappedProvider' in provider &&
    provider.wrappedProvider
  ) {
    return (provider as unknown as { wrappedProvider: IProvider })
      .wrappedProvider;
  }
  return provider;
}

function resolveBaseProviderId(provider: IProvider): string {
  const constructorName = provider?.constructor?.name ?? '';
  if (constructorName === 'OpenAIProvider') {
    return 'openai';
  }
  if (constructorName === 'OpenAIResponsesProvider') {
    return 'openai-responses';
  }
  return provider.name;
}

function getProviderBaseUrl(provider: IProvider): string | undefined {
  const configBaseUrl = (
    provider as unknown as { providerConfig?: { baseUrl?: string } }
  ).providerConfig?.baseUrl;
  if (configBaseUrl && configBaseUrl !== 'none') {
    return configBaseUrl;
  }

  const baseConfigUrl = (
    provider as unknown as { baseProviderConfig?: { baseURL?: string } }
  ).baseProviderConfig?.baseURL;
  if (baseConfigUrl && baseConfigUrl !== 'none') {
    return baseConfigUrl;
  }

  const getBaseUrlFn = (
    provider as unknown as { getBaseURL?: () => string | undefined }
  ).getBaseURL;
  if (typeof getBaseUrlFn === 'function') {
    return getBaseUrlFn.call(provider);
  }

  return undefined;
}

async function handleSaveAlias(
  providerManager: ReturnType<typeof getProviderManager>,
  context: CommandContext,
  rawArgs: string,
): Promise<MessageActionReturn> {
  const alias = rawArgs.replace(/^save\b\s*/i, '').trim();

  if (!alias) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Alias name is required. Usage: /provider save <alias>',
    };
  }

  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(alias)) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        "Alias names may contain letters, numbers, '.', '_' or '-' and must start with a letter or number.",
    };
  }

  const config = context.services.config;
  if (!config) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Unable to access configuration to save provider alias.',
    };
  }

  let activeProvider: IProvider;
  try {
    activeProvider = providerManager.getActiveProvider();
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to determine active provider: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const unwrappedProvider = unwrapProvider(activeProvider);
  const baseProviderId = resolveBaseProviderId(unwrappedProvider);

  const configBaseUrl =
    typeof config.getEphemeralSetting === 'function'
      ? (config.getEphemeralSetting('base-url') as string | undefined)
      : undefined;

  const resolvedBaseUrl =
    (configBaseUrl && configBaseUrl !== 'none' ? configBaseUrl : undefined) ||
    getProviderBaseUrl(unwrappedProvider);

  if (!resolvedBaseUrl) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'Unable to determine a base URL for the current provider. Use /baseurl to set one before saving an alias.',
    };
  }

  const defaultModel =
    unwrappedProvider.getCurrentModel?.() ||
    unwrappedProvider.getDefaultModel?.() ||
    '';

  const aliasConfig: ProviderAliasConfig = {
    baseProvider: baseProviderId,
    baseUrl: resolvedBaseUrl,
    description: `User-defined alias for ${baseProviderId}`,
  };

  if (defaultModel) {
    aliasConfig.defaultModel = defaultModel;
  }

  try {
    writeProviderAliasConfig(alias, aliasConfig);
    refreshAliasProviders();
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to save alias '${alias}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  return {
    type: 'message',
    messageType: 'info',
    content: `Saved provider alias '${alias}'. Use /provider ${alias} to switch.`,
  };
}

export const providerCommand: SlashCommand = {
  name: 'provider',
  description:
    'switch between different AI providers (openai, anthropic, etc.)',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<OpenDialogActionReturn | MessageActionReturn | void> => {
    const providerManager = getProviderManager();
    const trimmedArgs = args?.trim();

    if (!trimmedArgs) {
      // Open interactive provider selection dialog
      return {
        type: 'dialog',
        dialog: 'provider',
      };
    }

    if (/^save\b/i.test(trimmedArgs)) {
      return handleSaveAlias(providerManager, context, trimmedArgs);
    }

    const providerName = trimmedArgs;

    try {
      const currentProvider = providerManager.getActiveProviderName();

      // Handle switching to same provider
      if (providerName === currentProvider) {
        return {
          type: 'message',
          messageType: 'info',
          content: `Already using provider: ${currentProvider}`,
        };
      }

      const fromProvider = currentProvider || 'none';

      // Use conversion context to track available models
      // const conversionContextJSON = {
      //   availableModels: await providerManager.getAllAvailableModels(),
      // };

      // Clear auth and base-url ephemeral settings BEFORE switching providers
      // This prevents cached auth from the old provider affecting the new provider
      const config = context.services.config;
      if (config) {
        // Clear auth settings to ensure clean auth state
        config.setEphemeralSetting('auth-key', undefined);
        config.setEphemeralSetting('auth-keyfile', undefined);
        config.setEphemeralSetting('base-url', undefined);
      }

      // Get the target provider to clear its caches before activating it
      // This is important for providers like qwen that might have stale auth
      // Access the providers Map directly since there's no getAllProviders method
      const providersMap = (
        providerManager as unknown as { providers?: Map<string, unknown> }
      ).providers;
      if (providersMap && providersMap instanceof Map) {
        const targetProvider = providersMap.get(providerName) as
          | { clearState?: () => void }
          | undefined;
        if (targetProvider && targetProvider.clearState) {
          targetProvider.clearState();
        }
      }

      // Switch provider (this will clear state from previous provider via ProviderManager)
      providerManager.setActiveProvider(providerName);

      // Also clear base URL on the new provider if it has the method
      const newProvider = providerManager.getActiveProvider();
      if (newProvider && newProvider.setBaseUrl) {
        newProvider.setBaseUrl(undefined);
      }

      // Use SettingsService for provider switching
      try {
        const settingsService = await getSettingsServiceForProvider();
        await settingsService.switchProvider(providerName);

        // Also set the default model for this provider
        const activeProvider = providerManager.getActiveProvider();
        const defaultModel = activeProvider.getDefaultModel();
        settingsService.setProviderSetting(providerName, 'model', defaultModel);

        // Don't return early - continue with the rest of the setup
      } catch (error) {
        if (process.env.DEBUG) {
          console.warn(
            'SettingsService provider switch failed, falling back to legacy method:',
            error,
          );
        }
      }

      // Update config if available
      if (context.services.config) {
        // Clear ephemeral settings when switching providers
        // Get current ephemeral settings and clear them one by one
        const ephemeralKeys = [
          'auth-key',
          'auth-keyfile',
          'base-url',
          'context-limit',
          'compression-threshold',
          'tool-format',
          'api-version',
          'custom-headers',
        ];
        for (const key of ephemeralKeys) {
          context.services.config.setEphemeralSetting(key, undefined);
        }

        // Clear model parameters on the new provider
        const newProvider = providerManager.getActiveProvider();
        if (newProvider.setModelParams) {
          newProvider.setModelParams({});
        }

        // Ensure provider manager is set on config
        context.services.config.setProviderManager(providerManager);

        // Update the provider in config
        context.services.config.setProvider(providerName);

        // Get the active provider and ensure it uses a valid default model
        const activeProvider = providerManager.getActiveProvider();

        // Get the default model from the provider
        const defaultModel = activeProvider.getDefaultModel();
        let baseUrl: string | undefined;

        // Set base URL for specific providers
        if (providerName === 'qwen') {
          baseUrl = 'https://portal.qwen.ai/v1';
        }

        // Set the base URL if needed (for qwen)
        if (baseUrl) {
          context.services.config.setEphemeralSetting('base-url', baseUrl);
          // Also set it directly on the provider if it has the method
          if (
            'setBaseUrl' in activeProvider &&
            typeof activeProvider.setBaseUrl === 'function'
          ) {
            const providerWithSetBaseUrl = activeProvider as {
              setBaseUrl: (url: string) => void;
            };
            providerWithSetBaseUrl.setBaseUrl(baseUrl);
          }
        }

        // Set the model on both the provider and config
        if (defaultModel) {
          if (activeProvider.setModel) {
            activeProvider.setModel(defaultModel);
          }
          context.services.config.setModel(defaultModel);
        }

        // With HistoryService and ContentConverters, we can now keep conversation history
        // when switching providers as the conversion handles format differences

        // Keep the current auth type - auth only affects GeminiProvider internally
        const currentAuthType =
          context.services.config.getContentGeneratorConfig()?.authType ||
          AuthType.LOGIN_WITH_GOOGLE;

        // Refresh auth to ensure provider manager is attached
        await context.services.config.refreshAuth(currentAuthType);

        // Show info about API key if needed for non-Gemini providers
        if (providerName !== 'gemini') {
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Switched to ${providerName}. Use /key to set API key if needed.`,
            },
            Date.now(),
          );
        }

        // Note: We no longer clear UI history when switching providers
        // The whole point of provider switching is to maintain conversation context
        // Tool call ID conversion is handled by the content converters
      }

      // Trigger payment mode check if available
      const extendedContext = context as CommandContext & {
        checkPaymentModeChange?: (forcePreviousProvider?: string) => void;
      };
      if (extendedContext.checkPaymentModeChange) {
        setTimeout(
          () => extendedContext.checkPaymentModeChange!(fromProvider),
          100,
        );
      }

      return {
        type: 'message',
        messageType: 'info',
        content: `Switched from ${fromProvider} to ${providerName}`,
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to switch provider: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
