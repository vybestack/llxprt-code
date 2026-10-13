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

import { firstNonEmptyString } from '../../utils/coalesce.js';
import type {
  SlashCommand,
  CommandContext,
  OpenDialogActionReturn,
  MessageActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import { MessageType } from '../types.js';
import type { ProviderAliasConfig } from '@vybestack/llxprt-code-providers/composition.js';
import type { AliasResolveResult } from '../../runtime/providerInspection.js';
import type {
  AgentOAuthUIEvent,
  AgentProviderSwitchOptions,
  AgentProviderSwitchResult,
} from '@vybestack/llxprt-code-agents';
import { UNCONFIGURED_PROVIDER } from '@vybestack/llxprt-code-core';

/**
 * Operations bound by the application host that registers /provider. The
 * command never selects an owner from its invocation.
 */
export interface ProviderCommandOperations {
  /** Name of the active provider, or null when none can be determined. */
  getActiveProviderName: () => string | null;
  getActiveModelName: () => string;
  switchProvider: (
    providerName: string,
    options: AgentProviderSwitchOptions,
  ) => Promise<AgentProviderSwitchResult>;
  recordProviderSwitch: (provider: string, model: string) => Promise<void>;
  resolveActiveProviderAliasConfig: () => AliasResolveResult;
  writeProviderAlias: (alias: string, config: ProviderAliasConfig) => void;
  refreshProviderAliases: () => Promise<void>;
}

/** The UI publication surface a /provider invocation needs. */
type ProviderInvocation = Pick<CommandContext, 'ui'>;

/**
 * Translates the agent's OAuthUIEvent type into a UI MessageType. The agent
 * emits a discriminated union ('info' | 'warning' | 'error' | 'oauth_url')
 * while the UI HistoryItem expects a MessageType enum. oauth_url has no
 * MessageType counterpart and is rendered as INFO.
 */
function mapOAuthEventType(type: AgentOAuthUIEvent['type']): MessageType {
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
function formatOAuthText(event: AgentOAuthUIEvent): string {
  switch (event.type) {
    case 'oauth_url':
      return event.url === undefined
        ? event.text
        : `${event.text}: ${event.url}`;
    case 'oauth_waiting':
      return `Waiting for ${event.provider}/${event.bucket ?? 'default'} authentication (requested by ${event.requesterRuntimeKind})…`;
    case 'oauth_settled': {
      const outcome: Record<
        'succeeded' | 'cancelled' | 'timed_out' | 'failed',
        string
      > = {
        succeeded: 'completed',
        cancelled: 'was cancelled',
        timed_out: 'timed out',
        failed: 'failed',
      };
      return `Authentication for ${event.provider}/${event.bucket ?? 'default'} ${outcome[event.kind]}`;
    }
    default:
      return event.text;
  }
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

async function handleSaveAlias(
  operations: ProviderCommandOperations,
  rawArgs: string,
): Promise<MessageActionReturn> {
  const alias = rawArgs.replace(/^save\b\s*/i, '').trim();

  const validationError = validateAliasName(alias);
  if (validationError) {
    return { type: 'message', messageType: 'error', content: validationError };
  }

  const resolveResult = operations.resolveActiveProviderAliasConfig();
  if (!resolveResult.ok) {
    return {
      type: 'message',
      messageType: 'error',
      content: resolveResult.content,
    };
  }

  const aliasConfig = resolveResult.config;
  if (!aliasConfig) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'Unable to determine a base URL for the current provider. Use /baseurl to set one before saving an alias.',
    };
  }

  try {
    operations.writeProviderAlias(alias, aliasConfig);
    await operations.refreshProviderAliases();
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

async function switchProvider(
  operations: ProviderCommandOperations,
  invocation: ProviderInvocation,
  providerName: string,
): Promise<MessageActionReturn> {
  const currentProvider = operations.getActiveProviderName();

  if (providerName === currentProvider) {
    return {
      type: 'message',
      messageType: 'info',
      content: `Already using provider: ${currentProvider}`,
    };
  }

  const fromProvider = firstNonEmptyString(currentProvider, 'none');

  let switchResult: AgentProviderSwitchResult;
  try {
    switchResult = await operations.switchProvider(providerName, {
      addItem: (event, timestamp) =>
        invocation.ui.addItem(
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
    invocation.ui.addItem({ type: MessageType.INFO, text: info }, Date.now());
  }

  const model = switchResult.defaultModel ?? operations.getActiveModelName();
  await operations.recordProviderSwitch(switchResult.nextProvider, model);

  return {
    type: 'message',
    messageType: 'info',
    content: `Switched from ${fromProvider} to ${switchResult.nextProvider}`,
  };
}

export function createProviderCommand(
  operations: ProviderCommandOperations,
): SlashCommand {
  return {
    name: 'provider',
    description:
      'switch between different AI providers (openai, anthropic, etc.)',
    kind: CommandKind.BUILT_IN,
    action: async (
      invocation: ProviderInvocation,
      args: string,
    ): Promise<OpenDialogActionReturn | MessageActionReturn | void> => {
      const trimmedArgs = args.trim();

      if (!trimmedArgs) {
        return { type: 'dialog', dialog: 'provider' };
      }

      if (/^save\b/i.test(trimmedArgs)) {
        return handleSaveAlias(operations, trimmedArgs);
      }

      try {
        return await switchProvider(operations, invocation, trimmedArgs);
      } catch (error) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to switch provider: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
