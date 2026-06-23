/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import type {
  SlashCommand,
  CommandContext,
  OpenDialogActionReturn,
  MessageActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import {
  getProviderManager,
  refreshAliasProviders,
} from '@vybestack/llxprt-code-providers/composition.js';
import { MessageType } from '../types.js';
import {
  writeProviderAliasConfig,
  type ProviderAliasConfig,
} from '@vybestack/llxprt-code-providers/composition.js';
import type { IProvider } from '@vybestack/llxprt-code-providers';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { firstNonEmptyString } from '../../utils/coalesce.js';

type WrappedProvider = IProvider & { wrappedProvider: IProvider };

function hasWrappedProvider(provider: IProvider): provider is WrappedProvider {
  return (
    'wrappedProvider' in provider &&
    (provider as { wrappedProvider?: unknown }).wrappedProvider !== undefined &&
    (provider as { wrappedProvider?: unknown }).wrappedProvider !== null
  );
}

function unwrapProvider(provider: IProvider): IProvider {
  if (hasWrappedProvider(provider)) {
    return provider.wrappedProvider;
  }
  return provider;
}

function resolveBaseProviderId(provider: IProvider): string {
  const constructorName = provider.constructor.name;
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

function buildAliasConfig(
  provider: IProvider,
  configBaseUrl: string | undefined,
): ProviderAliasConfig | null {
  const unwrapped = unwrapProvider(provider);
  const baseProviderId = resolveBaseProviderId(unwrapped);

  const resolvedBaseUrl = firstNonEmptyString(
    configBaseUrl && configBaseUrl !== 'none' ? configBaseUrl : undefined,
    getProviderBaseUrl(unwrapped),
  );

  if (!resolvedBaseUrl) {
    return null;
  }

  const defaultModel = firstNonEmptyString(
    unwrapped.getCurrentModel?.(),
    unwrapped.getDefaultModel(),
  );

  const aliasConfig: ProviderAliasConfig = {
    baseProvider: baseProviderId,
    'base-url': resolvedBaseUrl,
    description: `User-defined alias for ${baseProviderId}`,
  };

  if (defaultModel) {
    aliasConfig.defaultModel = defaultModel;
  }
  return aliasConfig;
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

  const configBaseUrl =
    typeof config.getEphemeralSetting === 'function'
      ? (config.getEphemeralSetting('base-url') as string | undefined)
      : undefined;

  const aliasConfig = buildAliasConfig(activeProvider, configBaseUrl);
  if (!aliasConfig) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'Unable to determine a base URL for the current provider. Use /baseurl to set one before saving an alias.',
    };
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

function resolveCurrentProvider(
  runtime: ReturnType<typeof getRuntimeApi>,
  providerManager: ReturnType<typeof getProviderManager>,
): string | null {
  try {
    return runtime.getActiveProviderName();
  } catch {
    try {
      return providerManager.getActiveProviderName();
    } catch {
      return null;
    }
  }
}

async function switchProvider(
  context: CommandContext,
  providerName: string,
): Promise<MessageActionReturn> {
  const runtime = getRuntimeApi();
  const providerManager = getProviderManager();
  const currentProvider = resolveCurrentProvider(runtime, providerManager);

  if (providerName === currentProvider) {
    return {
      type: 'message',
      messageType: 'info',
      content: `Already using provider: ${currentProvider}`,
    };
  }

  const fromProvider = firstNonEmptyString(currentProvider, 'none');

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

  for (const info of switchResult.infoMessages) {
    if (!info) {
      continue;
    }
    context.ui.addItem({ type: MessageType.INFO, text: info }, Date.now());
  }

  context.recordingIntegration?.recordProviderSwitch(
    switchResult.nextProvider,
    switchResult.defaultModel ?? runtime.getActiveModelName(),
  );

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
    const trimmedArgs = args.trim();

    if (!trimmedArgs) {
      return { type: 'dialog', dialog: 'provider' };
    }

    if (/^save\b/i.test(trimmedArgs)) {
      return handleSaveAlias(getProviderManager(), context, trimmedArgs);
    }

    try {
      return await switchProvider(context, trimmedArgs);
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to switch provider: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
