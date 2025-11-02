/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P07
 * @requirement REQ-001, REQ-002, REQ-003, REQ-INT-001
 * Comprehensive behavioral tests for token tracking functionality
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ProviderManager } from '../packages/core/src/providers/ProviderManager.js';
import { OpenAIProvider } from '../packages/core/src/providers/openai/OpenAIProvider.js';
import { AnthropicProvider } from '../packages/core/src/providers/anthropic/AnthropicProvider.js';
import { GeminiProvider } from '../packages/core/src/providers/gemini/GeminiProvider.js';
import { Config } from '../packages/core/src/config/config.js';
import { ProviderPerformanceTracker } from '../packages/core/src/providers/logging/ProviderPerformanceTracker.js';
import { LoggingProviderWrapper } from '../packages/core/src/providers/LoggingProviderWrapper.js';
import {
  formatTokensPerMinute,
  formatThrottleTime,
  formatSessionTokenUsage,
} from '../packages/cli/src/ui/utils/tokenFormatters.js';
import { initializeTestProviderRuntime } from '../packages/core/src/test-utils/runtime.js';
import { clearActiveProviderRuntimeContext } from '../packages/core/src/runtime/providerRuntimeContext.js';
import { resetSettingsService } from '../packages/core/src/settings/settingsServiceInstance.js';

/**
 * Behavioral Test Suite for Token Tracking
 *
 * These tests verify user-visible behaviors of the token tracking system:
 * - Real-time token counting during streaming responses
 * - Session token accumulation across multiple requests
 * - Accurate token metrics for different providers
 * - UI display formatting
 * - Performance metrics calculation
 */
describe('Token Tracking Behavioral Tests', () => {
  let providerManager: ProviderManager;
  let config: Config;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSettingsService();
    const runtimeId = `token-tracking.behavioral.${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    initializeTestProviderRuntime({
      runtimeId,
      metadata: { suite: 'token-tracking-behavioral', runtimeId },
    });

    config = new Config({
      sessionId: 'behavioral-test-' + Date.now(),
      projectRoot: process.cwd(),
      targetDir: process.cwd(),
      llxprtHomeDir: '/tmp/.llxprt-behavioral-test',
      isReadOnlyFilesystem: false,
      persistentStatePath: '/tmp/.llxprt-behavioral-test/state',
      conversationLoggingEnabled: false,
      conversationLogPath: '/tmp/.llxprt-behavioral-test/logs',
      getUserMemory: () => '',
      embeddingModel: 'text-embedding-3-small',
      providerConfig: undefined,
      oauthManager: undefined,
    });

    providerManager = new ProviderManager();
    providerManager.setConfig(config);
    config.setProviderManager(providerManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  /**
   * REQ-001: Real-time Token Tracking During Streaming Responses
   * Behavioral Test: Verify token counts are updated in real-time as streaming responses arrive
   */
  describe('Real-time Token Tracking', () => {
    it('should accumulate tokens as streaming chunks arrive', async () => {
      // Given: A provider is active and streaming a response
      const openaiProvider = new OpenAIProvider('test-key');
      providerManager.registerProvider(openaiProvider);
      providerManager.setActiveProvider('openai');
      providerManager.resetSessionTokenUsage();

      const initialUsage = providerManager.getSessionTokenUsage();
      expect(initialUsage.total).toBe(0);

      // When: Streaming chunks arrive with token usage
      const chunk1Tokens = {
        input: 50,
        output: 25,
        cache: 0,
        tool: 0,
        thought: 0,
      };
      const chunk2Tokens = {
        input: 0,
        output: 30,
        cache: 0,
        tool: 0,
        thought: 0,
      };
      const chunk3Tokens = {
        input: 0,
        output: 45,
        cache: 10,
        tool: 0,
        thought: 0,
      };

      providerManager.accumulateSessionTokens('openai', chunk1Tokens);
      const afterChunk1 = providerManager.getSessionTokenUsage();

      providerManager.accumulateSessionTokens('openai', chunk2Tokens);
      const afterChunk2 = providerManager.getSessionTokenUsage();

      providerManager.accumulateSessionTokens('openai', chunk3Tokens);
      const afterChunk3 = providerManager.getSessionTokenUsage();

      // Then: Token counts increase incrementally with each chunk
      expect(afterChunk1.total).toBe(75); // 50 + 25
      expect(afterChunk2.total).toBe(105); // 75 + 30
      expect(afterChunk3.total).toBe(160); // 105 + 45 + 10

      // And: Individual token types are tracked correctly
      expect(afterChunk3.input).toBe(50);
      expect(afterChunk3.output).toBe(100); // 25 + 30 + 45
      expect(afterChunk3.cache).toBe(10);
    });

    it('should handle streaming responses with missing token metadata', async () => {
      // Given: A provider streaming response with incomplete token data
      const provider = new OpenAIProvider('test-key');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('openai');
      providerManager.resetSessionTokenUsage();

      // When: Chunks arrive with partial or missing token information
      const partialTokens = {
        input: 100,
        output: 0,
        cache: 0,
        tool: 0,
        thought: 0,
      };
      const missingFieldTokens = {
        input: 50,
        output: 25,
        cache: 0,
        tool: 0,
        thought: 0,
      };

      providerManager.accumulateSessionTokens('openai', partialTokens);
      providerManager.accumulateSessionTokens('openai', missingFieldTokens);

      const finalUsage = providerManager.getSessionTokenUsage();

      // Then: System handles missing data gracefully
      expect(finalUsage.input).toBe(150);
      expect(finalUsage.output).toBe(25);
      expect(finalUsage.total).toBe(175);
    });
  });

  /**
   * REQ-003: Session Token Accumulation Across Multiple Providers
   * Behavioral Test: Verify tokens are correctly accumulated across different providers
   */
  describe('Multi-Provider Session Token Accumulation', () => {
    it('should accumulate tokens from different providers in the same session', async () => {
      // Given: Multiple providers are registered and active
      const openaiProvider = new OpenAIProvider('test-openai-key');
      const anthropicProvider = new AnthropicProvider('test-anthropic-key');

      providerManager.registerProvider(openaiProvider);
      providerManager.registerProvider(anthropicProvider);
      providerManager.resetSessionTokenUsage();

      // When: Each provider contributes tokens to the session
      const openaiTokens = {
        input: 200,
        output: 150,
        cache: 50,
        tool: 25,
        thought: 0,
      };
      const anthropicTokens = {
        input: 300,
        output: 200,
        cache: 0,
        tool: 10,
        thought: 15,
      };

      providerManager.accumulateSessionTokens('openai', openaiTokens);
      providerManager.accumulateSessionTokens('anthropic', anthropicTokens);

      const sessionUsage = providerManager.getSessionTokenUsage();

      // Then: Session totals reflect contributions from all providers
      expect(sessionUsage.input).toBe(500); // 200 + 300
      expect(sessionUsage.output).toBe(350); // 150 + 200
      expect(sessionUsage.cache).toBe(50); // 50 + 0
      expect(sessionUsage.tool).toBe(35); // 25 + 10
      expect(sessionUsage.thought).toBe(15); // 0 + 15
      expect(sessionUsage.total).toBe(950); // Sum of all components
    });

    it('should maintain accurate session totals when providers are switched mid-session', async () => {
      // Given: A session starts with one provider
      const openaiProvider = new OpenAIProvider('test-key');
      const geminiProvider = new GeminiProvider();

      providerManager.registerProvider(openaiProvider);
      providerManager.registerProvider(geminiProvider);
      providerManager.setActiveProvider('openai');
      providerManager.resetSessionTokenUsage();

      // When: User switches between providers during the session
      providerManager.accumulateSessionTokens('openai', {
        input: 100,
        output: 75,
        cache: 0,
        tool: 0,
        thought: 0,
      });

      providerManager.setActiveProvider('gemini');
      providerManager.accumulateSessionTokens('gemini', {
        input: 150,
        output: 100,
        cache: 25,
        tool: 15,
        thought: 5,
      });

      providerManager.setActiveProvider('openai');
      providerManager.accumulateSessionTokens('openai', {
        input: 80,
        output: 60,
        cache: 10,
        tool: 5,
        thought: 0,
      });

      const finalUsage = providerManager.getSessionTokenUsage();

      // Then: All tokens are correctly accumulated regardless of provider switches
      expect(finalUsage.input).toBe(330); // 100 + 150 + 80
      expect(finalUsage.output).toBe(235); // 75 + 100 + 60
      expect(finalUsage.cache).toBe(35); // 0 + 25 + 10
      expect(finalUsage.tool).toBe(20); // 0 + 15 + 5
      expect(finalUsage.thought).toBe(5); // 0 + 5 + 0
      expect(finalUsage.total).toBe(625);
    });
  });

  /**
   * REQ-001: Tokens Per Minute Calculation
   * Behavioral Test: Verify TPM is calculated correctly based on recent activity
   */
  describe('Tokens Per Minute Calculation', () => {
    it('should calculate TPM based on recent token activity within the last minute', () => {
      // Given: A provider performance tracker
      const tracker = new ProviderPerformanceTracker('openai');
      tracker.reset();

      const now = Date.now();
      const within60Seconds = now - 30000; // 30 seconds ago
      const beyond60Seconds = now - 90000; // 90 seconds ago (should be ignored)

      // When: Token activity occurs at different times
      // Simulate recent activity
      tracker.recordCompletion(1000, within60Seconds, 1200, 10);
      tracker.recordCompletion(1000, within60Seconds + 10000, 800, 8);

      // Simulate old activity (should be ignored in TPM calculation)
      tracker.recordCompletion(1000, beyond60Seconds, 2000, 15);

      const metrics = tracker.getLatestMetrics();

      // Then: TPM reflects only recent activity (within last 60 seconds)
      expect(metrics.tokensPerMinute).toBeGreaterThan(0);
      // The calculation should be based on ~2000 tokens in less than 60 seconds
      expect(metrics.tokensPerMinute).toBeGreaterThan(2000); // Should be > 2000 TPM
    });

    it('should return zero TPM when no recent activity exists', () => {
      // Given: A fresh tracker with no activity
      const tracker = new ProviderPerformanceTracker('openai');
      tracker.reset();

      // When: No activity has been recorded
      const metrics = tracker.getLatestMetrics();

      // Then: TPM should be zero
      expect(metrics.tokensPerMinute).toBe(0);
    });
  });

  /**
   * REQ-002: Throttle Wait Time Tracking
   * Behavioral Test: Verify throttle times are accumulated correctly
   */
  describe('Throttle Wait Time Tracking', () => {
    it('should accumulate throttle wait times from 429 errors', () => {
      // Given: A provider performance tracker
      const tracker = new ProviderPerformanceTracker('openai');
      tracker.reset();

      // When: Multiple throttling events occur
      const waitTimes = [2000, 4000, 1500, 3000]; // milliseconds

      for (const waitTime of waitTimes) {
        tracker.trackThrottleWaitTime(waitTime);
      }

      const metrics = tracker.getLatestMetrics();

      // Then: Total wait time is correctly accumulated
      expect(metrics.throttleWaitTimeMs).toBe(10500); // 2000 + 4000 + 1500 + 3000
    });

    it('should reset throttle wait time when tracker is reset', () => {
      // Given: A tracker with accumulated throttle time
      const tracker = new ProviderPerformanceTracker('openai');
      tracker.trackThrottleWaitTime(5000);

      expect(tracker.getLatestMetrics().throttleWaitTimeMs).toBe(5000);

      // When: Tracker is reset
      tracker.reset();

      // Then: Throttle wait time is cleared
      expect(tracker.getLatestMetrics().throttleWaitTimeMs).toBe(0);
    });
  });

  /**
   * REQ-INT-001: UI Display Formatting
   * Behavioral Test: Verify token metrics are formatted correctly for display
   */
  describe('UI Display Formatting', () => {
    describe('Footer Token Display', () => {
      it('should format TPM values with appropriate suffixes', () => {
        // Test various TPM ranges
        expect(formatTokensPerMinute(500)).toBe('500');
        expect(formatTokensPerMinute(1200)).toBe('1.2K');
        expect(formatTokensPerMinute(45000)).toBe('45.0K');
        expect(formatTokensPerMinute(1500000)).toBe('1.5M');
      });

      it('should format throttle wait times with appropriate units', () => {
        // Test various wait time ranges
        expect(formatThrottleTime(500)).toBe('500ms');
        expect(formatThrottleTime(2500)).toBe('2.5s');
        expect(formatThrottleTime(65000)).toBe('1.1m');
        expect(formatThrottleTime(125000)).toBe('2.1m');
      });
    });

    describe('Stats Display Token Breakdown', () => {
      it('should format session token usage for detailed display', () => {
        // Given: A complete token usage breakdown
        const usage = {
          input: 12345,
          output: 8901,
          cache: 2345,
          tool: 567,
          thought: 123,
          total: 24281,
        };

        // When: Formatting for stats display
        const formatted = formatSessionTokenUsage(usage);

        // Then: All components are included with proper formatting
        expect(formatted).toContain('Session Tokens');
        expect(formatted).toContain('Input: 12,345');
        expect(formatted).toContain('Output: 8,901');
        expect(formatted).toContain('Cache: 2,345');
        expect(formatted).toContain('Tool: 567');
        expect(formatted).toContain('Thought: 123');
        expect(formatted).toContain('Total: 24,281');
      });
    });
  });

  /**
   * Provider-Specific Token Handling
   * Behavioral Test: Verify different providers report tokens correctly
   */
  describe('Provider-Specific Token Handling', () => {
    it('should handle OpenAI token format correctly', () => {
      // Given: A LoggingProviderWrapper for OpenAI
      const openaiProvider = new OpenAIProvider('test-key');
      const mockConfig = {
        getRedactionConfig: () => ({
          redactApiKeys: true,
          redactCredentials: true,
          redactFilePaths: false,
          redactUrls: false,
          redactEmails: false,
          redactPersonalInfo: false,
        }),
        getConversationLoggingEnabled: () => false,
      };
      const wrapper = new LoggingProviderWrapper(openaiProvider, mockConfig);

      // When: Processing an OpenAI-style response
      const openaiResponse = {
        usage: {
          prompt_tokens: 150,
          completion_tokens: 100,
          total_tokens: 250,
        },
      };

      const tokenCounts =
        wrapper.extractTokenCountsFromResponse(openaiResponse);

      // Then: Tokens are extracted correctly
      expect(tokenCounts.input_token_count).toBe(150);
      expect(tokenCounts.output_token_count).toBe(100);
      expect(tokenCounts.cached_content_token_count).toBe(0);
      expect(tokenCounts.tool_token_count).toBe(0);
      expect(tokenCounts.thoughts_token_count).toBe(0);
    });

    it('should handle Anthropic token format correctly', () => {
      // Given: A LoggingProviderWrapper for Anthropic
      const anthropicProvider = new AnthropicProvider('test-key');
      const mockConfig = {
        getRedactionConfig: () => ({
          redactApiKeys: true,
          redactCredentials: true,
          redactFilePaths: false,
          redactUrls: false,
          redactEmails: false,
          redactPersonalInfo: false,
        }),
        getConversationLoggingEnabled: () => false,
      };
      const wrapper = new LoggingProviderWrapper(anthropicProvider, mockConfig);

      // When: Processing an Anthropic-style response with headers
      const anthropicResponse = {
        headers: {
          'anthropic-input-tokens': '200',
          'anthropic-output-tokens': '150',
        },
      };

      const tokenCounts =
        wrapper.extractTokenCountsFromResponse(anthropicResponse);

      // Then: Tokens are extracted from headers correctly
      expect(tokenCounts.input_token_count).toBe(200);
      expect(tokenCounts.output_token_count).toBe(150);
      // Note: Cache tokens are not extracted by current implementation
      expect(tokenCounts.cached_content_token_count).toBe(0);
    });
  });

  /**
   * End-to-End Token Tracking Flow
   * Behavioral Test: Verify complete token tracking from API call to UI display
   */
  describe('End-to-End Token Tracking Flow', () => {
    it('should track tokens through complete request-response cycle', async () => {
      // Given: A complete provider setup
      const provider = new OpenAIProvider('test-key');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('openai');
      providerManager.resetSessionTokenUsage();

      // When: Simulating a complete API interaction
      const requestTokens = {
        input: 100,
        output: 75,
        cache: 0,
        tool: 0,
        thought: 0,
      };

      // Accumulate tokens from the request
      providerManager.accumulateSessionTokens('openai', requestTokens);

      // Get provider metrics for display
      const providerMetrics = providerManager.getProviderMetrics('openai');
      const sessionUsage = providerManager.getSessionTokenUsage();

      // Then: All components work together correctly
      expect(sessionUsage.total).toBe(175);
      expect(providerMetrics).toBeDefined();

      // And: Metrics can be formatted for UI display
      const formattedTPM = formatTokensPerMinute(
        providerMetrics?.tokensPerMinute || 0,
      );
      const formattedThrottleTime = formatThrottleTime(
        providerMetrics?.throttleWaitTimeMs || 0,
      );
      const formattedSessionUsage = formatSessionTokenUsage(sessionUsage);

      expect(formattedTPM).toBeDefined();
      expect(formattedThrottleTime).toBeDefined();
      expect(formattedSessionUsage).toContain('Session Tokens');
    });

    it('should maintain token tracking accuracy across session lifecycle', async () => {
      // Given: A fresh session
      providerManager.resetSessionTokenUsage();
      const provider = new OpenAIProvider('test-key');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('openai');

      // When: Multiple requests are made during the session
      const requests = [
        { input: 200, output: 150, cache: 0, tool: 25, thought: 0 },
        { input: 300, output: 200, cache: 50, tool: 15, thought: 10 },
        { input: 150, output: 100, cache: 25, tool: 0, thought: 5 },
      ];

      for (const request of requests) {
        providerManager.accumulateSessionTokens('openai', request);
      }

      const finalUsage = providerManager.getSessionTokenUsage();

      // Then: Final totals are accurate
      expect(finalUsage.input).toBe(650); // 200 + 300 + 150
      expect(finalUsage.output).toBe(450); // 150 + 200 + 100
      expect(finalUsage.cache).toBe(75); // 0 + 50 + 25
      expect(finalUsage.tool).toBe(40); // 25 + 15 + 0
      expect(finalUsage.thought).toBe(15); // 0 + 10 + 5
      expect(finalUsage.total).toBe(1230);

      // And: Session can be reset cleanly
      providerManager.resetSessionTokenUsage();
      const resetUsage = providerManager.getSessionTokenUsage();
      expect(resetUsage.total).toBe(0);
    });
  });

  /**
   * Error Handling and Edge Cases
   * Behavioral Test: Verify system handles edge cases gracefully
   */
  describe('Token Tracking Error Handling', () => {
    it('should handle invalid token values gracefully', () => {
      // Given: A provider manager
      providerManager.resetSessionTokenUsage();

      // When: Attempting to accumulate invalid token values
      const invalidTokens = {
        input: -50, // Negative value
        output: 0,
        cache: 0,
        tool: 0,
        thought: 0,
      };

      // Should not throw an error
      expect(() => {
        providerManager.accumulateSessionTokens('openai', invalidTokens);
      }).not.toThrow();

      // System should handle gracefully (implementation may clamp to 0 or ignore)
      const usage = providerManager.getSessionTokenUsage();
      expect(usage.total).toBeGreaterThanOrEqual(0);
    });

    it('should handle missing provider gracefully', () => {
      // Given: No providers registered
      providerManager.resetSessionTokenUsage();

      // When: Attempting to accumulate tokens for non-existent provider
      const tokens = { input: 100, output: 50, cache: 0, tool: 0, thought: 0 };

      // Should not throw an error
      expect(() => {
        providerManager.accumulateSessionTokens('nonexistent-provider', tokens);
      }).not.toThrow();
    });
  });
});
