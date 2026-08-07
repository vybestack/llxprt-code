/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260806-ISSUE3048.P13
 * @requirement REQ-3048-010
 *
 * Behavioural tests for the non-interactive CLI retry discard contract.
 *
 * On a `{ type: 'retry' }` AgentEvent, the non-interactive consumer MUST
 * throw away the buffered state of the abandoned attempt — the JSON
 * `responseText`, the `--quiet` text buffer and the thought buffer — and MUST
 * drain (and discard) the emoji filter's held-back partial chunk, while
 * leaving `pendingDone` untouched so a following `done` still finalizes the
 * turn. Already-written plain stdout / stream-json deltas are an unretractable
 * limitation (specification §8) and are not compensated.
 *
 * These tests drive the REAL `processAgentStream` with scripted `AgentEvent`
 * async iterables; only `process.stdout`/`process.stderr` are captured by
 * spies, and every assertion is on observable emitted output.
 */

import {
  Config,
  EmojiFilter,
  StreamJsonFormatter,
  JsonStreamEventType,
  uiTelemetryService,
} from '@vybestack/llxprt-code-core';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { processAgentStream } from './nonInteractiveCliSupport.js';

type StdoutSpy = ReturnType<typeof spyOn<typeof process.stdout, 'write'>>;

async function* streamFromEvents(
  events: readonly AgentEvent[],
): AsyncIterable<AgentEvent> {
  for (const event of events) {
    yield event;
  }
}

function callsToText(spy: StdoutSpy): string {
  return spy.mock.calls.map((call) => String(call[0])).join('');
}

type ParsedStreamEvent = {
  type: string;
  role?: string;
  content?: string;
};

function parseStreamEvents(spy: StdoutSpy): ParsedStreamEvent[] {
  return spy.mock.calls
    .map((call) => String(call[0]).trimEnd())
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as ParsedStreamEvent);
}

function parseJsonResult(spy: StdoutSpy): Record<string, unknown> {
  const jsonLine = spy.mock.calls
    .map((call) => String(call[0]).trimEnd())
    .filter((line) => line.startsWith('{') && line.includes('"response"'))
    .join('');
  return JSON.parse(jsonLine) as Record<string, unknown>;
}

let sharedConfig: Config | null = null;

function getRetryDiscardConfig(): Config {
  if (sharedConfig === null) {
    const config = new Config({
      sessionId: 'retry-discard-session',
      targetDir: '/tmp/llxprt-retry-discard',
      debugMode: false,
      cwd: '/tmp/llxprt-retry-discard',
      model: 'gemini-2.0-flash-exp',
    });
    config.setEphemeralSetting('reasoning.includeInResponse', true);
    sharedConfig = config;
  }
  return sharedConfig;
}

type StreamContextShape = {
  config: Config;
  jsonOutput: boolean;
  streamJsonOutput: boolean;
  quiet: boolean;
  streamFormatter: StreamJsonFormatter | null;
  emojiFilter: EmojiFilter | undefined;
  createProfileNameWriter: () => () => void;
};

function createContext(overrides?: {
  jsonOutput?: boolean;
  quiet?: boolean;
  streamFormatter?: StreamJsonFormatter | null;
  emojiFilter?: EmojiFilter | undefined;
}): StreamContextShape {
  const streamFormatter =
    overrides?.streamFormatter === undefined ? null : overrides.streamFormatter;
  return {
    config: getRetryDiscardConfig(),
    jsonOutput: overrides?.jsonOutput ?? false,
    streamJsonOutput: streamFormatter !== null,
    quiet: overrides?.quiet ?? false,
    streamFormatter,
    emojiFilter: overrides?.emojiFilter,
    createProfileNameWriter: () => () => {},
  };
}

describe('processAgentStream — retry discard (REQ-3048-010)', () => {
  let stdoutSpy: StdoutSpy;
  let stderrSpy: ReturnType<typeof spyOn<typeof process.stderr, 'write'>>;

  beforeEach(() => {
    stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('json mode emits only the successful attempt text after a retry', async () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'abandoned' },
      { type: 'retry' },
      { type: 'text', text: 'kept' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ jsonOutput: true }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const result = parseJsonResult(stdoutSpy);
    expect(result.response).toBe('kept');
    expect(String(result.response)).not.toContain('abandoned');
  });

  it('quiet mode emits only the successful attempt text after a retry', async () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'abandoned' },
      { type: 'retry' },
      { type: 'text', text: 'kept' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ quiet: true }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const output = callsToText(stdoutSpy);
    expect(output).toBe('kept\n');
    expect(output).not.toContain('abandoned');
  });

  it('drops thoughts accumulated by the abandoned attempt', async () => {
    const events: AgentEvent[] = [
      {
        type: 'thinking',
        thought: { subject: 'Abandoned reasoning', description: '' },
      },
      { type: 'retry' },
      { type: 'text', text: 'kept' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext(),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const output = callsToText(stdoutSpy);
    expect(output).toContain('kept');
    expect(output).not.toContain('Abandoned reasoning');
    expect(output).not.toContain('<think>');
  });

  it('discards the emoji filter held partial chunk from the abandoned attempt', async () => {
    // 'held✅' has no safe trailing boundary, so the filter holds it back
    // rather than emitting it. Without the retry drain, that fragment is
    // concatenated onto the successful attempt's text at finalize.
    const emojiFilter = new EmojiFilter({ mode: 'auto' });
    const events: AgentEvent[] = [
      { type: 'text', text: 'held✅' },
      { type: 'retry' },
      { type: 'text', text: 'kept' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ jsonOutput: true, emojiFilter }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const result = parseJsonResult(stdoutSpy);
    expect(result.response).toBe('kept');
    expect(String(result.response)).not.toContain('held');
  });

  it('does not disturb pendingDone — a done after the retry still finalizes', async () => {
    const streamFormatter = new StreamJsonFormatter();
    const events: AgentEvent[] = [
      { type: 'text', text: 'abandoned' },
      { type: 'retry' },
      { type: 'text', text: 'kept' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ quiet: true, streamFormatter }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const streamEvents = parseStreamEvents(stdoutSpy);
    const messages = streamEvents.filter(
      (event) =>
        event.type === JsonStreamEventType.MESSAGE &&
        event.role === 'assistant',
    );
    const result = streamEvents.find(
      (event) => event.type === JsonStreamEventType.RESULT,
    );
    // pendingDone survived the retry, so handleDone emitted the assistant
    // message and the terminal RESULT.
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('kept');
    expect(result).toBeDefined();
  });
});
