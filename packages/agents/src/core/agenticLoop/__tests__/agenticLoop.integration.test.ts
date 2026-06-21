/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgenticLoop } from '../AgenticLoop.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { MockModifiableTool } from '@vybestack/llxprt-code-core/test-utils/tools.js';
import { clearAllSchedulers } from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import {
  type ApprovalHandler,
  GeminiEventType,
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  createAskPolicyEngine,
  collectEvents,
  isToolsComplete,
  isStream,
  isAwaitingApproval,
  partListUnionToParts,
  toolCallRequestEvent,
  contentEvent,
  finishedEvent,
  hasFunctionResponse,
} from './agenticLoop-test-helpers.js';

const { modifyWithEditorMock } = vi.hoisted(() => ({
  modifyWithEditorMock: vi.fn(),
}));
vi.mock('@vybestack/llxprt-code-tools', async (importActual) => {
  const actual =
    await importActual<typeof import('@vybestack/llxprt-code-tools')>();
  return { ...actual, modifyWithEditor: modifyWithEditorMock };
});

describe('AgenticLoop integration - CLI-style with ASK_USER policy', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it('ProceedOnce continues the loop and the tool executes (side effect observable)', async () => {
    const tool = new MockTool({
      name: 'record_tool',
      execute: async () => ({
        llmContent: 'recorded-ok',
        returnDisplay: 'recorded-ok',
      }),
    });
    tool.shouldConfirm = true;
    tool.executeFn.mockResolvedValue({
      llmContent: 'recorded-ok',
      returnDisplay: 'recorded-ok',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });

    const approvalHandler: ApprovalHandler = async () => ({
      outcome: ToolConfirmationOutcome.ProceedOnce,
    });

    const { client, history, turnMessages, recordedToolCalls } =
      createScriptedAgentClient([
        [
          toolCallRequestEvent('record_tool', 'call-1', { x: 1 }),
          finishedEvent(),
        ],
        [contentEvent('done'), finishedEvent()],
      ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      approvalHandler,
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    expect(tool.executeFn).toHaveBeenCalledTimes(1);
    expect(recordedToolCalls).toHaveLength(1);
    expect(recordedToolCalls[0][0]?.request.callId).toBe('call-1');

    const eventKinds = events.map((e) => e.kind);
    const firstToolsCompleteIdx = eventKinds.indexOf('tools_complete');
    expect(firstToolsCompleteIdx).toBeGreaterThanOrEqual(0);

    const firstStreamIdx = eventKinds.indexOf('stream');
    expect(firstStreamIdx).toBeGreaterThanOrEqual(0);
    expect(firstStreamIdx).toBeLessThan(firstToolsCompleteIdx);

    const firstToolUpdateIdx = eventKinds.indexOf('tool_update');
    expect(firstToolUpdateIdx).toBeGreaterThan(firstStreamIdx);
    expect(firstToolUpdateIdx).toBeLessThan(firstToolsCompleteIdx);

    const secondStreamIdx = eventKinds.indexOf(
      'stream',
      firstToolsCompleteIdx + 1,
    );
    expect(secondStreamIdx).toBeGreaterThan(firstToolsCompleteIdx);

    const lastStream = events.filter(isStream).at(-1);
    expect(lastStream).toBeDefined();
    expect(lastStream.event.type).toBe(GeminiEventType.Finished);

    expect(turnMessages).toHaveLength(2);
    const turn2Parts = partListUnionToParts(turnMessages[1]);
    const hasFnResponseInTurn2 = turn2Parts.some(
      (p) => 'functionResponse' in p,
    );
    expect(hasFnResponseInTurn2).toBe(true);
    expect(hasFunctionResponse(history)).toBe(true);
  });

  it('Cancel aborts the tool and the loop records cancelled history then stops', async () => {
    const tool = new MockTool({ name: 'record_tool' });
    tool.shouldConfirm = true;
    tool.executeFn.mockResolvedValue({
      llmContent: 'should-not-matter',
      returnDisplay: 'should-not-matter',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });

    const approvalHandler: ApprovalHandler = async () => ({
      outcome: ToolConfirmationOutcome.Cancel,
    });

    const { client, history } = createScriptedAgentClient([
      [toolCallRequestEvent('record_tool', 'call-2'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      approvalHandler,
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    expect(tool.executeFn).not.toHaveBeenCalled();
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed[0].status).toBe('cancelled');
    expect(hasFunctionResponse(history)).toBe(true);
  });

  it('emits an awaiting_approval event BEFORE the tool executes when policy yields ASK_USER', async () => {
    const tool = new MockTool({
      name: 'record_tool',
      execute: async () => ({
        llmContent: 'recorded-ok',
        returnDisplay: 'recorded-ok',
      }),
    });
    tool.shouldConfirm = true;
    tool.executeFn.mockResolvedValue({
      llmContent: 'recorded-ok',
      returnDisplay: 'recorded-ok',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });

    const approvalHandler: ApprovalHandler = async () => ({
      outcome: ToolConfirmationOutcome.ProceedOnce,
    });

    const { client } = createScriptedAgentClient([
      [
        toolCallRequestEvent('record_tool', 'call-appr', { x: 1 }),
        finishedEvent(),
      ],
      [contentEvent('done'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      approvalHandler,
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    const awaitingEvents = events.filter(isAwaitingApproval);
    expect(awaitingEvents).toHaveLength(1);
    expect(awaitingEvents[0].toolCalls).toHaveLength(1);
    expect(awaitingEvents[0].toolCalls[0].status).toBe('awaiting_approval');

    const eventKinds = events.map((e) => e.kind);
    const awaitingIdx = eventKinds.indexOf('awaiting_approval');
    const toolsCompleteIdx = eventKinds.indexOf('tools_complete');
    expect(awaitingIdx).toBeGreaterThanOrEqual(0);
    expect(toolsCompleteIdx).toBeGreaterThanOrEqual(0);
    expect(awaitingIdx).toBeLessThan(toolsCompleteIdx);

    expect(tool.executeFn).toHaveBeenCalledTimes(1);
  });

  it('ModifyWithEditor payload forwards modified args to the tool (inline modify via bus)', async () => {
    const tool = new MockModifiableTool('modifiable_tool');
    tool.executeFn.mockResolvedValue({
      llmContent: 'modified-ok',
      returnDisplay: 'modified-ok',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });

    const modifiedContent = 'editor-modified-content';
    const approvalHandler: ApprovalHandler = async () => ({
      outcome: ToolConfirmationOutcome.ProceedOnce,
      payload: { newContent: modifiedContent },
    });

    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('modifiable_tool', 'call-mod'), finishedEvent()],
      [contentEvent('done'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      approvalHandler,
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    expect(tool.executeFn).toHaveBeenCalledTimes(1);
    const executedArgs = tool.executeFn.mock.calls[0][0];
    expect(executedArgs).toStrictEqual({ newContent: modifiedContent });

    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    const completed: CompletedToolCall = completedEvents[0].completed[0];
    expect(completed.status).toBe('success');
  });

  it('ModifyWithEditor outcome runs the editor flow and executes with editor-modified args', async () => {
    modifyWithEditorMock.mockResolvedValue({
      updatedParams: { newContent: 'editor-edited-content' },
      updatedDiff: 'edited-diff',
    });

    const tool = new MockModifiableTool('editor_tool');
    tool.executeFn.mockResolvedValue({
      llmContent: 'edited-ok',
      returnDisplay: 'edited-ok',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });

    let confirmationCount = 0;
    const approvalHandler: ApprovalHandler = async () => {
      confirmationCount += 1;
      if (confirmationCount === 1) {
        return { outcome: ToolConfirmationOutcome.ModifyWithEditor };
      }
      return { outcome: ToolConfirmationOutcome.ProceedOnce };
    };

    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('editor_tool', 'call-editor'), finishedEvent()],
      [contentEvent('done'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      approvalHandler,
      interactiveMode: true,
      displayCallbacks: {
        getPreferredEditor: () => 'vscode',
        onEditorOpen: () => {},
        onEditorClose: () => {},
      },
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    expect(modifyWithEditorMock).toHaveBeenCalledTimes(1);
    expect(tool.executeFn).toHaveBeenCalledTimes(1);
    const executedArgs = tool.executeFn.mock.calls[0][0];
    expect(executedArgs).toStrictEqual({ newContent: 'editor-edited-content' });
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed[0].status).toBe('success');
  });

  it('a rejecting approval handler denies the tool and the loop completes (no hang)', async () => {
    const tool = new MockTool({ name: 'record_tool' });
    tool.shouldConfirm = true;
    tool.executeFn.mockResolvedValue({
      llmContent: 'should-not-run',
      returnDisplay: 'should-not-run',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });

    const approvalHandler: ApprovalHandler = async () => {
      throw new Error('handler blew up');
    };

    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('record_tool', 'call-reject'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      approvalHandler,
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    expect(tool.executeFn).not.toHaveBeenCalled();
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed[0].status).toBe('cancelled');
  });
});
