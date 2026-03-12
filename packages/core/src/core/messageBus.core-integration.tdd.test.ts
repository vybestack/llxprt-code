/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreToolScheduler } from './coreToolScheduler.js';
import {
  ApprovalMode,
  Config,
  type ConfigParameters,
  ToolRegistry,
} from '../index.js';
import { IdeClient } from '../ide/ide-client.js';
import { PolicyDecision } from '../policy/types.js';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolCallConfirmationDetails,
  type ToolResult,
} from '../tools/tools.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type ToolConfirmationRequest,
  type ToolPolicyRejection,
} from '../confirmation-bus/types.js';
import { ToolConfirmationOutcome } from '../tools/tool-confirmation-types.js';

const baseConfigParams: ConfigParameters = {
  cwd: '/tmp',
  model: 'test-model',
  embeddingModel: 'test-embedding-model',
  sandbox: undefined,
  targetDir: '/test/dir',
  debugMode: false,
  userMemory: '',
  llxprtMdFileCount: 0,
  approvalMode: ApprovalMode.DEFAULT,
  sessionId: 'phase-04-scheduler-session',
  ideClient: IdeClient.getInstance(false),
};

interface Phase04Params {
  payload: string;
}

class Phase04BusAwareInvocation extends BaseToolInvocation<
  Phase04Params,
  ToolResult
> {
  constructor(params: Phase04Params, messageBus: MessageBus) {
    super(params, messageBus, Phase04BusAwareTool.Name, 'Phase04BusAwareTool');
  }

  override async shouldConfirmExecute(
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    const decision = await this.getMessageBusDecision(abortSignal);
    if (decision === 'ALLOW') {
      return false;
    }
    if (decision === 'DENY') {
      throw new Error('Tool execution denied by policy.');
    }

    return {
      type: 'exec',
      title: 'Phase 04 scheduler confirmation',
      command: 'phase04_bus_aware_tool',
      rootCommand: 'phase04_bus_aware_tool',
      onConfirm: async () => {},
    };
  }

  async execute(): Promise<ToolResult> {
    return {
      llmContent: 'phase04 executed',
      returnDisplay: 'phase04 executed',
    };
  }

  getDescription(): string {
    return `Phase04 invocation for ${this.params.payload}`;
  }
}

class Phase04BusAwareTool extends BaseDeclarativeTool<
  Phase04Params,
  ToolResult
> {
  static readonly Name = 'phase04_bus_aware_tool';

  constructor(messageBus?: MessageBus) {
    super(
      Phase04BusAwareTool.Name,
      'Phase04BusAwareTool',
      'Phase 04 MessageBus integration fixture tool',
      Kind.Other,
      {
        type: 'object',
        properties: {
          payload: {
            type: 'string',
          },
        },
        required: ['payload'],
      },
      false,
      false,
      messageBus,
    );
  }

  protected createInvocation(
    params: Phase04Params,
    messageBus: MessageBus,
  ): BaseToolInvocation<Phase04Params, ToolResult> {
    return new Phase04BusAwareInvocation(params, messageBus);
  }
}

describe('MessageBus core integration TDD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  it('uses the same injected MessageBus across scheduler, registry, and invocation paths', async () => {
    /**
     * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P04
     * @requirement REQ-D01-001.1
     * @requirement REQ-D01-001.2
     * @requirement REQ-D01-004.1
     * @requirement REQ-D01-004.2
     * @pseudocode lines 46-55
     * @matrix scheduler=CoreToolScheduler registry=explicit invocation=bus-aware ASK_USER|DENY
     */
    const config = new Config(baseConfigParams);
    const decoyBus = new MessageBus(config.getPolicyEngine(), false);
    const injectedBus = new MessageBus(config.getPolicyEngine(), false);
    const injectedRegistry = new ToolRegistry(config, injectedBus);
    injectedRegistry.registerTool(new Phase04BusAwareTool(injectedBus));

    const injectedConfirmationRequests: ToolConfirmationRequest[] = [];
    const decoyConfirmationRequests: ToolConfirmationRequest[] = [];
    const injectedPolicyRejections: ToolPolicyRejection[] = [];
    const decoyPolicyRejections: ToolPolicyRejection[] = [];

    injectedBus.subscribe(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (message) => {
        const request = message as ToolConfirmationRequest;
        injectedConfirmationRequests.push(request);
        injectedBus.respondToConfirmation(
          request.correlationId,
          ToolConfirmationOutcome.ProceedOnce,
        );
      },
    );
    decoyBus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, (message) => {
      const request = message as ToolConfirmationRequest;
      decoyConfirmationRequests.push(request);
      decoyBus.respondToConfirmation(
        request.correlationId,
        ToolConfirmationOutcome.ProceedOnce,
      );
    });
    injectedBus.subscribe(MessageBusType.TOOL_POLICY_REJECTION, (message) => {
      injectedPolicyRejections.push(message as ToolPolicyRejection);
    });
    decoyBus.subscribe(MessageBusType.TOOL_POLICY_REJECTION, (message) => {
      decoyPolicyRejections.push(message as ToolPolicyRejection);
    });

    vi.spyOn(config.getPolicyEngine(), 'evaluate')
      .mockReturnValueOnce(PolicyDecision.ASK_USER)
      .mockReturnValueOnce(PolicyDecision.DENY);

    const schedulerComplete = vi.fn();
    const scheduler = new CoreToolScheduler({
      config,
      messageBus: injectedBus,
      toolRegistry: injectedRegistry,
      onAllToolCallsComplete: schedulerComplete,
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    await scheduler.schedule(
      [
        {
          callId: 'phase04-ask-user',
          name: Phase04BusAwareTool.Name,
          args: { payload: 'ask-user' },
          isClientInitiated: false,
          prompt_id: 'phase04-ask-user',
        },
      ],
      new AbortController().signal,
    );

    const deniedComplete = vi.fn();
    const deniedScheduler = new CoreToolScheduler({
      config,
      messageBus: injectedBus,
      toolRegistry: injectedRegistry,
      onAllToolCallsComplete: deniedComplete,
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    await deniedScheduler.schedule(
      [
        {
          callId: 'phase04-deny',
          name: Phase04BusAwareTool.Name,
          args: { payload: 'deny' },
          isClientInitiated: false,
          prompt_id: 'phase04-deny',
        },
      ],
      new AbortController().signal,
    );

    expect(decoyConfirmationRequests).toHaveLength(0);
    expect(injectedConfirmationRequests).toHaveLength(1);
    expect(injectedConfirmationRequests[0].toolCall.name).toBe(
      Phase04BusAwareTool.Name,
    );
    expect(injectedPolicyRejections).toHaveLength(1);
    expect(injectedPolicyRejections[0].toolCall.name).toBe(
      Phase04BusAwareTool.Name,
    );
    expect(decoyPolicyRejections).toHaveLength(0);
  });
});
