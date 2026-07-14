/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Group B: flushTelemetry tests
 * @plan PLAN-20250219-GMERGE021.R4
 * @requirement REQ-R4-2 (flushTelemetry implementation)
 *
 * These tests verify that flushTelemetry function exists and behaves correctly.
 * These tests WILL FAIL in RED phase because flushTelemetry does not exist yet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initializeTelemetry,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  flushTelemetry,
} from './sdk.js';
import { Config } from '../config/config.js';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { IdeClient } from '@vybestack/llxprt-code-ide-integration';

vi.mock('@opentelemetry/sdk-node');
vi.mock('../config/config.js');

describe('flushTelemetry', () => {
  let mockConfig: Config;
  let mockNodeSdk: NodeSDK & { forceFlush?: () => Promise<void> };

  beforeEach(() => {
    vi.resetAllMocks();

    mockConfig = new Config({
      sessionId: 'test-session-id',
      model: 'test-model',
      targetDir: '/test/dir',
      debugMode: false,
      cwd: '/test/dir',
      ideClient: IdeClient.getInstance(false),
    });
    vi.spyOn(mockConfig, 'getTelemetryEnabled').mockReturnValue(true);
    vi.spyOn(mockConfig, 'getSessionId').mockReturnValue('test-session-id');

    mockNodeSdk = {
      start: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
      forceFlush: vi.fn().mockResolvedValue(undefined),
    } as unknown as NodeSDK & { forceFlush?: () => Promise<void> };

    vi.mocked(NodeSDK).mockImplementation(() => mockNodeSdk);
  });

  afterEach(async () => {
    // Ensure we shut down telemetry even if a test fails
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry(mockConfig);
    }
  });

  it('should resolve without error when SDK not initialized', async () => {
    // Don't initialize telemetry - call flushTelemetry on uninitialized SDK
    await expect(flushTelemetry()).resolves.toBeUndefined();

    // Should not have called forceFlush
    expect(mockNodeSdk.forceFlush).not.toHaveBeenCalled();
  });

  it('should call forceFlush on the SDK when initialized', async () => {
    // Initialize telemetry first
    initializeTelemetry(mockConfig);

    // Call flushTelemetry
    await flushTelemetry();

    // Assert forceFlush was called
    expect(mockNodeSdk.forceFlush).toHaveBeenCalledTimes(1);
  });

  it('should guard against concurrent calls', async () => {
    // Initialize telemetry
    initializeTelemetry(mockConfig);

    // Make forceFlush take some time
    let resolveFlush: (() => void) | undefined;
    const flushPromise = new Promise<void>((resolve) => {
      resolveFlush = resolve;
    });
    vi.mocked(mockNodeSdk.forceFlush!).mockReturnValue(flushPromise);

    // Call flushTelemetry twice simultaneously
    const flush1 = flushTelemetry();
    const flush2 = flushTelemetry();

    // Resolve the mock flush
    resolveFlush!();
    await Promise.all([flush1, flush2]);

    // Assert only one forceFlush call was made (concurrent guard)
    expect(mockNodeSdk.forceFlush).toHaveBeenCalledTimes(1);
  });

  it('should not throw if forceFlush fails', async () => {
    // Initialize telemetry
    initializeTelemetry(mockConfig);

    // Mock forceFlush to throw
    const error = new Error('Flush failed');
    vi.mocked(mockNodeSdk.forceFlush!).mockRejectedValueOnce(error);

    // Assert flushTelemetry resolves without throwing
    await expect(flushTelemetry()).resolves.toBeUndefined();
  });
});
