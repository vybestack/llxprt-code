/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolCall, WaitingToolCall } from './coreToolScheduler.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { DEFAULT_GEMINI_MODEL } from '@vybestack/llxprt-code-core/config/models.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { ContentConverters } from '@vybestack/llxprt-code-core/services/history/ContentConverters.js';
import type { ToolCallBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createMockMessageBus,
  createMockPolicyEngine,
  waitForStatus,
  MockEditTool,
} from './coreToolScheduler-test-helpers.js';

describe('CoreToolScheduler edit cancellation', () => {
  it('should preserve diff when an edit is cancelled', async () => {
    const mockEditTool = new MockEditTool();
    const declarativeTool = mockEditTool;
    const mockToolRegistry = {
      getTool: () => declarativeTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => declarativeTool,
      getToolByDisplayName: () => declarativeTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: '1',
      name: 'mockEditTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-1',
    };

    await scheduler.schedule([request], abortController.signal);

    const awaitingCall = (await waitForStatus(
      onToolCallsUpdate,
      'awaiting_approval',
    )) as WaitingToolCall;

    // Cancel the edit
    const confirmationDetails = awaitingCall.confirmationDetails;
    await confirmationDetails.onConfirm(ToolConfirmationOutcome.Cancel);

    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];

    expect(completedCalls[0].status).toBe('cancelled');

    // Check that the diff is preserved
    const cancelledCall = completedCalls[0];
    expect(cancelledCall.response.resultDisplay).toBeDefined();
    expect(
      (cancelledCall.response.resultDisplay as { fileDiff: string }).fileDiff,
    ).toBe(
      '--- test.txt\n+++ test.txt\n@@ -1,1 +1,1 @@\n-old content\n+new content',
    );
    expect(
      (cancelledCall.response.resultDisplay as { fileName: string }).fileName,
    ).toBe('test.txt');

    // Regression (Issue #864): ensure cancellation responseParts can be persisted
    // into provider-visible history as a paired tool_call + tool_response.
    // With the neutral block contract the cancelled response carries only the
    // tool_response; the tool_call is recorded separately from the model's
    // streamed assistant message. We simulate the combined turn content the
    // way the agentic loop records it: an AI message with the tool_call
    // followed by a user message with the tool_response from the cancelled
    // call, and verify the converter pairs them into well-formed history.
    const historyService = new HistoryService();
    const turnKey = historyService.generateTurnKey();
    const idGenerator = historyService.getIdGeneratorCallback(turnKey);

    const assistantContent: Content = {
      role: 'model',
      parts: [
        {
          functionCall: {
            id: request.callId,
            name: request.name,
            args: request.args,
          },
        },
      ],
    };
    historyService.add(
      ContentConverters.toIContent(
        assistantContent,
        idGenerator,
        undefined,
        turnKey,
      ),
    );

    const toolResponseContent: Content = {
      role: 'user',
      parts: cancelledCall.response.responseParts as Part[],
    };
    historyService.add(
      ContentConverters.toIContent(
        toolResponseContent,
        idGenerator,
        undefined,
        turnKey,
      ),
    );

    const curated = historyService.getCuratedForProvider();
    expect(curated.filter((c) => c.speaker === 'ai')).toHaveLength(1);
    expect(curated.filter((c) => c.speaker === 'tool')).toHaveLength(1);
    // The converter pairs the tool_call and tool_response into a single AI
    // turn (tool_call) + tool turn (tool_response).
    const toolCallMessage = curated.find((c) => c.speaker === 'ai');
    const toolResponseMessage = curated.find((c) => c.speaker === 'tool');
    expect(toolCallMessage).toBeDefined();
    expect(toolResponseMessage).toBeDefined();
    expect(toolCallMessage!.blocks[0]).toMatchObject({
      type: 'tool_call',
      name: 'mockEditTool',
    });
    const toolCallId = (toolCallMessage!.blocks[0] as ToolCallBlock).id;
    expect(toolCallId).toMatch(/^hist_tool_[a-zA-Z0-9_-]+$/);
    expect(toolResponseMessage!.blocks[0]).toMatchObject({
      type: 'tool_response',
      callId: toolCallId,
      toolName: 'mockEditTool',
    });
  });
});
