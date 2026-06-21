/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, type Mock } from 'vitest';
import type { ToolCall, WaitingToolCall } from './coreToolScheduler.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolCallConfirmationDetails,
  type ToolInvocation,
  type ToolResult,
} from '@vybestack/llxprt-code-tools';
import { DEFAULT_GEMINI_MODEL } from '@vybestack/llxprt-code-core/config/models.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';

// Test constants for tool output truncation
export const DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD = 30000;
export const DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES = 100;

// Helper function to create a mock MessageBus
export function createMockMessageBus() {
  return {
    subscribe: vi.fn().mockReturnValue(() => {}),
    publish: vi.fn(),
    respondToConfirmation: vi.fn(),
    requestConfirmation: vi.fn().mockResolvedValue(true),
    removeAllListeners: vi.fn(),
    listenerCount: vi.fn().mockReturnValue(0),
  };
}

// Helper function to create a mock PolicyEngine
export function createMockPolicyEngine() {
  return {
    evaluate: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
    checkDecision: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
  };
}

// Helper function to create a mock Config
export function createMockConfig(overrides: Partial<Config> = {}): Config {
  const defaults = {
    getSessionId: () => 'test-session-id',
    getUsageStatisticsEnabled: () => true,
    getDebugMode: () => false,
    getApprovalMode: () => ApprovalMode.YOLO,
    getEphemeralSettings: () => ({}),
    getAllowedTools: () => [],
    getContentGeneratorConfig: () => ({
      model: 'test-model',
    }),
    getToolRegistry: () => ({
      getFunctionDeclarations: vi.fn().mockReturnValue([]),
      getTool: vi.fn().mockReturnValue(null),
      getAllTools: vi.fn().mockReturnValue([]),
    }),
    getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
    getPolicyEngine: vi.fn().mockReturnValue(createMockPolicyEngine()),
    getEnableHooks: () => false,
    getHookSystem: () => null,
    getModel: () => DEFAULT_GEMINI_MODEL,
    isInteractive: () => false,
  };
  return { ...defaults, ...overrides } as unknown as Config;
}

export class AbortDuringConfirmationInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    private readonly abortController: AbortController,
    private readonly abortError: Error,
    params: Record<string, unknown>,
    messageBus: ReturnType<
      typeof createMockMessageBus
    > = createMockMessageBus(),
  ) {
    super(params, messageBus);
  }

  override async shouldConfirmExecute(
    _signal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    this.abortController.abort();
    throw this.abortError;
  }

  async execute(): Promise<ToolResult> {
    return {
      llmContent: 'Tool execution aborted during confirmation.',
      returnDisplay: 'Tool execution aborted during confirmation.',
    };
  }

  getDescription(): string {
    return 'Abort during confirmation invocation';
  }
}

export class AbortDuringConfirmationTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    private readonly abortController: AbortController,
    private readonly abortError: Error,
    messageBus: ReturnType<
      typeof createMockMessageBus
    > = createMockMessageBus(),
  ) {
    super(
      'abortDuringConfirmationTool',
      'Abort During Confirmation Tool',
      'Test tool that aborts while confirming execution.',
      Kind.Other,
      { type: 'object', properties: {} },
      true,
      false,
      messageBus,
    );
  }

  protected createInvocation(
    params: Record<string, unknown>,
    messageBus: ReturnType<typeof createMockMessageBus>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    return new AbortDuringConfirmationInvocation(
      this.abortController,
      this.abortError,
      params,
      messageBus,
    );
  }
}

export async function waitForStatus(
  onToolCallsUpdate: Mock,
  status: ToolCall['status'],
): Promise<ToolCall | undefined> {
  let matchingCall: ToolCall | undefined;
  await vi.waitFor(() => {
    const calls = onToolCallsUpdate.mock.calls;
    const latestCalls = calls[calls.length - 1]?.[0] as ToolCall[] | undefined;
    matchingCall = latestCalls?.find((call) => call.status === status);
    if (!matchingCall) {
      throw new Error(
        `Waiting for status "${status}", latest statuses: ${
          latestCalls?.map((call) => call.status).join(', ') ?? 'none'
        }`,
      );
    }
  });
  return matchingCall;
}

export class MockEditToolInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    params: Record<string, unknown>,
    messageBus: ReturnType<
      typeof createMockMessageBus
    > = createMockMessageBus(),
  ) {
    super(params, messageBus);
  }

  getDescription(): string {
    return 'A mock edit tool invocation';
  }

  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    return {
      type: 'edit',
      title: 'Confirm Edit',
      fileName: 'test.txt',
      filePath: 'test.txt',
      fileDiff:
        '--- test.txt\n+++ test.txt\n@@ -1,1 +1,1 @@\n-old content\n+new content',
      originalContent: 'old content',
      newContent: 'new content',
      onConfirm: async () => {},
    };
  }

  async execute(_abortSignal: AbortSignal): Promise<ToolResult> {
    return {
      llmContent: 'Edited successfully',
      returnDisplay: 'Edited successfully',
    };
  }
}

export class MockEditTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    messageBus: ReturnType<
      typeof createMockMessageBus
    > = createMockMessageBus(),
  ) {
    super(
      'mockEditTool',
      'mockEditTool',
      'A mock edit tool',
      Kind.Edit,
      {},
      true,
      false,
      messageBus,
    );
  }

  protected createInvocation(
    params: Record<string, unknown>,
    messageBus: ReturnType<typeof createMockMessageBus>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    return new MockEditToolInvocation(params, messageBus);
  }
}

// Re-export WaitingToolCall type for test files
export type { WaitingToolCall };
