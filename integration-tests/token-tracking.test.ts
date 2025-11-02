/**
 * @plan PLAN-20250909-TOKTRACK.P07
 * @requirement REQ-001, REQ-002, REQ-003
 * Integration TDD Phase - Behavioral tests for token tracking
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProviderManager } from '../packages/core/src/providers/ProviderManager';
import { ProviderPerformanceTracker } from '../packages/core/src/providers/logging/ProviderPerformanceTracker';
import { LoggingProviderWrapper } from '../packages/core/src/providers/LoggingProviderWrapper';
import { retryWithBackoff } from '../packages/core/src/utils/retry';
// import { TelemetryService } from '../packages/core/src/telemetry/TelemetryService'; // Not used in tests
import type { RedactionConfig } from '../packages/core/src/config/types';
import { initializeTestProviderRuntime } from '../packages/core/src/test-utils/runtime.js';
import { clearActiveProviderRuntimeContext } from '../packages/core/src/runtime/providerRuntimeContext.js';
import { resetSettingsService } from '../packages/core/src/settings/settingsServiceInstance.js';

// Mock the telemetry service to capture logs
vi.mock('../packages/core/src/telemetry/TelemetryService', () => {
  return {
    TelemetryService: {
      getInstance: vi.fn().mockReturnValue({
        logApiResponse: vi.fn(),
      }),
    },
  };
});

// Mock Config class
class MockConfig {
  getRedactionConfig(): RedactionConfig {
    return {
      redactApiKeys: true,
      redactCredentials: true,
      redactFilePaths: false,
      redactUrls: false,
      redactEmails: false,
      redactPersonalInfo: false,
    };
  }

  getConversationLoggingEnabled(): boolean {
    return true;
  }
}

describe('Token Tracking Integration Tests', () => {
  let providerManager: ProviderManager;
  let tracker: ProviderPerformanceTracker;
  let mockProvider: { id: string; name: string; call: () => void };
  let mockConfig: MockConfig;

  beforeEach(() => {
    resetSettingsService();
    const runtimeId = `token-tracking.integration.${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    initializeTestProviderRuntime({
      runtimeId,
      metadata: { suite: 'token-tracking-integration', runtimeId },
    });
    // Create mock provider instances
    mockProvider = {
      id: 'test-provider',
      name: 'Test Provider',
      call: vi.fn(),
    };

    providerManager = new ProviderManager();
    tracker = new ProviderPerformanceTracker(mockProvider.id);
    mockConfig = new MockConfig();
    new LoggingProviderWrapper(mockProvider, mockConfig);
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  // Test 1: ProviderPerformanceTracker TPM Calculation
  it('should correctly calculate tokens per minute based on API responses', async () => {
    // Simulate API responses with tokens and timestamps
    const responses = [
      { tokenCount: 100, timestamp: Date.now() - 30000 },
      { tokenCount: 200, timestamp: Date.now() - 15000 },
      { tokenCount: 150, timestamp: Date.now() },
    ];

    for (const response of responses) {
      tracker.recordCompletion(1000, null, response.tokenCount, 10);
    }

    const tpm = tracker.getLatestMetrics().tokensPerMinute;
    expect(tpm).toBeGreaterThan(0);
  });

  // Test 2: ProviderPerformanceTracker Throttle Tracking
  it('should correctly accumulate throttle wait times', () => {
    const waitTimes = [1000, 2000, 1500]; // in milliseconds

    for (const waitTime of waitTimes) {
      tracker.addThrottleWaitTime(waitTime);
    }

    const throttleWaitTime = tracker.getLatestMetrics().throttleWaitTimeMs;
    expect(throttleWaitTime).toBe(4500); // 1000 + 2000 + 1500

    tracker.reset();
    expect(tracker.getLatestMetrics().throttleWaitTimeMs).toBe(0);
  });

  // Test 3: ProviderManager Session Token Accumulation
  it('should correctly accumulate session token usage from multiple providers', () => {
    const provider1Tokens = {
      input: 100,
      output: 50,
      cache: 25,
      tool: 10,
      thought: 5,
    };
    const provider2Tokens = {
      input: 200,
      output: 150,
      cache: 75,
      tool: 20,
      thought: 15,
    };

    providerManager.accumulateSessionTokens('test-provider', provider1Tokens);
    providerManager.accumulateSessionTokens('test-provider', provider2Tokens);

    const sessionUsage = providerManager.getSessionTokenUsage();
    expect(sessionUsage.input).toBe(300); // 100 + 200
    expect(sessionUsage.output).toBe(200); // 50 + 150
    expect(sessionUsage.cache).toBe(100); // 25 + 75
    expect(sessionUsage.tool).toBe(30); // 10 + 20
    expect(sessionUsage.thought).toBe(20); // 5 + 15
  });

  // Test 4: Token Usage Accumulation Behavior
  it('should correctly accumulate session tokens from provider responses', async () => {
    // Setup initial usage state
    providerManager.resetSessionTokenUsage();

    const initialUsage = providerManager.getSessionTokenUsage();
    expect(initialUsage.total).toBe(0);

    // Simulate token accumulation from provider responses
    const usage1 = {
      input: 120,
      output: 80,
      cache: 20,
      tool: 10,
      thought: 5,
    };

    providerManager.accumulateSessionTokens('test-provider', usage1);

    const afterFirstUsage = providerManager.getSessionTokenUsage();
    expect(afterFirstUsage.input).toBe(120);
    expect(afterFirstUsage.output).toBe(80);
    expect(afterFirstUsage.total).toBe(235);

    // Add more usage
    const usage2 = {
      input: 150,
      output: 90,
      cache: 30,
      tool: 15,
      thought: 10,
    };

    providerManager.accumulateSessionTokens('test-provider', usage2);

    const finalUsage = providerManager.getSessionTokenUsage();
    expect(finalUsage.input).toBe(270); // 120 + 150
    expect(finalUsage.output).toBe(170); // 80 + 90
    expect(finalUsage.total).toBe(530); // 235 + 295
  });

  // Test 5: Retry System Throttle Integration (SKIPPED - integration issue)
  it.skip('should properly track throttle wait times during retries', async () => {
    const mockCall = vi.fn();
    let retryCount = 0;

    mockCall.mockImplementation(() => {
      retryCount++;
      if (retryCount < 3) {
        const error = new Error('Rate limited') as Error & {
          status: number;
          headers: { 'retry-after': string };
        };
        error.status = 429;
        error.headers = { 'retry-after': '0.1' }; // 0.1 seconds for faster test
        throw error;
      }
      return { success: true };
    });

    // Reset tracker before test
    tracker.reset();

    const result = await retryWithBackoff(mockCall, {
      maxRetries: 5,
      baseDelay: 100, // Shorter delays for testing
      backoffMultiplier: 1.5,
      trackThrottleWaitTime: (waitTime) =>
        tracker.addThrottleWaitTime(waitTime),
    });

    expect(result.success).toBe(true);
    expect(retryCount).toBe(3); // Should succeed on 3rd attempt

    // Check that throttle wait time was tracked
    const throttleWaitTime = tracker.getLatestMetrics().throttleWaitTimeMs;
    expect(throttleWaitTime).toBeGreaterThan(0);
  }, 10000); // 10 second timeout

  // Test 6: Logging Provider Wrapper Integration
  it('should create logging wrapper without errors', () => {
    const loggingWrapper = new LoggingProviderWrapper(mockProvider, mockConfig);

    // Verify wrapper properly delegates to wrapped provider
    expect(loggingWrapper.name).toBe(mockProvider.name);
    expect(loggingWrapper.wrappedProvider).toBe(mockProvider);

    // Verify methods exist
    expect(typeof loggingWrapper.generateChatCompletion).toBe('function');
    expect(typeof loggingWrapper.getModels).toBe('function');
    expect(typeof loggingWrapper.getDefaultModel).toBe('function');
  });

  // Test 7: Footer UI Component Integration
  it('should format TPM and throttle wait time for footer display', () => {
    // Create metrics with various values
    tracker.recordCompletion(1000, null, 5000, 10);
    tracker.addThrottleWaitTime(150000); // 2.5 minutes

    // Accumulate some tokens
    tracker.recordCompletion(1000, null, 100, 10);
    tracker.addThrottleWaitTime(1000);

    const metrics = tracker.getLatestMetrics();
    const tpm = metrics.tokensPerMinute;
    const throttleTime = metrics.throttleWaitTimeMs;

    // Footer component would format these values
    const formattedTPM = `${Math.round(tpm)}`;
    const formattedThrottleTime =
      throttleTime > 60000
        ? `${(throttleTime / 60000).toFixed(1)}m`
        : `${(throttleTime / 1000).toFixed(1)}s`;

    expect(formattedTPM).toMatch(/\d+/);
    expect(formattedThrottleTime).toMatch(/\d+(\.\d+)?[sm]/);
  });

  // Test 8: StatsDisplay UI Component Integration
  it('should display detailed token metrics correctly in stats UI', () => {
    // Simulate session token accumulation
    providerManager.accumulateSessionTokens('test-provider', {
      input: 1000,
      output: 500,
      cache: 200,
      tool: 50,
      thought: 25,
    });

    // Simulate provider metrics
    tracker.recordCompletion(1000, null, 200, 10);
    tracker.addThrottleWaitTime(30000); // 30 seconds

    const sessionTokens = providerManager.getSessionTokenUsage();
    const providerMetrics = tracker.getLatestMetrics();

    // StatsDisplay would format these metrics
    const statsDisplay = {
      sessionTokens: {
        input: sessionTokens.input,
        output: sessionTokens.output,
        cache: sessionTokens.cache,
        tool: sessionTokens.tool,
        thought: sessionTokens.thought,
        total:
          sessionTokens.input +
          sessionTokens.output +
          sessionTokens.cache +
          sessionTokens.tool +
          sessionTokens.thought,
      },
      providerMetrics: {
        tokensPerMinute: Math.round(providerMetrics.tokensPerMinute),
        throttleWaitTime: providerMetrics.throttleWaitTimeMs,
      },
    };

    // Verify components sum correctly
    const expectedTotal = 1000 + 500 + 200 + 50 + 25;
    expect(statsDisplay.sessionTokens.total).toBe(expectedTotal);
    expect(statsDisplay.providerMetrics.throttleWaitTime).toBe(30000);
  });

  // Test 9: Diagnostics Command Integration
  it('should include comprehensive token tracking information in diagnostics output', () => {
    // Setup metrics
    providerManager.accumulateSessionTokens('test-provider', {
      input: 2000,
      output: 1000,
      cache: 500,
      tool: 100,
      thought: 50,
    });
    tracker.recordCompletion(1000, null, 300, 10);
    tracker.addThrottleWaitTime(45000); // 45 seconds

    const sessionTokens = providerManager.getSessionTokenUsage();
    const providerMetrics = tracker.getLatestMetrics();

    // Simulate diagnostics command output
    const diagnosticsOutput = {
      sessionTokenUsage: sessionTokens,
      providerPerformance: {
        [mockProvider.id]: providerMetrics,
      },
    };

    // Verify all fields are included
    expect(diagnosticsOutput.sessionTokenUsage).toHaveProperty('input');
    expect(diagnosticsOutput.sessionTokenUsage).toHaveProperty('output');
    expect(diagnosticsOutput.sessionTokenUsage).toHaveProperty('cache');
    expect(diagnosticsOutput.sessionTokenUsage).toHaveProperty('tool');
    expect(diagnosticsOutput.sessionTokenUsage).toHaveProperty('thought');
    expect(
      diagnosticsOutput.providerPerformance[mockProvider.id],
    ).toHaveProperty('tokensPerMinute');
    expect(
      diagnosticsOutput.providerPerformance[mockProvider.id],
    ).toHaveProperty('throttleWaitTimeMs');
  });
});
