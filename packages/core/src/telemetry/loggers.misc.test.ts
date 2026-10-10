import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { z } from 'zod';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { HookEventName, type BeforeToolInput } from '../hooks/types.js';
import type { Config } from '../config/config.js';
import {
  EVENT_HOOK_CALL,
  EVENT_FILE_OPERATION,
  EVENT_TOOL_OUTPUT_TRUNCATED,
  EVENT_MALFORMED_JSON_RESPONSE,
  EVENT_MODEL_ROUTING,
  EVENT_EXTENSION_INSTALL,
  EVENT_EXTENSION_UNINSTALL,
  EVENT_EXTENSION_ENABLE,
  EVENT_EXTENSION_DISABLE,
} from '@vybestack/llxprt-code-telemetry/telemetry/constants.js';
import {
  HookCallEvent,
  FileOperationEvent,
  ToolOutputTruncatedEvent,
  MalformedJsonResponseEvent,
  ModelRoutingEvent,
  ExtensionInstallEvent,
  ExtensionUninstallEvent,
  ExtensionEnableEvent,
  ExtensionDisableEvent,
  FileOperation,
} from '@vybestack/llxprt-code-telemetry/telemetry/types.js';
import {
  vi,
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
  setSystemTime,
} from 'bun:test';

const {
  logHookCall,
  logFileOperation,
  logToolOutputTruncated,
  logMalformedJsonResponse,
  logModelRouting,
  logExtensionInstallEvent,
  logExtensionUninstall,
  logExtensionEnable,
  logExtensionDisable,
} = await import('@vybestack/llxprt-code-telemetry/telemetry/loggers.js');
const uiTelemetry = await import('./uiTelemetry.js');

describe('loggers', () => {
  let telemetry: RootTelemetry;
  let outfile: string;
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
    uiTelemetry.uiTelemetryService.reset();
    setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });
  afterEach(async () => {
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

  describe('logHookCall', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getTelemetryEnabled: () => true,
      getTelemetryLogPromptsEnabled: () => true,
    } as unknown as Config;

    it('should log a hook call event', async () => {
      const input: BeforeToolInput = {
        session_id: 'session-1',
        cwd: '/tmp',
        hook_event_name: 'BeforeTool',
        timestamp: '2025-01-01T00:00:00.000Z',
        transcript_path: '/tmp/transcript.jsonl',
        tool_name: 'write_file',
        tool_input: { file_path: 'a.txt', content: 'x' },
      };
      const event = new HookCallEvent(HookEventName.BeforeTool, input, {
        hookConfig: {
          type: 'command',
          command: 'node hook.cjs',
        },
        eventName: HookEventName.BeforeTool,
        success: true,
        output: { decision: 'allow' },
        stdout: '{"decision":"allow"}',
        stderr: '',
        exitCode: 0,
        duration: 12,
      });

      logHookCall(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'Hook call: BeforeTool. Success: true. Duration: 12ms.',
        attributes: {
          'session.id': 'test-session-id',
          ...event,
          'event.name': EVENT_HOOK_CALL,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          hook_input: JSON.stringify(event.hook_input),
          hook_output: JSON.stringify(event.hook_output),
        },
      });
    });
  });

  describe('logMalformedJsonResponse', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
    } as unknown as Config;

    it('logs the event to OTEL', async () => {
      const event = new MalformedJsonResponseEvent('test-model');

      logMalformedJsonResponse(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'Malformed JSON response from test-model.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_MALFORMED_JSON_RESPONSE,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          model: 'test-model',
        },
      });
    });
  });

  describe('logFileOperation', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getTargetDir: () => 'target-dir',
      getUsageStatisticsEnabled: () => true,
      getTelemetryEnabled: () => true,
      getTelemetryLogPromptsEnabled: () => true,
    } as Config;

    it('should log a file operation event', async () => {
      const event = new FileOperationEvent(
        'test-tool',
        FileOperation.READ,
        10,
        'text/plain',
        '.txt',
        'typescript',
      );

      logFileOperation(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'File operation: read. Lines: 10.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_FILE_OPERATION,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          tool_name: 'test-tool',
          operation: 'read',
          lines: 10,
          mimetype: 'text/plain',
          extension: '.txt',
          programming_language: 'typescript',
        },
      });

      expect(await exportedMetrics()).toContainEqual(
        expect.objectContaining({
          name: 'llxprt_code.file.operation.count',
          points: expect.arrayContaining([
            expect.objectContaining({
              value: 1,
              attributes: expect.objectContaining({
                operation: 'read',
                lines: 10,
                mimetype: 'text/plain',
                extension: '.txt',
              }),
            }),
          ]),
        }),
      );
    });
  });

  describe('logToolOutputTruncated', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
    } as unknown as Config;

    it('should log a tool output truncated event', async () => {
      const event = new ToolOutputTruncatedEvent('prompt-id-1', {
        toolName: 'test-tool',
        originalContentLength: 1000,
        truncatedContentLength: 100,
        threshold: 500,
        lines: 10,
      });

      logToolOutputTruncated(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'Tool output truncated for test-tool.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_TOOL_OUTPUT_TRUNCATED,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          eventName: 'tool_output_truncated',
          prompt_id: 'prompt-id-1',
          tool_name: 'test-tool',
          original_content_length: 1000,
          truncated_content_length: 100,
          threshold: 500,
          lines: 10,
        },
      });
    });
  });

  describe('logModelRouting', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
    } as unknown as Config;

    it('should log the event to OTEL and record metrics', async () => {
      const event = new ModelRoutingEvent(
        'gemini-pro',
        'default',
        100,
        'test-reason',
        false,
        undefined,
      );

      logModelRouting(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'Model routing decision. Model: gemini-pro, Source: default',
        attributes: {
          'session.id': 'test-session-id',
          ...event,
          'event.name': EVENT_MODEL_ROUTING,
        },
      });

      expect(exportedRecords()).toContainEqual(
        expect.objectContaining({
          attributes: expect.objectContaining({
            model: 'gemini-pro',
            source: 'default',
            contextLimit: 100,
            fallback: false,
          }),
        }),
      );
    });

    it('does not export after the selected root is disabled', async () => {
      await exportedMetrics();
      await telemetry.setEnabled(false);
      const bytesBeforeEvent = statSync(outfile).size;
      const event = new ModelRoutingEvent(
        'gemini-pro',
        'default',
        100,
        'test-reason',
        false,
        undefined,
      );

      logModelRouting(mockConfig, event, telemetry);

      expect(exportedRecords()).toHaveLength(0);
      await telemetry.flush();
      expect(statSync(outfile).size - bytesBeforeEvent).toBe(0);
    });
  });

  describe('logExtensionInstall', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
    } as unknown as Config;

    afterEach(() => {
      vi.resetAllMocks();
    });

    it('should log extension install event', async () => {
      const event = new ExtensionInstallEvent(
        'vscode',
        '0.1.0',
        'git',
        'success',
      );

      logExtensionInstallEvent(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'Installed extension vscode',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_EXTENSION_INSTALL,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          extension_name: 'vscode',
          extension_version: '0.1.0',
          extension_source: 'git',
          status: 'success',
        },
      });
    });
  });

  describe('logExtensionUninstall', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
    } as unknown as Config;

    afterEach(() => {
      vi.resetAllMocks();
    });

    it('should log extension uninstall event', async () => {
      const event = new ExtensionUninstallEvent('vscode', 'success');

      logExtensionUninstall(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'Uninstalled extension vscode',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_EXTENSION_UNINSTALL,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          extension_name: 'vscode',
          status: 'success',
        },
      });
    });
  });

  describe('logExtensionEnable', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
    } as unknown as Config;

    afterEach(() => {
      vi.resetAllMocks();
    });

    it('should log extension enable event', async () => {
      const event = new ExtensionEnableEvent('vscode', 'user');

      logExtensionEnable(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'Enabled extension vscode',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_EXTENSION_ENABLE,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          extension_name: 'vscode',
          setting_scope: 'user',
        },
      });
    });
  });

  describe('logExtensionDisable', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
    } as unknown as Config;

    afterEach(() => {
      vi.resetAllMocks();
    });

    it('should log extension disable event', async () => {
      const event = new ExtensionDisableEvent('vscode', 'user');

      logExtensionDisable(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'Disabled extension vscode',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_EXTENSION_DISABLE,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          extension_name: 'vscode',
          setting_scope: 'user',
        },
      });
    });
  });
});
