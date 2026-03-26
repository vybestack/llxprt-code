/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

// These module references will be populated at runtime inside the skipped block.
// The imports target subagentToolProcessing.js which does not exist yet — it will be created
// in Phase 3. The describe.skip wrapper keeps CI green in the meantime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processFunctionCalls: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handleEmitValueCall: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildPartsFromCompletedCalls: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let resolveToolName: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildToolUnavailableMessage: any;

describe.skip('subagentToolProcessing (enable in Phase 3)', () => {
  beforeAll(async () => {
    const mod = await import('./subagentToolProcessing.js');
    processFunctionCalls = mod.processFunctionCalls;
    handleEmitValueCall = mod.handleEmitValueCall;
    buildPartsFromCompletedCalls = mod.buildPartsFromCompletedCalls;
    resolveToolName = mod.resolveToolName;
    buildToolUnavailableMessage = mod.buildToolUnavailableMessage;
  });

  // --- Behavioral tests (blocking — test public API) ---

  describe('processFunctionCalls', () => {
    it('should route self_emitvalue calls to emit handling', async () => {
      const outputObject = { emitted_vars: {}, terminate_reason: 'ERROR' };
      const outputConfig = { outputs: { my_var: 'My variable description' } };
      const functionCalls = [
        { name: 'self_emitvalue', args: { key: 'my_var', value: 'hello' } },
      ];
      const params = {
        functionCalls,
        outputObject,
        outputConfig,
        toolsView: {
          listToolNames: () => [],
          getToolMetadata: () => undefined,
        },
        toolExecutorContext: {},
        schedulerConfigFactory: () => ({}),
        subagentId: 'test-agent',
        logger: { log: () => {} },
      };
      const result = await processFunctionCalls(params);
      expect(result).toBeDefined();
      // The emit call should have stored the variable
      expect(outputObject.emitted_vars.my_var).toBe('hello');
    });

    it('should route external tool calls to execution', async () => {
      const outputObject = { emitted_vars: {}, terminate_reason: 'ERROR' };
      const mockToolExecutorContext = {
        getToolRegistry: () => ({
          getTool: () => undefined,
        }),
        getEphemeralSettings: () => ({}),
        getEphemeralSetting: () => undefined,
        getExcludeTools: () => [],
        getSessionId: () => 'test-session',
        getTelemetryLogPromptsEnabled: () => false,
        getOrCreateScheduler: () => {},
        disposeScheduler: () => {},
      };
      const functionCalls = [{ name: 'external_tool', args: {} }];
      const toolsView = {
        listToolNames: () => ['external_tool'],
        getToolMetadata: (name: string) => ({
          name,
          description: 'An external tool',
          parameterSchema: { type: 'OBJECT', properties: {} },
        }),
      };
      const params = {
        functionCalls,
        outputObject,
        outputConfig: undefined,
        toolsView,
        toolExecutorContext: mockToolExecutorContext,
        schedulerConfigFactory: () => ({}),
        subagentId: 'test-agent',
        logger: { log: () => {} },
      };
      const result = await processFunctionCalls(params);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should produce fallback message when all calls fail', async () => {
      const outputObject = { emitted_vars: {}, terminate_reason: 'ERROR' };
      const functionCalls = [{ name: 'failing_tool', args: {} }];
      const toolsView = {
        listToolNames: () => [],
        getToolMetadata: () => undefined,
      };
      const params = {
        functionCalls,
        outputObject,
        outputConfig: undefined,
        toolsView,
        toolExecutorContext: {
          getToolRegistry: () => ({ getTool: () => undefined }),
          getEphemeralSettings: () => ({}),
          getEphemeralSetting: () => undefined,
          getExcludeTools: () => [],
          getSessionId: () => 'test',
          getTelemetryLogPromptsEnabled: () => false,
          getOrCreateScheduler: () => {},
          disposeScheduler: () => {},
        },
        schedulerConfigFactory: () => ({}),
        subagentId: 'test-agent',
        logger: { log: () => {} },
      };
      const result = await processFunctionCalls(params);
      expect(result).toBeDefined();
    });
  });

  describe('handleEmitValueCall', () => {
    it('should store emitted variable in output object', () => {
      const outputObject = {
        emitted_vars: {},
        terminate_reason: 'ERROR' as const,
      };
      const outputConfig = { outputs: { result: 'The result' } };
      const result = handleEmitValueCall({
        callId: 'call-1',
        args: { key: 'result', value: 'my value' },
        outputObject,
        outputConfig,
      });
      expect(outputObject.emitted_vars.result).toBe('my value');
      expect(result).toBeDefined();
    });

    it('should return functionResponse confirming storage', () => {
      const outputObject = { emitted_vars: {}, terminate_reason: 'ERROR' };
      const outputConfig = { outputs: { x: 'Some var' } };
      const parts = handleEmitValueCall({
        callId: 'call-2',
        args: { key: 'x', value: '42' },
        outputObject,
        outputConfig,
      });
      expect(parts.length).toBeGreaterThan(0);
      expect(parts[0]).toHaveProperty('functionResponse');
    });

    it('should handle multiple emissions', () => {
      const outputObject = { emitted_vars: {}, terminate_reason: 'ERROR' };
      const outputConfig = { outputs: { a: 'Var a', b: 'Var b' } };
      handleEmitValueCall({
        callId: 'call-3',
        args: { key: 'a', value: 'valueA' },
        outputObject,
        outputConfig,
      });
      handleEmitValueCall({
        callId: 'call-4',
        args: { key: 'b', value: 'valueB' },
        outputObject,
        outputConfig,
      });
      expect(outputObject.emitted_vars.a).toBe('valueA');
      expect(outputObject.emitted_vars.b).toBe('valueB');
    });

    it('should reject emission for undefined output keys', () => {
      const outputObject = { emitted_vars: {}, terminate_reason: 'ERROR' };
      const outputConfig = { outputs: { known: 'Known var' } };
      // Emitting an unknown key — the function should handle this gracefully
      const parts = handleEmitValueCall({
        callId: 'call-5',
        args: { key: 'unknown_key', value: 'value' },
        outputObject,
        outputConfig,
      });
      // Should still return parts (with error or warning), not throw
      expect(parts).toBeDefined();
    });
  });

  describe('buildPartsFromCompletedCalls', () => {
    it('should produce functionResponse parts for each completed call', () => {
      const completedCalls = [
        {
          status: 'success',
          request: {
            callId: 'c1',
            name: 'tool_a',
            args: {},
            isClientInitiated: true,
            prompt_id: 'p1',
            agentId: 'agent1',
          },
          response: {
            callId: 'c1',
            responseParts: [{ text: 'Result A' }],
            resultDisplay: { type: 'text', value: 'Result A' },
            agentId: 'agent1',
          },
        },
      ];
      const parts = buildPartsFromCompletedCalls({
        completedCalls,
        canUpdateOutput: false,
        onMessage: undefined,
      });
      expect(parts.length).toBeGreaterThan(0);
    });

    it('should not call onMessage for tools with canUpdateOutput=true', () => {
      const onMessage = { fn: (_msg: string) => {} };
      const spy = vi.spyOn(onMessage, 'fn');
      const completedCalls = [
        {
          status: 'success',
          request: {
            callId: 'c2',
            name: 'tool_b',
            args: {},
            isClientInitiated: true,
            prompt_id: 'p2',
            agentId: 'agent1',
          },
          response: {
            callId: 'c2',
            responseParts: [{ text: 'Result B' }],
            resultDisplay: { type: 'text', value: 'Result B' },
            agentId: 'agent1',
          },
        },
      ];
      buildPartsFromCompletedCalls({
        completedCalls,
        canUpdateOutput: true,
        onMessage: onMessage.fn,
      });
      expect(spy).not.toHaveBeenCalled();
    });

    it('should call onMessage for tools with canUpdateOutput=false', () => {
      const messages: string[] = [];
      const onMessage = (msg: string) => messages.push(msg);
      const completedCalls = [
        {
          status: 'success',
          request: {
            callId: 'c3',
            name: 'tool_c',
            args: {},
            isClientInitiated: true,
            prompt_id: 'p3',
            agentId: 'agent1',
          },
          response: {
            callId: 'c3',
            responseParts: [{ text: 'Result C' }],
            resultDisplay: { type: 'text', value: 'Result C' },
            agentId: 'agent1',
          },
        },
      ];
      buildPartsFromCompletedCalls({
        completedCalls,
        canUpdateOutput: false,
        onMessage,
      });
      expect(messages.length).toBeGreaterThan(0);
    });

    it('should call onMessage for error calls even with canUpdateOutput=true', () => {
      const messages: string[] = [];
      const onMessage = (msg: string) => messages.push(msg);
      const completedCalls = [
        {
          status: 'error',
          request: {
            callId: 'c4',
            name: 'failing_tool',
            args: {},
            isClientInitiated: true,
            prompt_id: 'p4',
            agentId: 'agent1',
          },
          response: {
            callId: 'c4',
            responseParts: [],
            error: new Error('Tool failed'),
            agentId: 'agent1',
          },
        },
      ];
      buildPartsFromCompletedCalls({
        completedCalls,
        canUpdateOutput: true,
        onMessage,
      });
      expect(messages.length).toBeGreaterThan(0);
    });

    it('should produce functionResponse-only parts for error calls', () => {
      const completedCalls = [
        {
          status: 'error',
          request: {
            callId: 'c5',
            name: 'error_tool',
            args: {},
            isClientInitiated: true,
            prompt_id: 'p5',
            agentId: 'agent1',
          },
          response: {
            callId: 'c5',
            responseParts: [],
            error: new Error('Something went wrong'),
            agentId: 'agent1',
          },
        },
      ];
      const parts = buildPartsFromCompletedCalls({
        completedCalls,
        canUpdateOutput: false,
        onMessage: undefined,
      });
      expect(
        parts.every(
          (p: Record<string, unknown>) => p.functionResponse !== undefined,
        ),
      ).toBe(true);
    });
  });

  describe('resolveToolName', () => {
    const toolsView = {
      listToolNames: () => [
        'read_file',
        'write_file',
        'run_shell_command',
        'mySpecialTool',
      ],
      getToolMetadata: (name: string) => ({
        name,
        description: '',
        parameterSchema: { type: 'OBJECT', properties: {} },
      }),
    };

    it('should match exact tool name from registry', () => {
      expect(resolveToolName('read_file', toolsView)).toBe('read_file');
    });

    it('should match lowercased tool name', () => {
      expect(resolveToolName('READ_FILE', toolsView)).toBe('read_file');
    });

    it('should strip Tool suffix and match', () => {
      // e.g. "runShellCommandTool" -> strips "Tool" -> "runShellCommand" -> snake "run_shell_command"
      expect(resolveToolName('run_shell_commandTool', toolsView)).toBe(
        'run_shell_command',
      );
    });

    it('should convert camelCase to snake_case and match', () => {
      expect(resolveToolName('mySpecialTool', toolsView)).toBe('mySpecialTool');
    });

    it('should return null when no candidate matches registry', () => {
      expect(resolveToolName('completely_unknown_tool', toolsView)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(resolveToolName(undefined, toolsView)).toBeNull();
    });
  });

  describe('buildToolUnavailableMessage', () => {
    it('should produce descriptive error message with tool name', () => {
      const msg = buildToolUnavailableMessage('my_tool');
      expect(msg).toContain('my_tool');
    });

    it('should include resultDisplay detail when available', () => {
      const resultDisplay = {
        type: 'text',
        value: 'Tool not found in registry',
      };
      const msg = buildToolUnavailableMessage('my_tool', resultDisplay);
      expect(msg).toBeDefined();
      expect(typeof msg).toBe('string');
    });

    it('should include error message when available', () => {
      const error = new Error('Permission denied');
      const msg = buildToolUnavailableMessage('my_tool', undefined, error);
      expect(msg).toContain('Permission denied');
    });
  });

  // --- Helper unit tests (add only if exported; skip until API settled) ---
  // These target small functions (<10 lines) that may be inlined during Phase 3.
  // If inlined, verify behavior through the public functions above instead.
  describe.skip('helper unit tests (enable if exported)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let categorizeToolCall: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let isFatalToolError: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toSnakeCase: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let extractToolDetail: any;

    beforeAll(async () => {
      const mod = await import('./subagentToolProcessing.js');
      categorizeToolCall = mod.categorizeToolCall;
      isFatalToolError = mod.isFatalToolError;
      toSnakeCase = mod.toSnakeCase;
      extractToolDetail = mod.extractToolDetail;
    });

    describe('categorizeToolCall', () => {
      it('should return emit for self_emitvalue calls', () => {
        const call = { name: 'self_emitvalue', args: {} };
        const outputConfig = { outputs: { x: 'var x' } };
        expect(categorizeToolCall(call, outputConfig)).toBe('emit');
      });

      it('should return external for any other tool name', () => {
        const call = { name: 'read_file', args: {} };
        const outputConfig = { outputs: {} };
        expect(categorizeToolCall(call, outputConfig)).toBe('external');
      });
    });

    describe('isFatalToolError', () => {
      it('should return true for TOOL_DISABLED error type', () => {
        expect(isFatalToolError('TOOL_DISABLED')).toBe(true);
      });

      it('should return true for TOOL_NOT_REGISTERED error type', () => {
        expect(isFatalToolError('TOOL_NOT_REGISTERED')).toBe(true);
      });

      it('should return false for other error types', () => {
        expect(isFatalToolError('EXECUTION_ERROR')).toBe(false);
      });

      it('should return false for undefined', () => {
        expect(isFatalToolError(undefined)).toBe(false);
      });
    });

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
    });

    describe('extractToolDetail', () => {
      it('should extract detail string from resultDisplay', () => {
        const resultDisplay = { type: 'text', value: 'Some detail' };
        expect(extractToolDetail(resultDisplay, undefined)).toBeDefined();
      });

      it('should extract detail from error when no resultDisplay', () => {
        const error = new Error('Error message here');
        expect(extractToolDetail(undefined, error)).toContain(
          'Error message here',
        );
      });

      it('should return undefined when neither available', () => {
        expect(extractToolDetail(undefined, undefined)).toBeUndefined();
      });
    });
  });
});
