/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logApiResponse, logApiError, logToolCall } from './loggers.js';
import { UiTelemetryService } from './uiTelemetry.js';
import { uiTelemetryService } from './uiTelemetry.js';
import { ApiResponseEvent, ApiErrorEvent } from './events/api-events.js';
import type { ToolCallEvent } from './events/tool-events.js';
import * as sdk from './sdk.js';
import type { TelemetryConfig } from '../internal/interfaces.js';

const mockConfig = {
  getSessionId: () => 'test-session',
  getTelemetryLogPromptsEnabled: () => false,
} as unknown as TelemetryConfig;

/**
 * Behavioral tests for the producer → aggregation pipeline.
 *
 * Each test creates a fresh UiTelemetryService to avoid singleton state
 * leakage. The logger functions use the module-level singleton, so we
 * test the full pipeline by wiring the real loggers to a real (reset)
 * singleton, or test aggregation behavior via a local instance.
 *
 * The provider_owned flag is the canonical ownership boundary:
 * only provider-wrapper-emitted events are aggregated locally.
 */

describe('Provider-owned local aggregation (SDK disabled)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(false);
    uiTelemetryService.reset();
  });

  it('aggregates provider-owned API responses locally even when SDK is NOT initialized', () => {
    const event = new ApiResponseEvent('test-model-owned', 1000, 'prompt-1', {
      promptTokenCount: 100,
      candidatesTokenCount: 50,
      totalTokenCount: 150,
    });
    event.provider_owned = true;
    logApiResponse(mockConfig, event);

    const metrics = uiTelemetryService.getMetrics();
    expect(metrics.models['test-model-owned']).toBeDefined();
    expect(metrics.models['test-model-owned'].api.totalRequests).toBe(1);
  });

  it('aggregates provider-owned API errors locally even when SDK is NOT initialized', () => {
    const event = new ApiErrorEvent(
      'test-model-owned-err',
      'test error',
      500,
      'prompt-error-1',
    );
    event.provider_owned = true;
    logApiError(mockConfig, event);

    const metrics = uiTelemetryService.getMetrics();
    expect(metrics.models['test-model-owned-err']).toBeDefined();
    expect(metrics.models['test-model-owned-err'].api.totalErrors).toBe(1);
  });

  it('does NOT aggregate non-provider-owned API responses (agent path is export-only)', () => {
    const beforeModels = Object.keys(uiTelemetryService.getMetrics().models);

    const event = new ApiResponseEvent(
      'agent-only-model',
      1000,
      'prompt-agent',
      { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
    );
    // provider_owned is NOT set — this is the agent adapter path
    logApiResponse(mockConfig, event);

    const metrics = uiTelemetryService.getMetrics();
    expect(metrics.models['agent-only-model']).toBeUndefined();
    // No new models added
    expect(Object.keys(metrics.models)).toStrictEqual(beforeModels);
  });

  it('does NOT aggregate non-provider-owned API errors (agent path is export-only)', () => {
    const event = new ApiErrorEvent(
      'agent-only-err-model',
      'test error',
      500,
      'prompt-agent-err',
    );
    // provider_owned is NOT set
    logApiError(mockConfig, event);

    const metrics = uiTelemetryService.getMetrics();
    expect(metrics.models['agent-only-err-model']).toBeUndefined();
  });

  it('aggregates tool calls locally even when SDK is NOT initialized', () => {
    const toolEvent: ToolCallEvent = {
      'event.name': 'tool_call',
      'event.timestamp': new Date().toISOString(),
      function_name: 'read_file',
      function_args: {},
      duration_ms: 100,
      success: true,
      prompt_id: 'prompt-1',
      tool_type: 'native',
      agent_id: 'primary',
      call_id: 'tool-call-1',
    } as ToolCallEvent;
    logToolCall(mockConfig, toolEvent);

    const metrics = uiTelemetryService.getMetrics();
    expect(metrics.tools.totalCalls).toBe(1);
  });
});

describe('Exactly-once producer path (provider_owned dedup)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(false);
    uiTelemetryService.reset();
  });

  it('counts the same provider-owned attempt_id only once when logged twice', () => {
    const event = new ApiResponseEvent(
      'dedup-model',
      1000,
      'prompt-dedup',
      { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
      undefined,
      undefined,
      undefined,
      'attempt-unique-1',
    );
    event.provider_owned = true;

    // Simulate dual emission: provider wrapper + agent adapter both log
    logApiResponse(mockConfig, event);
    logApiResponse(mockConfig, event);

    const metrics = uiTelemetryService.getMetrics();
    // Provider-owned event counted once by attempt_id dedup
    expect(metrics.models['dedup-model'].api.totalRequests).toBe(1);
  });

  it('counts different provider-owned attempt_ids separately (retries)', () => {
    const event1 = new ApiResponseEvent(
      'dedup-model-2',
      1000,
      'prompt-retry',
      { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
      undefined,
      undefined,
      undefined,
      'attempt-retry-1',
    );
    event1.provider_owned = true;

    const event2 = new ApiResponseEvent(
      'dedup-model-2',
      1000,
      'prompt-retry',
      {
        promptTokenCount: 200,
        candidatesTokenCount: 100,
        totalTokenCount: 300,
      },
      undefined,
      undefined,
      undefined,
      'attempt-retry-2',
    );
    event2.provider_owned = true;

    logApiResponse(mockConfig, event1);
    logApiResponse(mockConfig, event2);

    const metrics = uiTelemetryService.getMetrics();
    expect(metrics.models['dedup-model-2'].api.totalRequests).toBe(2);
  });

  it('provider-owned event + non-provider-owned event with same attempt_id counts once', () => {
    const providerEvent = new ApiResponseEvent(
      'dual-model',
      1000,
      'prompt-dual',
      { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
      undefined,
      undefined,
      undefined,
      'attempt-shared-id',
    );
    providerEvent.provider_owned = true;

    const agentEvent = new ApiResponseEvent(
      'dual-model',
      1000,
      'prompt-dual',
      { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
      undefined,
      undefined,
      undefined,
      'attempt-shared-id',
    );
    // agentEvent.provider_owned is NOT set

    logApiResponse(mockConfig, providerEvent);
    logApiResponse(mockConfig, agentEvent);

    const metrics = uiTelemetryService.getMetrics();
    expect(metrics.models['dual-model'].api.totalRequests).toBe(1);
  });
});

describe('Reset clears canonical state', () => {
  beforeEach(() => {
    uiTelemetryService.reset();
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(false);
  });

  it('reset clears all model/tool/timing metrics', () => {
    const event = new ApiResponseEvent('reset-model', 1000, 'prompt-reset', {
      promptTokenCount: 100,
      candidatesTokenCount: 50,
      totalTokenCount: 150,
    });
    event.provider_owned = true;
    logApiResponse(mockConfig, event);

    expect(uiTelemetryService.getMetrics().models['reset-model']).toBeDefined();

    uiTelemetryService.reset();

    const metrics = uiTelemetryService.getMetrics();
    expect(metrics.models['reset-model']).toBeUndefined();
    expect(metrics.timing.completeTokensPerMinute).toBe(0);
    expect(metrics.tools.totalCalls).toBe(0);
  });

  it('reset allows dedup state to clear so same attempt_id can be re-counted', () => {
    const event = new ApiResponseEvent(
      'reset-dedup-model',
      1000,
      'prompt-reset-dedup',
      { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
      undefined,
      undefined,
      undefined,
      'attempt-reset-id',
    );
    event.provider_owned = true;

    logApiResponse(mockConfig, event);
    expect(
      uiTelemetryService.getMetrics().models['reset-dedup-model'].api
        .totalRequests,
    ).toBe(1);

    uiTelemetryService.reset();

    logApiResponse(mockConfig, event);
    expect(
      uiTelemetryService.getMetrics().models['reset-dedup-model'].api
        .totalRequests,
    ).toBe(1);
  });
});

describe('Canonical TPM is not overwritten by polling', () => {
  let service: UiTelemetryService;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = new UiTelemetryService();
  });

  it('setTokenTrackingMetrics preserves the canonical session TPM from aggregator', () => {
    // Record a provider-owned response to establish canonical TPM
    const event: ApiResponseEvent & {
      'event.name': 'llxprt_code.api_response';
    } = {
      'event.name': 'llxprt_code.api_response' as const,
      model: 'polling-model',
      duration_ms: 1000,
      input_token_count: 100,
      output_token_count: 50,
      total_token_count: 150,
      cached_content_token_count: 0,
      thoughts_token_count: 0,
      tool_token_count: 0,
      finish_reasons: [],
      provider_owned: true,
      usage_metadata_present: true,
    } as ApiResponseEvent & { 'event.name': 'llxprt_code.api_response' };

    service.addEvent(event);

    const canonicalTpm = service.getMetrics().timing.completeTokensPerMinute;
    expect(canonicalTpm).toBeGreaterThan(0);

    // Polling tries to overwrite TPM with a different value
    service.setTokenTrackingMetrics({
      tokensPerMinute: 99999,
      throttleWaitTimeMs: 0,
      timeToFirstToken: null,
      tokensPerSecond: 0,
      sessionTokenUsage: {
        input: 0,
        output: 0,
        cache: 0,
        tool: 0,
        thought: 0,
        total: 0,
      },
    });

    // The canonical TPM from the aggregator must be preserved
    expect(service.getMetrics().tokenTracking.tokensPerMinute).toBe(
      canonicalTpm,
    );
    expect(service.getMetrics().tokenTracking.tokensPerMinute).not.toBe(99999);
  });
});
