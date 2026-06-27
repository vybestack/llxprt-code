/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import type { Agent } from '@vybestack/llxprt-code-agents';

async function logoutViaAgent(
  agent: Agent,
  provider: string,
): Promise<MessageActionReturn> {
  try {
    const authStatus = agent.auth.status(provider);
    if (authStatus === 'unknown') {
      return {
        type: 'message',
        messageType: 'error',
        content: `Unknown provider: ${provider}.`,
      };
    }
    const wasAuthenticated = authStatus === 'authenticated';
    await agent.auth.logout(provider);
    return {
      type: 'message',
      messageType: 'info',
      content: wasAuthenticated
        ? `Successfully logged out of ${provider}`
        : `Cleaned up authentication state for ${provider} (was not authenticated)`,
    };
  } catch (error) {
    return logoutErrorHandler(provider, error);
  }
}

function logoutErrorHandler(
  provider: string,
  error: unknown,
): MessageActionReturn {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return {
    type: 'message',
    messageType: 'error',
    content: `Failed to logout from ${provider}: ${errorMessage}`,
  };
}

async function logoutViaRuntimeApi(
  provider: string,
): Promise<MessageActionReturn> {
  try {
    const oauthManager = getRuntimeApi().getCliOAuthManager();
    if (!oauthManager) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'OAuth manager not available. Please try again.',
      };
    }
    const supportedProviders = oauthManager.getSupportedProviders();
    if (!supportedProviders.includes(provider)) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Unknown provider: ${provider}. Supported providers: ${supportedProviders.join(', ')}`,
      };
    }
    const isAuthenticated = await oauthManager.isAuthenticated(provider);
    await oauthManager.logout(provider);
    return {
      type: 'message',
      messageType: 'info',
      content: isAuthenticated
        ? `Successfully logged out of ${provider}`
        : `Cleaned up authentication state for ${provider} (was not authenticated)`,
    };
  } catch (error) {
    return logoutErrorHandler(provider, error);
  }
}

export const logoutCommand: SlashCommand = {
  name: 'logout',
  description:
    'logout from OAuth authentication for a provider (gemini, qwen, anthropic)',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const provider = args.trim();
    if (!provider) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'Please specify a provider to logout from: /logout <provider>\nSupported providers: gemini, qwen, anthropic',
      };
    }
    const agent = context.services.agent;
    if (agent) {
      return logoutViaAgent(agent, provider);
    }
    return logoutViaRuntimeApi(provider);
  },
};
