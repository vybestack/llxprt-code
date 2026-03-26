/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { ToolErrorType } from '../tools/tool-error.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import {
  toSnakeCase,
  isFatalToolError,
  extractToolDetail,
  buildToolUnavailableMessage,
  resolveToolName,
  finalizeOutput,
  handleEmitValueCall,
  buildPartsFromCompletedCalls,
  type EmitValueContext,
  type BuildPartsContext,
} from './subagentToolProcessing.js';
import { SubagentTerminateMode, type OutputObject } from './subagentTypes.js';

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
      const display = { message: 'Some detail' } as unknown as import('../tools/tools.js').ToolResultDisplay;
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
          ? { name, description: '', parameterSchema: { type: 'OBJECT', properties: {} } }
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
  });

  // --- handleEmitValueCall ---

  describe('handleEmitValueCall', () => {
    function makeCtx(
      overrides?: Partial<EmitValueContext>,
    ): EmitValueContext {
      return {
        output: { emitted_vars: {}, terminate_reason: SubagentTerminateMode.ERROR },
        subagentId: 'test-agent',
        logger: new DebugLogger('test'),
        ...overrides,
      };
    }

    it('should store emitted variable and return functionResponse', () => {
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
      expect(parts[0]).toHaveProperty('functionResponse');
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
      const resp = (parts[0] as { functionResponse: { response: { error: string } } })
        .functionResponse.response;
      expect(resp.error).toContain('requires');
    });
  });

  // --- buildPartsFromCompletedCalls ---

  describe('buildPartsFromCompletedCalls', () => {
    function makeCtx(overrides?: Partial<BuildPartsContext>): BuildPartsContext {
      return {
        subagentId: 'test-agent',
        logger: new DebugLogger('test'),
        ...overrides,
      };
    }

    it('should extract functionResponse parts from completed calls', () => {
      const parts = buildPartsFromCompletedCalls(
        [
          {
            status: 'success' as const,
            request: { callId: 'c1', name: 'tool_a', args: {}, isClientInitiated: true, prompt_id: 'p1', agentId: 'a1' },
            response: {
              callId: 'c1',
              responseParts: [{ functionResponse: { id: 'c1', name: 'tool_a', response: { output: 'ok' } } }],
              agentId: 'a1',
            },
          },
        ],
        makeCtx(),
      );
      expect(parts.length).toBe(1);
      expect(parts[0]).toHaveProperty('functionResponse');
    });

    it('should create fallback functionResponse when no responseParts', () => {
      const parts = buildPartsFromCompletedCalls(
        [
          {
            status: 'success' as const,
            request: { callId: 'c2', name: 'tool_b', args: {}, isClientInitiated: true, prompt_id: 'p2', agentId: 'a1' },
            response: { callId: 'c2', responseParts: [], agentId: 'a1' },
          },
        ],
        makeCtx(),
      );
      expect(parts.length).toBe(1);
      expect(parts[0]).toHaveProperty('functionResponse');
    });

    it('should not call onMessage for tools with canUpdateOutput=true', () => {
      const onMessage = vi.fn();
      buildPartsFromCompletedCalls(
        [
          {
            status: 'success' as const,
            request: { callId: 'c3', name: 'tool_c', args: {}, isClientInitiated: true, prompt_id: 'p3', agentId: 'a1' },
            response: { callId: 'c3', responseParts: [{ text: 'data' }], resultDisplay: 'output', agentId: 'a1' },
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
            request: { callId: 'c4', name: 'tool_d', args: {}, isClientInitiated: true, prompt_id: 'p4', agentId: 'a1' },
            response: { callId: 'c4', responseParts: [{ text: 'data' }], resultDisplay: 'output text', agentId: 'a1' },
          },
        ],
        makeCtx({ onMessage }),
      );
      expect(onMessage).toHaveBeenCalledWith('output text');
    });

    it('should filter out functionCall parts (Anthropic boundary)', () => {
      const parts = buildPartsFromCompletedCalls(
        [
          {
            status: 'success' as const,
            request: { callId: 'c5', name: 'tool_e', args: {}, isClientInitiated: true, prompt_id: 'p5', agentId: 'a1' },
            response: {
              callId: 'c5',
              responseParts: [
                { functionCall: { name: 'tool_e', args: {} } },
                { functionResponse: { id: 'c5', name: 'tool_e', response: { ok: true } } },
              ],
              agentId: 'a1',
            },
          },
        ],
        makeCtx(),
      );
      expect(parts.length).toBe(1);
      expect(parts[0]).toHaveProperty('functionResponse');
      expect(parts[0]).not.toHaveProperty('functionCall');
    });
  });
});
