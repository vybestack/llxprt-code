/**
 * @license
 * Copyright 2025 Vybestack LLC
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
import {
  type ModifiableDeclarativeTool,
  type ModifyContext,
} from '../tools/modifiable-tool.js';

type ToolSpy = ReturnType<(typeof vi)['fn']>;

class MockToolInvocation extends BaseToolInvocation<
  { [key: string]: unknown },
  ToolResult
> {
  constructor(
    private readonly tool: MockTool,
    params: { [key: string]: unknown },
  ) {
    super(params);
  }

  async execute(
    abortSignal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const result = await this.tool.executeFn(
      this.params,
      abortSignal,
      updateOutput,
    );
    if (
      result &&
      typeof result === 'object' &&
      'llmContent' in result &&
      'returnDisplay' in result
    ) {
      return result as ToolResult;
    }
    return {
      llmContent: `Tool ${this.tool.name} executed successfully.`,
      returnDisplay: `Tool ${this.tool.name} executed successfully.`,
    };
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
  ) {
    super(name, displayName ?? name, description, Kind.Other, params);
    this.executeFn = vi.fn();
  }

  protected createInvocation(params: {
    [key: string]: unknown;
  }): ToolInvocation<{ [key: string]: unknown }, ToolResult> {
    return new MockToolInvocation(this, params);
  }
}

export class MockModifiableToolInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    private readonly tool: MockModifiableTool,
    params: Record<string, unknown>,
  ) {
    super(params);
  }

  async execute(
    abortSignal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const result = await this.tool.executeFn(
      this.params,
      abortSignal,
      updateOutput,
    );
    if (
      result &&
      typeof result === 'object' &&
      'llmContent' in result &&
      'returnDisplay' in result
    ) {
      return result as ToolResult;
    }
    return {
      llmContent: `Tool ${this.tool.name} executed successfully.`,
      returnDisplay: `Tool ${this.tool.name} executed successfully.`,
    };
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
  constructor(name = 'mockModifiableTool') {
    super(name);
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
    return new MockModifiableToolInvocation(this, params);
  }
}
