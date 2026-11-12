/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036: a terminal refusal must not run tool calls that the refused
 * attempt carried. Real AgenticLoop, real CoreToolScheduler and MessageBus;
 * the only stub is the scripted model stream.
 */

import { describe, it, expect } from 'bun:test';
import { bindSchedulerOwner } from '../../../session/assembleSchedulerOwner.js';
import { bindTurnModel } from '../../../session/bind-turn-model.js';
import { TurnToolExecutionOwner } from '../../../session/turn-tool-execution-owner.js';
import { CoreToolScheduler } from '../../coreToolScheduler.js';
import { AgenticLoop } from '../AgenticLoop.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { AgentEventType } from '@vybestack/llxprt-code-core/core/turn.js';
import type { ServerAgentStreamEvent } from '../../turn.js';
import {
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  createAskPolicyEngine,
  collectEvents,
  isToolsComplete,
  toolCallRequestEvent,
} from './agenticLoop-test-helpers.js';

function finishedWith(reason: 'refusal' | 'stop'): ServerAgentStreamEvent {
  return { type: AgentEventType.Finished, value: { reason } };
}

async function runWithEchoTool(
  script: ServerAgentStreamEvent[],
): Promise<{ executed: number; toolsComplete: boolean; turns: number }> {
  let executed = 0;
  const echoTool = new MockTool({
    name: 'echo',
    execute: async () => {
      executed++;
      return { llmContent: 'echoed', returnDisplay: 'echoed' };
    },
  });
  const toolRegistry = createToolRegistryForTest([echoTool]);
  const messageBus = new MessageBus(createAskPolicyEngine(), false);
  const { config, settingsOwner } = createTestConfig({
    messageBus,
    toolRegistry,
    policyEngine: createAskPolicyEngine(),
    interactive: true,
    approvalMode: ApprovalMode.YOLO,
  });
  const { client, turnMessages } = createScriptedAgentClient([script]);
  const loop = new AgenticLoop({
    config,
    interactiveMode: true,
    ...bindTurnModel(client),
    tools: new TurnToolExecutionOwner(
      messageBus,
      undefined,
      bindSchedulerOwner(
        config,
        messageBus,
        config.isInteractive(),
        toolRegistry,
        (options) => new CoreToolScheduler(options),
        () => settingsOwner.readToolExecutionPolicy(),
        () => settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
        undefined,
        settingsOwner.telemetry,
      ),
    ),
  });
  const events = await collectEvents(
    loop,
    [{ type: 'text', text: 'use the tool' }],
    new AbortController().signal,
  );
  return {
    executed,
    toolsComplete: events.some(isToolsComplete),
    turns: turnMessages.length,
  };
}

describe('AgenticLoop terminal refusal (issue #4036)', () => {
  it('does not run tool calls carried by a refused attempt', async () => {
    const run = await runWithEchoTool([
      toolCallRequestEvent('echo', 'echo-1', { text: 'hi' }),
      finishedWith('refusal'),
    ]);

    expect(run).toStrictEqual({ executed: 0, toolsComplete: false, turns: 1 });
  });

  it('still runs the tool calls of a normally finished attempt', async () => {
    const run = await runWithEchoTool([
      toolCallRequestEvent('echo', 'echo-1', { text: 'hi' }),
      finishedWith('stop'),
    ]);

    expect(run.executed).toBe(1);
    expect(run.toolsComplete).toBe(true);
  });
});
