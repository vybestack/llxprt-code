/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * agenticLoop characterization tests — pins the OBSERVABLE behavior of
 * `loopHelpers.recordCancelledToolHistory` BEFORE the remaining retype
 * group migrates `Part`/`{role,parts}` internals to neutral types.
 *
 * When a tool call is cancelled, `recordCancelledToolHistory` records:
 *   - tool_call blocks under speaker 'ai'
 *   - non-tool_call blocks (tool responses, text, thinking) under speaker 'tool'
 *
 * Uses a REAL recording boundary (a minimal AgentClientContract stub that
 * captures every `addHistory` payload). No mock theater — the function under
 * test is the real production helper.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P26
 * @requirement:REQ-005.5c
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { recordCancelledToolHistory } from '../loopHelpers.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import type {
  IContent,
  ContentBlock,
  ToolCallBlock,
  ToolResponseBlock,
  TextBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

// ---------------------------------------------------------------------------
// Minimal AgentClientContract stub — captures addHistory payloads
// ---------------------------------------------------------------------------

interface CapturingClient {
  client: AgentClientContract;
  addedHistory: IContent[];
}

function createCapturingClient(): CapturingClient {
  const addedHistory: IContent[] = [];
  const client = {
    addHistory: vi.fn(async (content: IContent) => {
      addedHistory.push(content);
    }),
  } as unknown as AgentClientContract;
  return { client, addedHistory };
}

// ---------------------------------------------------------------------------
// ContentBlock + CompletedToolCall factories
// ---------------------------------------------------------------------------

function toolCallBlock(
  id: string,
  name: string,
  args: unknown = {},
): ToolCallBlock {
  return { type: 'tool_call', id, name, parameters: args };
}

function toolResponseBlock(
  callId: string,
  toolName: string,
  result: unknown,
): ToolResponseBlock {
  return { type: 'tool_response', callId, toolName, result };
}

function textBlock(text: string): TextBlock {
  return { type: 'text', text };
}

function makeCancelledToolCall(
  callId: string,
  toolName: string,
  responseParts: ContentBlock[],
): CompletedToolCall {
  return {
    status: 'cancelled',
    request: {
      callId,
      name: toolName,
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-p26',
    },
    response: {
      callId,
      responseParts,
      resultDisplay: undefined,
      error: undefined,
      errorType: undefined,
    },
    tool: { name: toolName } as never,
    invocation: {} as never,
  };
}

// ---------------------------------------------------------------------------
// REQ-005.5c — recordCancelledToolHistory observable behavior
// ---------------------------------------------------------------------------

describe('P26: recordCancelledToolHistory characterization', () => {
  let capturing: CapturingClient;

  beforeEach(() => {
    capturing = createCapturingClient();
  });

  it('records a single cancelled tool call + its response under the correct speakers', async () => {
    // The cancelled tool's responseParts carry both the tool_call block and
    // the tool_response block so the helper can record the call under 'ai'
    // and the response under 'tool'.
    const toolsWithCalls = [
      makeCancelledToolCall('call-1', 'search', [
        toolCallBlock('call-1', 'search', { query: 'hi' }),
        toolResponseBlock('call-1', 'search', 'cancelled'),
      ]),
    ];
    await recordCancelledToolHistory(toolsWithCalls, capturing.client);

    expect(capturing.addedHistory).toHaveLength(2);
    // First addHistory: tool_call blocks under 'ai'
    const aiEntry = capturing.addedHistory[0];
    expect(aiEntry.speaker).toBe('ai');
    expect(aiEntry.blocks).toHaveLength(1);
    expect(aiEntry.blocks[0].type).toBe('tool_call');
    const aiCall = aiEntry.blocks[0] as ToolCallBlock;
    expect(aiCall.id).toBe('call-1');
    expect(aiCall.name).toBe('search');
    // Second addHistory: non-tool_call blocks under 'tool'
    const toolEntry = capturing.addedHistory[1];
    expect(toolEntry.speaker).toBe('tool');
    expect(toolEntry.blocks).toHaveLength(1);
    expect(toolEntry.blocks[0].type).toBe('tool_response');
    const toolResp = toolEntry.blocks[0] as ToolResponseBlock;
    expect(toolResp.callId).toBe('call-1');
    expect(toolResp.toolName).toBe('search');
  });

  it('awaits addHistory so cancelled-tool history is persisted before the turn ends', async () => {
    const resolved: string[] = [];
    const client = {
      addHistory: vi.fn(async (content: IContent) => {
        await new Promise((r) => setTimeout(r, 5));
        resolved.push(content.speaker);
      }),
    } as unknown as AgentClientContract;

    const tools = [
      makeCancelledToolCall('call-1', 'search', [
        toolCallBlock('call-1', 'search', {}),
        toolResponseBlock('call-1', 'search', 'done'),
      ]),
    ];
    await recordCancelledToolHistory(tools, client);
    // Both writes completed BEFORE the helper returned.
    expect(resolved).toStrictEqual(['ai', 'tool']);
  });

  it('does NOT call addHistory when the cancelled tools carry only non-tool_call blocks', async () => {
    const tools = [
      makeCancelledToolCall('call-1', 'search', [
        toolResponseBlock('call-1', 'search', 'cancelled'),
      ]),
    ];
    await recordCancelledToolHistory(tools, capturing.client);
    // Only the non-tool_call (response) block is present → one addHistory call
    // under 'tool'; no 'ai' entry.
    expect(capturing.addedHistory).toHaveLength(1);
    expect(capturing.addedHistory[0].speaker).toBe('tool');
  });

  it('does NOT call addHistory when the cancelled tools carry only tool_call blocks', async () => {
    const tools = [
      makeCancelledToolCall('call-1', 'search', [
        toolCallBlock('call-1', 'search', {}),
      ]),
    ];
    await recordCancelledToolHistory(tools, capturing.client);
    expect(capturing.addedHistory).toHaveLength(1);
    expect(capturing.addedHistory[0].speaker).toBe('ai');
  });

  it('records multiple cancelled tool calls in a single batch', async () => {
    const tools = [
      makeCancelledToolCall('call-1', 'search', [
        toolCallBlock('call-1', 'search', { q: 'a' }),
        toolResponseBlock('call-1', 'search', 'r1'),
      ]),
      makeCancelledToolCall('call-2', 'read_file', [
        toolCallBlock('call-2', 'read_file', { path: '/x' }),
        toolResponseBlock('call-2', 'read_file', 'r2'),
      ]),
    ];
    await recordCancelledToolHistory(tools, capturing.client);

    expect(capturing.addedHistory).toHaveLength(2);
    const aiEntry = capturing.addedHistory[0];
    expect(aiEntry.speaker).toBe('ai');
    expect(aiEntry.blocks).toHaveLength(2);
    const toolEntry = capturing.addedHistory[1];
    expect(toolEntry.speaker).toBe('tool');
    expect(toolEntry.blocks).toHaveLength(2);
  });

  it('groups text/thinking blocks with tool responses under speaker tool', async () => {
    const tools = [
      makeCancelledToolCall('call-1', 'search', [
        toolCallBlock('call-1', 'search', {}),
        textBlock('intermediate note'),
        toolResponseBlock('call-1', 'search', 'done'),
      ]),
    ];
    await recordCancelledToolHistory(tools, capturing.client);

    expect(capturing.addedHistory).toHaveLength(2);
    const toolEntry = capturing.addedHistory[1];
    expect(toolEntry.speaker).toBe('tool');
    expect(toolEntry.blocks).toHaveLength(2);
    expect(toolEntry.blocks[0].type).toBe('text');
    expect(toolEntry.blocks[1].type).toBe('tool_response');
  });

  it('preserves tool-call id and parameters on the recorded ai entry', async () => {
    const params = { query: 'hello', limit: 10 };
    const tools = [
      makeCancelledToolCall('call-xyz', 'search', [
        toolCallBlock('call-xyz', 'search', params),
        toolResponseBlock('call-xyz', 'search', 'result'),
      ]),
    ];
    await recordCancelledToolHistory(tools, capturing.client);

    const aiEntry = capturing.addedHistory[0];
    const callBlock = aiEntry.blocks[0] as ToolCallBlock;
    expect(callBlock.id).toBe('call-xyz');
    expect(callBlock.name).toBe('search');
    expect(callBlock.parameters).toStrictEqual(params);
  });

  // PROPERTY: for ANY set of cancelled tool calls, every tool_call block
  // lands under speaker 'ai' and every other block lands under speaker 'tool'.
  it('partitions blocks by type into ai/tool speakers for any cancelled set (property)', async () => {
    const idArb = fc
      .string({ minLength: 1, maxLength: 12 })
      .filter((s) => /^[\w-]+$/.test(s));
    const nameArb = fc.constantFrom('search', 'read_file', 'write_file', 'run');
    const paramsArb = fc.record({
      key: fc.string({ minLength: 1, maxLength: 8 }),
      n: fc.integer({ min: 0, max: 100 }),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ id: idArb, name: nameArb, params: paramsArb }), {
          minLength: 1,
          maxLength: 5,
        }),
        async (calls) => {
          const local = createCapturingClient();
          const tools = calls.map((c) =>
            makeCancelledToolCall(c.id, c.name, [
              toolCallBlock(c.id, c.name, c.params),
              toolResponseBlock(c.id, c.name, 'cancelled'),
            ]),
          );
          await recordCancelledToolHistory(tools, local.client);

          // Every tool_call block across all tools must appear in the 'ai' entry.
          const aiEntry = local.addedHistory.find((e) => e.speaker === 'ai');
          expect(aiEntry).toBeDefined();
          const aiCallIds = aiEntry!.blocks
            .filter((b): b is ToolCallBlock => b.type === 'tool_call')
            .map((b) => b.id);
          expect(aiCallIds).toStrictEqual(calls.map((c) => c.id));

          // Every tool_response block must appear in the 'tool' entry.
          const toolEntry = local.addedHistory.find(
            (e) => e.speaker === 'tool',
          );
          expect(toolEntry).toBeDefined();
          const toolCallIds = toolEntry!.blocks
            .filter((b): b is ToolResponseBlock => b.type === 'tool_response')
            .map((b) => b.callId);
          expect(toolCallIds).toStrictEqual(calls.map((c) => c.id));
        },
      ),
    );
  });

  // PROPERTY: tool-call id ↔ response pairing — for any single cancelled tool
  // call, the id recorded on the ai tool_call block equals the callId recorded
  // on the tool tool_response block.
  it('preserves tool-call id ↔ response callId pairing for any cancelled call (property)', async () => {
    const idArb = fc
      .string({ minLength: 1, maxLength: 16 })
      .filter((s) => /^[\w-]+$/.test(s));
    const nameArb = fc
      .string({ minLength: 1, maxLength: 16 })
      .filter((s) => /^[\w-]+$/.test(s));

    await fc.assert(
      fc.asyncProperty(
        idArb,
        nameArb,
        async (callId: string, toolName: string) => {
          const local = createCapturingClient();
          const tools = [
            makeCancelledToolCall(callId, toolName, [
              toolCallBlock(callId, toolName, { input: callId }),
              toolResponseBlock(callId, toolName, { output: callId }),
            ]),
          ];
          await recordCancelledToolHistory(tools, local.client);

          const aiEntry = local.addedHistory.find((e) => e.speaker === 'ai');
          const toolEntry = local.addedHistory.find(
            (e) => e.speaker === 'tool',
          );
          expect(aiEntry).toBeDefined();
          expect(toolEntry).toBeDefined();

          const aiCall = aiEntry!.blocks.find(
            (b): b is ToolCallBlock => b.type === 'tool_call',
          );
          const toolResp = toolEntry!.blocks.find(
            (b): b is ToolResponseBlock => b.type === 'tool_response',
          );
          expect(aiCall).toBeDefined();
          expect(toolResp).toBeDefined();
          // The pairing invariant: tool_call.id === tool_response.callId
          expect(aiCall!.id).toBe(toolResp!.callId);
          expect(aiCall!.id).toBe(callId);
        },
      ),
    );
  });
});
