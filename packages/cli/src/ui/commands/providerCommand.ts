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
import type { AgentProviderSwitchResult } from '@vybestack/llxprt-code-agents';
import { UNCONFIGURED_PROVIDER } from '@vybestack/llxprt-code-core';
import {
  getOptionalString,
  hasFunction,
  hasObject,
} from '../../utils/typeGuards.js';

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
  if (hasObject(provider, 'providerConfig')) {
    const configBaseUrl = getOptionalString(provider.providerConfig, 'baseUrl');
    if (configBaseUrl && configBaseUrl !== 'none') {
      return configBaseUrl;
    }
  }

  if (hasObject(provider, 'baseProviderConfig')) {
    const baseConfigUrl = getOptionalString(
      provider.baseProviderConfig,
      'baseURL',
    );
    if (baseConfigUrl && baseConfigUrl !== 'none') {
      return baseConfigUrl;
    }
  }

  if (hasFunction(provider, 'getBaseURL')) {
    const baseUrl = provider.getBaseURL();
    return typeof baseUrl === 'string' ? baseUrl : undefined;
  }

  return undefined;
}

/**
 * Translates the agent's OAuthUIEvent type into a UI MessageType. The agent
 * emits a discriminated union ('info' | 'warning' | 'error' | 'oauth_url')
 * while the UI HistoryItem expects a MessageType enum. oauth_url has no
 * MessageType counterpart and is rendered as INFO.
 */
function mapOAuthEventType(
  type: 'info' | 'warning' | 'error' | 'oauth_url',
): MessageType {
  switch (type) {
    case 'warning':
      return MessageType.WARNING;
    case 'error':
      return MessageType.ERROR;
    default:
      return MessageType.INFO;
  }
}

/**
 * Formats the agent's OAuthUIEvent into a display string. For oauth_url
 * events, appends the URL to the text so the user can see and open it.
 */
function formatOAuthText(event: {
  type: 'info' | 'warning' | 'error' | 'oauth_url';
  text: string;
  url?: string;
}): string {
  if (event.type === 'oauth_url' && event.url !== undefined) {
    return `${event.text}: ${event.url}`;
  }
  return event.text;
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

/**
 * Reserved alias names that cannot be used for user-saved provider aliases.
 * These are internal sentinel identities that must not collide with real
 * provider names.
 */
const RESERVED_ALIAS_NAMES: ReadonlySet<string> = new Set([
  UNCONFIGURED_PROVIDER,
]);

function validateAliasName(alias: string): string | null {
  if (!alias) {
    return 'Alias name is required. Usage: /provider save <alias>';
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(alias)) {
    return "Alias names may contain letters, numbers, '.', '_' or '-' and must start with a letter or number.";
  }
  if (RESERVED_ALIAS_NAMES.has(alias.toLowerCase())) {
    return `'${alias}' is a reserved name and cannot be used as a provider alias.`;
  }
  return null;
}

type AliasResolveResult =
  | { ok: true; provider: IProvider }
  | { ok: false; content: string };

function resolveActiveProviderForAlias(
  providerManager: ReturnType<typeof getProviderManager>,
): AliasResolveResult {
  try {
    const provider = providerManager.getActiveProvider();
    if (provider === undefined) {
      return {
        ok: false,
        content: 'No active provider set. Use /setup to configure a provider.',
      };
    }
    return { ok: true, provider };
  } catch (error) {
    return {
      ok: false,
      content: `Failed to determine active provider: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function resolveAliasConfigBaseUrl(
  config: NonNullable<CommandContext['services']['config']>,
): string | undefined {
  return typeof config.getEphemeralSetting === 'function'
    ? (config.getEphemeralSetting('base-url') as string | undefined)
    : undefined;
}

async function handleSaveAlias(
  providerManager: ReturnType<typeof getProviderManager>,
  context: CommandContext,
  rawArgs: string,
): Promise<MessageActionReturn> {
  const alias = rawArgs.replace(/^save\b\s*/i, '').trim();

  const validationError = validateAliasName(alias);
  if (validationError) {
    return { type: 'message', messageType: 'error', content: validationError };
  }

  const config = context.services.config;
  if (!config) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Unable to access configuration to save provider alias.',
    };
  }

  const resolveResult = resolveActiveProviderForAlias(providerManager);
  if (!resolveResult.ok) {
    return {
      type: 'message',
      messageType: 'error',
      content: resolveResult.content,
    };
  }

  const configBaseUrl = resolveAliasConfigBaseUrl(config);
  const aliasConfig = buildAliasConfig(resolveResult.provider, configBaseUrl);
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
      return providerManager.getActiveProviderName() ?? null;
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
  const agent = context.services.agent;

  if (providerName === currentProvider) {
    return {
      type: 'message',
      messageType: 'info',
      content: `Already using provider: ${currentProvider}`,
    };
  }

  if (!agent) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'Cannot switch provider: the interactive Agent is not available. Restart the session.',
    };
  }

  const fromProvider = firstNonEmptyString(currentProvider, 'none');

  let switchResult: AgentProviderSwitchResult;
  try {
    switchResult = await agent.setProvider(providerName, undefined, {
      addItem: (event, timestamp) =>
        context.ui.addItem(
          { type: mapOAuthEventType(event.type), text: formatOAuthText(event) },
          timestamp ?? Date.now(),
        ),
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
