/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  type ToolCallConfirmationDetails,
  type ToolInvocation,
  type ToolResult,
  Kind,
} from '../tools/tools.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { PolicyDecision } from '../policy/types.js';
import {
  type ModifiableDeclarativeTool,
  type ModifyContext,
} from '../tools/modifiable-tool.js';

type ToolSpy = ReturnType<(typeof vi)['fn']>;

function createTestMessageBus(): MessageBus {
  return new MessageBus(
    new PolicyEngine({
      rules: [],
      defaultDecision: PolicyDecision.ALLOW,
      nonInteractive: false,
    }),
    false,
  );
}

/**
 * Shared execute implementation for mock tool invocations.
 * Used by both MockToolInvocation and MockModifiableToolInvocation.
 */
async function executeMockTool(
  tool: { name: string; executeFn: ToolSpy },
  params: Record<string, unknown>,
  abortSignal: AbortSignal,
  updateOutput?: (output: string) => void,
): Promise<ToolResult> {
  const result = await tool.executeFn(params, abortSignal, updateOutput);
  if (
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    result !== null &&
    result !== undefined &&
    typeof result === 'object' &&
    'llmContent' in result &&
    'returnDisplay' in result
  ) {
    return result as ToolResult;
  }
  return {
    llmContent: `Tool ${tool.name} executed successfully.`,
    returnDisplay: `Tool ${tool.name} executed successfully.`,
  };
}

class MockToolInvocation extends BaseToolInvocation<
  { [key: string]: unknown },
  ToolResult
> {
  constructor(
    private readonly tool: MockTool,
    params: { [key: string]: unknown },
    messageBus: MessageBus,
  ) {
    super(params, messageBus);
  }

  async execute(
    abortSignal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    return executeMockTool(this.tool, this.params, abortSignal, updateOutput);
  }

  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.tool.shouldConfirm) {
      return {
        type: 'exec' as const,
        title: `Confirm ${this.tool.displayName}`,
        command: this.tool.name,
        rootCommand: this.tool.name,
        rootCommands: [this.tool.name],
        onConfirm: async () => {},
      };
    }
    return false;
  }

  getDescription(): string {
    return `A mock tool invocation for ${this.tool.name}`;
  }
}

export class MockTool extends BaseDeclarativeTool<
  { [key: string]: unknown },
  ToolResult
> {
  executeFn: ToolSpy;
  shouldConfirm = false;

  constructor(
    name = 'mock-tool',
    displayName?: string,
    description = 'A mock tool for testing.',
    params = {
      type: 'object',
      properties: { param: { type: 'string' } },
    },
    messageBus: MessageBus = createTestMessageBus(),
  ) {
    super(
      name,
      displayName ?? name,
      description,
      Kind.Other,
      params,
      true,
      false,
      messageBus,
    );
    this.executeFn = vi.fn();
  }

  protected createInvocation(params: {
    [key: string]: unknown;
  }): ToolInvocation<{ [key: string]: unknown }, ToolResult> {
    return new MockToolInvocation(this, params, this.requireMessageBus());
  }
}

export class MockModifiableToolInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    private readonly tool: MockModifiableTool,
    params: Record<string, unknown>,
    messageBus: MessageBus,
  ) {
    super(params, messageBus);
  }

  async execute(
    abortSignal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    return executeMockTool(this.tool, this.params, abortSignal, updateOutput);
  }

  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.tool.shouldConfirm) {
      return {
        type: 'edit',
        title: 'Confirm Mock Tool',
        fileName: 'test.txt',
        filePath: 'test.txt',
        fileDiff: 'diff',
        originalContent: 'originalContent',
        newContent: 'newContent',
        onConfirm: async () => {},
      };
    }
    return false;
  }

  getDescription(): string {
    return `A mock modifiable tool invocation for ${this.tool.name}`;
  }
}

/**
 * Configurable mock modifiable tool for testing.
 */
export class MockModifiableTool
  extends MockTool
  implements ModifiableDeclarativeTool<Record<string, unknown>>
{
  constructor(
    name = 'mockModifiableTool',
    messageBus: MessageBus = createTestMessageBus(),
  ) {
    super(name, undefined, undefined, undefined, messageBus);
    this.shouldConfirm = true;
  }

  getModifyContext(
    _abortSignal: AbortSignal,
  ): ModifyContext<Record<string, unknown>> {
    return {
      getFilePath: () => 'test.txt',
      getCurrentContent: async () => 'old content',
      getProposedContent: async () => 'new content',
      createUpdatedParams: (
        _oldContent: string,
        modifiedProposedContent: string,
        _originalParams: Record<string, unknown>,
      ) => ({ newContent: modifiedProposedContent }),
    };
  }

  protected override createInvocation(
    params: Record<string, unknown>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    return new MockModifiableToolInvocation(
      this,
      params,
      this.requireMessageBus(),
    );
  }
}
