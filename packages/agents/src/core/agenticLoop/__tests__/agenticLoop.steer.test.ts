/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '../../../testApi.js';
import { AgenticLoop } from '../AgenticLoop.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { clearAllSchedulers } from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import {
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  createAllowPolicyEngine,
  collectEvents,
  isToolsComplete,
  isStream,
  partListUnionToParts,
  hasFunctionResponsePart,
  textParts,
  toolCallRequestEvent,
  contentEvent,
  finishedEvent,
} from './agenticLoop-test-helpers.js';

describe('AgenticLoop steering (injectSteer / drainSteer)', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it('injects steer text alongside tool results at the loop boundary when tools complete', async () => {
    const tool = new MockTool({
      name: 'record_tool',
      execute: async () => ({
        llmContent: 'recorded-ok',
        returnDisplay: 'recorded-ok',
      }),
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
      [
        toolCallRequestEvent('record_tool', 'call-1', { x: 1 }),
        finishedEvent(),
      ],
      [contentEvent('final-response'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
    });

    // Start the loop — the first turn will stream a tool call and then
    // schedule/await the tool. injectSteer must happen during tool execution
    // (before the turn boundary), so we call it right after starting the
    // async iteration. Since collectEvents is async and the MockTool resolves
    // on the microtask queue, the synchronous injectSteer lands in the buffer
    // before drainSteer runs at the top of the next iteration.
    const eventsPromise = collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );
    loop.injectSteer('actually, please use x=2 instead');
    const events = await eventsPromise;

    // Two turns happened: tool turn + final answer turn
    expect(turnMessages).toHaveLength(2);

    // Turn 2 message should contain both functionResponse parts AND the steer text
    const turn2Parts = partListUnionToParts(turnMessages[1]);
    expect(hasFunctionResponsePart(turn2Parts)).toBe(true);
    expect(textParts(turn2Parts)).toContain('actually, please use x=2 instead');

    // The steer text must come AFTER the tool results (it's appended last)
    const fnResponseIdx = turn2Parts.findIndex(
      (p) => p.type === 'tool_response',
    );
    const steerTextIdx = turn2Parts.findIndex(
      (p) => p.type === 'text' && p.text === 'actually, please use x=2 instead',
    );
    expect(steerTextIdx).toBeGreaterThan(fnResponseIdx);

    // The model should have produced a final response
    const streamEvents = events.filter(isStream);
    const lastStream = streamEvents.at(-1);
    expect(lastStream).toBeDefined();
  });

  it('keeps budget feedback before steer text at the completed-tool boundary', async () => {
    const tool = new MockTool({
      name: 'image_tool',
      execute: async () => ({
        llmContent: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: 'AA',
            },
          },
        ],
        returnDisplay: 'image',
      }),
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.YOLO,
      imagePayloadBudgetBytes: 1,
    });
    const { client, turnMessages } = createScriptedAgentClient([
      [toolCallRequestEvent('image_tool', 'call-1'), finishedEvent()],
      [contentEvent('final-response'), finishedEvent()],
    ]);
    const loop = new AgenticLoop({ agentClient: client, config, messageBus });

    const eventsPromise = collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );
    loop.injectSteer('use a smaller image');
    await eventsPromise;

    const turn2Parts = partListUnionToParts(turnMessages[1]);
    const responseIndex = turn2Parts.findIndex(
      (p) => p.type === 'tool_response',
    );
    const feedbackIndex = turn2Parts.findIndex(
      (p) => p.type === 'text' && p.text.includes('image(s) were omitted'),
    );
    const steerIndex = turn2Parts.findIndex(
      (p) => p.type === 'text' && p.text === 'use a smaller image',
    );
    expect(turn2Parts.some((p) => p.type === 'media')).toBe(false);
    expect(responseIndex).toBeGreaterThanOrEqual(0);
    expect(feedbackIndex).toBeGreaterThan(responseIndex);
    expect(steerIndex).toBeGreaterThan(feedbackIndex);
  });

  it('forces one more turn when steer arrives during a final-answer stream (no tool calls)', async () => {
    const toolRegistry = createToolRegistryForTest([]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.YOLO,
    });

    const { client, turnMessages } = createScriptedAgentClient([
      // Turn 1: model responds with text only (no tool calls) and finishes
      [contentEvent('here is my answer'), finishedEvent()],
      // Turn 2: model sees steer text and responds
      [contentEvent('ok, adjusted'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
    });

    const eventsPromise = collectEvents(
      loop,
      'initial question',
      new AbortController().signal,
    );
    // Steer during the first turn's final-answer stream
    loop.injectSteer('wait, also do X');
    await eventsPromise;

    // Without steer, turnMessages would have length 1. With steer, the loop
    // runs one more iteration with just the steer text as the message.
    expect(turnMessages).toHaveLength(2);
    const turn2Parts = partListUnionToParts(turnMessages[1]);
    expect(textParts(turn2Parts)).toContain('wait, also do X');
  });

  it('drains multiple steer messages, joined with newlines, in one continuation', async () => {
    const tool = new MockTool({
      name: 'record_tool',
      execute: async () => ({
        llmContent: 'ok',
        returnDisplay: 'ok',
      }),
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
      [toolCallRequestEvent('record_tool', 'call-1', {}), finishedEvent()],
      [contentEvent('done'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
    });

    const eventsPromise = collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );
    loop.injectSteer('first nudge');
    loop.injectSteer('second nudge');
    await eventsPromise;

    expect(turnMessages).toHaveLength(2);
    const turn2Parts = partListUnionToParts(turnMessages[1]);
    // Both steers are joined with \n and appended as a single text part
    expect(textParts(turn2Parts)).toContain('first nudge\nsecond nudge');
  });

  it('is a no-op when the loop is not running', () => {
    const toolRegistry = createToolRegistryForTest([]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.YOLO,
    });

    const { client } = createScriptedAgentClient([
      [contentEvent('done'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
    });

    // Should not throw — just silently drops the steer
    expect(() => loop.injectSteer('should be dropped')).not.toThrow();
  });

  it('does not interfere with normal multi-turn loops when no steer is injected', async () => {
    const tool = new MockTool({
      name: 'record_tool',
      execute: async () => ({
        llmContent: 'ok',
        returnDisplay: 'ok',
      }),
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
      [toolCallRequestEvent('record_tool', 'call-1', {}), finishedEvent()],
      [contentEvent('final answer'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    // Two turns, no extra steer text in turn 2
    expect(turnMessages).toHaveLength(2);
    const turn2Parts = partListUnionToParts(turnMessages[1]);
    expect(hasFunctionResponsePart(turn2Parts)).toBe(true);
    // No steer text should be present
    expect(textParts(turn2Parts)).toHaveLength(0);
    // Verify tools_complete event fired
    expect(events.filter(isToolsComplete)).toHaveLength(1);
  });
});
