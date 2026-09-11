/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { OutputObject } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type {
  IContent,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  BaseTool,
  Kind,
  type ToolResult,
} from '@vybestack/llxprt-code-tools/tools/tools.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools/tools/tool-registry.js';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import { createToolExecutionConfig } from './subagentRuntimeSetup.js';
import { createStatelessRuntimeBundle } from './subagent-test-helpers.js';
import { processFunctionCalls } from './subagentToolProcessing.js';

class DivideTool extends BaseTool<{ divisor: number }, ToolResult> {
  constructor() {
    super('divide', 'Divide', 'Divide one by a number', Kind.Think, {
      type: 'object',
      properties: { divisor: { type: 'number' } },
      required: ['divisor'],
    });
  }

  override getDescription(): string {
    return 'Divide one by a number';
  }

  override async execute(params: { divisor: number }): Promise<ToolResult> {
    if (params.divisor === 0) {
      return {
        llmContent: 'Cannot divide by zero',
        returnDisplay: 'Cannot divide by zero',
        error: {
          message: 'Cannot divide by zero',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
    const result = String(1 / params.divisor);
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
    toolSchedulerFactory: (options) => new CoreToolScheduler(options),
  });
  const policy = new PolicyEngine({});
  policy.setApprovalMode(ApprovalMode.YOLO);
  const messageBus = new MessageBus(policy, false);
  const registry = new ToolRegistry(
    config,
    new CoreMessageBusAdapter(messageBus),
  );
  registry.registerTool(new DivideTool());
  const toolExecutorContext = createToolExecutionConfig(
    createStatelessRuntimeBundle(),
    registry,
    config,
    messageBus,
  );
  try {
    return await processFunctionCalls(
      [call],
      new AbortController(),
      'flag-test',
      {
        output,
        subagentId: 'flag-test',
        logger: new DebugLogger('flag-test'),
        toolExecutorContext,
        config,
        messageBus,
      },
    );
  } finally {
    // disposeScheduler is synchronous (void); guard only against a sync throw
    // so config.dispose() always runs.
    try {
      toolExecutorContext.disposeScheduler(toolExecutorContext.getSessionId());
    } finally {
      await config.dispose();
    }
  }
}
