/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20260825-SHELLMEM.P02
 * @requirement REQ-3329-05
 */

import { describe, expect, it, vi } from 'bun:test';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import {
  PolicyDecision,
  type PolicyEngineConfig,
} from '@vybestack/llxprt-code-core/policy/types.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools/tools/tool-registry.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from '@vybestack/llxprt-code-tools/tools/tools.js';
import type { IToolMessageBus } from '@vybestack/llxprt-code-tools';
import { CoreToolScheduler } from './coreToolScheduler.js';

interface CountingParams {
  readonly value: number;
}

/** @plan PLAN-20260825-SHELLMEM.P02 @requirement REQ-3329-05 */
class CountingInvocation extends BaseToolInvocation<
  CountingParams,
  ToolResult
> {
  constructor(
    params: CountingParams,
    messageBus: IToolMessageBus | undefined,
    private readonly recordExecution: () => void,
  ) {
    super(params, messageBus, 'counting_tool', 'Counting Tool');
  }

  getDescription(): string {
    return `Count ${this.params.value}`;
  }

  async execute(): Promise<ToolResult> {
    this.recordExecution();
    return {
      llmContent: `counted ${this.params.value}`,
      returnDisplay: `counted ${this.params.value}`,
    };
  }
}

/** @plan PLAN-20260825-SHELLMEM.P02 @requirement REQ-3329-05 */
class CountingTool extends BaseDeclarativeTool<CountingParams, ToolResult> {
  private executionCount = 0;

  constructor(messageBus: IToolMessageBus) {
    super(
      'counting_tool',
      'Counting Tool',
      'Counts scheduler executions',
      Kind.Other,
      {
        type: 'object',
        properties: { value: { type: 'number' } },
        required: ['value'],
      },
      false,
      false,
      messageBus,
    );
  }

  get executions(): number {
    return this.executionCount;
  }

  protected createInvocation(
    params: CountingParams,
    messageBus?: IToolMessageBus,
  ): ToolInvocation<CountingParams, ToolResult> {
    return new CountingInvocation(params, messageBus, () => {
      this.executionCount += 1;
    });
  }
}

interface SchedulerHarness {
  readonly scheduler: CoreToolScheduler;
  readonly tool: CountingTool;
}

/** @plan PLAN-20260825-SHELLMEM.P02 @requirement REQ-3329-05 */
function createHarness(): SchedulerHarness {
  const policyConfig: PolicyEngineConfig = {
    rules: [
      {
        decision: PolicyDecision.ALLOW,
        priority: 1,
        modes: [ApprovalMode.YOLO],
        source: 'scheduler-cap-test',
      },
    ],
    defaultDecision: PolicyDecision.ASK_USER,
  };
  const policyEngine = new PolicyEngine(policyConfig);
  policyEngine.setApprovalMode(ApprovalMode.YOLO);
  const messageBus = new MessageBus(policyEngine, false);
  const messageBusAdapter = new CoreMessageBusAdapter(messageBus);
  const toolRegistry = new ToolRegistry(
    {
      getEphemeralSettings: () => ({}),
      getCoreTools: () => [],
      getExcludeTools: () => [],
    },
    messageBusAdapter,
  );
  const tool = new CountingTool(messageBusAdapter);
  toolRegistry.registerTool(tool);

  const config = {
    getSessionId: () => 'seen-call-id-cap-test',
    getUsageStatisticsEnabled: () => false,
    getDebugMode: () => false,
    isInteractive: () => false,
    getApprovalMode: () => ApprovalMode.YOLO,
    getEphemeralSettings: () => ({
      'tool-output-max-tokens': 50_000,
      'tool-output-max-items': 50,
    }),
    getAllowedTools: () => [],
    getContentGeneratorConfig: () => ({ model: 'test-model' }),
    getToolRegistry: () => toolRegistry,
    getMessageBus: () => messageBus,
    getEnableHooks: () => false,
    getHookSystem: () => null,
    getPolicyEngine: () => policyEngine,
    getModel: () => 'test-model',
  } as unknown as Config;

  return {
    tool,
    scheduler: new CoreToolScheduler({
      config,
      messageBus,
      toolRegistry,
      getPreferredEditor: () => undefined,
      onEditorClose: vi.fn(),
      toolContextInteractiveMode: false,
    }),
  };
}

/** @plan PLAN-20260825-SHELLMEM.P02 @requirement REQ-3329-05 */
function request(callId: string, value: number) {
  return {
    callId,
    name: 'counting_tool',
    args: { value },
    isClientInitiated: false,
    prompt_id: 'seen-call-id-cap-test',
  };
}

/** @plan PLAN-20260825-SHELLMEM.P02 @requirement REQ-3329-05 */
describe('CoreToolScheduler recent call ID deduplication', () => {
  /** @plan PLAN-20260825-SHELLMEM.P02 @requirement REQ-3329-05 */
  it('drops a duplicate call ID within one batch', async () => {
    const { scheduler, tool } = createHarness();

    await scheduler.schedule(
      [request('duplicate', 1), request('duplicate', 2)],
      new AbortController().signal,
    );

    expect(tool.executions).toBe(1);
    scheduler.dispose();
  });

  /** @plan PLAN-20260825-SHELLMEM.P02 @requirement REQ-3329-05 */
  it('allows a call ID to run again after it leaves the 1024-ID window', async () => {
    const { scheduler, tool } = createHarness();
    const initialBatch = Array.from({ length: 1_025 }, (_, index) =>
      request(`call-${index}`, index),
    );

    await scheduler.schedule(initialBatch, new AbortController().signal);

    // The oldest retained ID (call-1) is still inside the window and must
    // remain suppressed; only call-0 fell out.
    await scheduler.schedule(
      request('call-1', 2_001),
      new AbortController().signal,
    );
    expect(tool.executions).toBe(1_025);

    await scheduler.schedule(
      request('call-0', 2_000),
      new AbortController().signal,
    );

    expect(tool.executions).toBe(1_026);
    scheduler.dispose();
  });

  /** @plan PLAN-20260825-SHELLMEM.P02 @requirement REQ-3329-05 */
  it('drops an in-batch duplicate even when the window evicts its first copy', async () => {
    const { scheduler, tool } = createHarness();
    // call-A, then 1024 distinct IDs (evicting call-A from the 1024-entry
    // window mid-batch), then call-A again: both copies sit in ONE batch,
    // so the duplicate must still be dropped.
    const batch = [
      request('call-A', 0),
      ...Array.from({ length: 1_024 }, (_, index) =>
        request(`fill-${index}`, index + 1),
      ),
      request('call-A', 2_000),
    ];

    await scheduler.schedule(batch, new AbortController().signal);

    expect(tool.executions).toBe(1_025);
    scheduler.dispose();
  });
});
