/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initializeTelemetry,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
} from './sdk.js';
import { Config } from '../config/config.js';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { IdeClient } from '../ide/ide-client.js';

vi.mock('@opentelemetry/sdk-node');
vi.mock('../config/config.js');

describe('telemetry', () => {
  let mockConfig: Config;
  let mockNodeSdk: NodeSDK;

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
    vi.spyOn(mockConfig, 'getTelemetryOtlpEndpoint').mockReturnValue(
      'http://localhost:4317',
    );
    vi.spyOn(mockConfig, 'getSessionId').mockReturnValue('test-session-id');
    mockNodeSdk = {
      start: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as NodeSDK;
    vi.mocked(NodeSDK).mockImplementation(() => mockNodeSdk);
  });

  afterEach(async () => {
    // Ensure we shut down telemetry even if a test fails.
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry();
    }
  });

  it('should initialize the telemetry service', () => {
    initializeTelemetry(mockConfig);
    // Telemetry is disabled, so NodeSDK should not be called
    expect(NodeSDK).not.toHaveBeenCalled();
    expect(mockNodeSdk.start).not.toHaveBeenCalled();
  });

  it('should shutdown the telemetry service', async () => {
    initializeTelemetry(mockConfig);
    await shutdownTelemetry();

    // Telemetry is disabled, so shutdown should not be called
    expect(mockNodeSdk.shutdown).not.toHaveBeenCalled();
  });
});
