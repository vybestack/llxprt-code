import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { afterEach } from 'bun:test';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { unsupportedApprovalPolicy } from '@vybestack/llxprt-code-mcp/test-support/approval-policy.js';

import type {
  AnyToolInvocation,
  CompletedToolCall,
  ErroredToolCall,
} from '../index.js';
import { EditTool, ToolConfirmationOutcome, ToolErrorType } from '../index.js';
import { Config } from '../config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '../session/session-settings-owner.js';
import { WorkspaceFilesystemOwner } from '../services/workspace-filesystem-owner.js';
import { CoreToolHostAdapter } from '../tools-adapters/CoreToolHostAdapter.js';
import { EVENT_TOOL_CALL } from '@vybestack/llxprt-code-telemetry/telemetry/constants.js';
import { logToolCall } from '@vybestack/llxprt-code-telemetry/telemetry/loggers.js';
import { ToolCallDecision } from '@vybestack/llxprt-code-telemetry/telemetry/tool-call-decision.js';
import { ToolCallEvent } from '@vybestack/llxprt-code-telemetry/telemetry/types.js';
import { vi, describe, beforeEach, it, expect, setSystemTime } from 'bun:test';
import * as uiTelemetry from '@vybestack/llxprt-code-telemetry/telemetry/uiTelemetry.js';
import { DiscoveredMCPTool } from '@vybestack/llxprt-code-mcp';

describe('loggers', () => {
  let telemetry: RootTelemetry;
  let outfile: string;
  let host: CoreToolHostAdapter;
  let settings: SessionSettingsOwner;
  let files: WorkspaceFilesystemOwner;
  let config: Config;
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    outfile = join(
      mkdtempSync(join(tmpdir(), 'selected-logger-')),
      'events.jsonl',
    );
    telemetry = await RootTelemetry.create({
      sessionId: 'test-session-id',
      enabled: true,
      outfile,
      maxBytes: 1048576,
      maxFiles: 2,
      readPrivacySettings: () => ({
        logPrompts: true,
        logConversations: false,
        logApiBodies: false,
        maxChars: 4000,
      }),
    });
    config = new Config({
      sessionId: 'test-session-id',
      cwd: process.cwd(),
      targetDir: process.cwd(),
      model: 'test',
      debugMode: false,
      telemetry: { enabled: false },
    });
    settings = new SessionSettingsOwner(new SettingsService());
    settings.bindTelemetry(config, telemetry);
    files = new WorkspaceFilesystemOwner({
      targetDir: process.cwd(),
      includeDirectories: [],
      isTrusted: () => true,
    });
    host = new CoreToolHostAdapter(
      config,
      files.paths,
      files.files,
      files.ignore,
      files.scans,
      () => settings.readToolExecutionPolicy(),
      { isTrustedFolder: () => true, getIdeTrust: () => undefined },
      telemetry,
    );
    uiTelemetry.uiTelemetryService.reset();
    setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });
  afterEach(async () => {
    await settings.dispose();
    await files.dispose();
    await config.dispose();
    await telemetry.close();
    rmSync(dirname(outfile), { recursive: true, force: true });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  function exportedRecords(): Array<{
    body?: unknown;
    attributes: Record<string, unknown>;
  }> {
    if (!existsSync(outfile)) return [];
    return readFileSync(outfile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        const parsed = z
          .object({
            body: z.unknown().optional(),
            attributes: z.record(z.unknown()),
          })
          .safeParse(JSON.parse(line));
        return parsed.success ? [parsed.data] : [];
      });
  }
  async function exportedMetrics(): Promise<
    Array<{ name: string; points: unknown[] }>
  > {
    await telemetry.flush();
    if (!existsSync(outfile)) return [];
    const schema = z.object({
      scopeMetrics: z.array(
        z.object({
          metrics: z.array(
            z.object({
              descriptor: z.object({ name: z.string() }),
              dataPoints: z.array(z.unknown()),
            }),
          ),
        }),
      ),
    });
    return readFileSync(outfile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        const parsed = schema.safeParse(JSON.parse(line));
        return parsed.success
          ? parsed.data.scopeMetrics.flatMap((scope) =>
              scope.metrics.map((metric) => ({
                name: metric.descriptor.name,
                points: metric.dataPoints,
              })),
            )
          : [];
      });
  }

  describe('logToolCall', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getTargetDir: () => 'target-dir',
      getUsageStatisticsEnabled: () => true,
      getTelemetryEnabled: () => true,
      getTelemetryLogPromptsEnabled: () => true,
    } as Config;

    it('should log a tool call with all fields', async () => {
      const tool = new EditTool(host);
      const call: CompletedToolCall & { startMs?: number; endMs?: number } = {
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
          responseParts: [{ type: 'text', text: 'test-response' }],
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
        startMs: 0,
        endMs: 100,
        outcome: ToolConfirmationOutcome.ProceedOnce,
      };
      const event = new ToolCallEvent(call);

      logToolCall(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
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
          status: 'success',
          call_id: 'test-call-id',
          start_ms: 0,
          end_ms: 100,
          decision: ToolCallDecision.ACCEPT,
          prompt_id: 'prompt-id-1',
          tool_type: 'native',
          agent_id: 'agent-42',

          'metadata.ai_added_lines': '1',
          'metadata.ai_removed_lines': '2',
          'metadata.user_added_lines': '5',
          'metadata.user_removed_lines': '6',
        },
      });

      expect(await exportedMetrics()).toContainEqual(
        expect.objectContaining({
          name: 'llxprt_code.tool.call.count',
          points: expect.arrayContaining([
            expect.objectContaining({
              value: 1,
              attributes: {
                'session.id': 'test-session-id',
                function_name: 'test-function',
                decision: ToolCallDecision.ACCEPT,
                tool_type: 'native',
                success: true,
              },
            }),
          ]),
        }),
      );

      expect(await exportedMetrics()).toContainEqual(
        expect.objectContaining({
          name: 'llxprt_code.tool.call.latency',
          points: expect.arrayContaining([
            expect.objectContaining({
              value: expect.objectContaining({ sum: 100, count: 1 }),
              attributes: {
                'session.id': 'test-session-id',
                function_name: 'test-function',
                decision: ToolCallDecision.ACCEPT,
                tool_type: 'native',
              },
            }),
          ]),
        }),
      );
      expect(
        uiTelemetry.uiTelemetryService.getMetrics().tools.byName[
          'test-function'
        ],
      ).toMatchObject({
        count: 1,
        success: 1,
        fail: 0,
        cancelled: 0,
        durationMs: 100,
      });
    });
    it('should log a tool call with a reject decision', async () => {
      const call: ErroredToolCall & { startMs?: number; endMs?: number } = {
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
          responseParts: [{ type: 'text', text: 'test-response' }],
          resultDisplay: undefined,

          error: undefined,
          errorType: undefined,
          agentId: 'agent-99',
        },
        durationMs: 100,
        startMs: 0,
        endMs: 100,
        outcome: ToolConfirmationOutcome.Cancel,
      };
      const event = new ToolCallEvent(call);

      logToolCall(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
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
          status: 'error',
          call_id: 'test-call-id',
          start_ms: 0,
          end_ms: 100,
          decision: ToolCallDecision.REJECT,
          prompt_id: 'prompt-id-2',
          tool_type: 'native',
          agent_id: 'agent-99',
        },
      });

      expect(await exportedMetrics()).toContainEqual(
        expect.objectContaining({
          name: 'llxprt_code.tool.call.count',
          points: expect.arrayContaining([
            expect.objectContaining({
              value: 1,
              attributes: {
                'session.id': 'test-session-id',
                function_name: 'test-function',
                decision: ToolCallDecision.REJECT,
                tool_type: 'native',
                success: false,
              },
            }),
          ]),
        }),
      );

      expect(await exportedMetrics()).toContainEqual(
        expect.objectContaining({
          name: 'llxprt_code.tool.call.latency',
          points: expect.arrayContaining([
            expect.objectContaining({
              value: expect.objectContaining({ sum: 100, count: 1 }),
              attributes: {
                'session.id': 'test-session-id',
                function_name: 'test-function',
                decision: ToolCallDecision.REJECT,
                tool_type: 'native',
              },
            }),
          ]),
        }),
      );
      expect(
        uiTelemetry.uiTelemetryService.getMetrics().tools.byName[
          'test-function'
        ],
      ).toMatchObject({
        count: 1,
        success: 0,
        fail: 1,
        cancelled: 0,
        durationMs: 100,
      });
    });

    it('should log a tool call with a modify decision', async () => {
      const call: CompletedToolCall & { startMs?: number; endMs?: number } = {
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
          responseParts: [{ type: 'text', text: 'test-response' }],
          resultDisplay: undefined,

          error: undefined,
          errorType: undefined,
          agentId: 'agent-modify',
        },
        outcome: ToolConfirmationOutcome.ModifyWithEditor,
        tool: new EditTool(host),
        invocation: {} as AnyToolInvocation,
        durationMs: 100,
        startMs: 0,
        endMs: 100,
      };
      const event = new ToolCallEvent(call);

      logToolCall(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
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
          status: 'success',
          call_id: 'test-call-id',
          start_ms: 0,
          end_ms: 100,
          decision: ToolCallDecision.MODIFY,
          prompt_id: 'prompt-id-3',
          tool_type: 'native',
          agent_id: 'agent-modify',
        },
      });

      expect(await exportedMetrics()).toContainEqual(
        expect.objectContaining({
          name: 'llxprt_code.tool.call.count',
          points: expect.arrayContaining([
            expect.objectContaining({
              value: 1,
              attributes: {
                'session.id': 'test-session-id',
                function_name: 'test-function',
                decision: ToolCallDecision.MODIFY,
                tool_type: 'native',
                success: true,
              },
            }),
          ]),
        }),
      );

      expect(await exportedMetrics()).toContainEqual(
        expect.objectContaining({
          name: 'llxprt_code.tool.call.latency',
          points: expect.arrayContaining([
            expect.objectContaining({
              value: expect.objectContaining({ sum: 100, count: 1 }),
              attributes: {
                'session.id': 'test-session-id',
                function_name: 'test-function',
                decision: ToolCallDecision.MODIFY,
                tool_type: 'native',
              },
            }),
          ]),
        }),
      );
      expect(
        uiTelemetry.uiTelemetryService.getMetrics().tools.byName[
          'test-function'
        ],
      ).toMatchObject({
        count: 1,
        success: 1,
        fail: 0,
        cancelled: 0,
        durationMs: 100,
      });
    });

    it('should log a tool call without a decision', async () => {
      const call: CompletedToolCall & { startMs?: number; endMs?: number } = {
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
          responseParts: [{ type: 'text', text: 'test-response' }],
          resultDisplay: undefined,

          error: undefined,
          errorType: undefined,
          agentId: 'agent-nodecision',
        },
        tool: new EditTool(host),
        invocation: {} as AnyToolInvocation,
        durationMs: 100,
        startMs: 0,
        endMs: 100,
      };
      const event = new ToolCallEvent(call);

      logToolCall(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
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
          status: 'success',
          call_id: 'test-call-id',
          start_ms: 0,
          end_ms: 100,
          decision: undefined,

          prompt_id: 'prompt-id-4',
          tool_type: 'native',
          agent_id: 'agent-nodecision',
        },
      });

      expect(await exportedMetrics()).toContainEqual(
        expect.objectContaining({
          name: 'llxprt_code.tool.call.count',
          points: expect.arrayContaining([
            expect.objectContaining({
              value: 1,
              attributes: {
                'session.id': 'test-session-id',
                function_name: 'test-function',
                tool_type: 'native',
                success: true,
              },
            }),
          ]),
        }),
      );

      expect(await exportedMetrics()).toContainEqual(
        expect.objectContaining({
          name: 'llxprt_code.tool.call.latency',
          points: expect.arrayContaining([
            expect.objectContaining({
              value: expect.objectContaining({ sum: 100, count: 1 }),
              attributes: {
                'session.id': 'test-session-id',
                function_name: 'test-function',
                tool_type: 'native',
              },
            }),
          ]),
        }),
      );
      expect(
        uiTelemetry.uiTelemetryService.getMetrics().tools.byName[
          'test-function'
        ],
      ).toMatchObject({
        count: 1,
        success: 1,
        fail: 0,
        cancelled: 0,
        durationMs: 100,
      });
    });

    it('should log a failed tool call with an error', async () => {
      const call: ErroredToolCall & { startMs?: number; endMs?: number } = {
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
          responseParts: [{ type: 'text', text: 'test-response' }],
          resultDisplay: undefined,
          error: {
            name: 'test-error-type',
            message: 'test-error',
          },
          errorType: ToolErrorType.UNKNOWN,
          agentId: 'agent-failure',
        },
        durationMs: 100,
        startMs: 0,
        endMs: 100,
      };
      const event = new ToolCallEvent(call);

      logToolCall(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
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
          status: 'error',
          call_id: 'test-call-id',
          start_ms: 0,
          end_ms: 100,
          decision: undefined,
          error: 'test-error',
          'error.message': 'test-error',
          error_type: ToolErrorType.UNKNOWN,
          'error.type': ToolErrorType.UNKNOWN,
          prompt_id: 'prompt-id-5',
          tool_type: 'native',
          agent_id: 'agent-failure',
        },
      });

      expect(await exportedMetrics()).toContainEqual(
        expect.objectContaining({
          name: 'llxprt_code.tool.call.count',
          points: expect.arrayContaining([
            expect.objectContaining({
              value: 1,
              attributes: {
                'session.id': 'test-session-id',
                function_name: 'test-function',
                tool_type: 'native',
                success: false,
              },
            }),
          ]),
        }),
      );

      expect(await exportedMetrics()).toContainEqual(
        expect.objectContaining({
          name: 'llxprt_code.tool.call.latency',
          points: expect.arrayContaining([
            expect.objectContaining({
              value: expect.objectContaining({ sum: 100, count: 1 }),
              attributes: {
                'session.id': 'test-session-id',
                function_name: 'test-function',
                tool_type: 'native',
              },
            }),
          ]),
        }),
      );
      expect(
        uiTelemetry.uiTelemetryService.getMetrics().tools.byName[
          'test-function'
        ],
      ).toMatchObject({
        count: 1,
        success: 0,
        fail: 1,
        cancelled: 0,
        durationMs: 100,
      });
    });

    it('should log a tool call with mcp_server_name for MCP tools', async () => {
      const mockMcpTool = new DiscoveredMCPTool(
        unsupportedApprovalPolicy(),
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

      const call: CompletedToolCall & { startMs?: number; endMs?: number } = {
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
          responseParts: [{ type: 'text', text: 'test-response' }],
          resultDisplay: undefined,

          error: undefined,
          errorType: undefined,
        },
        tool: mockMcpTool,
        invocation: {} as AnyToolInvocation,
        durationMs: 100,
        startMs: 0,
        endMs: 100,
      };
      const event = new ToolCallEvent(call);

      logToolCall(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
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
          status: 'success',
          call_id: 'test-call-id',
          start_ms: 0,
          end_ms: 100,
          prompt_id: 'prompt-id',
          tool_type: 'mcp',
          agent_id: 'primary',
          decision: undefined,
        },
      });
    });
  });
});
