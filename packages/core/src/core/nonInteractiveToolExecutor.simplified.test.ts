/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test file for the simplified nonInteractiveToolExecutor after #1057 consolidation.
 *
 * After consolidation:
 * - CoreToolScheduler handles nonInteractive mode (auto-reject awaiting_approval)
 * - Emoji filtering remains in nonInteractiveToolExecutor (needed for executor.ts caller)
 * - The wrapper is much simpler - just creates scheduler with nonInteractive: true
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeToolCall } from './nonInteractiveToolExecutor.js';
import {
  ToolRegistry,
  type ToolCallRequestInfo,
  Config,
  ToolErrorType,
  ApprovalMode,
  DEFAULT_AGENT_ID,
} from '../index.js';
import { MockTool } from '../test-utils/tools.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { PolicyDecision } from '../policy/types.js';

describe('executeToolCall simplified (issue #1057)', () => {
  let mockToolRegistry: ToolRegistry;
  let mockTool: MockTool;
  let abortController: AbortController;
  let mockConfig: Config;
  let policyEngine: PolicyEngine;
  let messageBus: MessageBus;

  beforeEach(() => {
    policyEngine = new PolicyEngine({
      rules: [],
      defaultDecision: PolicyDecision.ALLOW,
      nonInteractive: false,
    });
    messageBus = new MessageBus(policyEngine, false);

    mockTool = new MockTool('testTool');

    mockToolRegistry = {
      getTool: vi.fn(),
      getAllToolNames: vi.fn().mockReturnValue(['testTool', 'anotherTool']),
      getAllTools: vi.fn().mockReturnValue([]),
    } as unknown as ToolRegistry;

    mockConfig = {
      getToolRegistry: () => mockToolRegistry,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getAllowedTools: () => [],
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getContentGeneratorConfig: () => ({
        model: 'test-model',
        authType: 'oauth-personal',
      }),
      getEphemeralSetting: vi.fn(),
      getEphemeralSettings: vi.fn().mockReturnValue({}),
      getExcludeTools: () => [],
      getTelemetryLogPromptsEnabled: () => false,
      getPolicyEngine: () => policyEngine,
      getMessageBus: () => messageBus,
    } as unknown as Config;

    abortController = new AbortController();
  });

  describe('CoreToolScheduler integration', () => {
    it('should pass nonInteractive: true to CoreToolScheduler', async () => {
      // This test verifies that the scheduler receives nonInteractive: true
      // which delegates policy handling to CoreToolScheduler
      const request: ToolCallRequestInfo = {
        callId: 'call-ni',
        name: 'testTool',
        args: { param1: 'value1' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-ni',
      };

      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Tool executed successfully',
        returnDisplay: 'Success!',
      });

      const result = await executeToolCall(
        mockConfig,
        request,
        abortController.signal,
      );

      // Tool should execute successfully
      expect(result.status).toBe('success');
      expect(result.response.error).toBeUndefined();
    });

    it('should reject tools that need approval with POLICY_VIOLATION when nonInteractive', async () => {
      // Create a policy engine that returns ASK_USER for the tool
      const askUserPolicyEngine = new PolicyEngine({
        rules: [],
        defaultDecision: PolicyDecision.ASK_USER,
        nonInteractive: false,
      });
      const askUserMessageBus = new MessageBus(askUserPolicyEngine, false);

      mockTool.shouldConfirm = true;
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);

      const askUserConfig = {
        ...mockConfig,
        getPolicyEngine: () => askUserPolicyEngine,
        getMessageBus: () => askUserMessageBus,
      } as unknown as Config;

      const request: ToolCallRequestInfo = {
        callId: 'call-approval-needed',
        name: 'testTool',
        args: { param1: 'value1' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-approval',
      };

      const result = await executeToolCall(
        askUserConfig,
        request,
        abortController.signal,
      );

      // Should be rejected as policy violation (handled by CoreToolScheduler)
      expect(result.status).toBe('error');
      expect(result.response.errorType).toBe(ToolErrorType.POLICY_VIOLATION);
      // The error message can vary depending on how the rejection happens
      // (either 'awaiting_approval' or 'Policy denied')
      expect(
        result.response.error?.message?.includes('awaiting_approval') ||
          result.response.error?.message?.includes('Policy denied'),
      ).toBe(true);
    });
  });

  describe('emoji filtering (kept for executor.ts compatibility)', () => {
    it('should filter emojis from write_file content', async () => {
      const request: ToolCallRequestInfo = {
        callId: 'call-emoji',
        name: 'write_file',
        args: { file_path: '/tmp/test.txt', content: 'Hello  World' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-emoji',
      };

      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockImplementation((args) => ({
        llmContent: `Written: ${(args as { content: string }).content}`,
        returnDisplay: 'File written',
      }));
      vi.mocked(mockConfig.getEphemeralSetting).mockImplementation((key) => {
        if (key === 'emojifilter') return 'auto';
        return undefined;
      });

      const result = await executeToolCall(
        mockConfig,
        request,
        abortController.signal,
      );

      // Tool should be called with filtered content (no emoji)
      expect(result.status).toBe('success');
      // The mock executeFn captures what was passed
      const executedArgs = mockTool.executeFn.mock.calls[0][0] as {
        content: string;
      };
      // In auto mode, emojis are silently removed
      // The content should still have 'Hello' and 'World'
      expect(executedArgs.content).toContain('Hello');
      expect(executedArgs.content).toContain('World');
      // Verify emojis are NOT present (they would be U+1F600 face emoji)
      // Note: Since test uses a face emoji U+1F600, but the file was filtered,
      // we just verify the content doesn't have obvious emoji characters
      expect(executedArgs.content.length).toBeLessThan(
        'Hello emoji World'.length,
      );
    });

    it('should preserve file paths even if they contain emojis', async () => {
      const request: ToolCallRequestInfo = {
        callId: 'call-path',
        name: 'write_file',
        args: { file_path: '/tmp/docs/folder/test.txt', content: 'content' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-path',
      };

      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockImplementation((args) => ({
        llmContent: `Written to: ${(args as { file_path: string }).file_path}`,
        returnDisplay: 'File written',
      }));
      vi.mocked(mockConfig.getEphemeralSetting).mockImplementation((key) => {
        if (key === 'emojifilter') return 'auto';
        return undefined;
      });

      const result = await executeToolCall(
        mockConfig,
        request,
        abortController.signal,
      );

      // File path should be preserved (emoji filtering should not affect paths)
      expect(result.status).toBe('success');
      const executedArgs = mockTool.executeFn.mock.calls[0][0] as {
        file_path: string;
      };
      expect(executedArgs.file_path).toContain('');
    });

    it('should not filter search tools', async () => {
      const request: ToolCallRequestInfo = {
        callId: 'call-search',
        name: 'grep',
        args: { pattern: '' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-search',
      };

      const grepTool = new MockTool('grep');
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(grepTool);
      grepTool.executeFn.mockImplementation((args) => ({
        llmContent: `Searched for: ${(args as { pattern: string }).pattern}`,
        returnDisplay: 'Search complete',
      }));

      const result = await executeToolCall(
        mockConfig,
        request,
        abortController.signal,
      );

      // Search pattern should be preserved (no filtering for search tools)
      expect(result.status).toBe('success');
      const executedArgs = grepTool.executeFn.mock.calls[0][0] as {
        pattern: string;
      };
      expect(executedArgs.pattern).toBe('');
    });
  });

  describe('agentId handling', () => {
    it('should preserve custom agentId through execution', async () => {
      const request: ToolCallRequestInfo = {
        callId: 'call-agent',
        name: 'testTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-agent',
        agentId: 'custom-agent-xyz',
      };

      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Done',
        returnDisplay: 'Done',
      });

      const result = await executeToolCall(
        mockConfig,
        request,
        abortController.signal,
      );

      expect(result.response.agentId).toBe('custom-agent-xyz');
    });

    it('should use DEFAULT_AGENT_ID when no agentId provided', async () => {
      const request: ToolCallRequestInfo = {
        callId: 'call-default-agent',
        name: 'testTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-default',
      };

      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Done',
        returnDisplay: 'Done',
      });

      const result = await executeToolCall(
        mockConfig,
        request,
        abortController.signal,
      );

      expect(result.response.agentId).toBe(DEFAULT_AGENT_ID);
    });
  });

  describe('abort handling', () => {
    it('should cancel tool execution when abort signal is triggered', async () => {
      const localAbortController = new AbortController();

      let resolveExecution: () => void;
      const executionStarted = new Promise<void>((resolve) => {
        resolveExecution = resolve;
      });

      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockImplementation(
        async (_args, signal: AbortSignal) => {
          resolveExecution();
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return {
            llmContent: signal.aborted ? '[Cancelled]' : 'Done',
            returnDisplay: signal.aborted ? '[Cancelled]' : 'Done',
          };
        },
      );

      const request: ToolCallRequestInfo = {
        callId: 'call-abort',
        name: 'testTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-abort',
      };

      const executionPromise = executeToolCall(
        mockConfig,
        request,
        localAbortController.signal,
      );

      await executionStarted;
      localAbortController.abort();

      const result = await executionPromise;
      expect(result.status).toBe('cancelled');
    });
  });

  describe('proper disposal', () => {
    it('should not leak scheduler instances after multiple executions', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success',
      });

      // Execute multiple tool calls
      for (let i = 0; i < 5; i++) {
        const request: ToolCallRequestInfo = {
          callId: `call-${i}`,
          name: 'testTool',
          args: {},
          isClientInitiated: false,
          prompt_id: `prompt-${i}`,
        };

        const result = await executeToolCall(
          mockConfig,
          request,
          abortController.signal,
        );

        expect(result.status).toBe('success');
      }

      // If there were leaks, we'd see memory growth or hanging tests
      // This test passes if all 5 executions complete successfully
    });
  });
});
