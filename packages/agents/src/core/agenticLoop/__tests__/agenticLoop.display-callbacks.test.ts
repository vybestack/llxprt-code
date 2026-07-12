/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgenticLoop } from '../AgenticLoop.js';
import type { AgenticLoopEvent } from '../types.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { MockModifiableTool } from '@vybestack/llxprt-code-core/test-utils/tools.js';
import { clearAllSchedulers } from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type {
  CompletedToolCall,
  ToolCall,
} from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ServerAgentStreamEvent } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  type ApprovalHandler,
  AgentEventType,
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  createAllowPolicyEngine,
  createAskPolicyEngine,
  collectEvents,
  isToolsComplete,
  isStream,
  partListUnionToParts,
  toolCallRequestEvent,
  contentEvent,
  finishedEvent,
} from './agenticLoop-test-helpers.js';

describe('AgenticLoop with caller display callbacks', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it('forwards the SAME tool-call and output data to displayCallbacks that it emits as events', async () => {
    const tool = new MockTool({
      name: 'streaming_tool',
      canUpdateOutput: true,
    });
    tool.executeFn.mockImplementation(
      async (
        _params: Record<string, unknown>,
        _signal: AbortSignal,
        updateOutput?: (output: string) => void,
      ) => {
        updateOutput?.('chunk-1');
        updateOutput?.('chunk-2');
        return { llmContent: 'done', returnDisplay: 'done' };
      },
    );

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });

    const displayToolUpdates: ToolCall[] = [];
    const displayOutputChunks: Array<{
      callId: string;
      chunk: string | unknown;
    }> = [];

    const { client } = createScriptedAgentClient([
      [
        toolCallRequestEvent('streaming_tool', 'call-disp', { x: 1 }),
        finishedEvent(),
      ],
      [contentEvent('final'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      displayCallbacks: {
        onToolCallsUpdate: (toolCalls) => {
          displayToolUpdates.push(...toolCalls);
        },
        outputUpdateHandler: (callId, chunk) => {
          displayOutputChunks.push({ callId, chunk });
        },
        getPreferredEditor: () => undefined,
      },
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    const emittedToolUpdateEvents = events.filter(
      (e): e is Extract<AgenticLoopEvent, { kind: 'tool_update' }> =>
        e.kind === 'tool_update',
    );
    expect(emittedToolUpdateEvents.length).toBeGreaterThan(0);
    const emittedToolCalls = emittedToolUpdateEvents.flatMap(
      (e) => e.toolCalls,
    );
    expect(displayToolUpdates.length).toBeGreaterThanOrEqual(
      emittedToolCalls.length,
    );
    for (const emitted of emittedToolCalls) {
      const matched = displayToolUpdates.some(
        (captured) =>
          captured.request.callId === emitted.request.callId &&
          captured.status === emitted.status,
      );
      expect(matched).toBe(true);
    }
    const dispFinal = displayToolUpdates.find(
      (tc) => tc.request.callId === 'call-disp' && tc.status === 'success',
    );
    expect(dispFinal).toBeDefined();

    const emittedOutputEvents = events.filter(
      (e): e is Extract<AgenticLoopEvent, { kind: 'tool_output' }> =>
        e.kind === 'tool_output',
    );
    expect(emittedOutputEvents).toHaveLength(2);
    const emittedOutputData = emittedOutputEvents.map((e) => ({
      callId: e.callId,
      chunk: e.chunk,
    }));
    const dispStringChunks = displayOutputChunks.map((c) => ({
      callId: c.callId,
      chunk: c.chunk,
    }));
    expect(dispStringChunks).toStrictEqual(emittedOutputData);
    expect(dispStringChunks.every((c) => c.callId === 'call-disp')).toBe(true);

    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed[0].status).toBe('success');
  });

  it('completes the turn correctly with interactiveMode: true (no observable interactive-only side effect is reachable headlessly)', async () => {
    const tool = new MockTool({ name: 'simple_tool' });
    tool.executeFn.mockResolvedValue({
      llmContent: 'ok',
      returnDisplay: 'ok',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.YOLO,
    });

    const { client, turnMessages } = createScriptedAgentClient([
      [toolCallRequestEvent('simple_tool', 'call-int'), finishedEvent()],
      [contentEvent('done-interactive'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      interactiveMode: true,
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    expect(tool.executeFn).toHaveBeenCalledTimes(1);
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed[0].status).toBe('success');
    expect(turnMessages).toHaveLength(2);
    const turn2Parts = partListUnionToParts(turnMessages[1]);
    expect(turn2Parts.some((p) => p.type === 'tool_response')).toBe(true);
    const streamContents = events
      .filter(isStream)
      .filter((e) => e.event.type === AgentEventType.Content)
      .map((e) => {
        const ev = e.event as Extract<
          ServerAgentStreamEvent,
          { type: typeof AgentEventType.Content }
        >;
        return ev.value;
      });
    expect(streamContents).toContain('done-interactive');
  });

  it('a provided getPreferredEditor is forwarded to the scheduler and its returned value is honored', async () => {
    const tool = new MockModifiableTool('modifiable_tool_disp');
    tool.executeFn.mockResolvedValue({
      llmContent: 'modified-ok',
      returnDisplay: 'modified-ok',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);

    let capturedGetPreferredEditor: (() => string | undefined) | undefined;
    let capturedOnEditorOpen: (() => void) | undefined;
    let capturedOnEditorClose: (() => void) | undefined;
    const baseConfig = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });
    const config: Config = {
      ...baseConfig,
      getOrCreateScheduler: async (
        sessionId: string,
        callbacks: Parameters<Config['getOrCreateScheduler']>[1],
        schedulerOptions: Parameters<Config['getOrCreateScheduler']>[2],
        deps: Parameters<Config['getOrCreateScheduler']>[3],
      ) => {
        capturedGetPreferredEditor = callbacks.getPreferredEditor;
        capturedOnEditorOpen = callbacks.onEditorOpen;
        capturedOnEditorClose = callbacks.onEditorClose;
        return baseConfig.getOrCreateScheduler(
          sessionId,
          callbacks,
          schedulerOptions,
          deps,
        );
      },
    };

    const editorOpenCalls: string[] = [];
    const editorCloseCalls: string[] = [];
    const approvalHandler: ApprovalHandler = async () => ({
      outcome: ToolConfirmationOutcome.ProceedOnce,
      payload: { newContent: 'payload-content' },
    });

    const { client } = createScriptedAgentClient([
      [
        toolCallRequestEvent('modifiable_tool_disp', 'call-ed'),
        finishedEvent(),
      ],
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
        onEditorOpen: () => {
          editorOpenCalls.push('opened');
        },
        onEditorClose: () => {
          editorCloseCalls.push('closed');
        },
      },
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    expect(capturedGetPreferredEditor).toBeDefined();
    expect(capturedGetPreferredEditor?.()).toBe('vscode');
    expect(capturedOnEditorOpen).toBeDefined();
    expect(capturedOnEditorClose).toBeDefined();
    capturedOnEditorOpen?.();
    capturedOnEditorClose?.();
    expect(editorOpenCalls).toStrictEqual(['opened']);
    expect(editorCloseCalls).toStrictEqual(['closed']);
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed[0].status).toBe('success');
  });

  it('forwards onAllToolCallsComplete with the SAME batch as the tools_complete event, BEFORE next-turn history finalization', async () => {
    const tool = new MockTool({ name: 'complete_cb_tool' });
    tool.executeFn.mockResolvedValue({
      llmContent: 'ok',
      returnDisplay: 'ok',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });

    const { client, recordedToolCalls } = createScriptedAgentClient([
      [
        toolCallRequestEvent('complete_cb_tool', 'call-allcb', { x: 1 }),
        finishedEvent(),
      ],
      [contentEvent('done'), finishedEvent()],
    ]);

    const displayCompletions: CompletedToolCall[][] = [];
    let onCompleteCallCount = 0;
    // Capture how many recorded-tool-call batches exist WHEN the callback fires,
    // so we can assert parent-loop callbacks fire before next-turn history
    // finalization.
    let recordedCountAtCallback = -1;

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      displayCallbacks: {
        onAllToolCallsComplete: (completed) => {
          onCompleteCallCount += 1;
          recordedCountAtCallback = recordedToolCalls.length;
          displayCompletions.push(completed);
        },
      },
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    // The callback fired exactly once (one turn with completed tools).
    expect(onCompleteCallCount).toBe(1);
    // Completed-tool callbacks fire before any next-turn history finalization in
    // the parent loop; eager durability is scoped to subagents, so no completed
    // tool batch is pre-recorded here.
    expect(recordedCountAtCallback).toBe(0);

    // The callback received the SAME batch as the tools_complete event.
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    const eventBatch = completedEvents[0].completed;
    expect(displayCompletions).toHaveLength(1);
    expect(displayCompletions[0].length).toBe(eventBatch.length);
    expect(displayCompletions[0][0].request.callId).toBe(
      eventBatch[0].request.callId,
    );
    expect(displayCompletions[0][0].status).toBe(eventBatch[0].status);
    expect(displayCompletions[0][0].status).toBe('success');
  });

  it('a throwing onAllToolCallsComplete callback does not break the loop', async () => {
    const tool = new MockTool({ name: 'throw_cb_tool' });
    tool.executeFn.mockResolvedValue({
      llmContent: 'ok',
      returnDisplay: 'ok',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });

    const { client } = createScriptedAgentClient([
      [
        toolCallRequestEvent('throw_cb_tool', 'call-throwcb', { x: 1 }),
        finishedEvent(),
      ],
      [contentEvent('survived'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      displayCallbacks: {
        onAllToolCallsComplete: () => {
          throw new Error('callback boom');
        },
      },
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    // The loop completed normally despite the throwing callback.
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed[0].status).toBe('success');
    // The continuation turn ran.
    const streamContents = events
      .filter(isStream)
      .filter((e) => e.event.type === AgentEventType.Content)
      .map((e) => {
        const ev = e.event as Extract<
          ServerAgentStreamEvent,
          { type: typeof AgentEventType.Content }
        >;
        return ev.value;
      });
    expect(streamContents).toContain('survived');
  });

  it('an async-rejecting onAllToolCallsComplete callback does not break the loop or cause unhandled rejection', async () => {
    const tool = new MockTool({ name: 'async_reject_cb_tool' });
    tool.executeFn.mockResolvedValue({
      llmContent: 'ok',
      returnDisplay: 'ok',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });

    const { client } = createScriptedAgentClient([
      [
        toolCallRequestEvent('async_reject_cb_tool', 'call-asynccb', { x: 1 }),
        finishedEvent(),
      ],
      [contentEvent('survived-async'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      displayCallbacks: {
        onAllToolCallsComplete: async () => {
          throw new Error('async callback boom');
        },
      },
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    // The loop completed normally despite the async-rejecting callback.
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed[0].status).toBe('success');
    // The continuation turn ran.
    const streamContents = events
      .filter(isStream)
      .filter((e) => e.event.type === AgentEventType.Content)
      .map((e) => {
        const ev = e.event as Extract<
          ServerAgentStreamEvent,
          { type: typeof AgentEventType.Content }
        >;
        return ev.value;
      });
    expect(streamContents).toContain('survived-async');
  });

  it('accumulates string output chunks into liveOutput instead of replacing (fixes #2008)', async () => {
    const tool = new MockTool({
      name: 'delta_streaming_tool',
      canUpdateOutput: true,
    });
    tool.executeFn.mockImplementation(
      async (
        _params: Record<string, unknown>,
        _signal: AbortSignal,
        updateOutput?: (output: string) => void,
      ) => {
        updateOutput?.('Hello ');
        updateOutput?.('world');
        updateOutput?.('!');
        return { llmContent: 'done', returnDisplay: 'done' };
      },
    );

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });

    const toolUpdatesByStatus: ToolCall[] = [];

    const { client } = createScriptedAgentClient([
      [
        toolCallRequestEvent('delta_streaming_tool', 'call-acc', { x: 1 }),
        finishedEvent(),
      ],
      [contentEvent('final'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      displayCallbacks: {
        onToolCallsUpdate: (toolCalls) => {
          toolUpdatesByStatus.push(...toolCalls);
        },
        getPreferredEditor: () => undefined,
      },
    });

    await collectEvents(loop, 'go', new AbortController().signal);

    const executingUpdates = toolUpdatesByStatus.filter(
      (tc) => tc.request.callId === 'call-acc' && tc.status === 'executing',
    );
    expect(executingUpdates.length).toBeGreaterThanOrEqual(1);

    // The last executing update (after all three chunks) must contain the
    // full accumulated string, proving deltas are appended not replaced.
    expect(executingUpdates[executingUpdates.length - 1]).toMatchObject({
      liveOutput: 'Hello world!',
    });
  });
});
