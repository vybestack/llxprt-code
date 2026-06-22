/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Mock } from 'vitest';
import { AgentTerminateMode, type SubagentActivityEvent } from './types.js';
import type { AgentDefinition, OutputConfig } from './types.js';
import { getTestRuntimeMessageBus } from '@vybestack/llxprt-code-core/test-utils/config.js';
import { makeFakeConfig } from '@vybestack/llxprt-code-core/test-utils/config.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { LSTool } from '@vybestack/llxprt-code-tools';
import { ReadFileTool } from '@vybestack/llxprt-code-tools';
import { CoreToolHostAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreToolHostAdapter.js';
import { StreamEventType, type StreamEvent } from '../core/chatSession.js';
import {
  type FunctionCall,
  type Part,
  type GenerateContentResponse,
  type GenerateContentConfig,
} from '@google/genai';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { z } from 'zod';
import type { ToolErrorType } from '@vybestack/llxprt-code-tools';

// Constants for testing
export const TASK_COMPLETE_TOOL_NAME = 'complete_task';
export const MOCK_TOOL_NOT_ALLOWED = new MockTool({
  name: 'write_file_interactive',
});

// ---------------------------------------------------------------------------
// Response / tool-call mock helpers (pure functions taking mock fns as params)
// ---------------------------------------------------------------------------

export type MockFn = Mock;

/** Subset of the vitest `vi` API used by setupExecutorFixture. */
export interface ViTestApi {
  resetAllMocks: () => void;
  useFakeTimers: () => void;
  useRealTimers: () => void;
  spyOn: <T extends object, K extends string | symbol | number>(
    target: T,
    key: K,
  ) => Mock;
  advanceTimersByTimeAsync: (ms: number) => Promise<void>;
}

/**
 * Creates a mock API response chunk, safely spreading functionCalls when
 * present.
 */
export const createMockResponseChunk = (
  parts: Part[],
  functionCalls?: FunctionCall[],
): GenerateContentResponse =>
  ({
    candidates: [{ index: 0, content: { role: 'model', parts } }],
    ...(functionCalls && functionCalls.length > 0 ? { functionCalls } : {}),
  }) as unknown as GenerateContentResponse;

/**
 * Helper to mock a single turn of model response in the stream.
 */
export const mockModelResponse = (
  mockSendMessageStream: MockFn,
  functionCalls: FunctionCall[],
  thought?: string,
  text?: string,
): void => {
  const parts: Part[] = [];
  if (thought) {
    parts.push({
      text: `**${thought}** This is the reasoning part.`,
      thought: true,
    });
  }
  if (text) parts.push({ text });

  const responseChunk = createMockResponseChunk(parts, functionCalls);

  mockSendMessageStream.mockImplementationOnce(async () =>
    (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: responseChunk,
      } as StreamEvent;
    })(),
  );
};

export interface CompletedToolCallParams {
  callId: string;
  name: string;
  responseParts?: Part[];
  resultDisplay?: unknown;
  error?: Error;
  errorType?: ToolErrorType;
}

export function createCompletedToolCallResponse(
  params: CompletedToolCallParams,
) {
  return {
    status: params.error ? ('error' as const) : ('success' as const),
    request: {
      callId: params.callId,
      name: params.name,
      args: {},
      isClientInitiated: true,
      prompt_id: 'mock-prompt',
      agentId: 'primary',
    },
    response: {
      callId: params.callId,
      responseParts: params.responseParts ?? [],
      resultDisplay: params.resultDisplay,
      error: params.error,
      errorType: params.errorType,
      agentId: 'primary',
    },
  };
}

export interface MessageParams {
  message?: Part[];
  config?: GenerateContentConfig;
}

/**
 * Extracts the message parameters sent to sendMessageStream.
 */
export const getMockMessageParams = (
  mockSendMessageStream: MockFn,
  callIndex: number,
): MessageParams => {
  const call = mockSendMessageStream.mock.calls[callIndex];
  return call[0] as MessageParams;
};

/**
 * Type-safe helper to create agent definitions for tests.
 */
export const createTestDefinition = <TOutput extends z.ZodTypeAny>(
  tools: Array<string | MockTool> = [LSTool.Name],
  runConfigOverrides: Partial<AgentDefinition<TOutput>['runConfig']> = {},
  outputConfigMode: 'default' | 'none' = 'default',
  schema: TOutput = z.string() as unknown as TOutput,
): AgentDefinition<TOutput> => {
  let outputConfig: OutputConfig<TOutput> | undefined;

  if (outputConfigMode === 'default') {
    outputConfig = {
      outputName: 'finalResult',
      description: 'The final result.',
      schema,
    };
  }

  return {
    name: 'TestAgent',
    description: 'An agent for testing.',
    inputConfig: {
      inputs: { goal: { type: 'string', required: true, description: 'goal' } },
    },
    modelConfig: { model: 'gemini-test-model', temp: 0, top_p: 1 },
    runConfig: { max_time_minutes: 5, max_turns: 5, ...runConfigOverrides },
    promptConfig: { systemPrompt: 'Achieve the goal: ${goal}.' },
    toolConfig: { tools },
    outputConfig,
  };
};

export const mockWorkResponse = (
  mockSendMessageStream: MockFn,
  mockExecuteToolCall: MockFn,
  id: string,
): void => {
  mockModelResponse(mockSendMessageStream, [
    { name: LSTool.Name, args: { path: '.' }, id },
  ]);
  mockExecuteToolCall.mockResolvedValueOnce(
    createCompletedToolCallResponse({
      callId: id,
      name: LSTool.Name,
      resultDisplay: 'ok',
      responseParts: [
        { functionResponse: { name: LSTool.Name, response: {}, id } },
      ],
    }),
  );
};

// ---------------------------------------------------------------------------
// Shared test fixture state
// ---------------------------------------------------------------------------

export interface ExecutorFixtureParams {
  MockedChatSession: MockFn;
  mockSendMessageStream: MockFn;
  mockExecuteToolCall: MockFn;
  mockedGetDirectoryContextString: MockFn;
  vi: ViTestApi;
}

export interface ExecutorTestFixture {
  mockConfig: Config;
  parentToolRegistry: ToolRegistry;
  activities: SubagentActivityEvent[];
  onActivity: (activity: SubagentActivityEvent) => void;
  abortController: AbortController;
  signal: AbortSignal;
}

/**
 * Sets up the shared executor test fixture. Call from beforeEach.
 */
export function setupExecutorFixture(
  params: ExecutorFixtureParams,
): ExecutorTestFixture {
  const {
    MockedChatSession,
    mockSendMessageStream,
    mockExecuteToolCall,
    mockedGetDirectoryContextString,
    vi,
  } = params;
  vi.resetAllMocks();
  mockSendMessageStream.mockReset();
  mockExecuteToolCall.mockReset();

  MockedChatSession.mockImplementation(
    () =>
      ({
        sendMessageStream: mockSendMessageStream,
      }) as unknown as Record<string, unknown>,
  );

  vi.useFakeTimers();

  const mockConfig = makeFakeConfig();
  const parentToolRegistry = new ToolRegistry(
    mockConfig,
    getTestRuntimeMessageBus(mockConfig),
  );
  parentToolRegistry.registerTool(
    new LSTool(new CoreToolHostAdapter(mockConfig)),
  );
  parentToolRegistry.registerTool(
    new ReadFileTool(new CoreToolHostAdapter(mockConfig)),
  );
  parentToolRegistry.registerTool(MOCK_TOOL_NOT_ALLOWED);

  vi.spyOn(mockConfig, 'getToolRegistry').mockReturnValue(parentToolRegistry);

  mockedGetDirectoryContextString.mockResolvedValue(
    'Mocked Environment Context',
  );

  const activities: SubagentActivityEvent[] = [];
  const onActivity = (activity: SubagentActivityEvent) =>
    activities.push(activity);
  const abortController = new AbortController();

  return {
    mockConfig,
    parentToolRegistry,
    activities,
    onActivity,
    abortController,
    signal: abortController.signal,
  };
}

export { AgentTerminateMode };
export type { ActivityCallback } from './executor.js';
