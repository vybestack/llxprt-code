/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Config,
  type ConfigParameters,
  ApprovalMode,
} from '../config/config.js';
import { ToolRegistry } from './tool-registry.js';
import { IdeClient } from '../ide/ide-client.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolCallConfirmationDetails,
  type ToolResult,
} from './tools.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type ToolConfirmationRequest,
} from '../confirmation-bus/types.js';
import { ToolConfirmationOutcome } from './tool-confirmation-types.js';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';

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
  sessionId: 'phase-04-registry-session',
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
    super(
      params,
      messageBus,
      Phase04RegistryBusAwareTool.Name,
      'Phase04RegistryBusAwareTool',
    );
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
      title: 'Phase 04 registry confirmation',
      command: 'phase04_registry_bus_aware_tool',
      rootCommand: 'phase04_registry_bus_aware_tool',
      onConfirm: async () => {},
    };
  }

  async execute(): Promise<ToolResult> {
    return {
      llmContent: 'phase04 registry executed',
      returnDisplay: 'phase04 registry executed',
    };
  }

  getDescription(): string {
    return `Phase04 registry invocation for ${this.params.payload}`;
  }
}

class Phase04RegistryBusAwareTool extends BaseDeclarativeTool<
  Phase04Params,
  ToolResult
> {
  static readonly Name = 'phase04_registry_bus_aware_tool';

  constructor(messageBus?: MessageBus) {
    super(
      Phase04RegistryBusAwareTool.Name,
      'Phase04RegistryBusAwareTool',
      'Phase 04 registry MessageBus integration fixture tool',
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

describe('ToolRegistry MessageBus integration TDD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  it('proves direct registry-built invocations use the injected MessageBus rather than Config-owned bus', async () => {
    /**
     * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P04
     * @requirement REQ-D01-001.2
     * @requirement REQ-D01-004.1
     * @pseudocode lines 46-55
     * @matrix registry=explicit invocation=bus-aware path=direct-build
     */
    const config = new Config(baseConfigParams);
    const decoyBus = new MessageBus(config.getPolicyEngine(), false);
    const injectedBus = new MessageBus(config.getPolicyEngine(), false);
    const registry = new ToolRegistry(config, injectedBus);
    registry.registerTool(new Phase04RegistryBusAwareTool(injectedBus));

    const observedInjectedRequests: ToolConfirmationRequest[] = [];
    const observedDecoyRequests: ToolConfirmationRequest[] = [];

    injectedBus.subscribe(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (message) => {
        const request = message as ToolConfirmationRequest;
        observedInjectedRequests.push(request);
        injectedBus.respondToConfirmation(
          request.correlationId,
          ToolConfirmationOutcome.ProceedOnce,
        );
      },
    );
    decoyBus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, (message) => {
      const request = message as ToolConfirmationRequest;
      observedDecoyRequests.push(request);
      decoyBus.respondToConfirmation(
        request.correlationId,
        ToolConfirmationOutcome.ProceedOnce,
      );
    });

    const invocation = registry
      .getTool(Phase04RegistryBusAwareTool.Name)
      ?.build({
        payload: 'registry-direct',
      });
    const confirmation =
      invocation != null
        ? await invocation.shouldConfirmExecute(new AbortController().signal)
        : false;

    expect(observedInjectedRequests).toHaveLength(1);
    expect(observedInjectedRequests[0].toolCall.name).toBe(
      Phase04RegistryBusAwareTool.Name,
    );
    expect(observedDecoyRequests).toHaveLength(0);
    expect(confirmation).toBe(false);
  });
});
