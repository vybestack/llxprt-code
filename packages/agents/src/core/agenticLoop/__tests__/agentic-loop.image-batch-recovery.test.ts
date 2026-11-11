/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3984: a model that asks for several images in one parallel batch sees
 * the byte-budget feedback, asks again for only what was omitted in a smaller
 * batch, and finishes. The AgenticLoop, CoreToolScheduler, real tool
 * invocation, tool-result conversion and batch admission are production code.
 * The only fixture is the model boundary: a protocol-level client that reads
 * the tool responses the loop sends it and decides its next tool calls from
 * that text, like a provider stream would.
 */

import { describe, expect, it } from 'bun:test';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolResult } from '@vybestack/llxprt-code-tools';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { bindSchedulerOwner } from '../../../session/assembleSchedulerOwner.js';
import { bindTurnModel } from '../../../session/bind-turn-model.js';
import { TurnToolExecutionOwner } from '../../../session/turn-tool-execution-owner.js';
import { CoreToolScheduler } from '../../coreToolScheduler.js';
import { AgenticLoop } from '../AgenticLoop.js';
import {
  collectEvents,
  contentEvent,
  createAllowPolicyEngine,
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  finishedEvent,
  partListUnionToParts,
  toolCallRequestEvent,
  type AgentRequestInput,
  type ServerAgentStreamEvent,
} from './agenticLoop-test-helpers.js';

const IMAGE_CHARACTERS = 4000;
const BATCH_BUDGET_BYTES = 10_000;
const IMAGE_NAMES = ['shot-1', 'shot-2', 'shot-3', 'shot-4'];

interface BatchObservation {
  readonly images: number;
  readonly answeredCalls: readonly string[];
  readonly feedback: string;
}

function observeBatch(request: AgentRequestInput): BatchObservation {
  const parts = partListUnionToParts(request);
  return {
    images: parts.filter((part) => part.type === 'media').length,
    answeredCalls: parts.flatMap((part) =>
      part.type === 'tool_response' ? [part.callId] : [],
    ),
    feedback: parts
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n'),
  };
}

/** Call ids the feedback names as omitted, as the model would read them. */
function omittedCallIds(feedback: string): string[] {
  return [...feedback.matchAll(/call ([\w-]+):/g)].map((match) => match[1]);
}

function imageToolResult(name: string): Pick<ToolResult, 'llmContent'> {
  return {
    llmContent: [
      { text: `${name} loaded` },
      {
        inlineData: {
          mimeType: 'image/png',
          data: name.slice(-1).repeat(IMAGE_CHARACTERS),
        },
      },
    ],
  };
}

/**
 * Model boundary fixture. Turn 0 asks for every image in parallel. Later turns
 * read what the loop sent back: omitted calls named in the budget feedback are
 * requested again as one smaller batch, and the model finishes once nothing is
 * omitted.
 */
function createBatchRecoveryModel(): {
  readonly client: ReturnType<typeof createScriptedAgentClient>['client'];
  readonly observed: BatchObservation[];
  readonly requestedBatches: string[][];
} {
  const { client } = createScriptedAgentClient([]);
  const observed: BatchObservation[] = [];
  const requestedBatches: string[][] = [];
  let turn = 0;
  async function* sendMessageStream(
    request: AgentRequestInput,
    signal: AbortSignal,
  ): AsyncGenerator<ServerAgentStreamEvent> {
    const current = turn;
    turn += 1;
    if (signal.aborted) return;
    if (current === 0) {
      requestedBatches.push(IMAGE_NAMES.map((_, index) => `call-${index + 1}`));
      for (const [index, name] of IMAGE_NAMES.entries()) {
        yield toolCallRequestEvent('read_image', `call-${index + 1}`, { name });
      }
      yield finishedEvent();
      return;
    }
    const batch = observeBatch(request);
    observed.push(batch);
    const omitted = omittedCallIds(batch.feedback);
    if (omitted.length === 0) {
      yield contentEvent('all screenshots read');
      yield finishedEvent();
      return;
    }
    requestedBatches.push(omitted.map((id) => `${id}-again`));
    for (const id of omitted) {
      const name = IMAGE_NAMES[Number(id.replace('call-', '')) - 1];
      yield toolCallRequestEvent('read_image', `${id}-again`, { name });
    }
    yield finishedEvent();
  }
  return {
    client: { ...client, tools: client.tools, sendMessageStream },
    observed,
    requestedBatches,
  };
}

async function runBatchRecovery(): Promise<{
  readonly observed: BatchObservation[];
  readonly requestedBatches: string[][];
  readonly executedNames: string[];
  readonly assistantText: string;
}> {
  const executedNames: string[] = [];
  const tool = new MockTool({
    name: 'read_image',
    execute: async (params) => {
      const name = String(params.name);
      executedNames.push(name);
      return {
        ...imageToolResult(name),
        returnDisplay: `${name} read`,
      };
    },
  });
  const messageBus = new MessageBus(createAllowPolicyEngine(), false);
  const toolRegistry = createToolRegistryForTest([tool]);
  const { config, settingsOwner } = createTestConfig({
    messageBus,
    toolRegistry,
    policyEngine: createAllowPolicyEngine(),
    interactive: false,
    approvalMode: ApprovalMode.YOLO,
    imagePayloadBudgetBytes: BATCH_BUDGET_BYTES,
  });
  const { client, observed, requestedBatches } = createBatchRecoveryModel();

  const events = await collectEvents(
    new AgenticLoop({
      config,
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
          () =>
            settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
          undefined,
          RootTelemetry.prepare({
            enabled: false,
            sessionId: 'issue3984-batch-recovery',
            maxBytes: 1024,
            maxFiles: 1,
          }),
        ),
      ),
    }),
    'read the four screenshots',
    new AbortController().signal,
  );
  const assistantText = events
    .flatMap((event) =>
      event.kind === 'stream' && event.event.type === 'content'
        ? [event.event.value]
        : [],
    )
    .join('');
  return { observed, requestedBatches, executedNames, assistantText };
}

describe('AgenticLoop parallel image batch recovery (issue #3984)', () => {
  it('answers every parallel call, states the byte budget, and admits only what fits', async () => {
    const { observed } = await runBatchRecovery();

    const first = observed[0];
    expect({
      answered: first.answeredCalls,
      images: first.images,
      statesBudget: first.feedback.includes(
        `limit for one tool result batch is ${BATCH_BUDGET_BYTES} bytes`,
      ),
      omitted: omittedCallIds(first.feedback),
    }).toStrictEqual({
      answered: ['call-1', 'call-2', 'call-3', 'call-4'],
      images: 2,
      statesBudget: true,
      omitted: ['call-3', 'call-4'],
    });
  });

  it('lets the model re-read only the omitted images in a smaller batch and finish', async () => {
    const { observed, requestedBatches, executedNames, assistantText } =
      await runBatchRecovery();

    expect({
      requestedBatches,
      retryImages: observed[1].images,
      retryFeedbackFree: omittedCallIds(observed[1].feedback),
      executedNames,
      assistantText,
    }).toStrictEqual({
      requestedBatches: [
        ['call-1', 'call-2', 'call-3', 'call-4'],
        ['call-3-again', 'call-4-again'],
      ],
      retryImages: 2,
      retryFeedbackFree: [],
      executedNames: [...IMAGE_NAMES, 'shot-3', 'shot-4'],
      assistantText: 'all screenshots read',
    });
  });
});
