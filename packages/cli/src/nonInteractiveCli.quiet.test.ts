/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  type EmojiFilter,
  JsonStreamEventType,
  StreamJsonFormatter,
  uiTelemetryService,
} from '@vybestack/llxprt-code-core';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import { processAgentStream } from './nonInteractiveCliSupport.js';

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';

type ParsedStreamEvent = {
  type: string;
  role?: string;
  content?: string;
  tool_name?: string;
  tool_id?: string;
  status?: string;
  severity?: string;
  message?: string;
  error?: { type?: string; message?: string };
};

async function* streamFromEvents(
  events: AgentEvent[],
): AsyncIterable<AgentEvent> {
  for (const event of events) {
    yield event;
  }
}

function parseJsonStdoutEvents(
  calls: Array<[unknown, ...unknown[]]>,
): ParsedStreamEvent[] {
  return calls
    .map(([value]) => String(value).trimEnd())
    .filter((value) => value.startsWith('{'))
    .map((value) => {
      try {
        return JSON.parse(value) as ParsedStreamEvent;
      } catch {
        throw new Error(`Failed to parse stdout line as JSON: ${value}`);
      }
    });
}

function createMockConfig(overrides?: {
  sessionId?: string;
  includeInResponse?: boolean;
}): Config {
  return {
    getSessionId: () => overrides?.sessionId ?? 'test-session',
    getEphemeralSetting: (key: string) =>
      key === 'reasoning.includeInResponse'
        ? overrides?.includeInResponse
        : undefined,
  } as unknown as Config;
}

describe('processAgentStream — quiet mode', () => {
  let processStdoutSpy: MockInstance<typeof process.stdout.write>;

  beforeEach(() => {
    processStdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createContext(overrides?: {
    jsonOutput?: boolean;
    streamJsonOutput?: boolean;
    streamFormatter?: StreamJsonFormatter | null;
    emojiFilter?: EmojiFilter | undefined;
    config?: Config;
    quiet?: boolean;
  }) {
    const streamFormatter =
      overrides?.streamFormatter === undefined
        ? null
        : overrides.streamFormatter;
    return {
      config: overrides?.config ?? createMockConfig(),
      jsonOutput: overrides?.jsonOutput ?? false,
      streamJsonOutput: overrides?.streamJsonOutput ?? streamFormatter !== null,
      quiet: overrides?.quiet ?? false,
      streamFormatter,
      emojiFilter: overrides?.emojiFilter,
      createProfileNameWriter: () => () => {},
    };
  }

  it('suppresses tool result display and writes only the final text to stdout', async () => {
    const events: AgentEvent[] = [
      {
        type: 'tool-call',
        call: { id: 'tool-1', name: 'read_file', args: {} },
      },
      {
        type: 'tool-result',
        result: {
          id: 'tool-1',
          name: 'read_file',
          display: 'file contents here',
          isError: false,
        },
      },
      { type: 'text', text: 'Final summary' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ quiet: true }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const stdoutContent = processStdoutSpy.mock.calls
      .map(([value]) => String(value))
      .join('');
    expect(stdoutContent).not.toContain('file contents here');
    expect(stdoutContent).toBe('Final summary\n');
  });

  it('discards intermediate talk before tool calls and shows only the final turn', async () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'Let me check the files.' },
      {
        type: 'tool-call',
        call: { id: 'tool-1', name: 'read_file', args: {} },
      },
      {
        type: 'tool-result',
        result: {
          id: 'tool-1',
          name: 'read_file',
          display: 'data',
          isError: false,
        },
      },
      { type: 'text', text: 'Here is the summary.' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ quiet: true }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const stdoutContent = processStdoutSpy.mock.calls
      .map(([value]) => String(value))
      .join('');
    expect(stdoutContent).not.toContain('Let me check the files.');
    expect(stdoutContent).toContain('Here is the summary.');
    expect(stdoutContent).toBe('Here is the summary.\n');
  });

  it('writes all text when no tool calls occur', async () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'The answer is 42.' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ quiet: true }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const stdoutContent = processStdoutSpy.mock.calls
      .map(([value]) => String(value))
      .join('');
    expect(stdoutContent).toBe('The answer is 42.\n');
  });

  it('suppresses thinking output', async () => {
    const events: AgentEvent[] = [
      {
        type: 'thinking',
        thought: { subject: 'Analysis', description: 'deep thought' },
      },
      { type: 'text', text: 'Result' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({
        quiet: true,
        config: createMockConfig({ includeInResponse: true }),
      }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const stdoutContent = processStdoutSpy.mock.calls
      .map(([value]) => String(value))
      .join('');
    expect(stdoutContent).not.toContain('<think>');
    expect(stdoutContent).not.toContain('Analysis');
    expect(stdoutContent).toBe('Result\n');
  });

  it('suppresses tool errors from stdout while allowing the model to continue', async () => {
    const events: AgentEvent[] = [
      {
        type: 'tool-result',
        result: {
          id: 'tool-1',
          name: 'errorTool',
          display: 'Execution failed',
          isError: true,
        },
      },
      { type: 'text', text: 'Retried successfully.' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ quiet: true }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const stdoutContent = processStdoutSpy.mock.calls
      .map(([value]) => String(value))
      .join('');
    expect(stdoutContent).not.toContain('Execution failed');
    expect(stdoutContent).toBe('Retried successfully.\n');
  });

  it('emits a JSON object containing only the final turn text in JSON mode', async () => {
    const metrics = uiTelemetryService.getMetrics();
    const events: AgentEvent[] = [
      { type: 'text', text: 'Intermediate text' },
      {
        type: 'tool-call',
        call: { id: 'tool-1', name: 'read_file', args: {} },
      },
      {
        type: 'tool-result',
        result: {
          id: 'tool-1',
          name: 'read_file',
          display: 'data',
          isError: false,
        },
      },
      { type: 'text', text: 'Final answer only.' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({
        quiet: true,
        jsonOutput: true,
        config: createMockConfig({ sessionId: 'quiet-json' }),
      }),
      Date.now(),
      () => metrics,
    );

    const jsonLine = processStdoutSpy.mock.calls
      .map(([value]) => String(value).trimEnd())
      .filter((value) => value.startsWith('{'))
      .join('');
    const parsed = JSON.parse(jsonLine) as Record<string, unknown>;
    expect(parsed).toHaveProperty('session_id', 'quiet-json');
    expect(parsed).toHaveProperty('response', 'Final answer only.');
    expect(String(parsed.response)).not.toContain('Intermediate text');
  });

  it('suppresses tool_use and tool_result events in stream-json mode', async () => {
    const streamFormatter = new StreamJsonFormatter();
    const events: AgentEvent[] = [
      {
        type: 'tool-call',
        call: { id: 'tool-1', name: 'read_file', args: {} },
      },
      {
        type: 'tool-result',
        result: {
          id: 'tool-1',
          name: 'read_file',
          display: 'data',
          isError: false,
        },
      },
      { type: 'text', text: 'Final message' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ quiet: true, streamFormatter }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const jsonEvents = parseJsonStdoutEvents(processStdoutSpy.mock.calls);
    const toolUseEvents = jsonEvents.filter(
      (event) => event.type === JsonStreamEventType.TOOL_USE,
    );
    const toolResultEvents = jsonEvents.filter(
      (event) => event.type === JsonStreamEventType.TOOL_RESULT,
    );
    expect(toolUseEvents).toHaveLength(0);
    expect(toolResultEvents).toHaveLength(0);

    const messages = jsonEvents.filter(
      (event) =>
        event.type === JsonStreamEventType.MESSAGE &&
        event.role === 'assistant',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Final message');

    const result = jsonEvents.find(
      (event) => event.type === JsonStreamEventType.RESULT,
    );
    expect(result).toBeDefined();
  });

  it('always emits a MESSAGE event before RESULT in stream-json even when text is empty', async () => {
    const streamFormatter = new StreamJsonFormatter();
    const events: AgentEvent[] = [
      {
        type: 'tool-call',
        call: { id: 'tool-1', name: 'read_file', args: {} },
      },
      {
        type: 'tool-result',
        result: {
          id: 'tool-1',
          name: 'read_file',
          display: 'data',
          isError: false,
        },
      },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ quiet: true, streamFormatter }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const jsonEvents = parseJsonStdoutEvents(processStdoutSpy.mock.calls);
    const messages = jsonEvents.filter(
      (event) =>
        event.type === JsonStreamEventType.MESSAGE &&
        event.role === 'assistant',
    );
    const resultIdx = jsonEvents.findIndex(
      (event) => event.type === JsonStreamEventType.RESULT,
    );
    expect(messages).toHaveLength(1);
    expect(resultIdx).toBeGreaterThan(-1);
    expect(messages[0].content).toBe('');
  });

  it('keeps only the final turn when multiple tool calls span turns', async () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'Working on it.' },
      {
        type: 'tool-call',
        call: { id: 'tool-1', name: 'read_file', args: {} },
      },
      {
        type: 'tool-result',
        result: {
          id: 'tool-1',
          name: 'read_file',
          display: 'part1',
          isError: false,
        },
      },
      { type: 'text', text: 'Almost done.' },
      {
        type: 'tool-call',
        call: { id: 'tool-2', name: 'read_file', args: {} },
      },
      {
        type: 'tool-result',
        result: {
          id: 'tool-2',
          name: 'read_file',
          display: 'part2',
          isError: false,
        },
      },
      { type: 'text', text: 'Final report.' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ quiet: true }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const stdoutContent = processStdoutSpy.mock.calls
      .map(([value]) => String(value))
      .join('');
    expect(stdoutContent).not.toContain('Working on it.');
    expect(stdoutContent).not.toContain('Almost done.');
    expect(stdoutContent).not.toContain('part1');
    expect(stdoutContent).not.toContain('part2');
    expect(stdoutContent).toBe('Final report.\n');
  });

  it('suppresses loop-detected stream error events in quiet mode', async () => {
    const streamFormatter = new StreamJsonFormatter();
    const events: AgentEvent[] = [
      {
        type: 'tool-call',
        call: { id: 'tool-1', name: 'read_file', args: {} },
      },
      {
        type: 'tool-result',
        result: {
          id: 'tool-1',
          name: 'read_file',
          display: 'data',
          isError: false,
        },
      },
      { type: 'text', text: 'Done anyway.' },
      {
        type: 'done',
        reason: 'loop-detected',
      } as AgentEvent,
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ quiet: true, streamFormatter }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const jsonEvents = parseJsonStdoutEvents(processStdoutSpy.mock.calls);
    const errorEvents = jsonEvents.filter(
      (event) => event.type === JsonStreamEventType.ERROR,
    );
    expect(errorEvents).toHaveLength(0);
  });

  it('suppresses hook-blocked stderr writes in quiet mode', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const events: AgentEvent[] = [
      {
        type: 'hook-blocked',
        info: { reason: 'Policy violation', systemMessage: 'blocked' },
      } as AgentEvent,
      { type: 'text', text: 'Continued.' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ quiet: true }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const stderrContent = stderrSpy.mock.calls
      .map(([value]) => String(value))
      .join('');
    expect(stderrContent).not.toContain('blocked');
    expect(stderrContent).not.toContain('WARNING');
  });

  it('suppresses idle-timeout stream error in quiet mode but still throws', async () => {
    const streamFormatter = new StreamJsonFormatter();
    const events: AgentEvent[] = [
      {
        type: 'idle-timeout',
        error: {
          message: 'timed out',
          type: 'timeout',
        },
      } as AgentEvent,
    ];

    await expect(
      processAgentStream(
        streamFromEvents(events),
        createContext({ quiet: true, streamFormatter }),
        Date.now(),
        () => uiTelemetryService.getMetrics(),
      ),
    ).rejects.toThrow('timed out');

    const jsonEvents = parseJsonStdoutEvents(processStdoutSpy.mock.calls);
    const errorEvents = jsonEvents.filter(
      (event) => event.type === JsonStreamEventType.ERROR,
    );
    expect(errorEvents).toHaveLength(0);
  });

  it('suppresses refusal stderr warning in quiet text mode', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const events: AgentEvent[] = [
      { type: 'text', text: 'Partial.' },
      { type: 'done', reason: 'refusal' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ quiet: true }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const stderrContent = stderrSpy.mock.calls
      .map(([value]) => String(value))
      .join('');
    expect(stderrContent).not.toContain('WARNING');
    expect(stderrContent).not.toContain('refusal');
  });

  it('suppresses hook-stopped stderr message in quiet mode', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const events: AgentEvent[] = [
      { type: 'text', text: 'Partial.' },
      {
        type: 'done',
        reason: 'hook-stopped',
        stop: { reason: 'policy', systemMessage: 'stopped by hook' },
      } as AgentEvent,
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ quiet: true }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const stderrContent = stderrSpy.mock.calls
      .map(([value]) => String(value))
      .join('');
    expect(stderrContent).not.toContain('stopped');
    expect(stderrContent).not.toContain('hook');
  });
});
