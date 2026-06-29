/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { logs } from '@opentelemetry/api-logs';
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
  logHookCall,
  logFileOperation,
  logToolOutputTruncated,
  logMalformedJsonResponse,
  logModelRouting,
  logExtensionInstallEvent,
  logExtensionUninstall,
  logExtensionEnable,
  logExtensionDisable,
} from '@vybestack/llxprt-code-telemetry/telemetry/loggers.js';
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
import * as metrics from '@vybestack/llxprt-code-telemetry/telemetry/metrics.js';
import * as sdk from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import * as uiTelemetry from './uiTelemetry.js';

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

  describe('logHookCall', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getTelemetryEnabled: () => true,
      getTelemetryLogPromptsEnabled: () => true,
    } as unknown as Config;

    it('should log a hook call event', () => {
      const event = new HookCallEvent(
        'BeforeTool',
        {
          session_id: 'session-1',
          cwd: '/tmp',
          hook_event_name: 'BeforeTool',
          timestamp: '2025-01-01T00:00:00.000Z',
          transcript_path: '/tmp/transcript.jsonl',
          tool_name: 'write_file',
          tool_input: { file_path: 'a.txt', content: 'x' },
        },
        {
          hookConfig: {
            type: 'command',
            command: 'node hook.cjs',
          },
          eventName: 'BeforeTool',
          success: true,
          output: { decision: 'allow' },
          stdout: '{"decision":"allow"}',
          stderr: '',
          exitCode: 0,
          duration: 12,
        },
      );

      logHookCall(mockConfig, event);

      expect(mockLogger.emit).toHaveBeenCalledWith({
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

    it('logs the event to OTEL', () => {
      const event = new MalformedJsonResponseEvent('test-model');

      logMalformedJsonResponse(mockConfig, event);

      expect(mockLogger.emit).toHaveBeenCalledWith({
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

    const mockMetrics = {
      recordFileOperationMetric: vi.fn(),
    };

    beforeEach(() => {
      vi.spyOn(metrics, 'recordFileOperationMetric').mockImplementation(
        mockMetrics.recordFileOperationMetric,
      );
    });

    it('should log a file operation event', () => {
      const event = new FileOperationEvent(
        'test-tool',
        FileOperation.READ,
        10,
        'text/plain',
        '.txt',
        'typescript',
      );

      logFileOperation(mockConfig, event);

      expect(mockLogger.emit).toHaveBeenCalledWith({
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

      expect(mockMetrics.recordFileOperationMetric).toHaveBeenCalledWith(
        mockConfig,
        'read',
        10,
        'text/plain',
        '.txt',
      );
    });
  });

  describe('logToolOutputTruncated', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
    } as unknown as Config;

    it('should log a tool output truncated event', () => {
      const event = new ToolOutputTruncatedEvent('prompt-id-1', {
        toolName: 'test-tool',
        originalContentLength: 1000,
        truncatedContentLength: 100,
        threshold: 500,
        lines: 10,
      });

      logToolOutputTruncated(mockConfig, event);

      expect(mockLogger.emit).toHaveBeenCalledWith({
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

    beforeEach(() => {
      vi.spyOn(metrics, 'recordModelRoutingMetrics');
    });

    it('should log the event to OTEL and record metrics', () => {
      const event = new ModelRoutingEvent(
        'gemini-pro',
        'default',
        100,
        'test-reason',
        false,
        undefined,
      );

      logModelRouting(mockConfig, event);

      expect(mockLogger.emit).toHaveBeenCalledWith({
        body: 'Model routing decision. Model: gemini-pro, Source: default',
        attributes: {
          'session.id': 'test-session-id',
          ...event,
          'event.name': EVENT_MODEL_ROUTING,
        },
      });

      expect(metrics.recordModelRoutingMetrics).toHaveBeenCalledWith(
        mockConfig,
        event,
      );
    });

    it('should not log if OTEL SDK is not initialized', () => {
      mockLogger.emit.mockReset();
      vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(false);
      const event = new ModelRoutingEvent(
        'gemini-pro',
        'default',
        100,
        'test-reason',
        false,
        undefined,
      );

      logModelRouting(mockConfig, event);

      expect(mockLogger.emit).not.toHaveBeenCalled();
      expect(metrics.recordModelRoutingMetrics).not.toHaveBeenCalled();
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

    it('should log extension install event', () => {
      const event = new ExtensionInstallEvent(
        'vscode',
        '0.1.0',
        'git',
        'success',
      );

      logExtensionInstallEvent(mockConfig, event);

      expect(mockLogger.emit).toHaveBeenCalledWith({
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

    it('should log extension uninstall event', () => {
      const event = new ExtensionUninstallEvent('vscode', 'success');

      logExtensionUninstall(mockConfig, event);

      expect(mockLogger.emit).toHaveBeenCalledWith({
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

    it('should log extension enable event', () => {
      const event = new ExtensionEnableEvent('vscode', 'user');

      logExtensionEnable(mockConfig, event);

      expect(mockLogger.emit).toHaveBeenCalledWith({
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

    it('should log extension disable event', () => {
      const event = new ExtensionDisableEvent('vscode', 'user');

      logExtensionDisable(mockConfig, event);

      expect(mockLogger.emit).toHaveBeenCalledWith({
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
