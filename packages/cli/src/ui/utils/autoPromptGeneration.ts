/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AgentClientContract,
  AgentClientMessageParams,
  ContentGeneratorConfig,
} from '@vybestack/llxprt-code-core';
import { getResponseTextFromBlocks } from '@vybestack/llxprt-code-core';
import { createDetachedAutoPromptClient } from '../../runtime/autoPromptDetachedClient.js';
import { generateAutoPrompt } from './autoPromptGenerator.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';

const logger = new DebugLogger('llxprt:subagent:auto-prompt');

export function bindAutoPromptGeneration(
  readProvider: () => string,
  readClient: () => AgentClientContract | null | undefined,
  createDetached: () => Promise<AgentClientContract>,
  readConfig: () => ContentGeneratorConfig | undefined,
): (description: string) => Promise<string> {
  return (description) =>
    generateAutoPrompt(description, async (request) => {
      const providerName = readProvider().toLowerCase();
      const live = readClient();
      const detached =
        live == null || providerName === 'gemini'
          ? await createDetachedAutoPromptClient(createDetached, readConfig())
          : undefined;
      const client = detached ?? live;
      if (client == null) {
        throw new Error(
          'Unable to access the AI client. Please configure authentication.',
        );
      }
      logger.log(() => '[auto-prompt] generating expanded prompt', {
        provider: providerName,
      });
      try {
        return await requestPromptText(client, request);
      } finally {
        await detached?.dispose();
      }
    });
}

async function requestPromptText(
  client: AgentClientContract,
  request: AgentClientMessageParams,
): Promise<string> {
  const output = await client.generateDirectMessage(
    request,
    'subagent-auto-prompt',
  );
  return getResponseTextFromBlocks(output.content.blocks) ?? '';
}
