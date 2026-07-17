/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for CacheStatsDisplay reading from the canonical
 * session snapshot via uiTelemetryService.getSessionSnapshot().
 * The cache display is driven by real telemetry events flowing
 * through the aggregator, not by a provider manager.
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheStatsDisplay } from './CacheStatsDisplay.js';
import * as SessionContext from '../contexts/SessionContext.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-telemetry';
import type { UiEvent } from '@vybestack/llxprt-code-telemetry';
import { EVENT_API_RESPONSE } from '@vybestack/llxprt-code-telemetry/telemetry/constants.js';

vi.mock('../contexts/SessionContext.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionContext>();
  return {
    ...actual,
    useSessionStats: vi.fn(),
  };
});

const useSessionStatsMock = vi.mocked(SessionContext.useSessionStats);

/**
 * Emit a provider-owned API response event with cache data through the
 * real aggregation pipeline. This exercises the full event path.
 */
function emitCacheResponse(opts: {
  cacheReads?: number;
  cacheWrites?: number | null;
  promptTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  model?: string;
}): void {
  const inputTokens = opts.promptTokens ?? 1000;
  const outputTokens = opts.outputTokens ?? 50;
  const event = {
    'event.name': EVENT_API_RESPONSE,
    'event.timestamp': new Date().toISOString(),
    model: opts.model ?? 'cache-test-model',
    duration_ms: 1000,
    input_token_count: inputTokens,
    output_token_count: outputTokens,
    total_token_count: inputTokens + outputTokens,
    cached_content_token_count: opts.cachedTokens ?? 0,
    thoughts_token_count: 0,
    tool_token_count: 0,
    finish_reasons: [],
    prompt_id: `prompt-${Math.random()}`,
    provider_owned: true,
    usage_metadata_present: true,
    cache_read_input_tokens: opts.cacheReads,
    cache_creation_input_tokens: opts.cacheWrites,
  } as UiEvent;
  uiTelemetryService.addEvent(event);
}

const renderCacheStats = () => {
  useSessionStatsMock.mockReturnValue({
    stats: {
      sessionId: 'test-session',
      sessionStartTime: new Date(),
      metrics: uiTelemetryService.getMetrics(),
      lastPromptTokenCount: 0,
      historyTokenCount: 0,
      promptCount: 0,
    },
    startNewPrompt: vi.fn(),
    getPromptCount: () => 0,
    updateHistoryTokenCount: vi.fn(),
  });
  return render(<CacheStatsDisplay />);
};

describe('<CacheStatsDisplay /> (canonical snapshot)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uiTelemetryService.reset();
  });

  it('should show "no cache data" when no provider-owned events with cache data', () => {
    const { lastFrame } = renderCacheStats();
    const output = lastFrame();
    expect(output).toContain('No cache data');
  });

  it('should display cache reads from canonical snapshot', () => {
    emitCacheResponse({
      cacheReads: 2000,
      promptTokens: 1000,
      cachedTokens: 200,
    });
    const { lastFrame } = renderCacheStats();
    const output = lastFrame();
    expect(output).toContain('Cache Reads');
    expect(output).toContain('Cache Hit Rate');
    expect(output).toMatch(/2[,\s]?000/);
  });

  it('should display cache writes from canonical snapshot', () => {
    emitCacheResponse({
      cacheReads: 500,
      cacheWrites: 300,
      promptTokens: 1000,
      cachedTokens: 100,
    });
    const { lastFrame } = renderCacheStats();
    const output = lastFrame();
    expect(output).toContain('Cache Writes');
    expect(output).toMatch(/300/);
  });

  it('should show requests with cache reads and writes', () => {
    emitCacheResponse({
      cacheReads: 1000,
      cacheWrites: 500,
      promptTokens: 2000,
      cachedTokens: 200,
    });
    const { lastFrame } = renderCacheStats();
    const output = lastFrame();
    expect(output).toContain('Requests with Cache Reads');
    expect(output).toContain('Requests with Cache Writes');
  });

  it('should hide cache writes when no reliable writes data', () => {
    emitCacheResponse({
      cacheReads: 5000,
      cacheWrites: undefined,
      promptTokens: 1000,
      cachedTokens: 200,
    });
    const { lastFrame } = renderCacheStats();
    const output = lastFrame();
    expect(output).toContain('Cache Reads');
    expect(output).not.toContain('Cache Writes');
  });

  it('should render Cache Writes row when cacheWrites is explicitly 0', () => {
    emitCacheResponse({
      cacheReads: 500,
      cacheWrites: 0,
      promptTokens: 1000,
      cachedTokens: 100,
    });
    const { lastFrame } = renderCacheStats();
    const output = lastFrame();
    expect(output).toContain('Cache Writes');
    expect(output).toMatch(/0/);
  });

  it('should show "no cache data" empty state, not an old provider-manager error', () => {
    const { lastFrame } = renderCacheStats();
    const output = lastFrame();
    expect(output).toContain('No cache data');
    expect(output).not.toContain('Provider manager not available');
  });
});
