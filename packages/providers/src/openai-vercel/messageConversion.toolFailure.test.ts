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
  // ai@7 widened ToolContent to Array<ToolResultPart | ToolApprovalResponse>,
  // so the tool-result parts have to be selected rather than assumed.
  const toolMessage = messages.find((m) => m.role === 'tool');
  if (!toolMessage) {
    throw new Error('expected a tool message');
  }
  return toolMessage.content.filter(
    (part): part is ToolResultPart => part.type === 'tool-result',
  );
}

/** Drive convertToVercelMessages and return the first tool-result part's output. */
function firstToolResultOutput(contents: IContent[]): ToolResultPart['output'] {
  const parts = toolResultParts(contents);
  if (parts.length === 0) {
    throw new Error('expected at least one tool-result part');
  }
  return parts[0].output;
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
    if (output.type !== 'error-text') {
      throw new Error(`expected error-text output, got ${output.type}`);
    }
    expect(output.value).toBe('partial data');
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
    if (output.type !== 'error-text') {
      throw new Error(`expected error-text output, got ${output.type}`);
    }
    expect(output.value).toBe('the tool exploded');
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
    if (successOutput.type !== 'text') {
      throw new Error(`expected text output, got ${successOutput.type}`);
    }
    expect(successOutput.value).toBe('all good');

    const emptyOutput = firstToolResultOutput([
      toolContent({
        type: 'tool_response',
        callId: 'hist_tool_1',
        toolName: 'voidTool',
        result: undefined,
      }),
    ]);
    if (emptyOutput.type !== 'text') {
      throw new Error(`expected text output, got ${emptyOutput.type}`);
    }
    expect(emptyOutput.value).toBe('[no tool result]');
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

    const blocks = roundTripToolResponses(
      ...contents.flatMap((content) =>
        content.blocks.flatMap((block) =>
          block.type === 'tool_response' ? [block] : [],
        ),
      ),
    );

    const failed = blocks.find((b) => b.toolName === 'failingTool');
    const succeeded = blocks.find((b) => b.toolName === 'okTool');
    if (!failed || !succeeded) {
      throw new Error('expected both a failed and a succeeded block');
    }

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

    expect(blocks.map((block) => block.error)).toEqual([
      'undefined result failed',
      'null result failed',
    ]);
    expect(blocks.map((block) => block.result)).toEqual([
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
    if (output.type !== 'error-text') {
      throw new Error(`expected error-text output, got ${output.type}`);
    }
    expect(output.value).toBe('the tool exploded');
  });
});
