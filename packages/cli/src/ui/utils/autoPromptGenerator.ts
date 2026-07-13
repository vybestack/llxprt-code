/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AgentClientContract,
  ContractSendMessageParameters,
  ContractGenerateContentConfig,
} from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { getRuntimeBridge } from '../contexts/RuntimeContext.js';
import {
  createDetachedAutoPromptClient,
  type DetachedAutoPromptClientSource,
} from '../../runtime/autoPromptDetachedClient.js';

const logger = new DebugLogger('llxprt:subagent:auto-prompt');

/**
 * Runtime surface required by the auto-prompt generator. Combines the
 * detached-client factory source with provider and agent-client accessors so
 * this module does not depend on the full Config object.
 */
export interface AutoPromptRuntime extends DetachedAutoPromptClientSource {
  getProvider(): string | undefined;
  getAgentClient(): AgentClientContract | null | undefined;
}

function createAutoPromptRequest(
  description: string,
): ContractSendMessageParameters {
  const autoModePrompt = `Generate a detailed system prompt for a subagent with the following purpose:\n\n${description}\n\nRequirements:\n- Create a comprehensive system prompt that defines the subagent's role, capabilities, and behavior\n- Be specific and actionable\n- Use clear, professional language\n- Output ONLY the system prompt text, no explanations or metadata`;

  return {
    message: autoModePrompt,
    config: {
      toolConfig: {
        functionCallingConfig: {
          mode: 'NONE',
        },
      },
      serverTools: [],
    } as ContractGenerateContentConfig & { serverTools: unknown[] },
  };
}

async function requestFromClient(
  targetClient: AgentClientContract,
  requestPayload: ContractSendMessageParameters,
  options?: { useRuntimeScope?: boolean },
): Promise<{ text?: string }> {
  const executeRequest = () =>
    targetClient.generateDirectMessage(requestPayload, 'subagent-auto-prompt');
  if (options?.useRuntimeScope === false) {
    return executeRequest();
  }
  try {
    const runtimeBridge = getRuntimeBridge();
    return await runtimeBridge.runWithScope(executeRequest);
  } catch (error) {
    logger.log(
      () => '[auto-prompt] runtime scope unavailable, falling back',
      error,
    );
    try {
      return await executeRequest();
    } catch (fallbackError) {
      logger.log(
        () => '[auto-prompt] fallback request also failed',
        fallbackError,
      );
      throw fallbackError;
    }
  }
}

function resolveClient(runtime: AutoPromptRuntime): {
  client: AgentClientContract;
  cleanupDetached: AgentClientContract | undefined;
  useRuntimeScope: boolean;
  providerName: string | undefined;
} {
  const providerName = runtime.getProvider()?.toLowerCase();
  const configuredClient = runtime.getAgentClient();
  const useDetachedClient =
    configuredClient == null || providerName === 'gemini';
  const cleanupDetached = useDetachedClient
    ? createDetachedAutoPromptClient(runtime)
    : undefined;
  const client = cleanupDetached ?? configuredClient;

  if (client == null) {
    throw new Error(
      'Unable to access the AI client. Please configure authentication.',
    );
  }

  return {
    client,
    cleanupDetached,
    useRuntimeScope: !useDetachedClient,
    providerName,
  };
}

export async function generateAutoPrompt(
  runtime: AutoPromptRuntime,
  description: string,
): Promise<string> {
  const requestPayload = createAutoPromptRequest(description);
  const { client, cleanupDetached, useRuntimeScope, providerName } =
    resolveClient(runtime);

  logger.log(() => '[auto-prompt] generating expanded prompt', {
    provider: providerName,
  });

  let response: { text?: string };
  try {
    response = await requestFromClient(client, requestPayload, {
      useRuntimeScope,
    });
  } finally {
    cleanupDetached?.dispose();
  }

  const text = response.text ?? '';
  if (text.trim() === '') {
    throw new Error(
      'Model returned empty response. Try manual mode or rephrase your description.',
    );
  }
  return text;
}
