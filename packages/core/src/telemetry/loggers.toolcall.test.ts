/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AnyToolInvocation,
  CompletedToolCall,
  ErroredToolCall,
} from '../index.js';
import { EditTool, ToolConfirmationOutcome, ToolErrorType } from '../index.js';
import { logs } from '@opentelemetry/api-logs';
import type { Config } from '../config/config.js';
import { EVENT_TOOL_CALL } from '@vybestack/llxprt-code-telemetry/telemetry/constants.js';
import { logToolCall } from '@vybestack/llxprt-code-telemetry/telemetry/loggers.js';
import { ToolCallDecision } from '@vybestack/llxprt-code-telemetry/telemetry/tool-call-decision.js';
import { ToolCallEvent } from '@vybestack/llxprt-code-telemetry/telemetry/types.js';
import * as metrics from '@vybestack/llxprt-code-telemetry/telemetry/metrics.js';
import * as sdk from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import * as uiTelemetry from './uiTelemetry.js';
import { DiscoveredMCPTool } from '@vybestack/llxprt-code-mcp';

// Mock ClearcutLogger to avoid import errors
const mockClearcutLogger = {
  prototype: {
    logMalformedJsonResponseEvent: vi.fn(),
    logModelRoutingEvent: vi.fn(),
    logExtensionInstallEvent: vi.fn(),
    logExtensionUninstallEvent: vi.fn(),
    logExtensionEnableEvent: vi.fn(),
    logExtensionDisableEvent: vi.fn(),
  },
};

(globalThis as { ClearcutLogger?: typeof mockClearcutLogger }).ClearcutLogger =
  mockClearcutLogger;

describe('loggers', () => {
  const mockLogger = {
    emit: vi.fn(),
  };
  const mockUiEvent = {
    addEvent: vi.fn(),
  };

  beforeEach(() => {
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(true);
    vi.spyOn(logs, 'getLogger').mockReturnValue(mockLogger);
    vi.spyOn(uiTelemetry.uiTelemetryService, 'addEvent').mockImplementation(
      mockUiEvent.addEvent,
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });

  describe('logToolCall', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getTargetDir: () => 'target-dir',
      getUsageStatisticsEnabled: () => true,
      getTelemetryEnabled: () => true,
      getTelemetryLogPromptsEnabled: () => true,
    } as Config;

    const mockMetrics = {
      recordToolCallMetrics: vi.fn(),
    };

    beforeEach(() => {
      vi.spyOn(metrics, 'recordToolCallMetrics').mockImplementation(
        mockMetrics.recordToolCallMetrics,
      );
      mockLogger.emit.mockReset();
    });

    it('should log a tool call with all fields', () => {
      const tool = new EditTool(mockConfig);
      const call: CompletedToolCall = {
        status: 'success',
        request: {
          name: 'test-function',
          args: {
            arg1: 'value1',
            arg2: 2,
          },
          callId: 'test-call-id',
          isClientInitiated: true,
          prompt_id: 'prompt-id-1',
          agentId: 'agent-42',
        },
        response: {
          callId: 'test-call-id',
          responseParts: [{ text: 'test-response' }],
          resultDisplay: {
            fileDiff: 'diff',
            fileName: 'file.txt',
            filePath: 'file.txt',
            originalContent: 'old content',
            newContent: 'new content',
            diffStat: {
              ai_added_lines: 1,
              ai_removed_lines: 2,
              user_added_lines: 5,
              user_removed_lines: 6,
            },
          },
          error: undefined,
          errorType: undefined,
          agentId: 'agent-42',
        },
        tool,
        invocation: {} as AnyToolInvocation,
        durationMs: 100,
        outcome: ToolConfirmationOutcome.ProceedOnce,
      };
      const event = new ToolCallEvent(call);

      logToolCall(mockConfig, event);

      expect(mockLogger.emit).toHaveBeenCalledWith({
        body: 'Tool call: test-function. Decision: accept. Success: true. Duration: 100ms.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_TOOL_CALL,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          function_name: 'test-function',
          function_args: JSON.stringify(
            {
              arg1: 'value1',
              arg2: 2,
            },
            null,
            2,
          ),
          duration_ms: 100,
          success: true,
          decision: ToolCallDecision.ACCEPT,
          prompt_id: 'prompt-id-1',
          tool_type: 'native',
          agent_id: 'agent-42',
          error: undefined,
          error_type: undefined,
          'metadata.ai_added_lines': '1',
          'metadata.ai_removed_lines': '2',
          'metadata.user_added_lines': '5',
          'metadata.user_removed_lines': '6',
        },
      });

      expect(mockMetrics.recordToolCallMetrics).toHaveBeenCalledWith(
        mockConfig,
        'test-function',
        100,
        true,
        ToolCallDecision.ACCEPT,
        'native',
      );

      expect(mockUiEvent.addEvent).toHaveBeenCalledWith({
        ...event,
        'event.name': EVENT_TOOL_CALL,
        'event.timestamp': '2025-01-01T00:00:00.000Z',
        agent_id: 'agent-42',
      });
    });
    it('should log a tool call with a reject decision', () => {
      const call: ErroredToolCall = {
        status: 'error',
        request: {
          name: 'test-function',
          args: {
            arg1: 'value1',
            arg2: 2,
          },
          callId: 'test-call-id',
          isClientInitiated: true,
          prompt_id: 'prompt-id-2',
          agentId: 'agent-99',
        },
        response: {
          callId: 'test-call-id',
          responseParts: [{ text: 'test-response' }],
          resultDisplay: undefined,
          error: undefined,
          errorType: undefined,
          agentId: 'agent-99',
        },
        durationMs: 100,
        outcome: ToolConfirmationOutcome.Cancel,
      };
      const event = new ToolCallEvent(call);

      logToolCall(mockConfig, event);

      expect(mockLogger.emit).toHaveBeenCalledWith({
        body: 'Tool call: test-function. Decision: reject. Success: false. Duration: 100ms.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_TOOL_CALL,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          function_name: 'test-function',
          function_args: JSON.stringify(
            {
              arg1: 'value1',
              arg2: 2,
            },
            null,
            2,
          ),
          duration_ms: 100,
          success: false,
          decision: ToolCallDecision.REJECT,
          prompt_id: 'prompt-id-2',
          tool_type: 'native',
          agent_id: 'agent-99',
        },
      });

      expect(mockMetrics.recordToolCallMetrics).toHaveBeenCalledWith(
        mockConfig,
        'test-function',
        100,
        false,
        ToolCallDecision.REJECT,
        'native',
      );

      expect(mockUiEvent.addEvent).toHaveBeenCalledWith({
        ...event,
        'event.name': EVENT_TOOL_CALL,
        'event.timestamp': '2025-01-01T00:00:00.000Z',
        agent_id: 'agent-99',
      });
    });

    it('should log a tool call with a modify decision', () => {
      const call: CompletedToolCall = {
        status: 'success',
        request: {
          name: 'test-function',
          args: {
            arg1: 'value1',
            arg2: 2,
          },
          callId: 'test-call-id',
          isClientInitiated: true,
          prompt_id: 'prompt-id-3',
          agentId: 'agent-modify',
        },
        response: {
          callId: 'test-call-id',
          responseParts: [{ text: 'test-response' }],
          resultDisplay: undefined,
          error: undefined,
          errorType: undefined,
          agentId: 'agent-modify',
        },
        outcome: ToolConfirmationOutcome.ModifyWithEditor,
        tool: new EditTool(mockConfig),
        invocation: {} as AnyToolInvocation,
        durationMs: 100,
      };
      const event = new ToolCallEvent(call);

      logToolCall(mockConfig, event);

      expect(mockLogger.emit).toHaveBeenCalledWith({
        body: 'Tool call: test-function. Decision: modify. Success: true. Duration: 100ms.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_TOOL_CALL,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          function_name: 'test-function',
          function_args: JSON.stringify(
            {
              arg1: 'value1',
              arg2: 2,
            },
            null,
            2,
          ),
          duration_ms: 100,
          success: true,
          decision: ToolCallDecision.MODIFY,
          prompt_id: 'prompt-id-3',
          tool_type: 'native',
          agent_id: 'agent-modify',
        },
      });

      expect(mockMetrics.recordToolCallMetrics).toHaveBeenCalledWith(
        mockConfig,
        'test-function',
        100,
        true,
        ToolCallDecision.MODIFY,
        'native',
      );

      expect(mockUiEvent.addEvent).toHaveBeenCalledWith({
        ...event,
        'event.name': EVENT_TOOL_CALL,
        'event.timestamp': '2025-01-01T00:00:00.000Z',
        agent_id: 'agent-modify',
      });
    });

    it('should log a tool call without a decision', () => {
      const call: CompletedToolCall = {
        status: 'success',
        request: {
          name: 'test-function',
          args: {
            arg1: 'value1',
            arg2: 2,
          },
          callId: 'test-call-id',
          isClientInitiated: true,
          prompt_id: 'prompt-id-4',
          agentId: 'agent-nodecision',
        },
        response: {
          callId: 'test-call-id',
          responseParts: [{ text: 'test-response' }],
          resultDisplay: undefined,
          error: undefined,
          errorType: undefined,
          agentId: 'agent-nodecision',
        },
        tool: new EditTool(mockConfig),
        invocation: {} as AnyToolInvocation,
        durationMs: 100,
      };
      const event = new ToolCallEvent(call);

      logToolCall(mockConfig, event);

      expect(mockLogger.emit).toHaveBeenCalledWith({
        body: 'Tool call: test-function. Success: true. Duration: 100ms.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_TOOL_CALL,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          function_name: 'test-function',
          function_args: JSON.stringify(
            {
              arg1: 'value1',
              arg2: 2,
            },
            null,
            2,
          ),
          duration_ms: 100,
          success: true,
          prompt_id: 'prompt-id-4',
          tool_type: 'native',
          agent_id: 'agent-nodecision',
        },
      });

      expect(mockMetrics.recordToolCallMetrics).toHaveBeenCalledWith(
        mockConfig,
        'test-function',
        100,
        true,
        undefined,
        'native',
      );

      expect(mockUiEvent.addEvent).toHaveBeenCalledWith({
        ...event,
        'event.name': EVENT_TOOL_CALL,
        'event.timestamp': '2025-01-01T00:00:00.000Z',
        agent_id: 'agent-nodecision',
      });
    });

    it('should log a failed tool call with an error', () => {
      const call: ErroredToolCall = {
        status: 'error',
        request: {
          name: 'test-function',
          args: {
            arg1: 'value1',
            arg2: 2,
          },
          callId: 'test-call-id',
          isClientInitiated: true,
          prompt_id: 'prompt-id-5',
          agentId: 'agent-failure',
        },
        response: {
          callId: 'test-call-id',
          responseParts: [{ text: 'test-response' }],
          resultDisplay: undefined,
          error: {
            name: 'test-error-type',
            message: 'test-error',
          },
          errorType: ToolErrorType.UNKNOWN,
          agentId: 'agent-failure',
        },
        durationMs: 100,
      };
      const event = new ToolCallEvent(call);

      logToolCall(mockConfig, event);

      expect(mockLogger.emit).toHaveBeenCalledWith({
        body: 'Tool call: test-function. Success: false. Duration: 100ms.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_TOOL_CALL,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          function_name: 'test-function',
          function_args: JSON.stringify(
            {
              arg1: 'value1',
              arg2: 2,
            },
            null,
            2,
          ),
          duration_ms: 100,
          success: false,
          error: 'test-error',
          'error.message': 'test-error',
          error_type: ToolErrorType.UNKNOWN,
          'error.type': ToolErrorType.UNKNOWN,
          prompt_id: 'prompt-id-5',
          tool_type: 'native',
          agent_id: 'agent-failure',
        },
      });

      expect(mockMetrics.recordToolCallMetrics).toHaveBeenCalledWith(
        mockConfig,
        'test-function',
        100,
        false,
        undefined,
        'native',
      );

      expect(mockUiEvent.addEvent).toHaveBeenCalledWith({
        ...event,
        'event.name': EVENT_TOOL_CALL,
        'event.timestamp': '2025-01-01T00:00:00.000Z',
        agent_id: 'agent-failure',
      });
    });

    it('should log a tool call with mcp_server_name for MCP tools', () => {
      const mockMcpTool = new DiscoveredMCPTool(
        {} as never,
        'mock_mcp_server',
        'mock_mcp_tool',
        'tool description',
        {
          type: 'object',
          properties: {
            arg1: { type: 'string' },
            arg2: { type: 'number' },
          },
          required: ['arg1', 'arg2'],
        },
      );

      const call: CompletedToolCall = {
        status: 'success',
        request: {
          name: 'mock_mcp_tool',
          args: { arg1: 'value1', arg2: 2 },
          callId: 'test-call-id',
          isClientInitiated: true,
          prompt_id: 'prompt-id',
        },
        response: {
          callId: 'test-call-id',
          responseParts: [{ text: 'test-response' }],
          resultDisplay: undefined,
          error: undefined,
          errorType: undefined,
        },
        tool: mockMcpTool,
        invocation: {} as AnyToolInvocation,
        durationMs: 100,
      };
      const event = new ToolCallEvent(call);

      logToolCall(mockConfig, event);

      expect(mockLogger.emit).toHaveBeenCalledWith({
        body: 'Tool call: mock_mcp_tool. Success: true. Duration: 100ms.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_TOOL_CALL,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          function_name: 'mock_mcp_tool',
          function_args: JSON.stringify(
            {
              arg1: 'value1',
              arg2: 2,
            },
            null,
            2,
          ),
          duration_ms: 100,
          success: true,
          prompt_id: 'prompt-id',
          tool_type: 'mcp',
          agent_id: 'primary',
          decision: undefined,
          error: undefined,
          error_type: undefined,
        },
      });
    });
  });
});
