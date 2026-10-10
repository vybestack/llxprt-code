/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { RootTelemetry } from './root-telemetry.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { logApiRequest, logApiResponse } from './loggers.js';
import { ApiRequestEvent, ApiResponseEvent } from './events/api-events.js';
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

let outfile: string;
const roots: RootTelemetry[] = [];
async function root(config: TelemetryConfig): Promise<RootTelemetry> {
  const selected = await RootTelemetry.create({
    sessionId: config.getSessionId(),
    enabled: true,
    outfile,
    maxBytes: 1048576,
    maxFiles: 2,
    readPrivacySettings: () => ({
      logPrompts: config.getTelemetryLogPromptsEnabled(),
      logConversations: false,
      logApiBodies: config.getTelemetryLogApiBodiesEnabled(),
      maxChars: config.getTelemetryLogApiBodyMaxChars(),
    }),
  });
  roots.push(selected);
  return selected;
}
function attributesAt(index: number): Record<string, unknown> {
  const schema = z.object({ attributes: z.record(z.unknown()) });
  const records = readFileSync(outfile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const record = schema.safeParse(JSON.parse(line));
      return record.success ? [record.data] : [];
    });
  return records[index].attributes;
}
describe('api_request / api_response export gating (REQ-3315.1..3)', () => {
  beforeEach(() => {
    outfile = join(
      mkdtempSync(join(tmpdir(), 'native-export-gating-')),
      'events.jsonl',
    );
    uiTelemetry.uiTelemetryService.reset();
  });
  afterEach(async () => {
    const results = await Promise.allSettled(
      roots.splice(0).map((selected) => selected.close()),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'Telemetry test retirement failed');
  });

  it('default config emits *_chars, never request_text/response_text', async () => {
    const config = makeConfig();
    const selectedTelemetry = await root(config);
    const req = new ApiRequestEvent(
      'test-model',
      'prompt-1',
      'secret request body',
    );
    const resp = new ApiResponseEvent(
      'test-model',
      100,
      'prompt-1',
      { inputTokenCount: 10, outputTokenCount: 20, totalTokenCount: 30 },
      'secret response body',
    );

    logApiRequest(config, req, selectedTelemetry);
    logApiResponse(config, resp, selectedTelemetry);

    const requestAttrs = attributesAt(0);
    expect(requestAttrs.request_chars).toBe(19);
    expect(requestAttrs.request_text).toBeUndefined();

    const responseAttrs = attributesAt(1);
    expect(responseAttrs.response_chars).toBe(20);
    expect(responseAttrs.response_text).toBeUndefined();
  });

  it('logApiBodies:true + logPrompts:true emits a truncated body (default 4000 cap)', async () => {
    const longBody = 'X'.repeat(5000);
    const config = makeConfig({
      getTelemetryLogApiBodiesEnabled: () => true,
      getTelemetryLogPromptsEnabled: () => true,
    });
    const selectedTelemetry = await root(config);

    logApiRequest(
      config,
      new ApiRequestEvent('m', 'p', longBody),
      selectedTelemetry,
    );
    logApiResponse(
      config,
      new ApiResponseEvent('m', 10, 'p', {}, longBody),
      selectedTelemetry,
    );

    const requestAttrs = attributesAt(0);
    expect(requestAttrs.request_chars).toBe(5000);
    expect(requestAttrs.request_text).toBe('X'.repeat(4000));

    const responseAttrs = attributesAt(1);
    expect(responseAttrs.response_chars).toBe(5000);
    expect(responseAttrs.response_text).toBe('X'.repeat(4000));
  });

  it('custom logApiBodyMaxChars cap is honored', async () => {
    const body = 'Y'.repeat(200);
    const config = makeConfig({
      getTelemetryLogApiBodiesEnabled: () => true,
      getTelemetryLogApiBodyMaxChars: () => 50,
    });
    const selectedTelemetry = await root(config);

    logApiRequest(
      config,
      new ApiRequestEvent('m', 'p', body),
      selectedTelemetry,
    );
    const requestAttrs = attributesAt(0);
    expect(requestAttrs.request_chars).toBe(200);
    expect(requestAttrs.request_text).toBe('Y'.repeat(50));
  });

  it('a body exactly at the cap is emitted whole (no truncation at the boundary)', async () => {
    const body = 'Z'.repeat(50);
    const config = makeConfig({
      getTelemetryLogApiBodiesEnabled: () => true,
      getTelemetryLogPromptsEnabled: () => true,
      getTelemetryLogApiBodyMaxChars: () => 50,
    });
    const selectedTelemetry = await root(config);

    logApiRequest(
      config,
      new ApiRequestEvent('m', 'p', body),
      selectedTelemetry,
    );
    const requestAttrs = attributesAt(0);
    expect(requestAttrs.request_chars).toBe(50);
    expect(requestAttrs.request_text).toBe(body);
  });

  it('logApiBodies:true + logPrompts:false never emits a body', async () => {
    const config = makeConfig({
      getTelemetryLogApiBodiesEnabled: () => true,
      getTelemetryLogPromptsEnabled: () => false,
    });
    const selectedTelemetry = await root(config);

    logApiRequest(
      config,
      new ApiRequestEvent('m', 'p', 'private prompt text'),
      selectedTelemetry,
    );
    logApiResponse(
      config,
      new ApiResponseEvent('m', 10, 'p', {}, 'private response text'),
      selectedTelemetry,
    );

    const requestAttrs = attributesAt(0);
    expect(requestAttrs.request_chars).toBe(19);
    expect(requestAttrs.request_text).toBeUndefined();

    const responseAttrs = attributesAt(1);
    expect(responseAttrs.response_chars).toBe(21);
    expect(responseAttrs.response_text).toBeUndefined();
  });

  it('token counts remain present regardless of body gating', async () => {
    const config = makeConfig();
    const selectedTelemetry = await root(config);
    const resp = new ApiResponseEvent(
      'test-model',
      100,
      'prompt-1',
      {
        inputTokenCount: 10,
        outputTokenCount: 20,
        cachedTokenCount: 5,
        thinkingTokenCount: 3,
        toolUseInputTokenCount: 7,
        totalTokenCount: 45,
      },
      'body',
    );

    logApiResponse(config, resp, selectedTelemetry);

    const responseAttrs = attributesAt(0);
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
