/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Config, uiTelemetryService } from '@vybestack/llxprt-code-core';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import { processAgentStream } from './nonInteractiveCliSupport.js';

import { vi, describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { Mock } from 'bun:test';

async function* streamFromEvents(
  events: AgentEvent[],
): AsyncIterable<AgentEvent> {
  for (const event of events) {
    yield event;
  }
}

function createMockConfig(): Config {
  return {
    getSessionId: () => 'test-session',
    getEphemeralSetting: () => undefined,
  } as unknown as Config;
}

interface JsonResponse {
  response: string;
}

/**
 * Extract the JSON object emitted by emitFinalResult in JSON output mode.
 * The final result is a single JSON object written to stdout.
 */
function extractJsonResponse(
  stdoutCalls: Array<[unknown, ...unknown[]]>,
): JsonResponse {
  const raw = stdoutCalls
    .map(([value]) => String(value))
    .join('')
    .trim();
  if (raw === '') {
    throw new Error(
      'Expected JSON output from processAgentStream but stdout was empty',
    );
  }
  try {
    return JSON.parse(raw) as JsonResponse;
  } catch {
    throw new Error(
      `Expected valid JSON from processAgentStream but got: ${raw.slice(0, 200)}`,
    );
  }
}

describe('processAgentStream — JSON output mode (issue #3226)', () => {
  let processStdoutSpy: Mock<typeof process.stdout.write>;

  beforeEach(() => {
    processStdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createContext() {
    return {
      config: createMockConfig(),
      jsonOutput: true,
      streamJsonOutput: false,
      quiet: false,
      streamFormatter: null,
      emojiFilter: undefined,
      createProfileNameWriter: () => () => {},
    };
  }

  it('discards intermediate text before a tool call and emits only the final answer in the JSON response', async () => {
    // Model states the answer "$blue$" in the first iteration, then calls a
    // tool, then states "$blue$" again in the final iteration. Without the
    // fix, responseText accumulates both, producing "$blue$$blue$".
    const events: AgentEvent[] = [
      { type: 'text', text: '$blue$' },
      {
        type: 'tool-call',
        call: { id: 'tool-1', name: 'save_memory', args: {} },
      },
      {
        type: 'tool-result',
        result: {
          id: 'tool-1',
          name: 'save_memory',
          display: 'saved',
          isError: false,
        },
      },
      { type: 'text', text: '$blue$' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext(),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const result = extractJsonResponse(processStdoutSpy.mock.calls);
    expect(result.response).toBe('$blue$');
    expect(result.response).not.toBe('$blue$$blue$');
  });

  it('keeps all text when no tool calls occur', async () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'The answer is 42.' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext(),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const result = extractJsonResponse(processStdoutSpy.mock.calls);
    expect(result.response).toBe('The answer is 42.');
  });

  it('keeps only the last iteration when multiple tool calls occur', async () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'First answer.' },
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
      { type: 'text', text: 'Second answer.' },
      {
        type: 'tool-call',
        call: { id: 'tool-2', name: 'write_file', args: {} },
      },
      {
        type: 'tool-result',
        result: {
          id: 'tool-2',
          name: 'write_file',
          display: 'written',
          isError: false,
        },
      },
      { type: 'text', text: 'Final answer.' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext(),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const result = extractJsonResponse(processStdoutSpy.mock.calls);
    expect(result.response).toBe('Final answer.');
    expect(result.response).not.toContain('First answer.');
    expect(result.response).not.toContain('Second answer.');
  });

  it('keeps text after the last tool call even when the model speaks before it', async () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'Let me save that.' },
      {
        type: 'tool-call',
        call: { id: 'tool-1', name: 'save_memory', args: {} },
      },
      {
        type: 'tool-result',
        result: {
          id: 'tool-1',
          name: 'save_memory',
          display: 'saved',
          isError: false,
        },
      },
      { type: 'text', text: 'Done. My favorite color is blue.' },
      { type: 'done', reason: 'stop' },
    ];

    await processAgentStream(
      streamFromEvents(events),
      createContext(),
      Date.now(),
      () => uiTelemetryService.getMetrics(),
    );

    const result = extractJsonResponse(processStdoutSpy.mock.calls);
    expect(result.response).toBe('Done. My favorite color is blue.');
    expect(result.response).not.toContain('Let me save that.');
  });
});
