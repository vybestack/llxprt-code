/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { logs, type Logger } from '@opentelemetry/api-logs';
import { logApiRequest, logApiResponse } from './loggers.js';
import { ApiRequestEvent, ApiResponseEvent } from './events/api-events.js';
import * as sdk from './sdk.js';
import * as uiTelemetry from './uiTelemetry.js';
import type { TelemetryConfig } from '../internal/interfaces.js';

function makeConfig(overrides: Partial<TelemetryConfig> = {}): TelemetryConfig {
  return {
    getSessionId: () => 'gating-test-session',
    getTelemetryEnabled: () => true,
    getTelemetryLogPromptsEnabled: () => true,
    getTelemetryLogApiBodiesEnabled: () => false,
    getTelemetryLogApiBodyMaxChars: () => 4000,
    getTelemetryOutfileMaxBytes: () => 104857600,
    getTelemetryOutfileMaxFiles: () => 10,
    getTelemetryOutfile: () => undefined,
    getDebugMode: () => false,
    getConversationLoggingEnabled: () => false,
    getModel: () => 'test-model',
    getEmbeddingModel: () => undefined,
    getSandbox: () => undefined,
    getCoreTools: () => undefined,
    getApprovalMode: () => 'default',
    getContentGeneratorConfig: () => undefined,
    getFileFilteringRespectGitIgnore: () => true,
    getMcpServers: () => undefined,
    ...overrides,
  };
}

const mockLogger = {
  emit: vi.fn(),
};

describe('api_request / api_response export gating (REQ-3315.1..3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(true);
    vi.spyOn(logs, 'getLogger').mockReturnValue(
      mockLogger as unknown as Logger,
    );
    vi.spyOn(uiTelemetry.uiTelemetryService, 'addEvent').mockImplementation(
      () => undefined,
    );
    mockLogger.emit.mockClear();
  });

  it('default config emits *_chars, never request_text/response_text', () => {
    const config = makeConfig();
    const req = new ApiRequestEvent(
      'test-model',
      'prompt-1',
      'secret request body',
    );
    const resp = new ApiResponseEvent(
      'test-model',
      100,
      'prompt-1',
      { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
      'secret response body',
    );

    logApiRequest(config, req);
    logApiResponse(config, resp);

    const requestAttrs = mockLogger.emit.mock.calls[0][0].attributes;
    expect(requestAttrs.request_chars).toBe(19);
    expect(requestAttrs.request_text).toBeUndefined();

    const responseAttrs = mockLogger.emit.mock.calls[1][0].attributes;
    expect(responseAttrs.response_chars).toBe(20);
    expect(responseAttrs.response_text).toBeUndefined();
  });

  it('logApiBodies:true + logPrompts:true emits a truncated body (default 4000 cap)', () => {
    const longBody = 'X'.repeat(5000);
    const config = makeConfig({
      getTelemetryLogApiBodiesEnabled: () => true,
      getTelemetryLogPromptsEnabled: () => true,
    });

    logApiRequest(config, new ApiRequestEvent('m', 'p', longBody));
    logApiResponse(config, new ApiResponseEvent('m', 10, 'p', {}, longBody));

    const requestAttrs = mockLogger.emit.mock.calls[0][0].attributes;
    expect(requestAttrs.request_chars).toBe(5000);
    expect(requestAttrs.request_text).toBe('X'.repeat(4000));

    const responseAttrs = mockLogger.emit.mock.calls[1][0].attributes;
    expect(responseAttrs.response_chars).toBe(5000);
    expect(responseAttrs.response_text).toBe('X'.repeat(4000));
  });

  it('custom logApiBodyMaxChars cap is honored', () => {
    const body = 'Y'.repeat(200);
    const config = makeConfig({
      getTelemetryLogApiBodiesEnabled: () => true,
      getTelemetryLogApiBodyMaxChars: () => 50,
    });

    logApiRequest(config, new ApiRequestEvent('m', 'p', body));
    const requestAttrs = mockLogger.emit.mock.calls[0][0].attributes;
    expect(requestAttrs.request_chars).toBe(200);
    expect(requestAttrs.request_text).toBe('Y'.repeat(50));
  });

  it('a body exactly at the cap is emitted whole (no truncation at the boundary)', () => {
    const body = 'Z'.repeat(50);
    const config = makeConfig({
      getTelemetryLogApiBodiesEnabled: () => true,
      getTelemetryLogPromptsEnabled: () => true,
      getTelemetryLogApiBodyMaxChars: () => 50,
    });

    logApiRequest(config, new ApiRequestEvent('m', 'p', body));
    const requestAttrs = mockLogger.emit.mock.calls[0][0].attributes;
    expect(requestAttrs.request_chars).toBe(50);
    expect(requestAttrs.request_text).toBe(body);
  });

  it('logApiBodies:true + logPrompts:false never emits a body', () => {
    const config = makeConfig({
      getTelemetryLogApiBodiesEnabled: () => true,
      getTelemetryLogPromptsEnabled: () => false,
    });

    logApiRequest(config, new ApiRequestEvent('m', 'p', 'private prompt text'));
    logApiResponse(
      config,
      new ApiResponseEvent('m', 10, 'p', {}, 'private response text'),
    );

    const requestAttrs = mockLogger.emit.mock.calls[0][0].attributes;
    expect(requestAttrs.request_chars).toBe(19);
    expect(requestAttrs.request_text).toBeUndefined();

    const responseAttrs = mockLogger.emit.mock.calls[1][0].attributes;
    expect(responseAttrs.response_chars).toBe(21);
    expect(responseAttrs.response_text).toBeUndefined();
  });

  it('token counts remain present regardless of body gating', () => {
    const config = makeConfig();
    const resp = new ApiResponseEvent(
      'test-model',
      100,
      'prompt-1',
      {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        cachedContentTokenCount: 5,
        thoughtsTokenCount: 3,
        toolUsePromptTokenCount: 7,
        totalTokenCount: 45,
      },
      'body',
    );

    logApiResponse(config, resp);

    const responseAttrs = mockLogger.emit.mock.calls[0][0].attributes;
    expect(responseAttrs.input_token_count).toBe(10);
    expect(responseAttrs.output_token_count).toBe(20);
    expect(responseAttrs.cached_content_token_count).toBe(5);
    expect(responseAttrs.thoughts_token_count).toBe(3);
    expect(responseAttrs.tool_token_count).toBe(7);
    expect(responseAttrs.total_token_count).toBe(45);
    expect(responseAttrs.response_chars).toBe(4);
    expect(responseAttrs.response_text).toBeUndefined();
  });
});
