/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'bun:test';
import {
  executeToolCall,
  type ToolExecutionConfig,
} from './nonInteractiveToolExecutor.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { DEFAULT_AGENT_ID } from '@vybestack/llxprt-code-core/core/turn.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import {
  type ToolCallRequestInfo,
  type ToolCallResponseInfo,
} from '@vybestack/llxprt-code-tools';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import type { ToolResponseBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/tools.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import { createSchedulerRegistryDelegate } from './scheduler-registry-test-helpers.js';

describe('executeToolCall response structure (Phase 3b.1)', () => {
  let mockToolRegistry: ToolRegistry;
  let mockTool: MockTool;
  let abortController: AbortController;
  let request: ToolCallRequestInfo;
  const testSessionId = 'test-session-structure';
  // Stable per-suite registry owner: executeToolCall acquires and releases
  // on this same object, so the per-config registry refcount balances.
  const executionOwner = { label: 'non-interactive-executor' };

  function createMockConfig(options?: {
    ephemerals?: Record<string, unknown>;
    approvalMode?: ApprovalMode;
    allowedTools?: string[] | undefined;
    policyEngine?: PolicyEngine;
    messageBus?: MessageBus;
    includePolicyEngine?: boolean;
    includeMessageBus?: boolean;
    policyEngineReturnsUndefined?: boolean;
  }): ToolExecutionConfig {
    const ephemerals = options?.ephemerals ?? {};
    const policyEngine =
      options?.policyEngine ??
      new PolicyEngine({
        rules: [],
        defaultDecision: PolicyDecision.ALLOW,
        nonInteractive: false,
      });
    const messageBus =
      options?.messageBus ?? new MessageBus(policyEngine, false);
    const includePolicyEngine = options?.includePolicyEngine ?? true;
    const policyEngineReturnsUndefined =
      options?.policyEngineReturnsUndefined ?? false;

    const getPolicyEngineFunc = (): PolicyEngine => {
      if (includePolicyEngine && policyEngineReturnsUndefined) {
        return undefined as unknown as PolicyEngine;
      }
      return policyEngine;
    };

    // Build the base config fixture, then attach a per-config scheduler
    // registry delegate keyed by owner object identity, matching production
    // Config semantics.
    const fixture = {
      getToolRegistry: () => mockToolRegistry,
      getSessionId: () => testSessionId,
      getTelemetryLogPromptsEnabled: () => false,
      getExcludeTools: () => [],
      getEphemeralSettings: () => ephemerals,
      getEphemeralSetting: (key: string) => ephemerals[key],
      getPolicyEngine: getPolicyEngineFunc,
      getMessageBus: () => messageBus,
      getApprovalMode: () => options?.approvalMode ?? ApprovalMode.DEFAULT,
      getAllowedTools: () => options?.allowedTools,
      getToolSchedulerFactory:
        () =>
        (
          schedulerOptions: ConstructorParameters<typeof CoreToolScheduler>[0],
        ) =>
          new CoreToolScheduler(schedulerOptions),
    };

    const delegate = createSchedulerRegistryDelegate({
      config: fixture as unknown as Config,
      messageBus,
      toolRegistry: mockToolRegistry,
      createScheduler: (schedulerOptions) =>
        fixture.getToolSchedulerFactory()({
          config: fixture as unknown as Config,
          messageBus,
          toolRegistry: mockToolRegistry,
          toolContextInteractiveMode: schedulerOptions.interactiveMode ?? true,
          getPreferredEditor: () => undefined,
          onEditorClose: () => {},
        }),
    });

    const config: ToolExecutionConfig = {
      ...fixture,
      ...delegate,
    } as unknown as ToolExecutionConfig;

    return config;
  }

  beforeEach(() => {
    mockTool = new MockTool('testTool');

    mockToolRegistry = {
      getTool: vi.fn(),
      getAllToolNames: vi.fn().mockReturnValue(['testTool']),
      getAllTools: vi.fn().mockReturnValue([]),
    } as unknown as ToolRegistry;

    abortController = new AbortController();

    request = {
      callId: 'call1',
      name: 'testTool',
      args: { param1: 'value1' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-1',
    };
  });

  describe('response structure validation', () => {
    it('should return ToolCallResponseInfo with correct structure', async () => {
      (
        mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
      ).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success!',
      });

      const { response } = await executeToolCall(
        createMockConfig(),
        request,
        abortController.signal,
        { owner: executionOwner },
      );

      expect(response.callId).toBe('call1');
      expect(response.resultDisplay).toBe('Success!');
      expect(response.responseParts).toBeDefined();
      // responseParts now contains only functionResponse (not functionCall)
      // The functionCall is already recorded in history from the original assistant message.
      // Including it again would create duplicate tool_use blocks for Anthropic. (Issue #1150)
      expect(response.responseParts.length).toBeGreaterThanOrEqual(1);
      expect(response.agentId).toBeDefined();
    });

    it('should include functionResponse in responseParts', async () => {
      (
        mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
      ).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success!',
      });

      const { response } = await executeToolCall(
        createMockConfig(),
        request,
        abortController.signal,
        { owner: executionOwner },
      );

      const parts = response.responseParts;
      // responseParts now contains only tool_response (not tool_call)
      expect(parts.length).toBeGreaterThanOrEqual(1);

      // First part should be tool_response (not tool_call anymore)
      const first = parts[0] as ToolResponseBlock;
      expect(first.type).toBe('tool_response');
      expect(first.callId).toBe(request.callId);
      expect(first.toolName).toBe(request.name);
    });
  });

  describe('agentId preservation', () => {
    it('should preserve agentId from request through to response', async () => {
      (
        mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
      ).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success!',
      });

      const customAgentId = 'custom-agent-123';
      const requestWithAgentId = { ...request, agentId: customAgentId };

      const { response } = await executeToolCall(
        createMockConfig(),
        requestWithAgentId,
        abortController.signal,
        { owner: executionOwner },
      );

      expect(response.agentId).toBe(customAgentId);
    });

    it('should use DEFAULT_AGENT_ID when request has no agentId', async () => {
      (
        mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
      ).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success!',
      });

      const requestWithoutAgentId = { ...request, agentId: undefined };

      const { response } = await executeToolCall(
        createMockConfig(),
        requestWithoutAgentId,
        abortController.signal,
        { owner: executionOwner },
      );

      expect(response.agentId).toBe(DEFAULT_AGENT_ID);
    });
  });

  describe('resource cleanup', () => {
    it('should allow subsequent executions after completion', async () => {
      (
        mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
      ).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success!',
      });

      const results: ToolCallResponseInfo[] = [];
      for (let i = 0; i < 3; i++) {
        const { response } = await executeToolCall(
          createMockConfig(),
          { ...request, callId: `call${i}` },
          abortController.signal,
          { owner: executionOwner },
        );
        results.push(response);
      }

      expect(results).toHaveLength(3);
      results.forEach((response) => {
        expect(response.error).toBeUndefined();
      });
    });

    it('should not emit MaxListenersExceededWarning when reusing an abort signal', async () => {
      (
        mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
      ).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success!',
      });

      const warnings: Error[] = [];
      const onWarning = (warning: Error): void => {
        warnings.push(warning);
      };

      process.on('warning', onWarning);
      try {
        for (let i = 0; i < 15; i++) {
          const { response } = await executeToolCall(
            createMockConfig(),
            { ...request, callId: `call-${i}` },
            abortController.signal,
            { owner: executionOwner },
          );
          expect(response.error).toBeUndefined();
        }
      } finally {
        process.removeListener('warning', onWarning);
      }

      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      const maxListenerWarnings = warnings.filter(
        (warning) => warning.name === 'MaxListenersExceededWarning',
      );

      expect(maxListenerWarnings).toHaveLength(0);
    });

    it('should allow subsequent executions after failure', async () => {
      (
        mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
      ).mockReturnValue(mockTool);

      mockTool.executeFn.mockImplementationOnce(() => {
        throw new Error('Tool failed');
      });
      const { response: failedResult } = await executeToolCall(
        createMockConfig(),
        { ...request, callId: 'fail' },
        abortController.signal,
        { owner: executionOwner },
      );
      expect(failedResult.error).toBeDefined();

      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success!',
      });
      const { response: successResult } = await executeToolCall(
        createMockConfig(),
        { ...request, callId: 'success' },
        abortController.signal,
        { owner: executionOwner },
      );
      expect(successResult.error).toBeUndefined();
    });
  });

  describe('abort signal propagation', () => {
    it('should handle abort signal during tool execution', async () => {
      const { completed } = await observeHandleAbortSignalDuringToolExecution();
      expect(completed.status).toBe('cancelled');
      expect(getFullResponseText(completed.response)).toContain('Cancelled');
    });

    const observeHandleAbortSignalDuringToolExecution = async () => {
      const localAbortController = new AbortController();

      let startedResolver: (() => void) | null = null;
      const startedPromise = new Promise<void>((resolve) => {
        startedResolver = resolve;
      });

      (
        mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
      ).mockReturnValue(mockTool);
      mockTool.executeFn.mockImplementation(
        async (_args: unknown, signal: AbortSignal) => {
          startedResolver?.();
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          if (signal.aborted) {
            return {
              llmContent: '[Operation Cancelled]',
              returnDisplay: '[Operation Cancelled]',
            };
          }
          return {
            llmContent: 'Should not reach',
            returnDisplay: 'Should not reach',
          };
        },
      );

      const executionPromise = executeToolCall(
        createMockConfig(),
        request,
        localAbortController.signal,
        { owner: executionOwner },
      );
      await startedPromise;
      localAbortController.abort();

      const completed = await executionPromise;

      return { completed };
    };
  });

  describe('error response structure', () => {
    it('should include original request info in error response', async () => {
      (
        mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
      ).mockReturnValue(mockTool);
      mockTool.executeFn.mockImplementation(() => {
        throw new Error('Execution failed');
      });

      const { response } = await executeToolCall(
        createMockConfig(),
        request,
        abortController.signal,
        { owner: executionOwner },
      );

      expect(response.error).toBeDefined();
      expect(response.callId).toBe(request.callId);
    });

    it('should include functionResponse in error responseParts', async () => {
      (
        mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
      ).mockReturnValue(mockTool);
      mockTool.executeFn.mockImplementation(() => {
        throw new Error('Execution failed');
      });

      const { response } = await executeToolCall(
        createMockConfig(),
        request,
        abortController.signal,
        { owner: executionOwner },
      );

      const parts = response.responseParts;
      // Error responseParts should contain only tool_response (no tool_call).
      expect(parts).toHaveLength(1);
      expect(parts[0]).not.toHaveProperty('type', 'tool_call');
      const first = parts[0] as ToolResponseBlock;
      expect(first.type).toBe('tool_response');
      expect(first.callId).toBe(request.callId);
    });

    it('should return error for tool that does not exist', async () => {
      (
        mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
      ).mockReturnValue(undefined);

      const { response } = await executeToolCall(
        createMockConfig(),
        { ...request, name: 'nonexistent_tool' },
        abortController.signal,
        { owner: executionOwner },
      );

      expect(response.error).toBeDefined();
      expect(response.errorType).toBe(ToolErrorType.TOOL_NOT_REGISTERED);
    });

    it('should return error for invalid tool arguments', async () => {
      (
        mockToolRegistry.getTool as Mock<typeof mockToolRegistry.getTool>
      ).mockReturnValue(mockTool);
      mockTool.executeFn.mockImplementation(() => {
        throw new Error('Invalid arguments: missing required field "path"');
      });

      const { response } = await executeToolCall(
        createMockConfig(),
        { ...request, args: {} },
        abortController.signal,
        { owner: executionOwner },
      );

      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Invalid arguments');
    });
  });

  // Note: emoji filtering is now handled by the individual tools (edit.ts, write-file.ts)
  // rather than in nonInteractiveToolExecutor. The tools themselves add system-reminder
  // when emojis are filtered in 'warn' mode. These tests verified the old behavior
  // where nonInteractiveToolExecutor did the filtering and appended the reminder.
  // The actual filtering behavior is tested in write-file.test.ts and edit.test.ts.
});

function getFullResponseText(response: ToolCallResponseInfo): string {
  const chunks: string[] = [];
  for (const part of response.responseParts) {
    if (part.type === 'tool_response') {
      const payload = part.result as
        | { output?: unknown; error?: unknown }
        | undefined;
      if (payload && typeof payload.output === 'string') {
        chunks.push(payload.output);
      }
      if (payload && typeof payload.error === 'string') {
        chunks.push(payload.error);
      }
    } else if (part.type === 'text' && typeof part.text === 'string') {
      chunks.push(part.text);
    }
  }
  return chunks.join('\n');
}
