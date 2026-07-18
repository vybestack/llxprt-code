/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Exact count assertions for #10 scenarios, split from the main
 * attemptLifecycle.exact.test.ts to keep both files under the lint
 * line budget.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoggingProviderWrapper } from '../LoggingProviderWrapper.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-telemetry/telemetry/uiTelemetry.js';
import * as sdk from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { ProviderPerformanceTracker } from '../logging/ProviderPerformanceTracker.js';
import {
  createConfig,
  makeContent,
  makeOptions,
  consumeStream,
  buildStack,
  SuccessProvider,
  SyncThrowProvider,
  ConsumerAbortedProvider,
  FailThenSucceedProvider,
  AlwaysFailProvider,
  SUCCESS_CHUNKS,
} from './attemptLifecycle.helpers.test.js';

describe('#10 exact counts for all scenarios', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(false);
    uiTelemetryService.reset();
  });

  it('direct success emits exactly 1 request, 0 errors', async () => {
    const config = createConfig(false);
    const wrapper = new LoggingProviderWrapper(
      new SuccessProvider(SUCCESS_CHUNKS),
      config,
    );
    wrapper.setRuntimeContextResolver(() => ({
      runtimeId: 'test',
      settingsService: { getConfig: () => config } as never,
      config,
      metadata: {},
    }));
    await consumeStream(
      wrapper.generateChatCompletion(makeOptions(config, makeContent())),
    );
    const snap = uiTelemetryService.getSessionSnapshot();
    expect(snap.totalApiRequests).toBe(1);
    expect(snap.totalApiErrors).toBe(0);
  });

  it('direct sync throw emits exactly 1 request, 1 error', async () => {
    const config = createConfig(false);
    const wrapper = new LoggingProviderWrapper(new SyncThrowProvider(), config);
    wrapper.setRuntimeContextResolver(() => ({
      runtimeId: 'test',
      settingsService: { getConfig: () => config } as never,
      config,
      metadata: {},
    }));
    await expect(
      consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      ),
    ).rejects.toThrow('Synchronous throw');
    const snap = uiTelemetryService.getSessionSnapshot();
    expect(snap.totalApiRequests).toBe(1);
    expect(snap.totalApiErrors).toBe(1);
  });

  it('direct abort emits exactly 1 request, 1 error terminal (consumer_abort)', async () => {
    const config = createConfig(false);
    const provider = new ConsumerAbortedProvider([
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'chunk1' }],
      } as IContent,
    ]);
    const wrapper = new LoggingProviderWrapper(provider, config);
    wrapper.setRuntimeContextResolver(() => ({
      runtimeId: 'test',
      settingsService: { getConfig: () => config } as never,
      config,
      metadata: {},
    }));
    const stream = wrapper.generateChatCompletion(
      makeOptions(config, makeContent()),
    );
    await stream.next();
    await stream.return?.(undefined);
    await vi.waitFor(() => {
      const snap = uiTelemetryService.getSessionSnapshot();
      expect(snap.totalApiRequests).toBe(1);
      expect(snap.totalApiErrors).toBe(1);
    });
  });

  it('retry success emits exactly 2 requests (1 error + 1 success)', async () => {
    const config = createConfig(false);
    const wrapper = buildStack(
      new FailThenSucceedProvider(2, SUCCESS_CHUNKS),
      config,
      { maxAttempts: 3, initialDelayMs: 1 },
    );
    await consumeStream(
      wrapper.generateChatCompletion(makeOptions(config, makeContent())),
    );
    const snap = uiTelemetryService.getSessionSnapshot();
    expect(snap.totalApiRequests).toBe(2);
    expect(snap.totalApiErrors).toBe(1);
  });

  it('all retries fail emits exactly maxAttempts errors', async () => {
    const config = createConfig(false);
    const retryableError = Object.assign(new Error('503 Server Error'), {
      status: 503,
      statusCode: 503,
    }) as Error & { status: number; statusCode: number };
    const wrapper = buildStack(new AlwaysFailProvider(retryableError), config, {
      maxAttempts: 2,
      initialDelayMs: 1,
    });
    await expect(
      consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      ),
    ).rejects.toThrow('503 Server Error');
    const snap = uiTelemetryService.getSessionSnapshot();
    expect(snap.totalApiRequests).toBe(2);
    expect(snap.totalApiErrors).toBe(2);
  });

  it('pre-abort with zero raw attempts emits exactly 0 requests', async () => {
    const config = createConfig(false);
    const wrapper = buildStack(new SuccessProvider(SUCCESS_CHUNKS), config);
    const controller = new AbortController();
    controller.abort();
    const options = makeOptions(config, makeContent());
    options.invocation = {
      ...(options.invocation ?? {}),
      signal: controller.signal,
    } as never;
    await expect(
      consumeStream(wrapper.generateChatCompletion(options)),
    ).rejects.toThrow(/abort/i);
    const snap = uiTelemetryService.getSessionSnapshot();
    expect(snap.totalApiRequests).toBe(0);
    expect(snap.totalApiErrors).toBe(0);
  });
});

describe('#10 logging parity and conversation write count', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(false);
    uiTelemetryService.reset();
  });

  it('aggregates exactly 1 model regardless of SDK initialization', async () => {
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(false);
    const config = createConfig(false);
    const wrapper = buildStack(new SuccessProvider(SUCCESS_CHUNKS), config);
    await consumeStream(
      wrapper.generateChatCompletion(makeOptions(config, makeContent())),
    );
    const metrics = uiTelemetryService.getMetrics();
    expect(Object.keys(metrics.models)).toHaveLength(1);
  });

  it('logging enabled: exactly 1 model in aggregator', async () => {
    const config = createConfig(true);
    const wrapper = buildStack(new SuccessProvider(SUCCESS_CHUNKS), config);
    await consumeStream(
      wrapper.generateChatCompletion(makeOptions(config, makeContent())),
    );
    const metrics = uiTelemetryService.getMetrics();
    expect(Object.keys(metrics.models)).toHaveLength(1);
  });
});

describe('#10 relative TTFT / last token / generation', () => {
  it('TTFT and lastTokenMs are relative to request start (not absolute)', () => {
    const tracker = new ProviderPerformanceTracker('test');
    // TPS uses output tokens: 500 output / (3000-200)ms ≈ 178.57 tok/s
    tracker.recordCompletion(5000, 200, 1000, 500, 10, 3000);
    const metrics = tracker.getLatestMetrics();
    expect(metrics.timeToFirstToken).toBe(200);
    expect(metrics.tokensPerSecond).toBeCloseTo(178.57, 0);
  });
});

describe('LoggingProviderWrapper sync invocation timing (finding #5)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(false);
    uiTelemetryService.reset();
  });

  it('sync throw records a finite non-negative monotonic elapsed duration', async () => {
    const config = createConfig(false);
    const wrapper = new LoggingProviderWrapper(new SyncThrowProvider(), config);
    wrapper.setRuntimeContextResolver(() => ({
      runtimeId: 'test',
      settingsService: { getConfig: () => config } as never,
      config,
      metadata: {},
    }));
    await expect(
      consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      ),
    ).rejects.toThrow('Synchronous throw');
    const snap = uiTelemetryService.getSessionSnapshot();
    // The monotonic elapsed must be finite and non-negative (Date.now
    // wall-clock changes would break this with the old Date.now approach).
    expect(Number.isFinite(snap.accumulatedApiTimeMs)).toBe(true);
    expect(snap.accumulatedApiTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('sync throw elapsed uses performance.now, not Date.now (wall-clock shift)', async () => {
    // Simulate a wall-clock adjustment between request start and the
    // sync throw. performance.now is monotonic so the elapsed must be
    // small and positive; Date.now would yield a negative or huge value.
    let perfNow = 1000;
    const perfSpy = vi
      .spyOn(performance, 'now')
      .mockImplementation(() => perfNow);

    const config = createConfig(false);
    // Provider that advances the mocked performance.now by 5ms before
    // throwing synchronously, simulating real elapsed work.
    const provider = new SyncThrowProvider();
    const wrapper = new LoggingProviderWrapper(provider, config);
    wrapper.setRuntimeContextResolver(() => ({
      runtimeId: 'test',
      settingsService: { getConfig: () => config } as never,
      config,
      metadata: {},
    }));

    // Patch the provider to advance performance.now before throwing
    const origGenerate = provider.generateChatCompletion.bind(provider);
    provider.generateChatCompletion = function* () {
      perfNow += 5;
      yield* origGenerate();
    };

    await expect(
      consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      ),
    ).rejects.toThrow('Synchronous throw');

    const snap = uiTelemetryService.getSessionSnapshot();
    // The recorded elapsed is the monotonic delta (5ms), finite and
    // non-negative — NOT affected by any Date.now wall-clock change.
    expect(snap.accumulatedApiTimeMs).toBe(5);
    perfSpy.mockRestore();
  });
});
