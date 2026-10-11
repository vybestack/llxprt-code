/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3840 with the real EmojiFilter in its default `auto` mode. The filter
 * holds back partial words and removes emojis, so what the printer actually
 * displays differs from the raw text events. Attempt separators and ordering
 * must follow the displayed output.
 */

import {
  EmojiFilter,
  JsonStreamEventType,
  StreamJsonFormatter,
  uiTelemetryService,
} from '@vybestack/llxprt-code-core';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import {
  processAgentStream,
  type StreamConsumerConfig,
} from './nonInteractiveCliSupport.js';

import { vi, describe, it, expect, beforeEach, afterEach } from 'bun:test';

async function* streamFromEvents(
  events: AgentEvent[],
): AsyncIterable<AgentEvent> {
  for (const event of events) {
    yield event;
  }
}

const config: StreamConsumerConfig = {
  getSessionId: () => 'test-session',
  getEphemeralSetting: (key: string) =>
    key === 'reasoning.includeInResponse' ? true : undefined,
};

function thinking(subject: string, description: string): AgentEvent {
  return { type: 'thinking', thought: { subject, description } };
}

function text(value: string): AgentEvent {
  return { type: 'text', text: value };
}

const boundary: AgentEvent = { type: 'attempt-boundary' };
const done: AgentEvent = { type: 'done', reason: 'stop' };

describe('processAgentStream attempt boundaries with the default emoji filter (issue #3840)', () => {
  let stdoutChunks: string[];

  beforeEach(() => {
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(
      (chunk: string | Uint8Array) => {
        stdoutChunks.push(String(chunk));
        return true;
      },
    );
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stdout(): string {
    return stdoutChunks.join('');
  }

  async function run(
    events: AgentEvent[],
    overrides: {
      jsonOutput?: boolean;
      quiet?: boolean;
      streamFormatter?: StreamJsonFormatter | null;
    } = {},
  ): Promise<void> {
    const streamFormatter = overrides.streamFormatter ?? null;
    await processAgentStream(
      streamFromEvents(events),
      {
        config,
        jsonOutput: overrides.jsonOutput ?? false,
        streamJsonOutput: streamFormatter !== null,
        quiet: overrides.quiet ?? false,
        streamFormatter,
        emojiFilter: new EmojiFilter({ mode: 'auto' }),
        createProfileNameWriter: () => () => {},
      },
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );
  }

  function assistantDeltas(): string {
    return stdoutChunks
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.startsWith('{'))
      .map((chunk): { type: string; role?: string; content?: string } =>
        JSON.parse(chunk),
      )
      .filter(
        (event) =>
          event.type === JsonStreamEventType.MESSAGE &&
          event.role === 'assistant',
      )
      .map((event) => event.content)
      .join('');
  }

  it('writes the earlier attempt before a later attempt thinking block', async () => {
    await run([
      text('attempt1'),
      boundary,
      thinking('second', 'attempt'),
      text('Second answer'),
      done,
    ]);

    expect(stdout()).toBe(
      'attempt1\n\n<think>second: attempt</think>\nSecond answer\n',
    );
  });

  it('writes earlier text held by the filter before thinking that follows it without a boundary', async () => {
    await run([text('attempt1'), thinking('plan', 'hmm'), text('next'), done]);

    expect(stdout()).toBe('attempt1<think>plan: hmm</think>\nnext\n');
  });

  it('adds no leading separator when the earlier attempt only held emojis', async () => {
    await run([text('😀'), boundary, text('answer'), done]);

    expect(stdout()).toBe('answer\n');
  });

  it('adds no leading separator for an emoji-only earlier attempt in quiet mode', async () => {
    await run([text('😀'), boundary, text('answer'), done], { quiet: true });

    expect(stdout()).toBe('answer\n');
  });

  it('adds no leading separator for an emoji-only earlier attempt in JSON output', async () => {
    await run([text('😀'), boundary, text('answer'), done], {
      jsonOutput: true,
    });

    const payload: { response: string } = JSON.parse(stdout());
    expect(payload.response).toBe('answer');
  });

  it('adds no leading separator for an emoji-only earlier attempt in stream-json output', async () => {
    await run([text('😀'), boundary, text('answer'), done], {
      streamFormatter: new StreamJsonFormatter(),
    });

    expect(assistantDeltas()).toBe('answer');
  });

  it('separates filtered attempts in quiet mode', async () => {
    await run([text('attempt1'), boundary, text('attempt2'), done], {
      quiet: true,
    });

    expect(stdout()).toBe('attempt1\n\nattempt2\n');
  });

  it('separates filtered attempts in JSON output', async () => {
    await run([text('attempt1'), boundary, text('attempt2'), done], {
      jsonOutput: true,
    });

    const payload: { response: string } = JSON.parse(stdout());
    expect(payload.response).toBe('attempt1\n\nattempt2');
  });

  it('separates filtered attempts in stream-json output', async () => {
    await run([text('attempt1'), boundary, text('attempt2'), done], {
      streamFormatter: new StreamJsonFormatter(),
    });

    expect(assistantDeltas()).toBe('attempt1\n\nattempt2');
  });

  it('ends a separated plain run with exactly one newline', async () => {
    await run([text('attempt1'), boundary, text('attempt2\n\n'), done]);

    expect(stdout()).toBe('attempt1\n\nattempt2\n');
  });

  it('ends a separated quiet run with exactly one newline', async () => {
    await run([text('attempt1'), boundary, text('attempt2\n'), done], {
      quiet: true,
    });

    expect(stdout()).toBe('attempt1\n\nattempt2\n');
  });

  it('keeps a trailing newline held by a separated run when more output follows', async () => {
    await run([
      text('attempt1'),
      boundary,
      text('attempt2\n'),
      { type: 'tool-call', call: { id: 't1', name: 'read_file', args: {} } },
      {
        type: 'tool-result',
        result: {
          id: 't1',
          name: 'read_file',
          display: 'file data',
          isError: false,
        },
      },
      text('final'),
      done,
    ]);

    expect(stdout()).toBe('attempt1\n\nattempt2\nfile data\nfinal\n');
  });

  it('leaves an unseparated run ending in newlines unchanged', async () => {
    await run([text('answer\n\n'), done]);

    expect(stdout()).toBe('answer\n\n\n');
  });

  it('leaves an unseparated quiet run ending in a newline unchanged', async () => {
    await run([text('answer\n'), done], { quiet: true });

    expect(stdout()).toBe('answer\n\n');
  });
});
