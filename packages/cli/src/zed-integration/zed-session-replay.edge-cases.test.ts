/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type { IContent } from '@vybestack/llxprt-code-core';

import { mapHistoryToSessionUpdates } from './zed-session-replay.js';

describe('mapHistoryToSessionUpdates (issue #1604 replay edge cases)', () => {
  it('maps a combined { output, error } result to a FAILED tool_call_update carrying the output text (output precedence, FINDING F3)', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-combined',
            name: 'run_shell_command',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call-combined',
            toolName: 'run_shell_command',
            result: { output: 'partial output', error: 'command failed' },
          },
        ],
      },
    ];
    expect(mapHistoryToSessionUpdates(history)[1]).toStrictEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-combined',
      status: 'failed',
      kind: 'execute',
      content: [
        {
          type: 'content',
          content: { type: 'text', text: 'partial output' },
        },
      ],
    });
  });

  it('maps a tool_response with null result to a completed tool_call_update with no content (FINDING F3)', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-null-result',
            name: 'run_shell_command',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call-null-result',
            toolName: 'run_shell_command',
            result: null,
          },
        ],
      },
    ];
    expect(mapHistoryToSessionUpdates(history)[1]).toStrictEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-null-result',
      status: 'completed',
      kind: 'execute',
      content: [],
    });
  });

  it('maps a tool_response with undefined result to a completed tool_call_update with no content (FINDING F3)', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-undef-result',
            name: 'run_shell_command',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call-undef-result',
            toolName: 'run_shell_command',
            result: undefined,
          },
        ],
      },
    ];
    expect(mapHistoryToSessionUpdates(history)[1]).toStrictEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-undef-result',
      status: 'completed',
      kind: 'execute',
      content: [],
    });
  });
});
