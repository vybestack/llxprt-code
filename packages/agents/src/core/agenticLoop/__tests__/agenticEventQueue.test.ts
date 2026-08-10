/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { ToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import { AgenticEventQueue } from '../agenticEventQueue.js';
import type { AgenticLoopEvent } from '../types.js';

type ToolOutputEvent = Extract<AgenticLoopEvent, { kind: 'tool_output' }>;

function toolCall(callId: string): ToolCall {
  return {
    status: 'error',
    request: {
      callId,
      name: 'test-tool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'test-prompt',
    },
    response: {
      callId,
      responseParts: [],
      resultDisplay: undefined,
      error: undefined,
      errorType: undefined,
    },
  };
}

function requireEvent(queue: AgenticEventQueue): AgenticLoopEvent {
  const event = queue.popBuffered();
  if (event === undefined) {
    throw new Error('Expected a buffered agentic-loop event');
  }
  return event;
}

function toolOutputEvents(events: AgenticLoopEvent[]): ToolOutputEvent[] {
  return events.filter(
    (event): event is ToolOutputEvent => event.kind === 'tool_output',
  );
}

describe('AgenticEventQueue', () => {
  it('coalesces replace-style tool snapshots for a slow consumer', () => {
    const queue = new AgenticEventQueue({ maxBufferedEvents: 8 });

    for (let index = 0; index < 10_000; index += 1) {
      queue.push({ kind: 'tool_update', toolCalls: [toolCall(String(index))] });
    }

    expect(queue.bufferedEventCount).toBe(1);
    const event = requireEvent(queue);
    expect(event.kind).toBe('tool_update');
    const update = event as Extract<AgenticLoopEvent, { kind: 'tool_update' }>;
    expect(update.toolCalls[0].request.callId).toBe('9999');
  });

  it('preserves the final tool snapshot before the scheduler clears it', () => {
    const queue = new AgenticEventQueue({ maxBufferedEvents: 8 });
    queue.push({ kind: 'tool_update', toolCalls: [toolCall('cancelled')] });
    queue.push({ kind: 'tool_update', toolCalls: [] });

    const updates = drain(queue).filter(
      (event): event is Extract<AgenticLoopEvent, { kind: 'tool_update' }> =>
        event.kind === 'tool_update',
    );

    expect(updates).toHaveLength(2);
    expect(updates[0].toolCalls[0].request.callId).toBe('cancelled');
    expect(updates[1].toolCalls).toEqual([]);
  });

  it('bounds many tiny append events by item count and reports the loss', () => {
    const queue = new AgenticEventQueue({
      maxBufferedEvents: 16,
      maxBufferedOutputBytes: 1024,
    });

    for (let index = 0; index < 10_000; index += 1) {
      queue.push({ kind: 'tool_output', callId: 'call-1', chunk: 'x' });
    }
    queue.push({ kind: 'tools_complete', completed: [] });

    expect(queue.bufferedEventCount).toBeLessThanOrEqual(16);
    expect(queue.bufferedLiveOutputBytes).toBeLessThanOrEqual(1024);
    const events = drain(queue);
    const output = toolOutputEvents(events)
      .map((event) => event.chunk)
      .join('');
    expect(output).toContain('LLXPRT live tool output omitted');
    expect(output).toContain('9,989 bytes');
    expect(events[events.length - 1]?.kind).toBe('tools_complete');
  });

  it('bounds one oversized UTF-8 chunk without splitting a character', () => {
    const queue = new AgenticEventQueue({
      maxBufferedEvents: 8,
      maxBufferedOutputBytes: 1024,
    });
    const chunk = '🙂'.repeat(1000);

    queue.push({ kind: 'tool_output', callId: 'call-1', chunk });
    queue.push({ kind: 'tools_complete', completed: [] });

    const outputs = toolOutputEvents(drain(queue));
    const retained = outputs.find((event) => event.chunk.startsWith('🙂'));
    const retainedBytes = Buffer.byteLength(retained?.chunk ?? '', 'utf8');
    expect(retained).toBeDefined();
    expect(retainedBytes).toBeGreaterThan(0);
    expect(retainedBytes).toBeLessThanOrEqual(1024);
    expect(retained?.chunk).not.toContain('�');
    const notice = outputs.find((event) =>
      event.chunk.includes('LLXPRT live tool output omitted'),
    );
    expect(notice).toBeDefined();
    expect(notice?.chunk).toContain(
      `${(Buffer.byteLength(chunk, 'utf8') - retainedBytes).toLocaleString('en-US')} bytes`,
    );
    expect(queue.bufferedLiveOutputBytes).toBe(0);
  });

  it('aggregates excess call IDs without losing omission accounting', () => {
    const queue = new AgenticEventQueue({
      maxBufferedEvents: 16,
      maxBufferedOutputBytes: 1024,
    });
    for (let index = 0; index < 11; index += 1) {
      queue.push({ kind: 'tool_output', callId: 'retained', chunk: 'x' });
    }
    for (let index = 0; index < 10; index += 1) {
      queue.push({
        kind: 'tool_output',
        callId: `omitted-${index}`,
        chunk: 'y',
      });
    }
    queue.push({ kind: 'tools_complete', completed: [] });

    expect(queue.bufferedEventCount).toBeLessThanOrEqual(16);
    expect(queue.bufferedLiveOutputBytes).toBeLessThanOrEqual(1024);
    const notices = toolOutputEvents(drain(queue)).filter((event) =>
      event.chunk.includes('LLXPRT live tool output omitted'),
    );
    const omittedBytes = notices.reduce((total, event) => {
      const match = /omitted: ([\d,]+) bytes/.exec(event.chunk);
      return total + Number((match?.[1] ?? '0').replaceAll(',', ''));
    }, 0);

    expect(notices.length).toBeGreaterThan(0);
    expect(notices.length).toBeLessThanOrEqual(4);
    expect(omittedBytes).toBe(10);
    expect(
      notices.some((event) =>
        event.chunk.includes('across additional tool calls'),
      ),
    ).toBe(true);
  });

  it('reserves report and completion capacity after output is omitted', () => {
    const queue = new AgenticEventQueue({
      maxBufferedEvents: 16,
      maxBufferedOutputBytes: 1024,
    });
    for (let index = 0; index < 11; index += 1) {
      queue.push({ kind: 'tool_output', callId: 'retained', chunk: 'x' });
    }
    queue.push({ kind: 'tool_output', callId: 'omitted', chunk: 'y' });
    for (let index = 0; index < 3; index += 1) {
      queue.push({
        kind: 'awaiting_approval',
        toolCalls: [toolCall(String(index))],
      });
    }

    expect(() =>
      queue.push({
        kind: 'awaiting_approval',
        toolCalls: [toolCall('overflow')],
      }),
    ).toThrow('reserved its remaining capacity');
    queue.push({ kind: 'tools_complete', completed: [] });

    const events = drain(queue);
    const notices = toolOutputEvents(events).filter((event) =>
      event.chunk.includes('LLXPRT live tool output omitted'),
    );
    expect(events).toHaveLength(16);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.chunk).toContain('1 byte');
    expect(events[events.length - 1]?.kind).toBe('tools_complete');
  });

  it('uses amortized compaction while preserving FIFO semantic events', () => {
    const queue = new AgenticEventQueue({ maxBufferedEvents: 5000 });
    for (let index = 0; index < 5000; index += 1) {
      queue.push({
        kind: 'awaiting_approval',
        toolCalls: [toolCall(String(index))],
      });
    }

    for (let index = 0; index < 5000; index += 1) {
      const event = requireEvent(queue);
      expect(event.kind).toBe('awaiting_approval');
      const approval = event as Extract<
        AgenticLoopEvent,
        { kind: 'awaiting_approval' }
      >;
      expect(approval.toolCalls[0].request.callId).toBe(String(index));
    }
    expect(queue.bufferedEventCount).toBe(0);
  });

  it('fails fast rather than silently dropping semantic events', () => {
    const queue = new AgenticEventQueue({ maxBufferedEvents: 4 });
    for (let index = 0; index < 4; index += 1) {
      queue.push({
        kind: 'awaiting_approval',
        toolCalls: [toolCall(String(index))],
      });
    }

    expect(() =>
      queue.push({
        kind: 'awaiting_approval',
        toolCalls: [toolCall('overflow')],
      }),
    ).toThrow('Agentic event queue exceeded 4 buffered events');
  });
});

function drain(queue: AgenticEventQueue): AgenticLoopEvent[] {
  const events: AgenticLoopEvent[] = [];
  let event = queue.popBuffered();
  while (event !== undefined) {
    events.push(event);
    event = queue.popBuffered();
  }
  return events;
}
