/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentExecutor } from './executor.js';
import { getTestRuntimeMessageBus } from '@vybestack/llxprt-code-core/test-utils/config.js';
import { LSTool } from '@vybestack/llxprt-code-tools';
import { ReadFileTool } from '@vybestack/llxprt-code-tools';
import { ChatSession, StreamEventType } from '../core/chatSession.js';
import { type FunctionCall } from '@google/genai';
import { getDirectoryContextString } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import { attachHookRestrictedAllowedTools } from '../core/hookToolRestrictions.js';
import {
  setupExecutorFixture,
  createTestDefinition,
  mockModelResponse,
  createCompletedToolCallResponse,
  createMockResponseChunk,
  TASK_COMPLETE_TOOL_NAME,
  MOCK_TOOL_NOT_ALLOWED,
  AgentTerminateMode,
  type ExecutorTestFixture,
  type MockFn,
} from './executor-test-helpers.js';

const { mockSendMessageStream, mockExecuteToolCall } = vi.hoisted(() => ({
  mockSendMessageStream: vi.fn(),
  mockExecuteToolCall: vi.fn(),
}));

vi.mock('../core/chatSession.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../core/chatSession.js')>();
  return {
    ...actual,
    ChatSession: vi.fn().mockImplementation(() => ({
      sendMessageStream: mockSendMessageStream,
    })),
  };
});

vi.mock('../core/nonInteractiveToolExecutor.js', () => ({
  executeToolCall: mockExecuteToolCall,
}));

vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js');

const MockedChatSession = vi.mocked(ChatSession);
const mockedGetDirectoryContextString = vi.mocked(getDirectoryContextString);

describe('AgentExecutor', () => {
  let fixture: ExecutorTestFixture;

  beforeEach(() => {
    fixture = setupExecutorFixture({
      MockedChatSession,
      mockSendMessageStream: mockSendMessageStream as MockFn,
      mockExecuteToolCall: mockExecuteToolCall as MockFn,
      mockedGetDirectoryContextString:
        mockedGetDirectoryContextString as MockFn,
      vi,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('create (Initialization and Validation)', () => {
    it('should create successfully with allowed tools', async () => {
      const definition = createTestDefinition([LSTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        fixture.mockConfig,
        getTestRuntimeMessageBus(fixture.mockConfig),
        fixture.onActivity,
      );
      expect(executor).toBeInstanceOf(AgentExecutor);
    });

    it('SECURITY: should throw if a tool is not on the non-interactive allowlist', async () => {
      const definition = createTestDefinition([MOCK_TOOL_NOT_ALLOWED.name]);
      await expect(
        AgentExecutor.create(
          definition,
          fixture.mockConfig,
          getTestRuntimeMessageBus(fixture.mockConfig),
          fixture.onActivity,
        ),
      ).rejects.toThrow(/not on the allow-list for non-interactive execution/);
    });

    it('should create an isolated ToolRegistry for the agent', async () => {
      const definition = createTestDefinition([LSTool.Name, ReadFileTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        fixture.mockConfig,
        getTestRuntimeMessageBus(fixture.mockConfig),
        fixture.onActivity,
      );

      const agentRegistry = executor['toolRegistry'];

      expect(agentRegistry).not.toBe(fixture.parentToolRegistry);
      expect(agentRegistry.getAllToolNames()).toStrictEqual(
        expect.arrayContaining([LSTool.Name, ReadFileTool.Name]),
      );
      expect(agentRegistry.getAllToolNames()).toHaveLength(2);
      expect(agentRegistry.getTool(MOCK_TOOL_NOT_ALLOWED.name)).toBeUndefined();
    });
  });

  describe('run (Hook-filtered tool calls)', () => {
    it('should not treat only hook-filtered function calls as successful completion', async () => {
      const definition = createTestDefinition([LSTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        fixture.mockConfig,
        getTestRuntimeMessageBus(fixture.mockConfig),
        fixture.onActivity,
      );
      const blockedCall: FunctionCall = {
        name: 'run_shell_command',
        args: { command: 'echo blocked' },
        id: 'blocked-call',
      };
      const blockedResponse = attachHookRestrictedAllowedTools(
        createMockResponseChunk([{ functionCall: blockedCall }], [blockedCall]),
        ['read_file'],
      );
      mockSendMessageStream
        .mockImplementationOnce(async () =>
          (async function* () {
            yield { type: StreamEventType.CHUNK, value: blockedResponse };
          })(),
        )
        .mockImplementationOnce(async () =>
          (async function* () {
            yield {
              type: StreamEventType.CHUNK,
              value: createMockResponseChunk([
                { text: 'Still no executable tool calls' },
              ]),
            };
          })(),
        );

      const output = await executor.run(
        { goal: 'Blocked tool call' },
        fixture.signal,
      );

      expect(output.terminate_reason).toBe(
        AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
      );
      expect(mockExecuteToolCall).not.toHaveBeenCalled();
    });

    it('should execute allowed function calls when the same response also has hook-filtered calls', async () => {
      const definition = createTestDefinition([LSTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        fixture.mockConfig,
        getTestRuntimeMessageBus(fixture.mockConfig),
        fixture.onActivity,
      );
      const signal = new AbortController().signal;
      const allowedCall: FunctionCall = {
        name: LSTool.Name,
        args: { path: '/allowed' },
        id: 'allowed-call',
      };
      const blockedCall: FunctionCall = {
        name: 'run_shell_command',
        args: { command: 'echo blocked' },
        id: 'blocked-call',
      };
      const mixedResponse = attachHookRestrictedAllowedTools(
        createMockResponseChunk(
          [{ functionCall: allowedCall }, { functionCall: blockedCall }],
          [allowedCall, blockedCall],
        ),
        [LSTool.Name],
      );
      mockSendMessageStream.mockImplementationOnce(async () =>
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mixedResponse };
        })(),
      );
      mockModelResponse(mockSendMessageStream, [
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { output: 'done' },
          id: 'complete-call',
        },
      ]);
      mockModelResponse(mockSendMessageStream, [
        {
          name: TASK_COMPLETE_TOOL_NAME,
          args: { output: 'done' },
          id: 'complete-call-2',
        },
      ]);
      mockModelResponse(
        mockSendMessageStream,
        [],
        undefined,
        'No more tool calls',
      );

      mockExecuteToolCall.mockResolvedValueOnce(
        createCompletedToolCallResponse({
          callId: 'allowed-call',
          name: LSTool.Name,
          resultDisplay: 'ok',
        }),
      );

      const output = await executor.run({ goal: 'Mixed calls' }, signal);

      expect(output.terminate_reason).toBe(
        AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
      );
      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
      expect(mockExecuteToolCall.mock.calls[0][1].name).toBe(LSTool.Name);
    });
  });
});
