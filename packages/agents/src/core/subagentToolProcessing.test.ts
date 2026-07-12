/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { ToolErrorType } from '@vybestack/llxprt-code-tools';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { ToolCallBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  toSnakeCase,
  isFatalToolError,
  extractToolDetail,
  buildToolUnavailableMessage,
  resolveToolName,
  finalizeOutput,
  handleEmitValueCall,
  buildPartsFromCompletedCalls,
  processFunctionCalls,
  type EmitValueContext,
  type BuildPartsContext,
  type ProcessFunctionCallsContext,
} from './subagentToolProcessing.js';
import {
  SubagentTerminateMode,
  type OutputObject,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';

describe('subagentToolProcessing', () => {
  // --- Pure helpers ---

  describe('toSnakeCase', () => {
    it('should convert camelCase to snake_case', () => {
      expect(toSnakeCase('camelCaseString')).toBe('camel_case_string');
    });

    it('should convert PascalCase to snake_case', () => {
      expect(toSnakeCase('PascalCaseString')).toBe('pascal_case_string');
    });

    it('should handle already snake_case', () => {
      expect(toSnakeCase('snake_case')).toBe('snake_case');
    });

    it('should handle spaces and hyphens', () => {
      expect(toSnakeCase('some-value here')).toBe('some_value_here');
    });
  });

  describe('isFatalToolError', () => {
    it('should return true for TOOL_DISABLED', () => {
      expect(isFatalToolError(ToolErrorType.TOOL_DISABLED)).toBe(true);
    });

    it('should return true for TOOL_NOT_REGISTERED', () => {
      expect(isFatalToolError(ToolErrorType.TOOL_NOT_REGISTERED)).toBe(true);
    });

    it('should return false for other error types', () => {
      expect(isFatalToolError(ToolErrorType.EXECUTION_ERROR)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isFatalToolError(undefined)).toBe(false);
    });
  });

  describe('extractToolDetail', () => {
    it('should return error message when available', () => {
      expect(extractToolDetail(undefined, new Error('Permission denied'))).toBe(
        'Permission denied',
      );
    });

    it('should return string resultDisplay', () => {
      expect(extractToolDetail('Tool not found', undefined)).toBe(
        'Tool not found',
      );
    });

    it('should return message from object resultDisplay', () => {
      const display = {
        message: 'Some detail',
      } as unknown as import('@vybestack/llxprt-code-tools').ToolResultDisplay;
      expect(extractToolDetail(display, undefined)).toBe('Some detail');
    });

    it('should return undefined when neither available', () => {
      expect(extractToolDetail(undefined, undefined)).toBeUndefined();
    });
  });

  describe('buildToolUnavailableMessage', () => {
    it('should include tool name', () => {
      const msg = buildToolUnavailableMessage('my_tool');
      expect(msg).toContain('my_tool');
      expect(msg).toContain('not available');
    });

    it('should include error detail when provided', () => {
      const msg = buildToolUnavailableMessage(
        'my_tool',
        undefined,
        new Error('Permission denied'),
      );
      expect(msg).toContain('Permission denied');
    });

    it('should include fallback when no detail', () => {
      const msg = buildToolUnavailableMessage('my_tool');
      expect(msg).toContain('Please continue without using it');
    });
  });

  // --- resolveToolName ---

  describe('resolveToolName', () => {
    const registeredTools = ['read_file', 'write_file', 'run_shell_command'];
    const toolsView = {
      listToolNames: () => registeredTools,
      getToolMetadata: (name: string) =>
        registeredTools.includes(name)
          ? {
              name,
              description: '',
              parameterSchema: { type: 'object', properties: {} },
            }
          : undefined,
    };

    it('should match exact tool name', () => {
      expect(resolveToolName('read_file', toolsView)).toBe('read_file');
    });

    it('should match lowercased tool name', () => {
      expect(resolveToolName('READ_FILE', toolsView)).toBe('read_file');
    });

    it('should convert camelCase to snake_case and match', () => {
      expect(resolveToolName('runShellCommand', toolsView)).toBe(
        'run_shell_command',
      );
    });

    it('should strip Tool suffix and match', () => {
      expect(resolveToolName('run_shell_commandTool', toolsView)).toBe(
        'run_shell_command',
      );
    });

    it('should return null for unknown tool', () => {
      expect(resolveToolName('unknown_tool', toolsView)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(resolveToolName(undefined, toolsView)).toBeNull();
    });
  });

  // --- finalizeOutput ---

  describe('finalizeOutput', () => {
    it('should not overwrite existing final_message', () => {
      const output: OutputObject = {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
        final_message: 'Already set',
      };
      finalizeOutput(output);
      expect(output.final_message).toBe('Already set');
    });

    it('should set GOAL message', () => {
      const output: OutputObject = {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
      };
      finalizeOutput(output);
      expect(output.final_message).toContain('Completed');
    });

    it('should set TIMEOUT message', () => {
      const output: OutputObject = {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.TIMEOUT,
      };
      finalizeOutput(output);
      expect(output.final_message).toContain('time limit');
    });

    it('should set MAX_TURNS message', () => {
      const output: OutputObject = {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.MAX_TURNS,
      };
      finalizeOutput(output);
      expect(output.final_message).toContain('maximum number of turns');
    });

    it('should include actionable max_turns guidance in MAX_TURNS message', () => {
      const output: OutputObject = {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.MAX_TURNS,
      };
      finalizeOutput(output);
      expect(output.final_message).toContain('max_turns');
    });

    it('should set ERROR message', () => {
      const output: OutputObject = {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.ERROR,
      };
      finalizeOutput(output);
      expect(output.final_message).toContain('unrecoverable error');
    });

    it('should include emitted vars in message', () => {
      const output: OutputObject = {
        emitted_vars: { result: 'hello' },
        terminate_reason: SubagentTerminateMode.GOAL,
      };
      finalizeOutput(output);
      expect(output.final_message).toContain('result=hello');
    });

    it('should treat literal "Null" as a placeholder and use the default completion message (Issue #2410)', () => {
      const output: OutputObject = {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
        final_message: 'Null',
      };
      finalizeOutput(output);
      expect(output.final_message).toContain('Completed');
      expect(output.final_message).not.toBe('Null');
    });

    it('should treat case-insensitive "null" as a placeholder (Issue #2410)', () => {
      const output: OutputObject = {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
        final_message: '  null  ',
      };
      finalizeOutput(output);
      expect(output.final_message).toContain('Completed');
    });

    it('should preserve non-Null final_message text (Issue #2410)', () => {
      const output: OutputObject = {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
        final_message: 'Task completed successfully',
      };
      finalizeOutput(output);
      expect(output.final_message).toContain('Task completed successfully');
    });

    it('should treat literal "None" as a placeholder when emitted vars carry the payload (Issue #2410)', () => {
      const output: OutputObject = {
        emitted_vars: { result: 'ready' },
        terminate_reason: SubagentTerminateMode.GOAL,
        final_message: '  None  ',
      };
      finalizeOutput(output);
      expect(output.final_message).toContain('Completed');
      expect(output.final_message).toContain('result=ready');
      expect(output.final_message.trim().toLowerCase()).not.toBe('none');
    });

    it('should preserve literal "None" as a meaningful goal answer without emitted vars', () => {
      const output: OutputObject = {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
        final_message: '  None  ',
      };
      finalizeOutput(output);
      expect(output.final_message).toBe('None');
    });

    it('should treat literal "None" as a placeholder for non-GOAL termination without emitted vars', () => {
      const output: OutputObject = {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.TIMEOUT,
        final_message: '  None  ',
      };
      finalizeOutput(output);
      expect(output.final_message).toContain('time limit');
      expect(output.final_message.trim().toLowerCase()).not.toBe('none');
    });
  });

  // --- handleEmitValueCall ---

  describe('handleEmitValueCall', () => {
    function makeCtx(overrides?: Partial<EmitValueContext>): EmitValueContext {
      return {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.ERROR,
        },
        subagentId: 'test-agent',
        logger: new DebugLogger('test'),
        ...overrides,
      };
    }

    it('should store emitted variable and return tool_response', () => {
      const ctx = makeCtx();
      const parts = handleEmitValueCall(
        {
          callId: 'c1',
          name: 'self_emitvalue',
          args: { emit_variable_name: 'result', emit_variable_value: 'hello' },
          isClientInitiated: true,
          prompt_id: 'p1',
          agentId: 'test-agent',
        },
        ctx,
      );
      expect(ctx.output.emitted_vars['result']).toBe('hello');
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ type: 'tool_response' });
    });

    it('should call onMessage when provided', () => {
      const messages: string[] = [];
      const ctx = makeCtx({ onMessage: (m) => messages.push(m) });
      handleEmitValueCall(
        {
          callId: 'c2',
          name: 'self_emitvalue',
          args: { emit_variable_name: 'x', emit_variable_value: 'val' },
          isClientInitiated: true,
          prompt_id: 'p2',
          agentId: 'test-agent',
        },
        ctx,
      );
      expect(messages.length).toBe(1);
      expect(messages[0]).toContain('Emitted');
    });

    it('should return error when missing args', () => {
      const ctx = makeCtx();
      const parts = handleEmitValueCall(
        {
          callId: 'c3',
          name: 'self_emitvalue',
          args: {},
          isClientInitiated: true,
          prompt_id: 'p3',
          agentId: 'test-agent',
        },
        ctx,
      );
      expect(parts).toHaveLength(1);
      const resp = (
        parts[0] as { type: 'tool_response'; result: { error?: string } }
      ).result;
      expect(resp.error).toContain('requires');
    });
  });

  // --- buildPartsFromCompletedCalls ---

  describe('buildPartsFromCompletedCalls', () => {
    function makeCtx(
      overrides?: Partial<BuildPartsContext>,
    ): BuildPartsContext {
      return {
        subagentId: 'test-agent',
        logger: new DebugLogger('test'),
        ...overrides,
      };
    }

    it('should extract tool_response blocks from completed calls', () => {
      const parts = buildPartsFromCompletedCalls(
        [
          {
            status: 'success' as const,
            request: {
              callId: 'c1',
              name: 'tool_a',
              args: {},
              isClientInitiated: true,
              prompt_id: 'p1',
              agentId: 'a1',
            },
            response: {
              callId: 'c1',
              responseParts: [
                {
                  type: 'tool_response',
                  callId: 'c1',
                  toolName: 'tool_a',
                  result: { output: 'ok' },
                },
              ],
              agentId: 'a1',
            },
          },
        ],
        makeCtx(),
      );
      expect(parts.length).toBe(1);
      expect(parts[0]).toMatchObject({ type: 'tool_response' });
    });

    it('should create fallback tool_response when no responseParts', () => {
      const parts = buildPartsFromCompletedCalls(
        [
          {
            status: 'success' as const,
            request: {
              callId: 'c2',
              name: 'tool_b',
              args: {},
              isClientInitiated: true,
              prompt_id: 'p2',
              agentId: 'a1',
            },
            response: { callId: 'c2', responseParts: [], agentId: 'a1' },
          },
        ],
        makeCtx(),
      );
      expect(parts.length).toBe(1);
      expect(parts[0]).toMatchObject({ type: 'tool_response' });
    });

    it('should not call onMessage for tools with canUpdateOutput=true', () => {
      const onMessage = vi.fn();
      buildPartsFromCompletedCalls(
        [
          {
            status: 'success' as const,
            request: {
              callId: 'c3',
              name: 'tool_c',
              args: {},
              isClientInitiated: true,
              prompt_id: 'p3',
              agentId: 'a1',
            },
            response: {
              callId: 'c3',
              responseParts: [{ text: 'data' }],
              resultDisplay: 'output',
              agentId: 'a1',
            },
            tool: { canUpdateOutput: true },
          },
        ],
        makeCtx({ onMessage }),
      );
      expect(onMessage).not.toHaveBeenCalled();
    });

    it('should call onMessage for tools without canUpdateOutput', () => {
      const onMessage = vi.fn();
      buildPartsFromCompletedCalls(
        [
          {
            status: 'success' as const,
            request: {
              callId: 'c4',
              name: 'tool_d',
              args: {},
              isClientInitiated: true,
              prompt_id: 'p4',
              agentId: 'a1',
            },
            response: {
              callId: 'c4',
              responseParts: [{ text: 'data' }],
              resultDisplay: 'output text',
              agentId: 'a1',
            },
          },
        ],
        makeCtx({ onMessage }),
      );
      expect(onMessage).toHaveBeenCalledWith('output text');
    });

    it('should filter out tool_call blocks (Anthropic boundary)', () => {
      const parts = buildPartsFromCompletedCalls(
        [
          {
            status: 'success' as const,
            request: {
              callId: 'c5',
              name: 'tool_e',
              args: {},
              isClientInitiated: true,
              prompt_id: 'p5',
              agentId: 'a1',
            },
            response: {
              callId: 'c5',
              responseParts: [
                {
                  type: 'tool_call',
                  callId: 'c5',
                  toolName: 'tool_e',
                  args: {},
                },
                {
                  type: 'tool_response',
                  callId: 'c5',
                  toolName: 'tool_e',
                  result: { ok: true },
                },
              ],
              agentId: 'a1',
            },
          },
        ],
        makeCtx(),
      );
      expect(parts.length).toBe(1);
      expect(parts[0]).toMatchObject({ type: 'tool_response' });

      expect(parts[0]).not.toMatchObject({ type: 'tool_call' });
    });
  });

  describe('processFunctionCalls hook restrictions', () => {
    function makeProcessContext(): ProcessFunctionCallsContext {
      return {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.ERROR,
        },
        subagentId: 'test-agent',
        logger: new DebugLogger('test'),
        toolExecutorContext: {
          getToolRegistry: () => ({}) as never,
          getEphemeralSettings: () => ({}),
          getEphemeralSetting: () => undefined,
          getExcludeTools: () => [],
          getSessionId: () => 'test-session',
          getTelemetryLogPromptsEnabled: () => false,
          getOrCreateScheduler: vi.fn(),
          disposeScheduler: vi.fn(),
        },
        config: {} as never,
      };
    }

    it('does not execute hook-restricted provider-emitted function calls', async () => {
      const allowedCall: ToolCallBlock = {
        type: 'tool_call',
        id: 'allowed-call',
        name: 'self_emitvalue',
        parameters: {
          emit_variable_name: 'result',
          emit_variable_value: 'allowed',
        },
      };
      const blockedCall: ToolCallBlock = {
        type: 'tool_call',
        id: 'blocked-call',
        name: 'run_shell_command',
        parameters: { command: 'echo blocked' },
      };

      const ctx = makeProcessContext();
      const content = await processFunctionCalls(
        [allowedCall, blockedCall],
        new AbortController(),
        'prompt-1',
        ctx,
        ['self_emitvalue'], // only self_emitvalue is allowed
      );

      expect(ctx.output.emitted_vars['result']).toBe('allowed');
      expect(
        ctx.toolExecutorContext.getOrCreateScheduler,
      ).not.toHaveBeenCalled();
      expect(JSON.stringify(content)).not.toContain('run_shell_command');
      expect(JSON.stringify(content)).not.toContain('blocked-call');
    });

    it('returns empty content when every provider-emitted function call is hook-restricted', async () => {
      const blockedCall: ToolCallBlock = {
        type: 'tool_call',
        id: 'blocked-call',
        name: 'run_shell_command',
        parameters: { command: 'echo blocked' },
      };

      const ctx = makeProcessContext();
      const content = await processFunctionCalls(
        [blockedCall],
        new AbortController(),
        'prompt-1',
        ctx,
        [], // empty allowed list — everything is restricted
      );

      expect(content).toStrictEqual([]);
      expect(
        ctx.toolExecutorContext.getOrCreateScheduler,
      ).not.toHaveBeenCalled();
    });
  });
});
