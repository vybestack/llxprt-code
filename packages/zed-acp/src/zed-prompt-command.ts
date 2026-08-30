/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as acp from '@agentclientprotocol/sdk';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import {
  executeZedCommand,
  type ZedCommandResult,
} from './zed-command-registry.js';

const logger = new DebugLogger('llxprt:zed-integration:prompt-command');

/**
 * Extracts the first text content from an ACP prompt content-block array. A
 * Zed slash command arrives as a single text block, so only the first text
 * block's text is relevant for command detection.
 *
 * Returns `null` when the prompt has no text block (e.g. only image/audio),
 * so the caller treats it as an ordinary (non-slash) prompt.
 */
export function extractPromptText(
  prompt: readonly acp.ContentBlock[],
): string | null {
  if (prompt.length !== 1 || prompt[0].type !== 'text') {
    return null;
  }
  return prompt[0].text;
}

/**
 * Attempts to handle a prompt as a Zed slash command. When the prompt is a
 * known Zed command (e.g. `/compact`, `/tools`), this executes the command,
 * streams the result text as an `agent_message_chunk` via the provided
 * `sendUpdate` callback, and returns the final {@link acp.PromptResponse}.
 *
 * Returns `null` when the prompt is NOT a slash command (or is an unknown
 * command), so the caller continues with ordinary model-streaming.
 *
 * @param prompt The raw ACP content blocks from the prompt request.
 * @param agent The session's real Agent.
 * @param sendUpdate Callback to stream an `agent_message_chunk`.
 */
export async function tryHandleZedCommand(
  prompt: readonly acp.ContentBlock[],
  agent: Agent,
  sendUpdate: (update: acp.SessionUpdate) => Promise<void>,
): Promise<{ response: acp.PromptResponse } | null> {
  const text = extractPromptText(prompt);
  if (text === null) {
    return null;
  }
  const result: ZedCommandResult | null = await executeZedCommand(text, {
    agent,
  });
  if (result === null) {
    return null;
  }
  try {
    await sendUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: result.text },
    });
  } catch (error) {
    logger.debug(() => `Command response delivery failed: ${String(error)}`);
    throw acp.RequestError.internalError(
      { cause: error },
      'Command response delivery failed.',
    );
  }
  return {
    response: { stopReason: 'end_turn' },
  };
}
