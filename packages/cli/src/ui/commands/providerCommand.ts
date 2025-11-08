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
import {
  writeProviderAliasConfig,
  type ProviderAliasConfig,
} from '../../providers/providerAliases.js';
import type { IProvider } from '@vybestack/llxprt-code-core/providers/IProvider.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';

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
      const runtime = getRuntimeApi();
      let currentProvider: string | null = null;
      try {
        currentProvider = runtime.getActiveProviderName();
      } catch (_error) {
        try {
          currentProvider = providerManager.getActiveProviderName();
        } catch {
          currentProvider = null;
        }
      }

      if (providerName === currentProvider) {
        return {
          type: 'message',
          messageType: 'info',
          content: `Already using provider: ${currentProvider}`,
        };
      }

      const fromProvider = currentProvider || 'none';

      let switchResult;
      try {
        switchResult = await runtime.switchActiveProvider(providerName, {
          addItem: context.ui.addItem,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to switch provider: ${message}`,
        };
      }

      for (const info of switchResult.infoMessages ?? []) {
        if (!info) {
          continue;
        }
        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: info,
          },
          Date.now(),
        );
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
        content: `Switched from ${fromProvider} to ${switchResult.nextProvider}`,
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
