/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AgentClientContract,
  AgentChatRecordingExecution,
} from '@vybestack/llxprt-code-core/core/clientContract.js';
import { getResponseTextFromBlocks } from '@vybestack/llxprt-code-core';
import type { AgentInput } from './agent.js';
import { toPartListUnion } from './agentBootstrap.js';

export async function generateDetachedText(
  input: AgentInput,
  promptId: string,
  generate: AgentClientContract['generateDirectMessage'],
  recording: AgentChatRecordingExecution,
): Promise<string> {
  const response = await generate(
    { message: toPartListUnion(input) },
    promptId,
    recording,
  );
  return getResponseTextFromBlocks(response.content.blocks) ?? '';
}
