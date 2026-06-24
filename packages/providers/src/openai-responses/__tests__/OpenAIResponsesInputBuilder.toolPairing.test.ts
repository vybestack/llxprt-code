/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for OpenAIResponsesInputBuilder tool-call / tool-response
 * pairing logic (issues #2137, #855).
 *
 * These tests call buildOpenAIResponsesInput directly with realistic
 * IContent[] histories and assert the emitted ResponsesInputItem[] shape.
 * No mocks of the builder itself are used — only a minimal
 * ToolOutputSettingsProvider stub.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ToolOutputSettingsProvider } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import {
  buildOpenAIResponsesInput,
  type ResponsesInputBuildContext,
} from '../OpenAIResponsesInputBuilder.js';

function buildContext(
  overrides: Partial<ResponsesInputBuildContext> = {},
): ResponsesInputBuildContext {
  const stubConfig: ToolOutputSettingsProvider = {
    getEphemeralSettings: () => ({}),
  };
  return {
    includeReasoningInContext: true,
    outputLimiterConfig: stubConfig,
    debug: () => {},
    ...overrides,
  };
}

function functionCalls(input: unknown[]): unknown[] {
  return input.filter(
    (i) =>
      typeof i === 'object' &&
      i !== null &&
      (i as { type?: string }).type === 'function_call',
  );
}

function functionCallOutputs(input: unknown[]): unknown[] {
  return input.filter(
    (i) =>
      typeof i === 'object' &&
      i !== null &&
      (i as { type?: string }).type === 'function_call_output',
  );
}

function callId(item: unknown): string {
  return (item as { call_id?: string }).call_id ?? '';
}

function build(...contents: IContent[]): unknown[] {
  return buildOpenAIResponsesInput(contents, buildContext()) as unknown[];
}

describe('OpenAIResponsesInputBuilder tool pairing @issue:2137', () => {
  it('emits paired function_call and function_call_output', () => {
    const input = build(
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_abc123',
            name: 'run_shell_command',
            parameters: { command: 'echo hi' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_abc123',
            toolName: 'run_shell_command',
            result: 'hi',
          },
        ],
      },
    );

    const calls = functionCalls(input);
    const outputs = functionCallOutputs(input);
    expect(calls).toHaveLength(1);
    expect(outputs).toHaveLength(1);
    expect(callId(calls[0])).toBe('call_abc123');
    expect(callId(outputs[0])).toBe('call_abc123');
  });

  it('drops orphan function_call_output with no matching tool_call', () => {
    const debugFn = vi.fn();
    const ctx = buildContext({ debug: debugFn });
    const input = buildOpenAIResponsesInput(
      [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hello' }],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_orphan',
              toolName: 'run_shell_command',
              result: 'no matching call',
            },
          ],
        },
      ],
      ctx,
    ) as unknown[];

    expect(functionCallOutputs(input)).toHaveLength(0);
    expect(functionCalls(input)).toHaveLength(0);
    expect(debugFn).toHaveBeenCalled();
  });

  it('omits dangling historical function_call with no matching tool_response', () => {
    const debugFn = vi.fn();
    const ctx = buildContext({ debug: debugFn });
    const input = buildOpenAIResponsesInput(
      [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'do something' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_dangling',
              name: 'run_shell_command',
              parameters: { command: 'ls' },
            },
          ],
        },
        // No tool_response for call_dangling
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'never mind' }],
        },
      ],
      ctx,
    ) as unknown[];

    expect(functionCalls(input)).toHaveLength(0);
    expect(debugFn).toHaveBeenCalled();
  });

  it('preserves assistant text but omits dangling tool_call when both present', () => {
    const input = buildOpenAIResponsesInput(
      [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hi' }],
        },
        {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'Let me check that.' },
            {
              type: 'tool_call',
              id: 'call_text_and_dangling',
              name: 'read_file',
              parameters: { path: '/tmp/x' },
            },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'wait' }],
        },
      ],
      buildContext(),
    ) as unknown[];

    // Assistant text is preserved
    const assistantMessages = input.filter(
      (i) =>
        typeof i === 'object' &&
        i !== null &&
        (i as { role?: string }).role === 'assistant' &&
        typeof (i as { content?: unknown }).content === 'string',
    );
    expect(assistantMessages).toHaveLength(1);
    expect((assistantMessages[0] as { content: string }).content).toBe(
      'Let me check that.',
    );

    // Dangling tool call is omitted
    expect(functionCalls(input)).toHaveLength(0);
  });

  it('omits only the missing call in a parallel pair (one output missing)', () => {
    const input = build(
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_first',
            name: 'run_shell_command',
            parameters: { command: 'echo one' },
          },
          {
            type: 'tool_call',
            id: 'call_second',
            name: 'run_shell_command',
            parameters: { command: 'echo two' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_first',
            toolName: 'run_shell_command',
            result: 'one',
          },
          // No response for call_second
        ],
      },
    );

    const calls = functionCalls(input);
    const outputs = functionCallOutputs(input);
    // Only call_first is paired; call_second has no response so it's dropped.
    expect(calls).toHaveLength(1);
    expect(outputs).toHaveLength(1);
    expect(callId(calls[0])).toBe('call_first');
    expect(callId(outputs[0])).toBe('call_first');
  });

  it('emits both parallel calls when both have matching outputs', () => {
    const input = build(
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_a',
            name: 'run_shell_command',
            parameters: { command: 'echo a' },
          },
          {
            type: 'tool_call',
            id: 'call_b',
            name: 'run_shell_command',
            parameters: { command: 'echo b' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_a',
            toolName: 'run_shell_command',
            result: 'a',
          },
          {
            type: 'tool_response',
            callId: 'call_b',
            toolName: 'run_shell_command',
            result: 'b',
          },
        ],
      },
    );

    const calls = functionCalls(input);
    const outputs = functionCallOutputs(input);
    expect(calls).toHaveLength(2);
    expect(outputs).toHaveLength(2);
  });

  it('uses normalized call_ids consistently between call and output', () => {
    // A tool_call stored with a hist_tool_ prefix id and a tool_response
    // with a call_ prefix id — both normalize to the same call_xxx.
    const input = build(
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_abc123',
            name: 'read_file',
            parameters: { path: '/tmp/f' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_abc123',
            toolName: 'read_file',
            result: 'contents',
          },
        ],
      },
    );

    const calls = functionCalls(input);
    const outputs = functionCallOutputs(input);
    expect(calls).toHaveLength(1);
    expect(outputs).toHaveLength(1);
    expect(callId(calls[0])).toBe(callId(outputs[0]));
    expect(callId(calls[0])).toBe('call_abc123');
  });

  it('does not emit thinking blocks without encryptedContent as reasoning', () => {
    const input = buildOpenAIResponsesInput(
      [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'think about it' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'I should reason carefully',
              sourceField: 'reasoning_content',
            },
            { type: 'text', text: 'Here is my answer.' },
          ],
        },
      ],
      buildContext(),
    ) as unknown[];

    // No reasoning item emitted because there's no encryptedContent.
    const reasoning = input.filter(
      (i) =>
        typeof i === 'object' &&
        i !== null &&
        (i as { type?: string }).type === 'reasoning',
    );
    expect(reasoning).toHaveLength(0);

    // Text is preserved.
    const assistantMessages = input.filter(
      (i) =>
        typeof i === 'object' &&
        i !== null &&
        (i as { role?: string }).role === 'assistant' &&
        typeof (i as { content?: unknown }).content === 'string',
    );
    expect(assistantMessages).toHaveLength(1);
    expect((assistantMessages[0] as { content: string }).content).toBe(
      'Here is my answer.',
    );
  });
});
