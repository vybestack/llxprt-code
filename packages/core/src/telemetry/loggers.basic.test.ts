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

import { SemanticAttributes } from '@opentelemetry/semantic-conventions';
import type { Config } from '../config/config.js';
import {
  EVENT_API_REQUEST,
  EVENT_API_RESPONSE,
  EVENT_CLI_CONFIG,
  EVENT_USER_PROMPT,
} from '@vybestack/llxprt-code-telemetry/telemetry/constants.js';
import {
  logApiRequest,
  logApiResponse,
  logCliConfiguration,
  logUserPrompt,
} from '@vybestack/llxprt-code-telemetry/telemetry/loggers.js';
import {
  ApiRequestEvent,
  ApiResponseEvent,
  StartSessionEvent,
  UserPromptEvent,
} from '@vybestack/llxprt-code-telemetry/telemetry/types.js';
import { vi, describe, beforeEach, it, expect, setSystemTime } from 'bun:test';
import type { RuntimeUsageMetadata } from '../runtime/AgentRuntimeContext.js';
import * as uiTelemetry from '@vybestack/llxprt-code-telemetry/telemetry/uiTelemetry.js';

describe('loggers', () => {
  let telemetry: RootTelemetry;
  let outfile: string;
  let privacy = {
    logPrompts: true,
    logConversations: false,
    logApiBodies: false,
    maxChars: 4000,
  };
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    privacy = {
      logPrompts: true,
      logConversations: false,
      logApiBodies: false,
      maxChars: 4000,
    };
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
      readPrivacySettings: () => privacy,
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

  describe('logCliConfiguration', () => {
    it('should log the cli configuration', async () => {
      const mockConfig = {
        getSessionId: () => 'test-session-id',
        getModel: () => 'test-model',
        getEmbeddingModel: () => 'test-embedding-model',
        getSandbox: () => true,
        getCoreTools: () => ['ls', 'read-file'],
        getApprovalMode: () => 'default',
        getContentGeneratorConfig: () => ({
          model: 'test-model',
          apiKey: 'test-api-key',
        }),
        getTelemetryEnabled: () => true,
        getUsageStatisticsEnabled: () => true,
        getTelemetryLogPromptsEnabled: () => true,
        getFileFilteringRespectGitIgnore: () => true,
        getFileFilteringAllowBuildArtifacts: () => false,
        getDebugMode: () => true,
        getMcpServers: () => ({
          'test-server': {
            command: 'test-command',
          },
        }),
        getQuestion: () => 'test-question',
        getTargetDir: () => 'target-dir',
        getProxy: () => 'http://test.proxy.com:8080',
      } as unknown as Config;

      const startSessionEvent = new StartSessionEvent(mockConfig);
      logCliConfiguration(mockConfig, startSessionEvent, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'CLI configuration loaded.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_CLI_CONFIG,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          model: 'test-model',
          embedding_model: 'test-embedding-model',
          sandbox_enabled: true,
          core_tools_enabled: 'ls,read-file',
          approval_mode: 'default',
          api_key_enabled: true,
          vertex_ai_enabled: false,
          log_user_prompts_enabled: true,
          file_filtering_respect_git_ignore: true,
          debug_mode: true,
          mcp_servers: 'test-server',
        },
      });
    });
  });

  describe('logUserPrompt', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getTelemetryEnabled: () => true,
      getTelemetryLogPromptsEnabled: () => true,
      getUsageStatisticsEnabled: () => true,
    } as unknown as Config;

    it('should log a user prompt', async () => {
      const event = new UserPromptEvent(11, 'prompt-id-8', 'test-prompt');

      logUserPrompt(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'User prompt. Length: 11.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_USER_PROMPT,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          prompt_length: 11,
          prompt: 'test-prompt',
        },
      });
    });

    it('should not log prompt if disabled', async () => {
      const mockConfig = {
        getSessionId: () => 'test-session-id',
        getTelemetryEnabled: () => true,
        getTelemetryLogPromptsEnabled: () => false,
        getTargetDir: () => 'target-dir',
        getUsageStatisticsEnabled: () => true,
      } as unknown as Config;
      const event = new UserPromptEvent(11, 'test-prompt');

      logUserPrompt(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'User prompt. Length: 11.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_USER_PROMPT,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          prompt_length: 11,
        },
      });
    });
  });

  describe('logApiResponse', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getTargetDir: () => 'target-dir',
      getUsageStatisticsEnabled: () => true,
      getTelemetryEnabled: () => true,
      getTelemetryLogPromptsEnabled: () => true,
      getTelemetryLogApiBodiesEnabled: () => false,
      getTelemetryLogApiBodyMaxChars: () => 4000,
      getTelemetryOutfileMaxBytes: () => 104857600,
      getTelemetryOutfileMaxFiles: () => 10,
    } as Config;

    it('should log an API response with all fields', async () => {
      const usageData: RuntimeUsageMetadata = {
        inputTokenCount: 17,
        outputTokenCount: 50,
        cachedTokenCount: 10,
        thinkingTokenCount: 5,
        toolUseInputTokenCount: 2,
      };
      const event = new ApiResponseEvent(
        'test-model',
        100,
        'prompt-id-1',
        usageData,
        'test-response',
      );

      event.provider_owned = true;
      logApiResponse(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'API response from test-model. Status: 200. Duration: 100ms.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_API_RESPONSE,
          provider_owned: true,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          [SemanticAttributes.HTTP_STATUS_CODE]: 200,
          model: 'test-model',
          status_code: 200,
          prompt_id: 'prompt-id-1',
          duration_ms: 100,
          input_token_count: 17,
          output_token_count: 50,
          cached_content_token_count: 10,
          thoughts_token_count: 5,
          tool_token_count: 2,
          total_token_count: 0,

          finish_reasons: [],
          response_chars: 13,
        },
      });

      expect(await exportedMetrics()).toContainEqual(
        expect.objectContaining({
          name: 'llxprt_code.api.request.count',
          points: expect.arrayContaining([
            expect.objectContaining({
              value: 1,
              attributes: expect.objectContaining({
                model: 'test-model',
                status_code: 200,
              }),
            }),
          ]),
        }),
      );

      expect(await exportedMetrics()).toContainEqual(
        expect.objectContaining({
          name: 'llxprt_code.token.usage',
          points: expect.arrayContaining([
            expect.objectContaining({
              value: 50,
              attributes: expect.objectContaining({
                model: 'test-model',
                type: 'output',
              }),
            }),
          ]),
        }),
      );

      expect(await exportedMetrics()).toContainEqual(
        expect.objectContaining({
          name: 'llxprt_code.api.request.latency',
          points: expect.arrayContaining([
            expect.objectContaining({
              value: expect.objectContaining({ sum: 100 }),
              attributes: expect.objectContaining({ model: 'test-model' }),
            }),
          ]),
        }),
      );
      expect(
        uiTelemetry.uiTelemetryService.getMetrics().models['test-model'],
      ).toStrictEqual({
        api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 100 },
        tokens: {
          input: 7,
          prompt: 17,
          candidates: 50,
          total: 67,
          cached: 10,
          thoughts: 5,
          tool: 2,
        },
      });
    });

    it('should log an API response with an error', async () => {
      const usageData: RuntimeUsageMetadata = {
        inputTokenCount: 17,
        outputTokenCount: 50,
        cachedTokenCount: 10,
        thinkingTokenCount: 5,
        toolUseInputTokenCount: 2,
      };
      const event = new ApiResponseEvent(
        'test-model',
        100,
        'prompt-id-1',
        usageData,
        'test-response',
        'test-error',
      );

      event.provider_owned = true;
      logApiResponse(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'API response from test-model. Status: 200. Duration: 100ms.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_API_RESPONSE,
          provider_owned: true,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          model: 'test-model',
          status_code: 200,
          prompt_id: 'prompt-id-1',
          duration_ms: 100,
          input_token_count: 17,
          output_token_count: 50,
          cached_content_token_count: 10,
          thoughts_token_count: 5,
          tool_token_count: 2,
          total_token_count: 0,
          error: 'test-error',
          finish_reasons: [],
          response_chars: 13,
          'error.message': 'test-error',
        },
      });

      expect(
        uiTelemetry.uiTelemetryService.getMetrics().models['test-model'],
      ).toStrictEqual({
        api: { totalRequests: 1, totalErrors: 1, totalLatencyMs: 100 },
        tokens: {
          input: 7,
          prompt: 17,
          candidates: 50,
          total: 67,
          cached: 10,
          thoughts: 5,
          tool: 2,
        },
      });
    });

    it('should log an API response with body when logApiBodies is enabled', async () => {
      const bodyConfig = {
        getSessionId: () => 'test-session-id',
        getTargetDir: () => 'target-dir',
        getUsageStatisticsEnabled: () => true,
        getTelemetryEnabled: () => true,
        getTelemetryLogPromptsEnabled: () => true,
        getTelemetryLogApiBodiesEnabled: () => true,
        getTelemetryLogApiBodyMaxChars: () => 10,
        getTelemetryOutfileMaxBytes: () => 104857600,
        getTelemetryOutfileMaxFiles: () => 10,
      } as Config;

      const event = new ApiResponseEvent(
        'test-model',
        100,
        'prompt-id-9',
        {
          inputTokenCount: 17,
          outputTokenCount: 50,
          totalTokenCount: 67,
        },
        'a-very-long-response-body-worth-of-text',
      );

      privacy = { ...privacy, logApiBodies: true, maxChars: 10 };
      logApiResponse(bodyConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'API response from test-model. Status: 200. Duration: 100ms.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_API_RESPONSE,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          [SemanticAttributes.HTTP_STATUS_CODE]: 200,
          model: 'test-model',
          status_code: 200,
          prompt_id: 'prompt-id-9',
          duration_ms: 100,
          input_token_count: 17,
          output_token_count: 50,
          cached_content_token_count: 0,
          thoughts_token_count: 0,
          tool_token_count: 0,
          total_token_count: 67,

          finish_reasons: [],
          response_text: 'a-very-lon',
          response_chars: 39,
        },
      });
    });
  });

  describe('logApiRequest', () => {
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getTargetDir: () => 'target-dir',
      getUsageStatisticsEnabled: () => true,
      getTelemetryEnabled: () => true,
      getTelemetryLogPromptsEnabled: () => true,
      getTelemetryLogApiBodiesEnabled: () => false,
      getTelemetryLogApiBodyMaxChars: () => 4000,
      getTelemetryOutfileMaxBytes: () => 104857600,
      getTelemetryOutfileMaxFiles: () => 10,
    } as Config;

    it('should log an API request with request_text', async () => {
      const event = new ApiRequestEvent(
        'test-model',
        'prompt-id-7',
        'This is a test request',
      );

      logApiRequest(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'API request to test-model.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_API_REQUEST,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          model: 'test-model',
          request_chars: 22,
          prompt_id: 'prompt-id-7',
        },
      });
    });

    it('should log an API request with body when logApiBodies is enabled', async () => {
      const mockConfig = {
        getSessionId: () => 'test-session-id',
        getTargetDir: () => 'target-dir',
        getUsageStatisticsEnabled: () => true,
        getTelemetryEnabled: () => true,
        getTelemetryLogPromptsEnabled: () => true,
        getTelemetryLogApiBodiesEnabled: () => true,
        getTelemetryLogApiBodyMaxChars: () => 4000,
        getTelemetryOutfileMaxBytes: () => 104857600,
        getTelemetryOutfileMaxFiles: () => 10,
      } as Config;

      const event = new ApiRequestEvent(
        'test-model',
        'prompt-id-7',
        'This is a test request',
      );

      privacy = { ...privacy, logApiBodies: true };
      logApiRequest(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'API request to test-model.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_API_REQUEST,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          model: 'test-model',
          request_text: 'This is a test request',
          request_chars: 22,
          prompt_id: 'prompt-id-7',
        },
      });
    });

    it('should log an API request without request_text', async () => {
      const event = new ApiRequestEvent('test-model', 'prompt-id-6');

      logApiRequest(mockConfig, event, telemetry);

      expect(exportedRecords()).toContainEqual({
        body: 'API request to test-model.',
        attributes: {
          'session.id': 'test-session-id',
          'event.name': EVENT_API_REQUEST,
          'event.timestamp': '2025-01-01T00:00:00.000Z',
          model: 'test-model',
          prompt_id: 'prompt-id-6',
          request_chars: 0,
        },
      });
    });
  });
});
