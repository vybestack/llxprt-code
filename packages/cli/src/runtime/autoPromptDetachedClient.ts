/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from '@vybestack/llxprt-code-agents';
import type {
  AgentClientContract,
  ContentGeneratorConfig,
} from '@vybestack/llxprt-code-core';

export type DetachedAutoPromptClientSource = {
  readonly sessionClient: Pick<
    Agent['sessionClient'],
    'createDetachedAgentClient'
  >;
};

export async function createDetachedAutoPromptClient(
  source: DetachedAutoPromptClientSource,
  config: ContentGeneratorConfig | undefined,
): Promise<AgentClientContract> {
  if (!config)
    throw new Error('Content generator configuration is unavailable');
  const client = await source.sessionClient.createDetachedAgentClient();
  try {
    await client.initialize(config);
    return client;
  } catch (error) {
    await client.dispose();
    throw error;
  }
}
