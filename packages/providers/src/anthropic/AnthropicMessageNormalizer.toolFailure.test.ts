/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3063 — a failed tool call must reach Anthropic as a tool_result with
 * is_error: true, while the content still carries the model-facing remedy
 * (#3037). The failure block is built by the REAL createErrorResponse (not
 * hand-crafted) so the producer and consumer halves cannot drift apart. The
 * history is converted through the real normalizer and asserted on the wire
 * object.
 */

import { describe, it, expect } from 'bun:test';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ToolCallRequestInfo } from '@vybestack/llxprt-code-core/core/turn.js';
import { createErrorResponse } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import {
  convertToAnthropicMessages,
  type AnthropicMessage,
  type AnthropicMessageBlock,
} from './AnthropicMessageNormalizer.js';

const noopLogger = { debug: () => {} };
const REMEDY = 'File not found; check the path and try read_file again.';
const TERSE = 'file_not_found: /missing/path';

/** The canonical tool_result member of the exported wire-block union. */
type AnthropicToolResultBlock = Extract<
  AnthropicMessageBlock,
  { type: 'tool_result' }
>;

function findToolResult(
  messages: AnthropicMessage[],
): AnthropicToolResultBlock | undefined {
  for (const message of messages) {
    if (message.role !== 'user' || typeof message.content === 'string') {
      continue;
    }
    const found = message.content.find(
      (block): block is AnthropicToolResultBlock =>
        block.type === 'tool_result',
    );
    if (found) {
      return found;
    }
  }
  return undefined;
}

/** Flattens the tool_result content union to the text it renders. */
function toolResultText(block: AnthropicToolResultBlock): string {
  if (typeof block.content === 'string') {
    return block.content;
  }
  return block.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('');
}

/** Builds a real failure block from the actual createErrorResponse producer. */
function failureBlock(): ToolResponseBlock {
  const request: ToolCallRequestInfo = {
    callId: 'call-fail',
    name: 'failingTool',
    args: {},
    isClientInitiated: false,
    prompt_id: 'prompt-1',
  };
  const response = createErrorResponse(
    request,
    new Error(TERSE),
    undefined,
    REMEDY,
  );
  const block = response.responseParts[0];
  if (block.type !== 'tool_response') {
    throw new Error(`expected tool_response, got ${String(block.type)}`);
  }
  return block;
}

/**
 * Builds a minimal two-turn history (assistant tool_call → tool tool_response)
 * so the response is not treated as an orphan and is not filtered out.
 */
function historyWithResponse(block: ToolResponseBlock): IContent[] {
  const toolCall: ToolCallBlock = {
    type: 'tool_call',
    id: block.callId,
    name: block.toolName,
    parameters: {},
  };
  return [
    { speaker: 'human', blocks: [{ type: 'text', text: 'do the thing' }] },
    { speaker: 'ai', blocks: [toolCall] },
    { speaker: 'tool', blocks: [block] },
  ];
}

function convert(contents: IContent[]): AnthropicMessage[] {
  return convertToAnthropicMessages(contents, {
    isOAuth: false,
    reasoningEnabled: true,
    config: undefined,
    unprefixToolName: (name) => name,
    logger: noopLogger,
  });
}

describe('AnthropicMessageNormalizer — tool failure fidelity (issue #3063)', () => {
  it('marks a producer-built failed tool_result with is_error and keeps the remedy in content (AC5)', () => {
    const toolResult = findToolResult(
      convert(historyWithResponse(failureBlock())),
    );

    expect(toolResult).toBeDefined();
    expect(toolResult!.is_error).toBe(true);
    // The model-facing remedy still travels in the rendered content.
    expect(toolResultText(toolResult!)).toContain(REMEDY);
  });

  it('omits is_error for a successful tool_result (AC8)', () => {
    const successBlock: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call-ok',
      toolName: 'okTool',
      result: { output: 'all good' },
    };

    const toolResult = findToolResult(
      convert(historyWithResponse(successBlock)),
    );

    expect(toolResult).toBeDefined();
    expect(toolResult!.is_error).toBeUndefined();
  });
});
