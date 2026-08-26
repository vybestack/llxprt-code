/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Issue #3076 — a failed tool call must stay failed through the OpenAI-Vercel
 * conversion. These behavioural proofs drive the real exported converters with
 * plain IContent fixtures and assert only on observable output, never on
 * implementation internals.
 */

import { describe, it, expect } from 'bun:test';
import type { ToolResultPart } from 'ai';
import type {
  IContent,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  convertToVercelMessages,
  convertFromVercelMessages,
} from './messageConversion.js';

function toolContent(...blocks: ToolResponseBlock[]): IContent {
  return { speaker: 'tool', blocks };
}

/** Run convertToVercelMessages and return the parts of the (single) tool message. */
function toolResultParts(contents: IContent[]): ToolResultPart[] {
  const messages = convertToVercelMessages(contents);
  // The find predicate narrows the message to CoreToolMessage (TS find
  // inference), so toolMessage.content is already ToolResultPart[].
  const toolMessage = messages.find((m) => m.role === 'tool');
  if (!toolMessage) {
    throw new Error('expected a tool message');
  }
  return toolMessage.content;
}

/** Drive convertToVercelMessages and return the first tool-result part's output. */
function firstToolResultOutput(contents: IContent[]): ToolResultPart['output'] {
  const parts = toolResultParts(contents);
  if (parts.length === 0) {
    throw new Error('expected at least one tool-result part');
  }
  return parts[0].output;
}

function getToolOutputValue(
  output: ToolResultPart['output'],
  expectedType: 'text' | 'error-text',
): string {
  if (output.type !== 'text' && output.type !== 'error-text') {
    throw new Error(`expected ${expectedType} output, got ${output.type}`);
  }
  if (output.type !== expectedType) {
    throw new Error(`expected ${expectedType} output, got ${output.type}`);
  }
  return output.value;
}

function requireToolResponse(
  blocks: readonly ToolResponseBlock[],
  toolName: string,
): ToolResponseBlock {
  const block = blocks.find((candidate) => candidate.toolName === toolName);
  if (!block) {
    throw new Error(`expected a ${toolName} block`);
  }
  return block;
}

function toolResponseBlocks(
  contents: readonly IContent[],
): ToolResponseBlock[] {
  return contents.flatMap((content) =>
    content.blocks.flatMap((block) =>
      block.type === 'tool_response' ? [block] : [],
    ),
  );
}

function roundTripToolResponses(
  ...blocks: ToolResponseBlock[]
): ToolResponseBlock[] {
  return convertFromVercelMessages(
    convertToVercelMessages([toolContent(...blocks)]),
  ).flatMap((content) =>
    content.blocks.flatMap((block) =>
      block.type === 'tool_response' ? [block] : [],
    ),
  );
}

describe('messageConversion tool-failure round trip (issue #3076)', () => {
  it('AC1.1 — a tool_response with error set converts to an error-text output', () => {
    const output = firstToolResultOutput([
      toolContent({
        type: 'tool_response',
        callId: 'hist_tool_1',
        toolName: 'failingTool',
        result: { output: 'partial data' },
        error: 'boom',
      }),
    ]);
    expect(output.type).toBe('error-text');
  });

  it('AC1.2 — the error-text value is the model-facing result text', () => {
    const output = firstToolResultOutput([
      toolContent({
        type: 'tool_response',
        callId: 'hist_tool_1',
        toolName: 'failingTool',
        result: { output: 'partial data' },
        error: 'boom',
      }),
    ]);
    expect(getToolOutputValue(output, 'error-text')).toBe('partial data');
  });

  it('AC1.3 — a failed block with no result yields the error text, not [no tool result]', () => {
    const output = firstToolResultOutput([
      toolContent({
        type: 'tool_response',
        callId: 'hist_tool_1',
        toolName: 'failingTool',
        result: undefined,
        error: 'the tool exploded',
      }),
    ]);
    expect(getToolOutputValue(output, 'error-text')).toBe('the tool exploded');
  });

  it('AC1.4 — a tool_response without error still yields a text output (regression guard, incl. empty placeholder)', () => {
    const successOutput = firstToolResultOutput([
      toolContent({
        type: 'tool_response',
        callId: 'hist_tool_1',
        toolName: 'okTool',
        result: { output: 'all good' },
      }),
    ]);
    expect(getToolOutputValue(successOutput, 'text')).toBe('all good');

    const emptyOutput = firstToolResultOutput([
      toolContent({
        type: 'tool_response',
        callId: 'hist_tool_1',
        toolName: 'voidTool',
        result: undefined,
      }),
    ]);
    expect(getToolOutputValue(emptyOutput, 'text')).toBe('[no tool result]');
  });

  it('AC1.5 — round trip convertTo -> convertFrom keeps failures marked failed and successes clean', () => {
    const contents: IContent[] = [
      toolContent({
        type: 'tool_response',
        callId: 'hist_tool_1',
        toolName: 'failingTool',
        result: { output: 'partial data' },
        error: 'boom',
      }),
      toolContent({
        type: 'tool_response',
        callId: 'hist_tool_2',
        toolName: 'okTool',
        result: { output: 'all good' },
      }),
    ];

    const blocks = roundTripToolResponses(...toolResponseBlocks(contents));

    const failed = requireToolResponse(blocks, 'failingTool');
    const succeeded = requireToolResponse(blocks, 'okTool');

    // The pre-existing inbound decoder (parseToolResultPart) sets the reconstructed
    // `error` to the OUTPUT TEXT rather than the original error string, so the
    // exact error text is NOT preserved here. The canonical `error` property is
    // the observable failure marker that #3076 requires the round trip to keep.
    expect(failed.error).toBe('partial data');
    expect(failed.result).toBe('partial data');

    expect(succeeded.error).toBeUndefined();
    expect(succeeded.result).toBe('all good');
  });

  it('AC1.8 — failed empty-result variants remain failures after a round trip', () => {
    const blocks = roundTripToolResponses(
      {
        type: 'tool_response',
        callId: 'hist_tool_undefined',
        toolName: 'undefinedResultTool',
        result: undefined,
        error: 'undefined result failed',
      },
      {
        type: 'tool_response',
        callId: 'hist_tool_null',
        toolName: 'nullResultTool',
        result: null,
        error: 'null result failed',
      },
    );

    expect(blocks.map((block) => block.error)).toStrictEqual([
      'undefined result failed',
      'null result failed',
    ]);
    expect(blocks.map((block) => block.result)).toStrictEqual([
      'undefined result failed',
      'null result failed',
    ]);
  });

  it('AC1.6 — one tool message with multiple tool_response blocks keeps error-text/text parts in order', () => {
    const outputs = toolResultParts([
      toolContent(
        {
          type: 'tool_response',
          callId: 'hist_tool_1',
          toolName: 'failingTool',
          result: { output: 'partial data' },
          error: 'boom',
        },
        {
          type: 'tool_response',
          callId: 'hist_tool_2',
          toolName: 'okTool',
          result: { output: 'all good' },
        },
      ),
    ]).map((part) => part.output);

    expect(outputs[0]?.type).toBe('error-text');
    expect(outputs[1]?.type).toBe('text');
  });

  it('AC1.7 — a failed block with result null yields the error text as the value', () => {
    const output = firstToolResultOutput([
      toolContent({
        type: 'tool_response',
        callId: 'hist_tool_1',
        toolName: 'failingTool',
        result: null,
        error: 'the tool exploded',
      }),
    ]);
    expect(getToolOutputValue(output, 'error-text')).toBe('the tool exploded');
  });
});
