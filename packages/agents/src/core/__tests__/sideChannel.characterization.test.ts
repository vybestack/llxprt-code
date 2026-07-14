/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Side-channel characterization tests — pins #2329 raw stop-reason
 * behavior and hook tool-restriction filtering BEFORE the WeakMap/Symbol
 * and providerStopReason mechanisms are removed (P11).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P10
 * @requirement:REQ-003.1,REQ-003.2
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import {
  createFullLoopHarness,
  runFullLoop,
  findFinished,
  extractToolCallRequests,
} from './streamPipeline-characterization-helpers.js';
import type {
  IContent,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// IContent chunk factories
// ---------------------------------------------------------------------------

function textTerminalIContent(
  text: string,
  stopReason: string,
  usage?: Partial<UsageStats>,
): IContent {
  const content: IContent = {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { stopReason },
  };
  if (usage) {
    content.metadata!.usage = {
      ...usage,
      promptTokens: usage.promptTokens ?? 0,
      completionTokens: usage.completionTokens ?? 0,
      totalTokens: usage.totalTokens ?? 0,
    };
  }
  return content;
}

function toolCallIContent(
  id: string,
  name: string,
  args: Record<string, unknown>,
): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'tool_call', id, name, parameters: args }],
  };
}

function toolCallWithTextIContent(
  text: string,
  id: string,
  name: string,
  args: Record<string, unknown>,
): IContent {
  return {
    speaker: 'ai',
    blocks: [
      { type: 'text', text },
      { type: 'tool_call', id, name, parameters: args },
    ],
  };
}

function makeProviderStream(chunks: IContent[]): AsyncGenerator<IContent> {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

// ---------------------------------------------------------------------------
// #2329 — Raw stop reason surfaces on Finished event
// ---------------------------------------------------------------------------

describe('P10: #2329 stop-reason characterization', () => {
  it('surfaces a refusal stop reason on the Finished event', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([
        textTerminalIContent('I cannot help with that.', 'refusal'),
      ]),
    ) as Mock;
    const harness = createFullLoopHarness(mock);
    const events = await runFullLoop(harness.turn, 'tell me something harmful');
    const finished = findFinished(events);
    expect(finished).toBeDefined();
    expect(finished!.value.stopReason).toBe('refusal');
  });

  it('surfaces an end_turn stop reason on the Finished event', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([
        textTerminalIContent('Here is your answer.', 'end_turn'),
      ]),
    ) as Mock;
    const harness = createFullLoopHarness(mock);
    const events = await runFullLoop(harness.turn, 'hello');
    const finished = findFinished(events);
    expect(finished).toBeDefined();
    expect(finished!.value.stopReason).toBe('end_turn');
  });

  it('surfaces a stop stop reason on the Finished event', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([textTerminalIContent('Done.', 'stop')]),
    ) as Mock;
    const harness = createFullLoopHarness(mock);
    const events = await runFullLoop(harness.turn, 'hello');
    const finished = findFinished(events);
    expect(finished).toBeDefined();
    expect(finished!.value.stopReason).toBe('stop');
  });

  it('surfaces a max_tokens stop reason on the Finished event', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([textTerminalIContent('partial...', 'max_tokens')]),
    ) as Mock;
    const harness = createFullLoopHarness(mock);
    const events = await runFullLoop(harness.turn, 'hello');
    const finished = findFinished(events);
    expect(finished).toBeDefined();
    expect(finished!.value.stopReason).toBe('max_tokens');
  });

  it('surfaces usage stats on the Finished event when provided', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([
        textTerminalIContent('Done.', 'stop', {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        }),
      ]),
    ) as Mock;
    const harness = createFullLoopHarness(mock);
    const events = await runFullLoop(harness.turn, 'hello');
    const finished = findFinished(events);
    expect(finished).toBeDefined();
    expect(finished!.value.usageMetadata).toBeDefined();
    expect(finished!.value.usageMetadata?.totalTokens).toBe(15);
  });

  // PROPERTY: round-trip fidelity — any non-empty stop-reason string surfaces on Finished
  it('surfaces any arbitrary stop-reason string on Finished (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        async (stopReason: string) => {
          const mock = vi.fn(() =>
            makeProviderStream([textTerminalIContent('text', stopReason)]),
          ) as Mock;
          const harness = createFullLoopHarness(mock);
          const events = await runFullLoop(harness.turn, 'test');
          const finished = findFinished(events);
          expect(finished).toBeDefined();
          expect(finished!.value.stopReason).toBe(stopReason);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Hook tool-restriction filtering — observable behavior
// ---------------------------------------------------------------------------

describe('P10: hook tool-restriction characterization', () => {
  it('emits allowed tool calls as ToolCallRequest events', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([
        toolCallWithTextIContent('Calling tool.', 'call-1', 'allowed_tool', {
          arg: 'value',
        }),
        textTerminalIContent('Done.', 'stop'),
      ]),
    ) as Mock;
    const harness = createFullLoopHarness(mock);
    const events = await runFullLoop(harness.turn, 'use the tool');
    const toolCalls = extractToolCallRequests(events);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe('allowed_tool');
  });

  it('does NOT emit tool calls when the model produces none', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([textTerminalIContent('No tool call here.', 'stop')]),
    ) as Mock;
    const harness = createFullLoopHarness(mock);
    const events = await runFullLoop(harness.turn, 'hello');
    const toolCalls = extractToolCallRequests(events);
    expect(toolCalls).toHaveLength(0);
  });

  it('emits multiple tool calls when the model produces multiple', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([
        toolCallIContent('call-1', 'tool_a', { x: 1 }),
        toolCallIContent('call-2', 'tool_b', { y: 2 }),
        textTerminalIContent('Done.', 'stop'),
      ]),
    ) as Mock;
    const harness = createFullLoopHarness(mock);
    const events = await runFullLoop(harness.turn, 'use tools');
    const toolCalls = extractToolCallRequests(events);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].name).toBe('tool_a');
    expect(toolCalls[1].name).toBe('tool_b');
  });

  // PROPERTY: for any valid tool name, emitted tool calls preserve the name
  it('emitted tool calls preserve the tool name (property)', async () => {
    const toolNameArb = fc.constantFrom(
      'search',
      'read_file',
      'write_file',
      'list_dir',
      'execute_tool',
    );
    await fc.assert(
      fc.asyncProperty(toolNameArb, async (toolName: string) => {
        const mock = vi.fn(() =>
          makeProviderStream([
            toolCallIContent('call-1', toolName, {}),
            textTerminalIContent('Done.', 'stop'),
          ]),
        ) as Mock;
        const harness = createFullLoopHarness(mock);
        const events = await runFullLoop(harness.turn, 'use tool');
        const toolCalls = extractToolCallRequests(events);
        expect(toolCalls.length).toBeGreaterThanOrEqual(1);
        expect(toolCalls[0].name).toBe(toolName);
      }),
    );
  });
});
