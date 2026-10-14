/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AgentClientContract,
  ContentGeneratorConfig,
} from '@vybestack/llxprt-code-core';

export async function createDetachedAutoPromptClient(
  createClient: () => Promise<AgentClientContract>,
  config: ContentGeneratorConfig | undefined,
): Promise<AgentClientContract> {
  if (!config)
    throw new Error('Content generator configuration is unavailable');
  const client = await createClient();
  try {
    await client.initialize(config);
    return client;
  } catch (error) {
    await client.dispose();
    throw error;
  }
}
