/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { OutputObject } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import type {
  IContent,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ToolRegistry } from '@vybestack/llxprt-code-tools/tools/tool-registry.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolResult,
} from '@vybestack/llxprt-code-tools/tools/tools.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import { assembleSchedulerOwner } from '../../session/assembleSchedulerOwner.js';
import { executeToolCall } from '../nonInteractiveToolExecutor.js';
import { createToolExecutionConfig } from '../subagentRuntimeSetup.js';
import { processFunctionCalls } from '../subagentToolProcessing.js';
import { createStatelessRuntimeBundle } from './subagent-test-helpers.js';

class DivideTool extends BaseDeclarativeTool<{ divisor: number }, ToolResult> {
  constructor() {
    super('divide', 'Divide', 'Divide one by a number', Kind.Think, {
      type: 'object',
      properties: { divisor: { type: 'number' } },
      required: ['divisor'],
    });
  }

  protected createInvocation(params: {
    divisor: number;
  }): DivideToolInvocation {
    return new DivideToolInvocation(params, this.messageBus, this.name);
  }
}

class DivideToolInvocation extends BaseToolInvocation<
  { divisor: number },
  ToolResult
> {
  override getDescription(): string {
    return 'Divide one by a number';
  }

  override async execute(): Promise<ToolResult> {
    if (this.params.divisor === 0) {
      return {
        llmContent: 'Cannot divide by zero',
        returnDisplay: 'Cannot divide by zero',
        error: {
          message: 'Cannot divide by zero',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
    const result = String(1 / this.params.divisor);
    return { llmContent: result, returnDisplay: result };
  }
}

/**
 * Runs a call through the real non-interactive processing and scheduler paths.
 * @param call Tool request to dispatch against the divide-tool fixture.
 * @param output Run output whose recovery state is updated by processing.
 * @returns Model-facing response content.
 */
export async function dispatch(
  call: ToolCallBlock,
  output: OutputObject,
): Promise<IContent[]> {
  const config = new Config({
    sessionId: crypto.randomUUID(),
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'test-model',
    approvalMode: ApprovalMode.YOLO,
  });
  const policy = new PolicyEngine({});
  policy.setApprovalMode(ApprovalMode.YOLO);
  const messageBus = new MessageBus(policy, false);
  const registry = new ToolRegistry(
    config,
    new CoreMessageBusAdapter(messageBus),
    assembleTaskSchemaPolicy(new SettingsService()),
  );
  registry.registerTool(new DivideTool());
  const toolExecutorContext = createToolExecutionConfig(
    createStatelessRuntimeBundle().telemetryRoot,
    () =>
      createStatelessRuntimeBundle().runtimeContext.readToolExecutionPolicy(),
    () => createStatelessRuntimeBundle().runtimeContext.state.sessionId,
    registry,
  );
  // The processing context object is the scheduler registry owner for this
  // run: executeNonInteractiveTool acquires the 'subagent' entry keyed on it,
  // so the release below pairs on the same object and purpose.
  const processingContext = {
    output,
    subagentId: 'flag-test',
    logger: new DebugLogger('flag-test'),
    imagePayloadBudgetBytes: config.getImagePayloadBudgetBytes(),
    executeToolCall: (
      request: Parameters<typeof executeToolCall>[1],
      signal: AbortSignal,
    ) =>
      executeToolCall(
        (callbacks) =>
          assembleSchedulerOwner('flag-test', {
            telemetry: toolExecutorContext.telemetry,
            config,
            messageBus,
            toolRegistry: registry,
            readApprovalMode: () => config.getApprovalMode(),
            getToolGovernance: () => toolExecutorContext.readGovernance(),
            readExecutionPolicy: () =>
              toolExecutorContext.readExecutionPolicy(),
            toolContextInteractiveMode: false,
            ...callbacks,
          }),
        request,
        signal,
      ),
  };
  try {
    return await processFunctionCalls(
      [call],
      new AbortController(),
      'flag-test',
      processingContext,
    );
  } finally {
    await config.dispose();
  }
}
