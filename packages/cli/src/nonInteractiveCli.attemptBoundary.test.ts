/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3840: when the engine re-prompts the model inside one prompt (task-list
 * continuation, thinking-only retry), the `attempt-boundary` public event marks
 * where a later attempt's visible output begins. The non-interactive printer
 * turns that signal into a blank line between attempts in text, JSON and
 * stream-JSON output, and leaves single-attempt output byte-for-byte unchanged.
 */

import {
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

function createConfig(includeThinking: boolean): StreamConsumerConfig {
  return {
    getSessionId: () => 'test-session',
    getEphemeralSetting: (key: string) =>
      key === 'reasoning.includeInResponse' ? includeThinking : undefined,
  };
}

function thinking(subject: string, description: string): AgentEvent {
  return { type: 'thinking', thought: { subject, description } };
}

function text(value: string): AgentEvent {
  return { type: 'text', text: value };
}

const boundary: AgentEvent = { type: 'attempt-boundary' };
const done: AgentEvent = { type: 'done', reason: 'stop' };

describe('processAgentStream attempt boundaries (issue #3840)', () => {
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
      includeThinking?: boolean;
      streamFormatter?: StreamJsonFormatter | null;
    } = {},
  ): Promise<void> {
    const streamFormatter = overrides.streamFormatter ?? null;
    await processAgentStream(
      streamFromEvents(events),
      {
        config: createConfig(overrides.includeThinking ?? true),
        jsonOutput: overrides.jsonOutput ?? false,
        streamJsonOutput: streamFormatter !== null,
        quiet: overrides.quiet ?? false,
        streamFormatter,
        emojiFilter: undefined,
        createProfileNameWriter: () => () => {},
      },
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );
  }

  // PLAN #3840 test 8
  it('separates continuation attempts with a blank line and ends with one newline', async () => {
    await run([
      text('attempt1'),
      boundary,
      text('attempt2'),
      boundary,
      text('attempt3'),
      done,
    ]);

    expect(stdout()).toBe('attempt1\n\nattempt2\n\nattempt3\n');
  });

  // PLAN #3840 test 9
  it('leaves a single-attempt run byte-for-byte unchanged', async () => {
    await run([text('only '), text('answer'), done]);

    expect(stdout()).toBe('only answer\n');
  });

  // PLAN #3840 test 10 (printer side): a later attempt's thinking is printed
  // after the separator, never glued onto the earlier attempt's last line. The
  // boundary precedes the thought because thinking is itself later-attempt
  // output.
  it('places the blank line before the later attempt thinking block', async () => {
    await run([
      text('READY'),
      boundary,
      { type: 'thinking', thought: { subject: 'plan', description: 'hmm' } },
      text('next'),
      done,
    ]);

    expect(stdout()).toBe('READY\n\n<think>plan: hmm</think>\nnext\n');
  });

  // The #3840 -p reproduction: the continuation attempt thinks and pauses
  // with no text, so its thinking and tool output must still start after a
  // blank line.
  it('places the blank line before thinking and tool output of a later attempt that has no text', async () => {
    await run([
      { type: 'tool-call', call: { id: 't1', name: 'todo_write', args: {} } },
      {
        type: 'tool-result',
        result: {
          id: 't1',
          name: 'todo_write',
          display: 'todos written',
          isError: false,
        },
      },
      text('READY'),
      boundary,
      {
        type: 'thinking',
        thought: { subject: 'wait', description: 'no data' },
      },
      { type: 'tool-call', call: { id: 't2', name: 'todo_pause', args: {} } },
      {
        type: 'tool-result',
        result: {
          id: 't2',
          name: 'todo_pause',
          display: 'AI paused: no data',
          isError: false,
        },
      },
      done,
    ]);

    expect(stdout()).toBe(
      'todos written\nREADY\n\n<think>wait: no data</think>\nAI paused: no data\n',
    );
  });

  // An ordinary prompt (tool call, result, final answer) has no boundary
  // event, so nothing gains a blank line.
  it('adds no blank lines to a tool call followed by a final answer', async () => {
    await run([
      { type: 'thinking', thought: { subject: 'plan', description: 'look' } },
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
      text('final answer'),
      done,
    ]);

    expect(stdout()).not.toContain('\n\n');
    expect(stdout()).toBe(
      '<think>plan: look</think>\nfile data\nfinal answer\n',
    );
  });

  // PLAN #3840 test 10 (printer side): hidden thinking is never displayed, so a
  // boundary after a hidden thinking-only attempt must not open the output
  // with a blank line.
  it('adds no leading blank line when the first attempt was hidden thinking-only', async () => {
    await run(
      [thinking('plan', 'hmm'), boundary, text('first visible'), done],
      {
        includeThinking: false,
      },
    );

    expect(stdout()).toBe('first visible\n');
  });

  it('separates a displayed thinking-only first attempt from the visible text after it', async () => {
    await run([thinking('plan', 'hmm'), boundary, text('first visible'), done]);

    expect(stdout()).toBe('<think>plan: hmm</think>\n\nfirst visible\n');
  });

  // Review finding: consecutive thinking-only attempts after visible output
  // must stay separate and in order, and the output ends with one newline.
  it('keeps consecutive thinking-only attempts separate and ends with one newline', async () => {
    await run([
      text('READY'),
      boundary,
      thinking('second', 'attempt'),
      boundary,
      thinking('third', 'attempt'),
      done,
    ]);

    expect(stdout()).toBe(
      'READY\n\n<think>second: attempt</think>\n\n<think>third: attempt</think>\n',
    );
  });

  it('writes no trailing separator when later attempts only think and the thinking is hidden', async () => {
    await run(
      [
        text('READY'),
        boundary,
        thinking('second', 'attempt'),
        boundary,
        thinking('third', 'attempt'),
        done,
      ],
      { includeThinking: false },
    );

    expect(stdout()).toBe('READY\n');
  });

  it('does not double the separator when the text already ends at a paragraph break', async () => {
    await run([text('attempt1\n\n'), boundary, text('attempt2'), done]);

    expect(stdout()).toBe('attempt1\n\nattempt2\n');
  });

  it('tops a single trailing newline up to a blank line', async () => {
    await run([text('attempt1\n'), boundary, text('attempt2'), done]);

    expect(stdout()).toBe('attempt1\n\nattempt2\n');
  });

  // A tool result ends the model call that requested it; a boundary only ever
  // separates attempts of one call, so tool output before it is not "earlier
  // output" for the separator.
  it('treats a tool result as the end of the earlier output when deciding on a separator', async () => {
    await run(
      [
        text('READY'),
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
        boundary,
        thinking('hidden', 'only'),
        text('answer'),
        done,
      ],
      { includeThinking: false },
    );

    expect(stdout()).toBe('READYfile data\nanswer\n');
  });

  it('separates attempts in the aggregated JSON response', async () => {
    await run([text('attempt1'), boundary, text('attempt2'), done], {
      jsonOutput: true,
    });

    const payload: { response: string } = JSON.parse(stdout());
    expect(payload.response).toBe('attempt1\n\nattempt2');
  });

  it('separates attempts in the quiet-mode buffered response', async () => {
    await run([text('attempt1'), boundary, text('attempt2'), done], {
      quiet: true,
    });

    expect(stdout()).toBe('attempt1\n\nattempt2\n');
  });

  it('emits the separator as an assistant delta in stream-json output', async () => {
    await run([text('attempt1'), boundary, text('attempt2'), done], {
      streamFormatter: new StreamJsonFormatter(),
    });

    const deltas = stdoutChunks
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
      .map((event) => event.content);
    expect(deltas.join('')).toBe('attempt1\n\nattempt2');
  });

  it('keeps trailing separators out of the JSON response when later attempts only think', async () => {
    await run(
      [
        text('READY'),
        boundary,
        thinking('a', 'b'),
        boundary,
        thinking('c', 'd'),
        done,
      ],
      { jsonOutput: true },
    );

    const payload: { response: string } = JSON.parse(stdout());
    expect(payload.response).toBe('READY');
  });

  it('keeps trailing separators out of the quiet-mode response when later attempts only think', async () => {
    await run(
      [
        text('READY'),
        boundary,
        thinking('a', 'b'),
        boundary,
        thinking('c', 'd'),
        done,
      ],
      { quiet: true },
    );

    expect(stdout()).toBe('READY\n');
  });

  it('keeps leading separators out of the quiet-mode response after a thinking-only first attempt', async () => {
    await run([thinking('a', 'b'), boundary, text('answer'), done], {
      quiet: true,
    });

    expect(stdout()).toBe('answer\n');
  });

  it('emits no separator delta in stream-json output when later attempts only think', async () => {
    await run(
      [
        text('READY'),
        boundary,
        thinking('a', 'b'),
        boundary,
        thinking('c', 'd'),
        done,
      ],
      { streamFormatter: new StreamJsonFormatter() },
    );

    const deltas = stdoutChunks
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
      .map((event) => event.content);
    expect(deltas.join('')).toBe('READY');
  });
});
