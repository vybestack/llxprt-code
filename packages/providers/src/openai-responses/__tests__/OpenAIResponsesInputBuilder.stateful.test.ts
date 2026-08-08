/**
 * @license
 * Copyright 2025 Vybestack LLC
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
 * Issue #207: When a server-side conversation parent is active, the matching
 * function_call lives server-side (stored via previous_response_id), so
 * function_call_output items must be preserved even when the matching
 * function_call is not present in the input.
 */

import { describe, it, expect, vi } from 'bun:test';
import type { ToolOutputSettingsProvider } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import {
  buildOpenAIResponsesInput,
  type ResponsesInputBuildContext,
} from '../OpenAIResponsesInputBuilder.js';
import type { ResponsesInputItem } from '../OpenAIResponsesTypes.js';

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
    mediaPdfEnabled: true,
    ...overrides,
  };
}

function functionCallOutputs(
  input: ResponsesInputItem[],
): Array<Extract<ResponsesInputItem, { type: 'function_call_output' }>> {
  return input.filter(
    (i): i is Extract<ResponsesInputItem, { type: 'function_call_output' }> =>
      'type' in i && i.type === 'function_call_output',
  );
}

describe('OpenAIResponsesInputBuilder stateful tool output preservation @issue:207', () => {
  it('preserves function_call_output when a server-side parent is active without matching function_call in input', () => {
    const ctx = buildContext({ serverSideParentActive: true });
    const input = buildOpenAIResponsesInput(
      [
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_server_side',
              toolName: 'run_shell_command',
              result: 'result from server-side call',
            },
          ],
        },
      ],
      ctx,
    );

    const outputs = functionCallOutputs(input);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].call_id).toBe('call_server_side');
    expect(outputs[0].output).toContain('result from server-side call');
  });

  it('preserves all function_call_outputs when serverSideParentActive even with mixed matching/orphan outputs', () => {
    const ctx = buildContext({ serverSideParentActive: true });
    const input = buildOpenAIResponsesInput(
      [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_local',
              name: 'test',
              parameters: {},
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_local',
              toolName: 'test',
              result: 'matched',
            },
            {
              type: 'tool_response',
              callId: 'call_server_side',
              toolName: 'test',
              result: 'orphan',
            },
          ],
        },
      ],
      ctx,
    );

    const outputs = functionCallOutputs(input);
    expect(outputs).toHaveLength(2);
    const callIds = outputs.map((o) => o.call_id);
    expect(callIds).toContain('call_local');
    expect(callIds).toContain('call_server_side');
  });

  it('drops orphan function_call_output in stateless mode (no matching function_call)', () => {
    const capturedMessages: string[] = [];
    const debugFn = vi.fn((factory: () => string) => {
      capturedMessages.push(factory());
    });
    const ctx = buildContext({ debug: debugFn });
    const input = buildOpenAIResponsesInput(
      [
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
    );

    expect(functionCallOutputs(input)).toHaveLength(0);
    expect(debugFn).toHaveBeenCalled();
    expect(capturedMessages.some((m) => m.includes('call_orphan'))).toBe(true);
  });
});

/**
 * Issue #3134: with a server-side parent active the API validates reasoning
 * item ids against the stored chain, so a client-synthesized `rs_<ts>_<n>` id
 * (which exists nowhere on the server) must not be sent. Upstream
 * `openai/codex` strips non-server-prefixed ids the same way.
 */
describe('reasoning item ids under a server-side parent @issue:3134', () => {
  function reasoningItems(
    input: ResponsesInputItem[],
  ): Array<Record<string, unknown>> {
    return input.filter(
      (item): item is ResponsesInputItem & Record<string, unknown> =>
        'type' in item && item.type === 'reasoning',
    ) as Array<Record<string, unknown>>;
  }

  const thinkingTurn = [
    {
      speaker: 'ai' as const,
      blocks: [
        {
          type: 'thinking' as const,
          thought: 'pondering',
          encryptedContent: 'ENC',
        },
      ],
    },
  ];

  it('omits id entirely when no server-issued reasoning id exists', () => {
    const input = buildOpenAIResponsesInput(
      thinkingTurn,
      buildContext({ serverSideParentActive: true }),
    );

    const items = reasoningItems(input);
    expect(items).toHaveLength(1);
    expect('id' in items[0]).toBe(false);
    expect(items[0]['encrypted_content']).toBe('ENC');
  });

  it('preserves a genuine server-issued reasoning id', () => {
    const input = buildOpenAIResponsesInput(
      [
        {
          speaker: 'ai' as const,
          blocks: [
            {
              type: 'thinking' as const,
              thought: 'pondering',
              encryptedContent: 'ENC',
              providerMetadata: {
                'openai.responses.reasoningId': 'rs_server_123',
              },
            },
          ],
        },
      ],
      buildContext({ serverSideParentActive: true }),
    );

    expect(reasoningItems(input)[0]['id']).toBe('rs_server_123');
  });

  it('still synthesizes an id when no parent is active (stateless turn)', () => {
    const input = buildOpenAIResponsesInput(
      thinkingTurn,
      buildContext({ serverSideParentActive: false }),
    );

    const id = reasoningItems(input)[0]['id'];
    expect(typeof id).toBe('string');
    expect(String(id).startsWith('rs')).toBe(true);
  });
});
