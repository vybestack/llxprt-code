/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036: /stats counts refusals separately from requests and errors.
 * Provider-owned api_response events already carry `finish_reasons`; a
 * canonical `refusal` among them marks the attempt as refused. The attempt
 * stays an HTTP success: its tokens and latency are kept and it is not an
 * error. Events flow through UiTelemetryService.addEvent, unmocked.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { UiTelemetryService } from './uiTelemetry.js';

let attemptCounter = 0;

function apiResponse(opts: {
  model?: string;
  finishReasons: string[];
  outputTokens?: number;
}) {
  return {
    'event.name': 'llxprt_code.api_response' as const,
    'event.timestamp': new Date().toISOString(),
    model: opts.model ?? 'claude-opus-5-5',
    duration_ms: 1000,
    status_code: 200,
    input_token_count: 120,
    output_token_count: opts.outputTokens ?? 0,
    cached_content_token_count: 0,
    thoughts_token_count: 0,
    tool_token_count: 0,
    total_token_count: 120 + (opts.outputTokens ?? 0),
    finish_reasons: opts.finishReasons,
    prompt_id: 'prompt-test',
    attempt_id: `att_${attemptCounter++}`,
    provider: 'claudecode',
    time_to_first_token_ms: null,
    last_token_ms: null,
    usage_metadata_present: true,
    provider_owned: true,
  };
}

describe('refusal counting in session metrics (issue #4036)', () => {
  let service: UiTelemetryService;

  beforeEach(() => {
    service = new UiTelemetryService();
  });

  it('counts one refusal and one success as two requests, one refusal, no errors per model', () => {
    service.addEvent(apiResponse({ finishReasons: ['refusal'] }));
    service.addEvent(
      apiResponse({ finishReasons: ['stop'], outputTokens: 40 }),
    );

    expect(service.getMetrics().models['claude-opus-5-5'].api).toMatchObject({
      totalRequests: 2,
      totalRefusals: 1,
      totalErrors: 0,
    });
  });

  it('counts the same totals in the session snapshot', () => {
    service.addEvent(apiResponse({ finishReasons: ['refusal'] }));
    service.addEvent(
      apiResponse({ finishReasons: ['stop'], outputTokens: 40 }),
    );

    expect(service.getSessionSnapshot()).toMatchObject({
      totalApiRequests: 2,
      totalRefusals: 1,
      totalApiErrors: 0,
    });
  });

  it('keeps the billed tokens of a refused attempt', () => {
    service.addEvent(apiResponse({ finishReasons: ['refusal'] }));

    expect(service.getMetrics().models['claude-opus-5-5'].tokens).toMatchObject(
      { prompt: 120, candidates: 0 },
    );
  });

  it('counts refusals per model', () => {
    service.addEvent(apiResponse({ finishReasons: ['refusal'] }));
    service.addEvent(
      apiResponse({ model: 'claude-sonnet-5-5', finishReasons: ['stop'] }),
    );

    const { models } = service.getMetrics();
    expect([
      models['claude-opus-5-5'].api.totalRefusals,
      models['claude-sonnet-5-5'].api.totalRefusals,
    ]).toStrictEqual([1, 0]);
  });

  it('does not count the safety finish reason as a refusal', () => {
    service.addEvent(apiResponse({ finishReasons: ['safety'] }));

    expect(service.getSessionSnapshot().totalRefusals).toBe(0);
  });

  it('counts a replayed refusal attempt once', () => {
    const event = apiResponse({ finishReasons: ['refusal'] });
    service.addEvent(event);
    service.addEvent(event);

    expect(service.getSessionSnapshot().totalRefusals).toBe(1);
  });

  it('clears refusals when the session metrics are reset', () => {
    service.addEvent(apiResponse({ finishReasons: ['refusal'] }));
    service.reset();

    expect(service.getSessionSnapshot().totalRefusals).toBe(0);
  });
});
