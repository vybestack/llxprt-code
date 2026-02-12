/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ToolCallConfirmationDetails,
  ToolInvocation,
  ToolResult,
} from '../tools/tools.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
} from '../tools/tools.js';
import { vi } from 'vitest';

interface MockToolOptions {
  name: string;
  displayName?: string;
  description?: string;
  canUpdateOutput?: boolean;
  isOutputMarkdown?: boolean;
  shouldConfirmExecute?: (
    params: { [key: string]: unknown },
    signal: AbortSignal,
  ) => Promise<ToolCallConfirmationDetails | false>;
  execute?: (
    params: { [key: string]: unknown },
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ) => Promise<ToolResult>;
  params?: object;
}

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

  execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    return this.tool.executeFn(this.params, signal, updateOutput);
  }

  override shouldConfirmExecute(
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    return this.tool.shouldConfirmExecute(this.params, abortSignal);
  }

  getDescription(): string {
    return `A mock tool invocation for ${this.tool.name}`;
  }
}

/**
 * A highly configurable mock tool for testing purposes.
 */
type ExecuteFn = (
  params: { [key: string]: unknown },
  signal: AbortSignal,
  updateOutput?: (output: string) => void,
) => Promise<ToolResult>;

type ExecuteMock = ReturnType<typeof vi.fn<ExecuteFn>>;

function createExecuteFn(impl: ExecuteFn, _fallbackName: string): ExecuteMock {
  return vi.fn(impl);
}

export class MockTool extends BaseDeclarativeTool<
  { [key: string]: unknown },
  ToolResult
> {
  shouldConfirm = false;
  executeFn: ExecuteMock;
  shouldConfirmExecute: (
    params: { [key: string]: unknown },
    signal: AbortSignal,
  ) => Promise<ToolCallConfirmationDetails | false>;

  constructor(optionsOrName: MockToolOptions | string = { name: 'mock-tool' }) {
    const options: MockToolOptions =
      typeof optionsOrName === 'string'
        ? { name: optionsOrName }
        : optionsOrName;
    super(
      options.name,
      options.displayName ?? options.name,
      options.description ?? options.name,
      Kind.Other,
      options.params ??
        ({
          type: 'object',
          properties: { param: { type: 'string' } },
        } as object),
      options.isOutputMarkdown ?? false,
      options.canUpdateOutput ?? false,
    );

    const defaultExecute: ExecuteFn = async () => ({
      llmContent: `Tool ${this.name} executed successfully.`,
      returnDisplay: `Tool ${this.name} executed successfully.`,
    });
    const executeImpl = options.execute ?? defaultExecute;
    this.executeFn = createExecuteFn(executeImpl, options.name);
    if (options.shouldConfirmExecute) {
      this.shouldConfirmExecute = options.shouldConfirmExecute;
    } else {
      this.shouldConfirmExecute = async () => {
        if (!this.shouldConfirm) {
          return false;
        }
        return {
          type: 'exec',
          title: `Confirm ${this.displayName}`,
          command: this.name,
          rootCommand: this.name,
          onConfirm: async () => {},
        };
      };
    }
  }

  protected createInvocation(params: {
    [key: string]: unknown;
  }): ToolInvocation<{ [key: string]: unknown }, ToolResult> {
    return new MockToolInvocation(this, params);
  }
}
