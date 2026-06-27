/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  EmojiFilter,
  DebugLogger,
  FatalTurnLimitedError,
  JsonStreamEventType,
  StreamJsonFormatter,
  uiTelemetryService,
} from '@vybestack/llxprt-code-core';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import { processAgentStream } from './nonInteractiveCliSupport.js';

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

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

describe('processAgentStream', () => {
  let consoleErrorSpy: vi.SpyInstance;
  let processStdoutSpy: vi.SpyInstance;
  let processStderrSpy: vi.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = vi
      .spyOn(DebugLogger.prototype, 'error')
      .mockImplementation(() => {});
    processStdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    processStderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
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
  }) {
    const streamFormatter =
      overrides?.streamFormatter === undefined
        ? null
        : overrides.streamFormatter;
    return {
      config: overrides?.config ?? createMockConfig(),
      jsonOutput: overrides?.jsonOutput ?? false,
      // In production, streamJsonOutput and streamFormatter are always set
      // together; derive streamJsonOutput from the formatter unless a test
      // explicitly overrides it, so the test context matches production.
      streamJsonOutput: overrides?.streamJsonOutput ?? streamFormatter !== null,
      streamFormatter,
      emojiFilter: overrides?.emojiFilter,
      createProfileNameWriter: () => () => {},
    };
  }

  it('writes text content to stdout and a trailing newline on normal completion', async () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' World' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext(),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const meaningfulWrites = processStdoutSpy.mock.calls
      .map(([value]) => value)
      .filter((value) => value !== '');
    expect(meaningfulWrites.join('')).toBe('Hello World\n');
  });

  it('emits stream-json message records for each text chunk', async () => {
    const streamFormatter = new StreamJsonFormatter();
    const events: AgentEvent[] = [
      { type: 'text', text: 'LLXPRT2208_ALPHA' },
      { type: 'text', text: '\n\n' },
      { type: 'text', text: 'Alpha paragraph one.' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ streamFormatter }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const jsonEvents = parseJsonStdoutEvents(processStdoutSpy.mock.calls);
    const messages = jsonEvents.filter(
      (event) => event.type === JsonStreamEventType.MESSAGE,
    );
    expect(
      messages.map((event) => ({ role: event.role, content: event.content })),
    ).toStrictEqual([
      { role: 'assistant', content: 'LLXPRT2208_ALPHA' },
      { role: 'assistant', content: '\n\n' },
      { role: 'assistant', content: 'Alpha paragraph one.' },
    ]);
  });

  it('emits emoji-filter buffered stream-json content as JSON records', async () => {
    const streamFormatter = new StreamJsonFormatter();
    const emojiFilter = new EmojiFilter({ mode: 'auto' });
    const events: AgentEvent[] = [
      { type: 'text', text: 'LLXPRT2208_ALPHA' },
      { type: 'text', text: '\n\n' },
      { type: 'text', text: 'Alpha paragraph one.' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ streamFormatter, emojiFilter }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const jsonEvents = parseJsonStdoutEvents(processStdoutSpy.mock.calls);
    const assistantOutput = jsonEvents
      .filter(
        (event) =>
          event.type === JsonStreamEventType.MESSAGE &&
          event.role === 'assistant',
      )
      .map((event) => event.content)
      .join('');
    expect(assistantOutput).toBe('LLXPRT2208_ALPHA\n\nAlpha paragraph one.');
  });

  it('coalesces thinking events before content into a single think block', async () => {
    const events: AgentEvent[] = [
      { type: 'thinking', thought: { subject: 'First', description: '' } },
      { type: 'thinking', thought: { subject: 'Second', description: '' } },
      { type: 'text', text: 'Content' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ config: createMockConfig({ includeInResponse: true }) }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const output = processStdoutSpy.mock.calls.map(([value]) => value).join('');
    expect(output).toContain('<think>First Second</think>');
  });

  it('emits a tool-use record and prints successful tool display output', async () => {
    const events: AgentEvent[] = [
      {
        type: 'tool-call',
        call: { id: 'tool-1', name: 'testTool', args: { arg1: 'value1' } },
      },
      {
        type: 'tool-result',
        result: {
          id: 'tool-1',
          name: 'testTool',
          display: 'BeforeTool: File operation logged',
          isError: false,
        },
      },
      { type: 'text', text: 'Final answer' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext(),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    expect(processStdoutSpy).toHaveBeenCalledWith(
      'BeforeTool: File operation logged\n',
    );
    expect(processStdoutSpy).toHaveBeenCalledWith('Final answer');
    expect(processStdoutSpy).toHaveBeenCalledWith('\n');
  });

  it('emits a tool-use stream-json record in stream-json mode', async () => {
    const streamFormatter = new StreamJsonFormatter();
    const events: AgentEvent[] = [
      {
        type: 'tool-call',
        call: { id: 'tool-1', name: 'testTool', args: { arg1: 'value1' } },
      },
      {
        type: 'tool-result',
        result: {
          id: 'tool-1',
          name: 'testTool',
          isError: false,
        },
      },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ streamFormatter }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const jsonEvents = parseJsonStdoutEvents(processStdoutSpy.mock.calls);
    const toolUse = jsonEvents.find(
      (event) => event.type === JsonStreamEventType.TOOL_USE,
    );
    expect(toolUse).toMatchObject({ tool_name: 'testTool', tool_id: 'tool-1' });
    const toolResult = jsonEvents.find(
      (event) => event.type === JsonStreamEventType.TOOL_RESULT,
    );
    expect(toolResult).toMatchObject({
      tool_id: 'tool-1',
      status: 'success',
    });
  });

  it('does not print tool display when suppressDisplay is true', async () => {
    const events: AgentEvent[] = [
      {
        type: 'tool-result',
        result: {
          id: 'tool-display-2',
          name: 'testTool',
          display: 'This should not be shown',
          isError: false,
          suppressDisplay: true,
        },
      },
      { type: 'text', text: 'Final answer' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext(),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    expect(processStdoutSpy).not.toHaveBeenCalledWith(
      'This should not be shown\n',
    );
    expect(processStdoutSpy).toHaveBeenCalledWith('Final answer');
    expect(processStdoutSpy).toHaveBeenCalledWith('\n');
  });

  it('logs a tool error and allows the model to continue', async () => {
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
      { type: 'text', text: 'Sorry, let me try again.' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext(),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error executing tool errorTool: Execution failed',
    );
    expect(processStdoutSpy).toHaveBeenCalledWith('Sorry, let me try again.');
  });

  it('throws FatalTurnLimitedError when the agent reports max-turns', async () => {
    const events: AgentEvent[] = [{ type: 'done', reason: 'max-turns' }];

    await expect(
      processAgentStream(
        streamFromEvents(events),
        createContext(),
        Date.now(),
        () => uiTelemetryService.getMetrics(),
      ),
    ).rejects.toThrow(FatalTurnLimitedError);
  });

  it('throws when the agent reports an error event', async () => {
    const events: AgentEvent[] = [
      { type: 'error', error: { message: 'API connection failed' } },
    ];

    await expect(
      processAgentStream(
        streamFromEvents(events),
        createContext(),
        Date.now(),
        () => uiTelemetryService.getMetrics(),
      ),
    ).rejects.toThrow('API connection failed');
  });

  it('emits a flat JSON object with session_id, response, and stats on completion', async () => {
    const metrics = uiTelemetryService.getMetrics();
    const events: AgentEvent[] = [
      { type: 'text', text: 'The capital is Paris.' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({
        jsonOutput: true,
        config: createMockConfig({ sessionId: 'json-session' }),
      }),
      Date.now(),
      () => metrics,
    );

    const jsonLine = processStdoutSpy.mock.calls
      .map(([value]) => String(value).trimEnd())
      .filter((value) => value.startsWith('{'))
      .join('');
    const parsed = JSON.parse(jsonLine);
    expect(parsed).toHaveProperty('session_id', 'json-session');
    expect(parsed).toHaveProperty('response', 'The capital is Paris.');
    expect(parsed).toHaveProperty('stats');
    expect(typeof parsed.stats).toBe('object');
  });

  it('emits a loop-detected stream warning and completes', async () => {
    const streamFormatter = new StreamJsonFormatter();
    const events: AgentEvent[] = [
      { type: 'loop-detected' },
      { type: 'text', text: 'partial' },
      { type: 'done', reason: 'loop-detected' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ streamFormatter }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const jsonEvents = parseJsonStdoutEvents(processStdoutSpy.mock.calls);
    const warning = jsonEvents.find(
      (event) =>
        event.type === JsonStreamEventType.ERROR &&
        event.severity === 'warning',
    );
    expect(warning).toMatchObject({
      message: 'Loop detected, stopping execution',
    });
  });

  it('writes no final result on an aborted completion', async () => {
    const events: AgentEvent[] = [{ type: 'done', reason: 'aborted' }];

    await processAgentStream(
      streamFromEvents(events),
      createContext(),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith('Operation cancelled.');
    const meaningfulWrites = processStdoutSpy.mock.calls
      .map(([value]) => value)
      .filter((value) => value !== '');
    expect(meaningfulWrites).toHaveLength(0);
  });

  it('writes a stop message to stderr on hook-stopped completion', async () => {
    const events: AgentEvent[] = [
      {
        type: 'done',
        reason: 'hook-stopped',
        stop: { reason: 'policy', systemMessage: '  blocked by hook  ' },
      },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext(),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    expect(processStderrSpy).toHaveBeenCalledWith(
      'Agent execution stopped: blocked by hook\n',
    );
  });

  it('emits a stream-json RESULT event with stats on completion', async () => {
    const streamFormatter = new StreamJsonFormatter();
    const metrics = uiTelemetryService.getMetrics();
    const events: AgentEvent[] = [
      { type: 'text', text: 'done' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ streamFormatter }),
      1000,
      () => metrics,
    );

    const jsonEvents = parseJsonStdoutEvents(processStdoutSpy.mock.calls);
    const result = jsonEvents.find(
      (event) => event.type === JsonStreamEventType.RESULT,
    );
    expect(result).toBeDefined();
  });

  it('writes a warning to stderr and continues on a hook-blocked event', async () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'partial' },
      {
        type: 'hook-blocked',
        info: { reason: 'policy', systemMessage: '  blocked by hook  ' },
      },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext(),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    expect(processStderrSpy).toHaveBeenCalledWith(
      '[WARNING] Agent execution blocked: blocked by hook\n',
    );
    expect(processStdoutSpy).toHaveBeenCalledWith('partial');
    expect(processStdoutSpy).toHaveBeenCalledWith('\n');
  });

  it('emits a stream-json error and throws on an idle-timeout event', async () => {
    const streamFormatter = new StreamJsonFormatter();
    const events: AgentEvent[] = [
      {
        type: 'idle-timeout',
        error: { message: 'no response received within the allowed time.' },
      },
    ];

    await expect(
      processAgentStream(
        streamFromEvents(events),
        createContext({ streamFormatter }),
        Date.now(),
        () => uiTelemetryService.getMetrics(),
      ),
    ).rejects.toThrow('no response received within the allowed time.');

    const jsonEvents = parseJsonStdoutEvents(processStdoutSpy.mock.calls);
    const streamError = jsonEvents.find(
      (event) => event.type === JsonStreamEventType.ERROR,
    );
    expect(streamError?.message).toContain('Stream idle timeout');
  });

  it('preserves the tool errorType in the stream-json TOOL_RESULT record', async () => {
    const streamFormatter = new StreamJsonFormatter();
    const events: AgentEvent[] = [
      {
        type: 'tool-result',
        result: {
          id: 'tool-perm-1',
          name: 'editTool',
          isError: true,
          display: 'Permission denied',
          errorType: 'PERMISSION_DENIED',
        },
      },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext({ streamFormatter }),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const jsonEvents = parseJsonStdoutEvents(processStdoutSpy.mock.calls);
    const toolResult = jsonEvents.find(
      (event) => event.type === JsonStreamEventType.TOOL_RESULT,
    );
    expect(toolResult?.status).toBe('error');
    expect(toolResult?.error?.type).toBe('PERMISSION_DENIED');
  });
});
