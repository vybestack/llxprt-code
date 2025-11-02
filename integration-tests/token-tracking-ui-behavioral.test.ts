/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P07
 * @requirement REQ-INT-001
 * Behavioral tests for token tracking UI integration
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ProviderManager } from '../packages/core/src/providers/ProviderManager.js';
import { OpenAIProvider } from '../packages/core/src/providers/openai/OpenAIProvider.js';
import { Config } from '../packages/core/src/config/config.js';
import {
  formatTokensPerMinute,
  formatThrottleTime,
  formatSessionTokenUsage,
} from '../packages/cli/src/ui/utils/tokenFormatters.js';
import { initializeTestProviderRuntime } from '../packages/core/src/test-utils/runtime.js';
import { clearActiveProviderRuntimeContext } from '../packages/core/src/runtime/providerRuntimeContext.js';
import { resetSettingsService } from '../packages/core/src/settings/settingsServiceInstance.js';

// Mock the provider manager instance to return our test instance
const mockProviderManager = vi.fn();
vi.mock('../packages/cli/src/providers/providerManagerInstance.js', () => ({
  getProviderManager: () => mockProviderManager(),
}));

/**
 * UI Behavioral Tests for Token Tracking
 *
 * These tests verify that token tracking data is correctly integrated
 * and displayed in the UI components, focusing on user-visible behaviors.
 */
describe('Token Tracking UI Behavioral Tests', () => {
  let providerManager: ProviderManager;
  let config: Config;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSettingsService();
    const runtimeId = `token-tracking.ui.${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    initializeTestProviderRuntime({
      runtimeId,
      metadata: { suite: 'token-tracking-ui', runtimeId },
    });

    config = new Config({
      sessionId: 'ui-behavioral-test-' + Date.now(),
      projectRoot: process.cwd(),
      targetDir: process.cwd(),
      llxprtHomeDir: '/tmp/.llxprt-ui-behavioral-test',
      isReadOnlyFilesystem: false,
      persistentStatePath: '/tmp/.llxprt-ui-behavioral-test/state',
      conversationLoggingEnabled: false,
      conversationLogPath: '/tmp/.llxprt-ui-behavioral-test/logs',
      getUserMemory: () => '',
      embeddingModel: 'text-embedding-3-small',
      providerConfig: undefined,
      oauthManager: undefined,
    });

    providerManager = new ProviderManager();
    providerManager.setConfig(config);
    config.setProviderManager(providerManager);

    // Mock the provider manager instance
    mockProviderManager.mockReturnValue(providerManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  /**
   * REQ-INT-001.1: Footer Component Token Display
   * Behavioral Test: Verify footer shows real-time token metrics
   */
  describe('Footer Token Metrics Display', () => {
    it('should display tokens per minute in footer when available', () => {
      // Given: Token metrics with various TPM values
      const testCases = [
        { tpm: 500, expected: '500' },
        { tpm: 1200, expected: '1.2K' },
        { tpm: 45000, expected: '45.0K' },
        { tpm: 1500000, expected: '1.5M' },
      ];

      // When/Then: Each value is formatted correctly for footer display
      testCases.forEach(({ tpm, expected }) => {
        const formatted = formatTokensPerMinute(tpm);
        expect(formatted).toBe(expected);
      });
    });

    it('should display throttle wait time in footer when throttling occurs', () => {
      // Given: Various throttle wait times
      const testCases = [
        { waitTime: 250, expected: '250ms' },
        { waitTime: 1500, expected: '1.5s' },
        { waitTime: 45000, expected: '45.0s' },
        { waitTime: 125000, expected: '2.1m' },
      ];

      // When/Then: Each wait time is formatted appropriately
      testCases.forEach(({ waitTime, expected }) => {
        const formatted = formatThrottleTime(waitTime);
        expect(formatted).toBe(expected);
      });
    });

    it('should show session token total in footer', () => {
      // Given: A session with accumulated tokens
      const provider = new OpenAIProvider('test-key');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('openai');
      providerManager.resetSessionTokenUsage();

      // When: Tokens accumulate during the session
      providerManager.accumulateSessionTokens('openai', {
        input: 1500,
        output: 800,
        cache: 200,
        tool: 50,
        thought: 25,
      });

      const sessionUsage = providerManager.getSessionTokenUsage();

      // Then: Total reflects all token types
      expect(sessionUsage.total).toBe(2575);

      // And: Total can be displayed in footer format
      const footerDisplay = sessionUsage.total.toLocaleString();
      expect(footerDisplay).toBe('2,575');
    });
  });

  /**
   * REQ-INT-001.2: StatsDisplay Component Token Breakdown
   * Behavioral Test: Verify stats display shows detailed token usage
   */
  describe('Stats Display Token Breakdown', () => {
    it('should format comprehensive session token breakdown for stats display', () => {
      // Given: A session with diverse token usage
      const usage = {
        input: 15432,
        output: 9876,
        cache: 3210,
        tool: 987,
        thought: 456,
        total: 29961,
      };

      // When: Formatting for detailed stats display
      const formatted = formatSessionTokenUsage(usage);

      // Then: All token categories are displayed with proper formatting
      expect(formatted).toContain('Session Tokens');
      expect(formatted).toContain('Input: 15,432');
      expect(formatted).toContain('Output: 9,876');
      expect(formatted).toContain('Cache: 3,210');
      expect(formatted).toContain('Tool: 987');
      expect(formatted).toContain('Thought: 456');
      expect(formatted).toContain('Total: 29,961');

      // And: Format is consistent for UI display
      expect(formatted).toMatch(
        /Session Tokens - Input: [\d,]+, Output: [\d,]+, Cache: [\d,]+, Tool: [\d,]+, Thought: [\d,]+, Total: [\d,]+/,
      );
    });

    it('should handle zero values in token breakdown gracefully', () => {
      // Given: A session with some zero token categories
      const usage = {
        input: 1000,
        output: 500,
        cache: 0,
        tool: 0,
        thought: 0,
        total: 1500,
      };

      // When: Formatting for display
      const formatted = formatSessionTokenUsage(usage);

      // Then: Zero values are displayed without hiding categories
      expect(formatted).toContain('Cache: 0');
      expect(formatted).toContain('Tool: 0');
      expect(formatted).toContain('Thought: 0');
      expect(formatted).toContain('Total: 1,500');
    });
  });

  /**
   * Real-world UI Interaction Scenarios
   * Behavioral Test: Verify UI updates reflect actual token usage patterns
   */
  describe('Real-world Token Usage Scenarios', () => {
    it('should reflect typical chat conversation token progression', () => {
      // Given: A typical chat session setup
      const provider = new OpenAIProvider('test-key');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('openai');
      providerManager.resetSessionTokenUsage();

      // When: Simulating a realistic conversation pattern
      // First message (system prompt + user message)
      providerManager.accumulateSessionTokens('openai', {
        input: 500, // System prompt + first user message
        output: 150, // AI response
        cache: 0,
        tool: 0,
        thought: 0,
      });

      const afterFirstMessage = providerManager.getSessionTokenUsage();
      expect(afterFirstMessage.total).toBe(650);

      // Follow-up message (context + new message)
      providerManager.accumulateSessionTokens('openai', {
        input: 200, // Follow-up message
        output: 180, // AI response
        cache: 450, // Previous context cached
        tool: 0,
        thought: 0,
      });

      const afterFollowup = providerManager.getSessionTokenUsage();
      expect(afterFollowup.total).toBe(1480); // 650 + 200 + 180 + 450

      // Tool use scenario
      providerManager.accumulateSessionTokens('openai', {
        input: 100,
        output: 50,
        cache: 200,
        tool: 150, // Tool call tokens
        thought: 25,
      });

      const afterToolUse = providerManager.getSessionTokenUsage();

      // Then: UI can display progression accurately
      const formattedFinal = formatSessionTokenUsage(afterToolUse);
      expect(formattedFinal).toContain('Total: 2,005'); // 1480 + 525
    });

    it('should handle rapid token accumulation during streaming responses', () => {
      // Given: A streaming response scenario
      const provider = new OpenAIProvider('test-key');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('openai');
      providerManager.resetSessionTokenUsage();

      // When: Tokens accumulate rapidly during streaming
      const streamingChunks = [
        { input: 200, output: 10, cache: 0, tool: 0, thought: 0 }, // Initial chunk with prompt
        { input: 0, output: 25, cache: 0, tool: 0, thought: 0 }, // Streaming chunk 1
        { input: 0, output: 30, cache: 0, tool: 0, thought: 0 }, // Streaming chunk 2
        { input: 0, output: 28, cache: 0, tool: 0, thought: 0 }, // Streaming chunk 3
        { input: 0, output: 22, cache: 0, tool: 0, thought: 0 }, // Streaming chunk 4
        { input: 0, output: 15, cache: 0, tool: 0, thought: 0 }, // Final chunk
      ];

      const progressionSnapshots = [];

      for (const chunk of streamingChunks) {
        providerManager.accumulateSessionTokens('openai', chunk);
        const currentUsage = providerManager.getSessionTokenUsage();
        progressionSnapshots.push(currentUsage.total);
      }

      // Then: Token totals increase monotonically during streaming
      for (let i = 1; i < progressionSnapshots.length; i++) {
        expect(progressionSnapshots[i]).toBeGreaterThan(
          progressionSnapshots[i - 1],
        );
      }

      // And: Final total matches expected sum
      const finalUsage = providerManager.getSessionTokenUsage();
      expect(finalUsage.input).toBe(200);
      expect(finalUsage.output).toBe(130); // 10 + 25 + 30 + 28 + 22 + 15
      expect(finalUsage.total).toBe(330);
    });

    it('should accurately reflect multi-provider usage in UI display', () => {
      // Given: Multiple providers contributing to session
      const openaiProvider = new OpenAIProvider('test-openai-key');
      providerManager.registerProvider(openaiProvider);

      // When: Different providers contribute tokens
      providerManager.resetSessionTokenUsage();

      // OpenAI contributions
      providerManager.accumulateSessionTokens('openai', {
        input: 300,
        output: 200,
        cache: 50,
        tool: 75,
        thought: 0,
      });

      // Hypothetical Anthropic contributions
      providerManager.accumulateSessionTokens('anthropic', {
        input: 250,
        output: 180,
        cache: 0,
        tool: 25,
        thought: 45,
      });

      const combinedUsage = providerManager.getSessionTokenUsage();

      // Then: UI display reflects combined usage from all providers
      expect(combinedUsage.input).toBe(550);
      expect(combinedUsage.output).toBe(380);
      expect(combinedUsage.cache).toBe(50);
      expect(combinedUsage.tool).toBe(100);
      expect(combinedUsage.thought).toBe(45);
      expect(combinedUsage.total).toBe(1125);

      // And: Formatted display includes all contributions
      const formattedDisplay = formatSessionTokenUsage(combinedUsage);
      expect(formattedDisplay).toContain('Input: 550');
      expect(formattedDisplay).toContain('Output: 380');
      expect(formattedDisplay).toContain('Total: 1,125');
    });
  });

  /**
   * Token Display Performance and Responsiveness
   * Behavioral Test: Verify UI updates are responsive under load
   */
  describe('Token Display Performance', () => {
    it('should handle high-frequency token updates without UI lag', () => {
      // Given: A provider setup for rapid updates
      const provider = new OpenAIProvider('test-key');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('openai');
      providerManager.resetSessionTokenUsage();

      // When: Rapid token accumulation occurs (simulating fast streaming)
      const startTime = performance.now();

      for (let i = 0; i < 100; i++) {
        providerManager.accumulateSessionTokens('openai', {
          input: i === 0 ? 200 : 0, // Only first update has input tokens
          output: 5 + (i % 3), // Varying output tokens
          cache: 0,
          tool: 0,
          thought: 0,
        });

        // Simulate UI formatting calls (would happen during render)
        const currentUsage = providerManager.getSessionTokenUsage();
        formatSessionTokenUsage(currentUsage);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Then: Operations complete quickly (should be sub-millisecond per update)
      expect(duration).toBeLessThan(100); // 100ms for 100 updates + formatting

      // And: Final state is correct
      const finalUsage = providerManager.getSessionTokenUsage();
      expect(finalUsage.input).toBe(200);
      expect(finalUsage.output).toBeGreaterThan(500); // ~600 output tokens
      expect(finalUsage.total).toBeGreaterThan(700);
    });

    it('should maintain formatting consistency across large token values', () => {
      // Given: Very large token values
      const largeUsage = {
        input: 1234567,
        output: 987654,
        cache: 456789,
        tool: 123456,
        thought: 78901,
        total: 2881367,
      };

      // When: Formatting for display
      const formatted = formatSessionTokenUsage(largeUsage);

      // Then: Large numbers are properly formatted with commas
      expect(formatted).toContain('Input: 1,234,567');
      expect(formatted).toContain('Output: 987,654');
      expect(formatted).toContain('Cache: 456,789');
      expect(formatted).toContain('Tool: 123,456');
      expect(formatted).toContain('Thought: 78,901');
      expect(formatted).toContain('Total: 2,881,367');

      // And: Format remains readable
      expect(formatted.length).toBeLessThan(200); // Reasonable length for display
    });
  });

  /**
   * Token Tracking Edge Cases in UI
   * Behavioral Test: Verify UI handles edge cases gracefully
   */
  describe('UI Edge Case Handling', () => {
    it('should display zero state appropriately when no tokens have been used', () => {
      // Given: A fresh session with no token usage
      providerManager.resetSessionTokenUsage();
      const emptyUsage = providerManager.getSessionTokenUsage();

      // When: Formatting zero usage for display
      const formatted = formatSessionTokenUsage(emptyUsage);

      // Then: All fields show zero appropriately
      expect(formatted).toContain('Input: 0');
      expect(formatted).toContain('Output: 0');
      expect(formatted).toContain('Cache: 0');
      expect(formatted).toContain('Tool: 0');
      expect(formatted).toContain('Thought: 0');
      expect(formatted).toContain('Total: 0');
    });

    it('should handle TPM formatting edge cases', () => {
      // Test boundary conditions for TPM formatting
      const edgeCases = [
        { tpm: 0, expected: '0' },
        { tpm: 1, expected: '1' },
        { tpm: 999, expected: '999' },
        { tpm: 1000, expected: '1.0K' },
        { tpm: 999999, expected: '1000.0K' },
        { tpm: 1000000, expected: '1.0M' },
      ];

      edgeCases.forEach(({ tpm, expected }) => {
        const formatted = formatTokensPerMinute(tpm);
        expect(formatted).toBe(expected);
      });
    });

    it('should handle throttle time formatting edge cases', () => {
      // Test boundary conditions for throttle time formatting
      const edgeCases = [
        { ms: 0, expected: '0ms' },
        { ms: 1, expected: '1ms' },
        { ms: 999, expected: '999ms' },
        { ms: 1000, expected: '1.0s' },
        { ms: 59999, expected: '60.0s' },
        { ms: 60000, expected: '1.0m' },
      ];

      edgeCases.forEach(({ ms, expected }) => {
        const formatted = formatThrottleTime(ms);
        expect(formatted).toBe(expected);
      });
    });
  });
});
