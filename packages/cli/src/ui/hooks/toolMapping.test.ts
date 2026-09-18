/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { Buffer } from 'node:buffer';
import {
  DEFAULT_AGENT_ID,
  type AnyDeclarativeTool,
  type AnyToolInvocation,
  type FileDiff,
  type FileRead,
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
import {
  RETENTION_TRUNCATION_MARKER,
  TOOL_RESULT_RETENTION_CAP_BYTES,
} from '../utils/toolResultRetention.js';

const { mockWarn } = {
  mockWarn: vi.fn(),
};

const actual = { ...(await import('@vybestack/llxprt-code-telemetry')) };
void vi.mock('@vybestack/llxprt-code-telemetry', () => ({
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
}));

// Loaded with top-level await instead of a static import: toolMapping.ts
// resolves its logger at module scope, so it must be evaluated AFTER the mock
// above is registered.
const { mapCoreStatusToDisplayStatus, mapToDisplay } = await import(
  './toolMapping.js'
);

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

      expect(displayTool).toStrictEqual(
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

    it('propagates outputFile for successful tool calls when present', () => {
      const responseWithOutputFile = {
        ...mockResponse,
        outputFile: '/tmp/tool-output.txt',
      } as ToolCallResponseInfo & { outputFile: string };

      const toolCall: SuccessfulToolCall = {
        status: 'success',
        request: mockRequest,
        tool: mockTool,
        invocation: mockInvocation,
        response: responseWithOutputFile,
      };

      const result = mapToDisplay(toolCall);
      const displayTool = result.tools[0];

      expect(displayTool.outputFile).toBe('/tmp/tool-output.txt');
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
      expect(displayTool.confirmationDetails).toStrictEqual(
        confirmationDetails,
      );
    });

    it('maps error tool call missing tool definition without exposing raw args', () => {
      const toolCall: ToolCall = {
        status: 'error',
        request: mockRequest,
        response: {
          ...mockResponse,
          error: new Error('Tool not found'),
          resultDisplay: 'Tool not found',
        },
      };

      const result = mapToDisplay(toolCall);
      const displayTool = result.tools[0];

      expect(displayTool.status).toBe(ToolCallStatus.Error);
      expect(displayTool.name).toBe('test_tool');
      expect(displayTool.description).toBe('Tool not found');
      expect(displayTool.resultDisplay).toBe('Tool not found');
      expect(displayTool.renderOutputAsMarkdown).toBe(false);
    });

    it('uses invocation description for errors after invocation was built', () => {
      const dogSequence = '\u{1F415}\u{1F436}\u{1F415}\u{1F436}';
      const toolCall = {
        status: 'error',
        request: {
          ...mockRequest,
          args: { reason: dogSequence },
        },
        tool: mockTool,
        invocation: {
          getDescription: () =>
            'Pause AI continuation: Pause reason is empty after emoji filtering',
        } as unknown as AnyToolInvocation,
        response: {
          ...mockResponse,
          error: new Error('Pause reason is empty after emoji filtering'),
          resultDisplay: 'Pause reason is empty after emoji filtering',
        },
      } as ToolCall;

      const result = mapToDisplay(toolCall);
      const displayTool = result.tools[0];

      expect(displayTool.status).toBe(ToolCallStatus.Error);
      expect(displayTool.name).toBe('Test Tool');
      expect(displayTool.description).toBe(
        'Pause AI continuation: Pause reason is empty after emoji filtering',
      );
      expect(displayTool.description).not.toContain(dogSequence);
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

    describe('retention cap at display commit (issue #3428)', () => {
      it('caps a large string result display to the retention cap and records retention', () => {
        const body = 'x'.repeat(200 * 1024);
        const toolCall: SuccessfulToolCall = {
          status: 'success',
          request: mockRequest,
          tool: mockTool,
          invocation: mockInvocation,
          response: { ...mockResponse, resultDisplay: body },
        };

        const displayTool = mapToDisplay(toolCall).tools[0];
        const display = displayTool.resultDisplay;

        expect(typeof display).toBe('string');
        expect(
          Buffer.byteLength(display as string, 'utf8'),
        ).toBeLessThanOrEqual(64 * 1024);
        expect(display).toContain('session transcript');
        expect(displayTool.retention).toStrictEqual({
          capped: true,
          originalLength: 200 * 1024,
        });
        // The scheduler's response is the model-facing copy; it is untouched.
        expect(toolCall.response.resultDisplay).toBe(body);
      });

      it('leaves small string results uncapped with no retention metadata', () => {
        const toolCall: SuccessfulToolCall = {
          status: 'success',
          request: mockRequest,
          tool: mockTool,
          invocation: mockInvocation,
          response: { ...mockResponse, resultDisplay: 'Success output' },
        };

        const displayTool = mapToDisplay(toolCall).tools[0];

        expect(displayTool.resultDisplay).toBe('Success output');
        expect(displayTool.retention).toBeUndefined();
      });

      it('passes structured result displays through untouched', () => {
        const fileDiffDisplay = {
          fileDiff: '--- a' + String.fromCharCode(10) + '+++ b',
          fileName: 'a.ts',
          originalContent: 'a',
          newContent: 'b',
        };
        const toolCall: SuccessfulToolCall = {
          status: 'success',
          request: mockRequest,
          tool: mockTool,
          invocation: mockInvocation,
          response: { ...mockResponse, resultDisplay: fileDiffDisplay },
        };

        const displayTool = mapToDisplay(toolCall).tools[0];

        expect(displayTool.resultDisplay).toBe(fileDiffDisplay);
        expect(displayTool.retention).toBeUndefined();
      });

      it('bounds each long field of a large FileDiff without stringifying it', () => {
        const fileDiff = `diff-head
${'d'.repeat(150 * 1024)}`;
        const originalContent = `orig
${'o'.repeat(200 * 1024)}`;
        const newContent = `new
${'n'.repeat(180 * 1024)}`;
        const fileDiffDisplay = {
          fileDiff,
          fileName: 'a.ts',
          originalContent,
          newContent,
        };
        const toolCall: SuccessfulToolCall = {
          status: 'success',
          request: mockRequest,
          tool: mockTool,
          invocation: mockInvocation,
          response: { ...mockResponse, resultDisplay: fileDiffDisplay },
        };

        const displayTool = mapToDisplay(toolCall).tools[0];
        const display = displayTool.resultDisplay as FileDiff;

        // Shape preserved: the display is still the structured FileDiff
        // object DiffRenderer consumes, never a stringified body.
        expect(typeof display).toBe('object');
        expect(display).not.toBe(fileDiffDisplay);
        expect(display.fileName).toBe('a.ts');
        // Each long field is bounded to the cap with the head+tail marker.
        for (const field of [
          display.fileDiff,
          display.originalContent as string,
          display.newContent,
        ]) {
          expect(Buffer.byteLength(field, 'utf8')).toBeLessThanOrEqual(
            TOOL_RESULT_RETENTION_CAP_BYTES,
          );
          expect(field).toContain(RETENTION_TRUNCATION_MARKER);
        }
        // Retention metadata is set so the transcript hint renders.
        expect(displayTool.retention).toStrictEqual({
          capped: true,
          originalLength:
            Buffer.byteLength(fileDiff, 'utf8') +
            Buffer.byteLength(originalContent, 'utf8') +
            Buffer.byteLength(newContent, 'utf8'),
        });
        // AC5: the scheduler's response is the model-facing copy; it stays
        // unmutated, fields included.
        expect(toolCall.response.resultDisplay).toBe(fileDiffDisplay);
        expect(toolCall.response.resultDisplay).toStrictEqual({
          fileDiff,
          fileName: 'a.ts',
          originalContent,
          newContent,
        });
      });

      it('bounds a large FileRead content field while keeping the display structured', () => {
        const content = `read
${'r'.repeat(300 * 1024)}`;
        const fileReadDisplay = {
          content,
          fileName: 'b.txt',
          filePath: '/tmp/b.txt',
        };
        const toolCall: SuccessfulToolCall = {
          status: 'success',
          request: mockRequest,
          tool: mockTool,
          invocation: mockInvocation,
          response: { ...mockResponse, resultDisplay: fileReadDisplay },
        };

        const displayTool = mapToDisplay(toolCall).tools[0];
        const display = displayTool.resultDisplay as FileRead;

        expect(typeof display).toBe('object');
        expect(display).not.toBe(fileReadDisplay);
        expect(display.fileName).toBe('b.txt');
        expect(display.filePath).toBe('/tmp/b.txt');
        expect(Buffer.byteLength(display.content, 'utf8')).toBeLessThanOrEqual(
          TOOL_RESULT_RETENTION_CAP_BYTES,
        );
        expect(display.content).toContain(RETENTION_TRUNCATION_MARKER);
        expect(displayTool.retention).toStrictEqual({
          capped: true,
          originalLength: Buffer.byteLength(content, 'utf8'),
        });
        expect(toolCall.response.resultDisplay).toBe(fileReadDisplay);
        expect(toolCall.response.resultDisplay).toStrictEqual(fileReadDisplay);
      });

      it('caps large error result displays too', () => {
        const body = 'y'.repeat(150 * 1024);
        const toolCall: ToolCall = {
          status: 'error',
          request: mockRequest,
          tool: mockTool,
          invocation: mockInvocation,
          response: {
            ...mockResponse,
            error: new Error('boom'),
            resultDisplay: body,
          },
        };

        const displayTool = mapToDisplay(toolCall).tools[0];

        expect(
          Buffer.byteLength(displayTool.resultDisplay as string),
        ).toBeLessThanOrEqual(64 * 1024);
        expect(displayTool.retention?.capped).toBe(true);
        expect(toolCall.response.resultDisplay).toBe(body);
      });
    });
  });
});
