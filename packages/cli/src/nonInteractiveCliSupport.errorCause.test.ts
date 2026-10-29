/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { StreamJsonFormatter } from '@vybestack/llxprt-code-core';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import { UiTelemetryService } from '@vybestack/llxprt-code-telemetry';
import { processAgentStream } from './nonInteractiveCliSupport.js';

async function* streamFromEvents(
  events: readonly AgentEvent[],
): AsyncIterable<AgentEvent> {
  for (const event of events) yield event;
}

function contextWith(streamFormatter: StreamJsonFormatter | null) {
  return {
    includeThinking: false,
    config: { getSessionId: () => 'error-cause-session' },
    jsonOutput: false,
    streamJsonOutput: streamFormatter !== null,
    quiet: false,
    streamFormatter,
    emojiFilter: undefined,
    createProfileNameWriter: () => () => {},
  };
}

describe('processAgentStream error events carry their in-process cause', () => {
  const written: string[] = [];
  const restore: Array<() => void> = [];

  beforeEach(() => {
    written.length = 0;
    const stdout = spyOn(process.stdout, 'write').mockImplementation(
      (chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      },
    );
    const stderr = spyOn(process.stderr, 'write').mockImplementation(
      () => true,
    );
    restore.push(
      () => stdout.mockRestore(),
      () => stderr.mockRestore(),
    );
  });

  afterEach(() => {
    for (const undo of restore.splice(0)) undo();
  });

  async function consume(
    events: readonly AgentEvent[],
    streamFormatter: StreamJsonFormatter | null,
  ): Promise<unknown> {
    try {
      await processAgentStream(
        streamFromEvents(events),
        contextWith(streamFormatter),
        Date.now(),
        () => new UiTelemetryService().getMetrics(),
      );
    } catch (error) {
      return error;
    }
    throw new Error('Expected the error event to throw');
  }

  it('throws an Error whose cause is the one on the event', async () => {
    const cause = new Error('Session execution is closed');

    const thrown = await consume(
      [
        { type: 'error', error: { message: 'm' }, cause },
        { type: 'done', reason: 'error' },
      ],
      null,
    );

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('m');
    expect((thrown as Error).cause).toBe(cause);
  });

  it('throws an Error with no cause when the event carries none', async () => {
    const thrown = await consume(
      [
        { type: 'error', error: { message: 'm' } },
        { type: 'done', reason: 'error' },
      ],
      null,
    );

    expect(thrown).toBeInstanceOf(Error);
    expect('cause' in (thrown as Error)).toBe(false);
  });

  it('keeps the cause out of the stream-json error event', async () => {
    const cause = new Error('Session execution is closed');

    await consume(
      [
        { type: 'error', error: { message: 'm' }, cause },
        { type: 'done', reason: 'error' },
      ],
      new StreamJsonFormatter(),
    );

    const emitted = written
      .map((chunk) => chunk.trimEnd())
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.type === 'error');
    expect(emitted).toHaveLength(1);
    expect(Object.keys(emitted[0]).sort()).toStrictEqual([
      'message',
      'severity',
      'timestamp',
      'type',
    ]);
    expect(emitted[0].message).toBe('m');
  });
});
