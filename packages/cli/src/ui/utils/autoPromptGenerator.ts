/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';
import type {
  AgentClientContract,
  ContentGeneratorConfig,
  AgentClientMessageParams,
  AgentClientGenerateConfig,
} from '@vybestack/llxprt-code-core';
import { getResponseTextFromBlocks } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
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
export type AutoPromptRuntime = DetachedAutoPromptClientSource &
  Pick<Agent, 'getProvider'> & {
    readonly agentClient: AgentClientContract | null | undefined;
  };

function createAutoPromptRequest(
  description: string,
): AgentClientMessageParams {
  const autoModePrompt = `Generate a detailed system prompt for a subagent with the following purpose:\n\n${description}\n\nRequirements:\n- Create a comprehensive system prompt that defines the subagent's role, capabilities, and behavior\n- Be specific and actionable\n- Use clear, professional language\n- Output ONLY the system prompt text, no explanations or metadata`;

  return {
    message: autoModePrompt,
    config: {
      toolConfig: {
        functionCallingConfig: {
          mode: 'NONE',
        },
      },
    } satisfies AgentClientGenerateConfig,
  };
}

async function requestFromClient(
  targetClient: AgentClientContract,
  requestPayload: AgentClientMessageParams,
): Promise<{ text?: string }> {
  const output = await targetClient.generateDirectMessage(
    requestPayload,
    'subagent-auto-prompt',
  );
  const text = getResponseTextFromBlocks(output.content.blocks);
  return { text: text ?? '' };
}

async function resolveClient(
  runtime: AutoPromptRuntime,
  config: ContentGeneratorConfig | undefined,
): Promise<{
  client: AgentClientContract;
  cleanupDetached: AgentClientContract | undefined;
  providerName: string | undefined;
}> {
  const providerName = runtime.getProvider().toLowerCase();
  const configuredClient = runtime.agentClient;
  const useDetachedClient =
    configuredClient == null || providerName === 'gemini';
  const cleanupDetached = useDetachedClient
    ? await createDetachedAutoPromptClient(runtime, config)
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
    providerName,
  };
}

export async function generateAutoPrompt(
  runtime: AutoPromptRuntime,
  description: string,
  config: ContentGeneratorConfig | undefined,
): Promise<string> {
  const requestPayload = createAutoPromptRequest(description);
  const { client, cleanupDetached, providerName } = await resolveClient(
    runtime,
    config,
  );

  logger.log(() => '[auto-prompt] generating expanded prompt', {
    provider: providerName,
  });

  let response: { text?: string };
  try {
    response = await requestFromClient(client, requestPayload);
  } finally {
    await cleanupDetached?.dispose();
  }

  const text = response.text ?? '';
  if (text.trim() === '') {
    throw new Error(
      'Model returned empty response. Try manual mode or rephrase your description.',
    );
  }
  return text;
}
