/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the pure IContent -> ACP SessionUpdate replay mapping
 * (mapHistoryToSessionUpdates) used by ACP session/load (issue #1604). These
 * assert the EXACT v1 snake_case wire payload shapes for every block kind so a
 * regression in the discriminators or field names is caught structurally, and
 * they pin the order-aware tool-call pairing semantics (FINDING C) and the
 * result-text extraction precedence including MCP-style content arrays
 * (FINDING D). Pure inputs -> pure output; no mocks, no connection.
 *
 * The ZedAgent.loadSession ORCHESTRATION (streaming, cleanup, error mapping)
 * lives in zedIntegration.loadSession.test.ts; the record->resume->history
 * fidelity is proven by the agents-package behavioral tests.
 */

import { describe, expect, it } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core';

import { mapHistoryToSessionUpdates } from './zed-session-replay.js';

describe('mapHistoryToSessionUpdates (issue #1604 replay mapping)', () => {
  it('maps a human text block to a user_message_chunk', () => {
    const history: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hello there' }] },
    ];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([
      {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'hello there' },
      },
    ]);
  });

  it('maps an ai text block to an agent_message_chunk', () => {
    const history: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'the answer' }] },
    ];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'the answer' },
      },
    ]);
  });

  it('maps an ai thinking block to an agent_thought_chunk carrying the thought text', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'thinking', thought: 'let me reason' }],
      },
    ];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([
      {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'let me reason' },
      },
    ]);
  });

  it('maps a lone ai tool_call (no recorded response) to an in_progress tool_call matching the live start shape, then a synthetic failed update (FINDING 2/3: orphaned/interrupted turn)', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'read_file',
            parameters: { absolute_path: '/project/a.ts' },
          },
        ],
      },
    ];
    // Live start shape (emitToolCallStart): in_progress, empty content, inferred
    // locations + kind, rawInput. Because the call has NO paired response in the
    // history, a terminal failed tool_call_update (empty content) is synthesized
    // so the client does not render a perpetually-running tool.
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'read_file',
        status: 'in_progress',
        content: [],
        locations: [{ path: '/project/a.ts' }],
        kind: 'read',
        rawInput: { absolute_path: '/project/a.ts' },
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'failed',
        content: [],
      },
    ]);
  });

  it('maps a tool-speaker tool_response block to a completed tool_call_update with text content', () => {
    // Paired call so the response has a matching in_progress start (FINDING C
    // drops orphan responses); the terminal update is asserted at index [1].
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'read_file',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call-1',
            toolName: 'read_file',
            result: 'file body contents',
          },
        ],
      },
    ];
    expect(mapHistoryToSessionUpdates(history)[1]).toStrictEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-1',
      status: 'completed',
      content: [
        {
          type: 'content',
          content: { type: 'text', text: 'file body contents' },
        },
      ],
    });
  });

  it('maps a { output } success result to a completed tool_call_update carrying the output text (FINDING 3)', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-out',
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
            callId: 'call-out',
            toolName: 'run_shell_command',
            result: { output: 'x' },
          },
        ],
      },
    ];
    expect(mapHistoryToSessionUpdates(history)[1]).toStrictEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-out',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'x' } }],
    });
  });

  it('maps a { error } result to a FAILED tool_call_update carrying the error text (FINDING 3)', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-err',
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
            callId: 'call-err',
            toolName: 'run_shell_command',
            result: { error: 'y' },
          },
        ],
      },
    ];
    expect(mapHistoryToSessionUpdates(history)[1]).toStrictEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-err',
      status: 'failed',
      content: [{ type: 'content', content: { type: 'text', text: 'y' } }],
    });
  });

  it('maps an OBJECT-shaped { error: { message } } result to a FAILED tool_call_update carrying the message text (FINDING F3)', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-obj-err',
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
            callId: 'call-obj-err',
            toolName: 'run_shell_command',
            result: { error: { message: 'boom' } },
          },
        ],
      },
    ];
    // createErrorResponse can persist an object-shaped error ({ error: { message } });
    // it must be detected as a failure AND surface the nested message text.
    expect(mapHistoryToSessionUpdates(history)[1]).toStrictEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-obj-err',
      status: 'failed',
      content: [{ type: 'content', content: { type: 'text', text: 'boom' } }],
    });
  });

  it('maps a tool_response whose block.error is set to a FAILED tool_call_update carrying the error text (FINDING 3)', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-boom',
            name: 'write_file',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call-boom',
            toolName: 'write_file',
            result: {},
            error: 'permission denied',
          },
        ],
      },
    ];
    expect(mapHistoryToSessionUpdates(history)[1]).toStrictEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-boom',
      status: 'failed',
      content: [
        {
          type: 'content',
          content: { type: 'text', text: 'permission denied' },
        },
      ],
    });
  });

  it('emits an empty content array for a tool_response with no representable text', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-2',
            name: 'secret_tool',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call-2',
            toolName: 'secret_tool',
            result: {},
          },
        ],
      },
    ];
    expect(mapHistoryToSessionUpdates(history)[1]).toStrictEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-2',
      status: 'completed',
      content: [],
    });
  });

  it('skips whitespace-only text and skips media/code blocks (v1 replay)', () => {
    const history: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: '   ' }] },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'AAAA',
            encoding: 'base64',
          },
          { type: 'code', code: 'const x = 1;' },
        ],
      },
    ];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([]);
  });

  it('omits kind for an unknown tool name but still emits the in_progress tool_call (with no inferable locations)', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-x',
            name: 'totally_unknown_tool',
            parameters: { foo: 'bar' },
          },
        ],
      },
    ];
    const [update] = mapHistoryToSessionUpdates(history);
    expect(update).toStrictEqual({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-x',
      title: 'totally_unknown_tool',
      status: 'in_progress',
      content: [],
      locations: [],
      rawInput: { foo: 'bar' },
    });
    expect('kind' in update).toBe(false);
  });

  it('pairs an ai tool_call with its later tool_response: in_progress start THEN completed update, no synthetic failure (FINDING 2/3 ordered pairing)', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'paired-1',
            name: 'read_file',
            parameters: { absolute_path: '/project/z.ts' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'paired-1',
            toolName: 'read_file',
            result: { output: 'paired body' },
          },
        ],
      },
    ];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'paired-1',
        title: 'read_file',
        status: 'in_progress',
        content: [],
        locations: [{ path: '/project/z.ts' }],
        kind: 'read',
        rawInput: { absolute_path: '/project/z.ts' },
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'paired-1',
        status: 'completed',
        content: [
          { type: 'content', content: { type: 'text', text: 'paired body' } },
        ],
      },
    ]);
  });

  it('orders pairing across a multi-tool conversation: each call starts in_progress and completes from its own response (FINDING 2/3)', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 't1',
            name: 'read_file',
            parameters: { absolute_path: '/a' },
          },
          {
            type: 'tool_call',
            id: 't2',
            name: 'run_shell_command',
            parameters: { command: 'ls' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 't1',
            toolName: 'read_file',
            result: { output: 'first' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 't2',
            toolName: 'run_shell_command',
            result: { error: 'boom' },
          },
        ],
      },
    ];
    expect(
      mapHistoryToSessionUpdates(history).map((u) => ({
        kind: u.sessionUpdate,
        id: (u as { toolCallId?: string }).toolCallId,
        status: (u as { status?: string }).status,
      })),
    ).toStrictEqual([
      { kind: 'tool_call', id: 't1', status: 'in_progress' },
      { kind: 'tool_call', id: 't2', status: 'in_progress' },
      { kind: 'tool_call_update', id: 't1', status: 'completed' },
      { kind: 'tool_call_update', id: 't2', status: 'failed' },
    ]);
  });

  // ─── FINDING C: order-aware tool-call pairing edge cases ──────────────────

  it('DROPS an orphan tool_response that arrives before any matching tool_call (no floating terminal update, FINDING C)', () => {
    const history: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'never-started',
            toolName: 'read_file',
            result: { output: 'ghost' },
          },
        ],
      },
    ];
    // The response has no in_progress start to pair with; emitting a terminal
    // update would hand the client a lifecycle it never saw begin. Dropped.
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([]);
  });

  it('emits exactly ONE terminal update for a call (first response wins; duplicate responses for the same id are dropped, FINDING C)', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'dup-1',
            name: 'read_file',
            parameters: { absolute_path: '/a' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'dup-1',
            toolName: 'read_file',
            result: { output: 'winner' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'dup-1',
            toolName: 'read_file',
            result: { output: 'loser' },
          },
        ],
      },
    ];
    const updates = mapHistoryToSessionUpdates(history);
    // start + exactly one completed terminal; the second response is dropped.
    expect(updates).toStrictEqual([
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'dup-1',
        title: 'read_file',
        status: 'in_progress',
        content: [],
        locations: [{ path: '/a' }],
        kind: 'read',
        rawInput: { absolute_path: '/a' },
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'dup-1',
        status: 'completed',
        content: [
          { type: 'content', content: { type: 'text', text: 'winner' } },
        ],
      },
    ]);
  });

  it('treats the SAME callId reused across turns (start, complete, start again, complete) as TWO independent lifecycles (FINDING C determinism)', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'reused',
            name: 'run_shell_command',
            parameters: { command: 'first' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'reused',
            toolName: 'run_shell_command',
            result: { output: 'one' },
          },
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'reused',
            name: 'run_shell_command',
            parameters: { command: 'second' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'reused',
            toolName: 'run_shell_command',
            result: { output: 'two' },
          },
        ],
      },
    ];
    // Because the first response clears the pending id BEFORE the second start,
    // the second start re-adds it as a NEW pending call: both start->complete
    // lifecycles are emitted in order, each pairing with its own response.
    expect(
      mapHistoryToSessionUpdates(history).map((u) => ({
        kind: u.sessionUpdate,
        status: (u as { status?: string }).status,
        text: (u as { content?: Array<{ content?: { text?: string } }> })
          .content?.[0]?.content?.text,
      })),
    ).toStrictEqual([
      { kind: 'tool_call', status: 'in_progress', text: undefined },
      { kind: 'tool_call_update', status: 'completed', text: 'one' },
      { kind: 'tool_call', status: 'in_progress', text: undefined },
      { kind: 'tool_call_update', status: 'completed', text: 'two' },
    ]);
  });

  it('synthesizes trailing failed updates for still-pending calls in original START order (FINDING C)', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'pending-a',
            name: 'read_file',
            parameters: { absolute_path: '/a' },
          },
          {
            type: 'tool_call',
            id: 'pending-b',
            name: 'read_file',
            parameters: { absolute_path: '/b' },
          },
        ],
      },
      // Only the SECOND call gets a response; 'pending-a' and (after) nothing
      // else stays pending. Interleave a response for b to prove the trailing
      // synthetic is emitted only for the still-pending 'pending-a'.
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'pending-b',
            toolName: 'read_file',
            result: { output: 'b done' },
          },
        ],
      },
    ];
    expect(
      mapHistoryToSessionUpdates(history).map((u) => ({
        kind: u.sessionUpdate,
        id: (u as { toolCallId?: string }).toolCallId,
        status: (u as { status?: string }).status,
      })),
    ).toStrictEqual([
      { kind: 'tool_call', id: 'pending-a', status: 'in_progress' },
      { kind: 'tool_call', id: 'pending-b', status: 'in_progress' },
      { kind: 'tool_call_update', id: 'pending-b', status: 'completed' },
      // 'pending-a' never got a response -> trailing synthetic failed update.
      { kind: 'tool_call_update', id: 'pending-a', status: 'failed' },
    ]);
  });

  // ─── FINDING D: MCP-style result.content array extraction ─────────────────

  it('extracts joined text from an MCP-style result.content ARRAY into the completed update (FINDING D)', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'mcp-1',
            name: 'run_shell_command',
            parameters: { command: 'x' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'mcp-1',
            toolName: 'run_shell_command',
            result: {
              content: [
                { type: 'text', text: 'part one ' },
                { type: 'text', text: 'part two' },
              ],
            },
          },
        ],
      },
    ];
    const updates = mapHistoryToSessionUpdates(history);
    expect(updates[1]).toStrictEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'mcp-1',
      status: 'completed',
      content: [
        {
          type: 'content',
          content: { type: 'text', text: 'part one part two' },
        },
      ],
    });
  });

  it('joins ONLY the text elements of a mixed MCP content array, skipping non-text elements (FINDING D)', () => {
    const history: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'mcp-mixed',
            toolName: 'some_tool',
            result: {
              content: [
                { type: 'image', data: 'AAAA', mimeType: 'image/png' },
                { type: 'text', text: 'visible text' },
                { type: 'resource', uri: 'file:///x' },
              ],
            },
          },
        ],
      },
    ];
    // MCP content-array extraction is asserted through a PAIRED call/response:
    // an orphan response (no matching start) would be dropped by the pending
    // check before extraction is observable, so pairing is required to surface
    // the extracted text on the terminal update.
    const paired: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'mcp-mixed',
            name: 'some_tool',
            parameters: {},
          },
        ],
      },
      ...history,
    ];
    const updates = mapHistoryToSessionUpdates(paired);
    expect(updates[1]).toStrictEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'mcp-mixed',
      status: 'completed',
      content: [
        { type: 'content', content: { type: 'text', text: 'visible text' } },
      ],
    });
  });

  it('emits empty content for an MCP content array with NO usable text: non-text elements AND whitespace-only text are BOTH skipped (no crash, FINDING D + FINDING F11)', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'mcp-empty',
            name: 'some_tool',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'mcp-empty',
            toolName: 'some_tool',
            result: {
              content: [
                // Non-text elements are skipped (FINDING D)...
                { type: 'image', data: 'AAAA', mimeType: 'image/png' },
                { type: 'resource', uri: 'file:///x' },
                // ...and whitespace-only text elements are trimmed + skipped
                // (FINDING F11), so they do NOT pass blank text through. Both
                // spaces and a newline+tab element must be dropped.
                { type: 'text', text: '   ' },
                { type: 'text', text: '\n\t' },
              ],
            },
          },
        ],
      },
    ];
    // With no usable text, the update carries an empty content array (no blank
    // text leaks from the whitespace-only elements).
    const updates = mapHistoryToSessionUpdates(history);
    expect(updates[1]).toStrictEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'mcp-empty',
      status: 'completed',
      content: [],
    });
  });

  it('preserves whole-conversation order across a multi-block transcript', () => {
    const history: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'do a thing' }] },
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'planning' },
          { type: 'text', text: 'working on it' },
          {
            type: 'tool_call',
            id: 'c1',
            name: 'run_shell_command',
            parameters: { command: 'ls' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'run_shell_command',
            result: 'a.ts b.ts',
          },
        ],
      },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'done' }] },
    ];
    expect(
      mapHistoryToSessionUpdates(history).map((u) => u.sessionUpdate),
    ).toStrictEqual([
      'user_message_chunk',
      'agent_thought_chunk',
      'agent_message_chunk',
      'tool_call',
      'tool_call_update',
      'agent_message_chunk',
    ]);
  });
});
