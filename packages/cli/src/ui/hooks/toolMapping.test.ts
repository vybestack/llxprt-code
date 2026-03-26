/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mapCoreStatusToDisplayStatus, mapToDisplay } from './toolMapping.js';
import {
  DEFAULT_AGENT_ID,
  type AnyDeclarativeTool,
  type AnyToolInvocation,
  type ToolCallRequestInfo,
  type ToolCallResponseInfo,
  type Status,
  type ToolCall,
  type ScheduledToolCall,
  type SuccessfulToolCall,
  type ExecutingToolCall,
  type WaitingToolCall,
  type CancelledToolCall,
} from '@vybestack/llxprt-code-core';
import { ToolCallStatus } from '../types.js';

const { mockWarn } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    DebugLogger: {
      ...actual.DebugLogger,
      getLogger: () => ({
        warn: mockWarn,
        debug: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
      }),
    },
  };
});

describe('toolMapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mapCoreStatusToDisplayStatus', () => {
    it.each([
      ['validating', ToolCallStatus.Executing],
      ['awaiting_approval', ToolCallStatus.Confirming],
      ['executing', ToolCallStatus.Executing],
      ['success', ToolCallStatus.Success],
      ['cancelled', ToolCallStatus.Canceled],
      ['error', ToolCallStatus.Error],
      ['scheduled', ToolCallStatus.Pending],
    ] as const)('maps %s to %s', (coreStatus, expectedDisplayStatus) => {
      expect(mapCoreStatusToDisplayStatus(coreStatus)).toBe(
        expectedDisplayStatus,
      );
    });

    it('logs warning and defaults to Error for unknown status', () => {
      const result = mapCoreStatusToDisplayStatus('unknown_status' as Status);
      expect(result).toBe(ToolCallStatus.Error);
      expect(mockWarn).toHaveBeenCalled();
    });
  });

  describe('mapToDisplay', () => {
    const mockRequest: ToolCallRequestInfo = {
      callId: 'call-1',
      name: 'test_tool',
      args: { arg1: 'val1' },
      isClientInitiated: false,
      prompt_id: 'p1',
      agentId: 'request-agent',
    };

    const mockTool = {
      name: 'test_tool',
      displayName: 'Test Tool',
      isOutputMarkdown: true,
    } as unknown as AnyDeclarativeTool;

    const mockInvocation = {
      getDescription: () => 'Calling test_tool with args...',
    } as unknown as AnyToolInvocation;

    const mockResponse: ToolCallResponseInfo = {
      callId: 'call-1',
      responseParts: [],
      resultDisplay: 'Success output',
      error: undefined,
      errorType: undefined,
    };

    it('handles a single tool call input', () => {
      const toolCall: ScheduledToolCall = {
        status: 'scheduled',
        request: mockRequest,
        tool: mockTool,
        invocation: mockInvocation,
      };

      const result = mapToDisplay(toolCall);
      expect(result.type).toBe('tool_group');
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]?.callId).toBe('call-1');
    });

    it('handles an array of tool calls', () => {
      const toolCall1: ScheduledToolCall = {
        status: 'scheduled',
        request: mockRequest,
        tool: mockTool,
        invocation: mockInvocation,
      };
      const toolCall2: ScheduledToolCall = {
        status: 'scheduled',
        request: { ...mockRequest, callId: 'call-2' },
        tool: mockTool,
        invocation: mockInvocation,
      };

      const result = mapToDisplay([toolCall1, toolCall2]);
      expect(result.tools).toHaveLength(2);
      expect(result.tools[0]?.callId).toBe('call-1');
      expect(result.tools[1]?.callId).toBe('call-2');
    });

    it('maps successful tool call properties correctly', () => {
      const toolCall: SuccessfulToolCall = {
        status: 'success',
        request: mockRequest,
        tool: mockTool,
        invocation: mockInvocation,
        response: mockResponse,
      };

      const result = mapToDisplay(toolCall);
      const displayTool = result.tools[0];

      expect(displayTool).toEqual(
        expect.objectContaining({
          callId: 'call-1',
          name: 'Test Tool',
          description: 'Calling test_tool with args...',
          renderOutputAsMarkdown: true,
          status: ToolCallStatus.Success,
          resultDisplay: 'Success output',
        }),
      );
    });

    it('maps executing tool call properties correctly with live output and ptyId', () => {
      const toolCall: ExecutingToolCall = {
        status: 'executing',
        request: mockRequest,
        tool: mockTool,
        invocation: mockInvocation,
        liveOutput: 'Loading...',
        pid: 12345,
      };

      const result = mapToDisplay(toolCall);
      const displayTool = result.tools[0];

      expect(displayTool.status).toBe(ToolCallStatus.Executing);
      expect(displayTool.resultDisplay).toBe('Loading...');
      expect(displayTool.ptyId).toBe(12345);
    });

    it('maps awaiting_approval tool call properties with confirmationDetails', () => {
      const confirmationDetails = {
        type: 'exec' as const,
        title: 'Confirm Exec',
        command: 'ls',
        rootCommand: 'ls',
        rootCommands: ['ls'],
        onConfirm: vi.fn(),
      };

      const toolCall: WaitingToolCall = {
        status: 'awaiting_approval',
        request: mockRequest,
        tool: mockTool,
        invocation: mockInvocation,
        confirmationDetails,
      };

      const result = mapToDisplay(toolCall);
      const displayTool = result.tools[0];

      expect(displayTool.status).toBe(ToolCallStatus.Confirming);
      expect(displayTool.confirmationDetails).toEqual(confirmationDetails);
    });

    it('maps error tool call missing tool definition', () => {
      const toolCall: ToolCall = {
        status: 'error',
        request: mockRequest,
        response: { ...mockResponse, resultDisplay: 'Tool not found' },
      };

      const result = mapToDisplay(toolCall);
      const displayTool = result.tools[0];

      expect(displayTool.status).toBe(ToolCallStatus.Error);
      expect(displayTool.name).toBe('test_tool');
      expect(displayTool.description).toBe('{"arg1":"val1"}');
      expect(displayTool.resultDisplay).toBe('Tool not found');
      expect(displayTool.renderOutputAsMarkdown).toBe(false);
    });

    it('maps cancelled tool call properties correctly', () => {
      const toolCall: CancelledToolCall = {
        status: 'cancelled',
        request: mockRequest,
        tool: mockTool,
        invocation: mockInvocation,
        response: {
          ...mockResponse,
          resultDisplay: 'User cancelled',
        },
      };

      const result = mapToDisplay(toolCall);
      const displayTool = result.tools[0];

      expect(displayTool.status).toBe(ToolCallStatus.Canceled);
      expect(displayTool.resultDisplay).toBe('User cancelled');
    });

    describe('agentId precedence (LLxprt-specific)', () => {
      it('uses response.agentId when present (highest precedence)', () => {
        const toolCall: SuccessfulToolCall = {
          status: 'success',
          request: { ...mockRequest, agentId: 'request-agent' },
          tool: mockTool,
          invocation: mockInvocation,
          response: {
            ...mockResponse,
            agentId: 'response-agent',
          },
        };

        const result = mapToDisplay(toolCall);
        expect(result.agentId).toBe('response-agent');
      });

      it('falls back to request.agentId when response.agentId is absent', () => {
        const toolCall: SuccessfulToolCall = {
          status: 'success',
          request: { ...mockRequest, agentId: 'request-agent' },
          tool: mockTool,
          invocation: mockInvocation,
          response: {
            ...mockResponse,
            agentId: undefined,
          },
        };

        const result = mapToDisplay(toolCall);
        expect(result.agentId).toBe('request-agent');
      });

      it('falls back to DEFAULT_AGENT_ID when both response and request agentIds are absent', () => {
        const toolCall: SuccessfulToolCall = {
          status: 'success',
          request: { ...mockRequest, agentId: undefined },
          tool: mockTool,
          invocation: mockInvocation,
          response: {
            ...mockResponse,
            agentId: undefined,
          },
        };

        const result = mapToDisplay(toolCall);
        expect(result.agentId).toBe(DEFAULT_AGENT_ID);
      });

      it('falls back to DEFAULT_AGENT_ID when agentIds are empty strings', () => {
        const toolCall: SuccessfulToolCall = {
          status: 'success',
          request: { ...mockRequest, agentId: '' },
          tool: mockTool,
          invocation: mockInvocation,
          response: {
            ...mockResponse,
            agentId: '',
          },
        };

        const result = mapToDisplay(toolCall);
        expect(result.agentId).toBe(DEFAULT_AGENT_ID);
      });

      it('picks first valid agentId from a group of tool calls', () => {
        const toolCallWithNoAgent: ScheduledToolCall = {
          status: 'scheduled',
          request: {
            ...mockRequest,
            callId: 'call-no-agent',
            agentId: undefined,
          },
          tool: mockTool,
          invocation: mockInvocation,
        };
        const toolCallWithAgent: ScheduledToolCall = {
          status: 'scheduled',
          request: {
            ...mockRequest,
            callId: 'call-with-agent',
            agentId: 'sub-agent-1',
          },
          tool: mockTool,
          invocation: mockInvocation,
        };

        const result = mapToDisplay([toolCallWithNoAgent, toolCallWithAgent]);
        expect(result.agentId).toBe('sub-agent-1');
      });
    });
  });
});
