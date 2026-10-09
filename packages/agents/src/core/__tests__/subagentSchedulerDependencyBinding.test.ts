/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration coverage for the #2615 scheduler-registry dependency-binding
 * fix. Each subagent acquires its scheduler through its own
 * createToolExecutionConfig/createSchedulerConfig facade over a shared
 * foreground Config, and the registry must hand the PRODUCTION
 * CoreToolScheduler the messageBus and toolRegistry of the acquisition that
 * starts each entry. Before the fix every entry bound the first caller's
 * deps, so a later owner's confirmation bus and tool registry were wrong.
 */

import { describe, it, expect } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SchedulerCallbacks } from '@vybestack/llxprt-code-core/config/config.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type ToolConfirmationRequest,
  type ToolConfirmationResponse,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type { ToolSchedulerFactoryOptions } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import type { SchedulerHandle } from '@vybestack/llxprt-code-core/session/sessionExecutionServices.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools/types/tool-confirmation-types.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { CoreToolScheduler } from '../coreToolScheduler.js';
import type { ToolCall } from '../coreToolScheduler.js';
import {
  createSchedulerConfig,
  createToolExecutionConfig,
} from '../subagentRuntimeSetup.js';
import { createStatelessRuntimeBundle } from './subagent-test-helpers.js';

interface ForegroundFixture {
  config: Config;
  constructionOptions: ToolSchedulerFactoryOptions[];
  dispose: () => Promise<void>;
}

/**
 * One foreground Config whose toolSchedulerFactory records the options of
 * every construction before delegating to the production CoreToolScheduler.
 */
function makeForegroundFixture(): ForegroundFixture {
  const constructionOptions: ToolSchedulerFactoryOptions[] = [];
  const config = new Config({
    sessionId: `dep-binding-${crypto.randomUUID()}`,
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'test-model',
    // The behavioral test drives a real pending confirmation, and the
    // confirmation prompt setup throws for non-interactive configs.
    interactive: true,
    toolSchedulerFactory: (options) => {
      constructionOptions.push(options);
      return new CoreToolScheduler(options);
    },
  });
  return {
    config,
    constructionOptions,
    dispose: () => config.dispose(),
  };
}

/**
 * Registry stub mirroring the approval-outcomes test shape. The happy path
 * only needs getTool; the rest of the surface keeps the cast honest.
 */
function makeRegistryStub(tool: MockTool): ToolRegistry {
  const toolsByName = new Map([[tool.name, tool]]);
  return {
    getTool: (name: string) => toolsByName.get(name),
    getFunctionDeclarations: () => [],
    tools: new Map(),
    discovery: {},
    registerTool: () => {},
    getToolByName: (name: string) => toolsByName.get(name),
    getToolByDisplayName: (name: string) => toolsByName.get(name),
    getTools: () => [],
    discoverTools: async () => {},
    getAllTools: () => [tool],
    getToolsByServer: () => [],
  } as unknown as ToolRegistry;
}

function makeConfirmableTool(name: string, executed: string[]): MockTool {
  return new MockTool({
    name,
    shouldConfirmExecute: async () => ({
      type: 'exec',
      title: `Confirm ${name}`,
      command: name,
      rootCommand: name,
      rootCommands: [name],
      onConfirm: async () => {},
    }),
    execute: async () => {
      executed.push(name);
      return {
        llmContent: `${name} ran`,
        returnDisplay: `${name} ran`,
      };
    },
  });
}

interface OwnerFacade {
  schedulerConfig: Config;
  owner: object;
  acquire: (callbacks: SchedulerCallbacks) => Promise<SchedulerHandle>;
  dispose: () => void;
}

/**
 * Acquisition facade over the shared foreground Config: the same
 * createToolExecutionConfig then createSchedulerConfig layering the subagent
 * runtime uses, carrying this owner's messageBus and toolRegistry defaults.
 */
function makeOwnerFacade(
  foregroundConfig: Config,
  messageBus: MessageBus,
  toolRegistry: ToolRegistry,
): OwnerFacade {
  const runtimeBundle = createStatelessRuntimeBundle();
  const toolExecutorContext = createToolExecutionConfig(
    runtimeBundle,
    toolRegistry,
    foregroundConfig,
    messageBus,
  );
  const schedulerConfig = createSchedulerConfig(
    toolExecutorContext,
    foregroundConfig,
  );
  const owner = { owner: 'scheduler-acquisition-owner' };
  return {
    schedulerConfig,
    owner,
    acquire: (callbacks) =>
      schedulerConfig.getOrCreateScheduler(owner, 'subagent', callbacks),
    dispose: () => {
      schedulerConfig.disposeScheduler(owner, 'subagent');
    },
  };
}

interface StatusLog {
  callbacks: SchedulerCallbacks;
  latest: (callId: string) => ToolCall['status'] | undefined;
}

function makeStatusLog(): StatusLog {
  const latestByCallId = new Map<string, ToolCall['status']>();
  return {
    callbacks: {
      onToolCallsUpdate: (calls: ToolCall[]) => {
        for (const call of calls) {
          latestByCallId.set(call.request.callId, call.status);
        }
      },
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    },
    latest: (callId) => latestByCallId.get(callId),
  };
}

async function waitForStatus(
  statusLog: StatusLog,
  callId: string,
  status: ToolCall['status'],
): Promise<void> {
  await waitFor(() => {
    const current = statusLog.latest(callId);
    if (current !== status) {
      throw new Error(
        `Waiting for call "${callId}" to reach "${status}", saw "${current ?? 'nothing'}"`,
      );
    }
  });
}

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setImmediate(resolve));
}

describe('subagent scheduler dependency binding (#2615 registry fix)', () => {
  it('constructs each owner scheduler with the messageBus and toolRegistry of its own acquisition', async () => {
    const foreground = makeForegroundFixture();
    const busB = new MessageBus();
    const registryB = { sentinel: 'registry-b' } as unknown as ToolRegistry;
    const busA = new MessageBus();
    const registryA = { sentinel: 'registry-a' } as unknown as ToolRegistry;

    // B acquires first: before the fix both entries bound the first
    // caller's deps, so A must not inherit B's bus or registry.
    const facadeB = makeOwnerFacade(foreground.config, busB, registryB);
    const facadeA = makeOwnerFacade(foreground.config, busA, registryA);
    const handleB = await facadeB.acquire(makeStatusLog().callbacks);
    const handleA = await facadeA.acquire(makeStatusLog().callbacks);

    expect(foreground.constructionOptions).toHaveLength(2);
    // The entry B started was built from B's acquisition deps.
    expect(foreground.constructionOptions[0]?.messageBus).toBe(busB);
    expect(foreground.constructionOptions[0]?.toolRegistry).toBe(registryB);
    // The entry A started was built from A's acquisition deps, not B's.
    expect(foreground.constructionOptions[1]?.messageBus).toBe(busA);
    expect(foreground.constructionOptions[1]?.toolRegistry).toBe(registryA);
    expect(foreground.constructionOptions[1]?.config).toBe(foreground.config);
    // Distinct owners never share a scheduler instance.
    expect(handleA).not.toBe(handleB);

    facadeA.dispose();
    facadeB.dispose();
    await foreground.dispose();
  });

  it('binds each scheduler confirmation flow to its own acquisition bus', async () => {
    const foreground = makeForegroundFixture();
    const executedA: string[] = [];
    const toolA = makeConfirmableTool('confirm_tool_a', executedA);
    const registryA = makeRegistryStub(toolA);
    const busA = new MessageBus(foreground.config.getPolicyEngine(), false);
    const busB = new MessageBus(foreground.config.getPolicyEngine(), false);

    // B first again, so a pre-fix first-caller dep binding would wire A's
    // confirmation coordinator onto B's bus.
    const facadeB = makeOwnerFacade(
      foreground.config,
      busB,
      makeRegistryStub(makeConfirmableTool('confirm_tool_b', [])),
    );
    const facadeA = makeOwnerFacade(foreground.config, busA, registryA);
    await facadeB.acquire(makeStatusLog().callbacks);
    const statusLogA = makeStatusLog();
    const handleA = await facadeA.acquire(statusLogA.callbacks);

    expect(foreground.constructionOptions[1]?.messageBus).toBe(busA);
    expect(foreground.constructionOptions[1]?.toolRegistry).toBe(registryA);

    const requestsOnA: ToolConfirmationRequest[] = [];
    const requestsOnB: ToolConfirmationRequest[] = [];
    const unsubscribeA = busA.subscribe<ToolConfirmationRequest>(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (message) => {
        requestsOnA.push(message);
      },
    );
    const unsubscribeB = busB.subscribe<ToolConfirmationRequest>(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (message) => {
        requestsOnB.push(message);
      },
    );

    try {
      await handleA.schedule(
        [
          {
            callId: 'call-a',
            name: 'confirm_tool_a',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-a',
          },
        ],
        new AbortController().signal,
      );
      await waitForStatus(statusLogA, 'call-a', 'awaiting_approval');

      // The awaiting scheduler published its confirmation request on its
      // own construction bus, never on the other owner's bus.
      expect(requestsOnB).toStrictEqual([]);
      const correlationId = requestsOnA[requestsOnA.length - 1]?.correlationId;
      expect(correlationId).toBeDefined();

      // The identical ProceedOnce response on the foreign bus is a no-op:
      // A's call keeps awaiting and the tool never executes.
      busB.publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId,
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);
      await flushAsyncWork();
      expect(statusLogA.latest('call-a')).toBe('awaiting_approval');
      expect(executedA).toStrictEqual([]);

      // The same response on A's own bus resolves the confirmation and the
      // call runs to success.
      busA.publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId,
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);
      await waitForStatus(statusLogA, 'call-a', 'success');
      expect(executedA).toStrictEqual(['confirm_tool_a']);
    } finally {
      unsubscribeA();
      unsubscribeB();
      facadeA.dispose();
      facadeB.dispose();
      await foreground.dispose();
    }
  });
});
