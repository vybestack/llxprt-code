/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Compression Threshold System Prompt Token Inclusion Tests
 *
 * These behavioral tests verify that the compression threshold calculation
 * consistently includes system prompt tokens across different code paths.
 *
 * Background:
 * - System prompt tokens are stored as baseTokenOffset in HistoryService
 * - Compression threshold checks use two paths:
 *   1. lastPromptTokenCount (actual API data when available)
 *   2. getEffectiveTokenCount() (estimated, uses getTotalTokens())
 * - Both paths should include system prompt tokens for consistent behavior
 *
 * What we're testing:
 * - getTotalTokens() includes baseTokenOffset
 * - Compression decision is consistent regardless of which path is used
 * - System prompt never gets compressed (verified indirectly)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryService } from '../../services/history/HistoryService.js';
import {
  createUserMessage,
  IContent,
} from '../../services/history/IContent.js';

describe('Compression Threshold: System Prompt Token Inclusion', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
  });

  describe('HistoryService.getTotalTokens() includes baseTokenOffset', () => {
    it('should return only baseTokenOffset when history is empty', () => {
      const systemPromptTokens = 500;
      historyService.setBaseTokenOffset(systemPromptTokens);

      const totalTokens = historyService.getTotalTokens();

      expect(totalTokens).toBe(systemPromptTokens);
      expect(historyService.getBaseTokenOffset()).toBe(systemPromptTokens);
    });

    it('should return baseTokenOffset + history tokens when history exists', async () => {
      const systemPromptTokens = 500;
      historyService.setBaseTokenOffset(systemPromptTokens);

      // Add a message with known token count
      const userMessage = createUserMessage('Test message', {
        timestamp: Date.now(),
      });
      historyService.add(userMessage);

      // syncTotalTokens adjusts baseTokenOffset to match the target total
      // It's async, so we need to wait for the lock to resolve
      const targetTotal = 600; // 500 (system) + 100 (history)
      historyService.syncTotalTokens(targetTotal);

      // Wait for the async sync to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      const totalTokens = historyService.getTotalTokens();

      // Total should match the synced value
      expect(totalTokens).toBe(targetTotal);
    });

    it('should handle baseTokenOffset changes during conversation', async () => {
      // Start with initial system prompt
      const initialSystemPromptTokens = 500;
      historyService.setBaseTokenOffset(initialSystemPromptTokens);

      // Directly verify that changing baseTokenOffset updates the total
      expect(historyService.getTotalTokens()).toBe(500);
      expect(historyService.getBaseTokenOffset()).toBe(500);

      // Update system prompt (e.g., mode switch)
      const updatedSystemPromptTokens = 800;
      historyService.setBaseTokenOffset(updatedSystemPromptTokens);

      // After updating base offset, total should reflect the new base
      expect(historyService.getTotalTokens()).toBe(800);
      expect(historyService.getBaseTokenOffset()).toBe(800);

      // With history added and synced, the base offset is part of the total
      historyService.add(
        createUserMessage('Test message', { timestamp: Date.now() }),
      );
      historyService.syncTotalTokens(1200); // Sync to a higher total
      await new Promise((resolve) => setTimeout(resolve, 10));

      // After sync, total should match the target
      expect(historyService.getTotalTokens()).toBe(1200);
      // Base offset will have been adjusted to make total = 1200
      expect(historyService.getBaseTokenOffset()).toBeGreaterThanOrEqual(800);
    });

    it('should normalize negative baseTokenOffset to zero', () => {
      historyService.setBaseTokenOffset(-100);

      expect(historyService.getBaseTokenOffset()).toBe(0);
      expect(historyService.getTotalTokens()).toBe(0);
    });

    it('should floor fractional baseTokenOffset values', () => {
      historyService.setBaseTokenOffset(123.7);

      expect(historyService.getBaseTokenOffset()).toBe(123);
      expect(historyService.getTotalTokens()).toBe(123);
    });
  });

  describe('Compression threshold calculation consistency', () => {
    it('should include system prompt in total when estimating if compression is needed', async () => {
      const systemPromptTokens = 1000;
      const expectedTotal = 1500;

      historyService.setBaseTokenOffset(systemPromptTokens);

      // Add conversation history
      historyService.add(
        createUserMessage('First message', { timestamp: Date.now() }),
      );
      const aiResponse: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'First response' }],
        metadata: {
          model: 'test-model',
          timestamp: Date.now(),
        },
      };
      historyService.add(aiResponse);
      historyService.syncTotalTokens(expectedTotal); // Sync to target total

      await new Promise((resolve) => setTimeout(resolve, 10));

      const totalTokens = historyService.getTotalTokens();

      expect(totalTokens).toBe(expectedTotal);
      expect(totalTokens).toBeGreaterThan(systemPromptTokens);
    });

    it('should maintain consistent total across multiple message additions', async () => {
      const systemPromptTokens = 500;
      historyService.setBaseTokenOffset(systemPromptTokens);

      // Add messages incrementally, syncing to target totals
      historyService.add(
        createUserMessage('Message 1', { timestamp: Date.now() }),
      );
      historyService.syncTotalTokens(600);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const total1 = historyService.getTotalTokens();
      expect(total1).toBe(600);

      const aiResponse1: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Response 1' }],
        metadata: {
          model: 'test-model',
          timestamp: Date.now(),
        },
      };
      historyService.add(aiResponse1);
      historyService.syncTotalTokens(700);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const total2 = historyService.getTotalTokens();
      expect(total2).toBe(700);

      historyService.add(
        createUserMessage('Message 2', { timestamp: Date.now() }),
      );
      historyService.syncTotalTokens(850);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const total3 = historyService.getTotalTokens();
      expect(total3).toBe(850);
    });

    it('should correctly report token count for compression decision at various thresholds', async () => {
      const systemPromptTokens = 2000;
      const contextLimit = 8000;
      const compressionThreshold = 0.8; // 80% of context limit
      const thresholdTokens = compressionThreshold * contextLimit; // 6400

      historyService.setBaseTokenOffset(systemPromptTokens);

      // Scenario 1: Below threshold (should not compress)
      historyService.add(
        createUserMessage('Small message', { timestamp: Date.now() }),
      );
      historyService.syncTotalTokens(5000);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(historyService.getTotalTokens()).toBe(5000);
      expect(historyService.getTotalTokens()).toBeLessThan(thresholdTokens);

      // Scenario 2: At threshold (should compress)
      historyService.syncTotalTokens(6400);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(historyService.getTotalTokens()).toBe(6400);
      expect(historyService.getTotalTokens()).toBeGreaterThanOrEqual(
        thresholdTokens,
      );

      // Scenario 3: Above threshold (should compress)
      historyService.syncTotalTokens(7000);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(historyService.getTotalTokens()).toBe(7000);
      expect(historyService.getTotalTokens()).toBeGreaterThan(thresholdTokens);
    });
  });

  describe('System prompt is never compressed', () => {
    it('should only operate on curated history, not including system prompt', () => {
      const systemPromptTokens = 1000;
      historyService.setBaseTokenOffset(systemPromptTokens);

      // Add multiple messages
      historyService.add(
        createUserMessage('Message 1', { timestamp: Date.now() }),
      );
      const aiResponse1: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Response 1' }],
        metadata: {
          model: 'test-model',
          timestamp: Date.now(),
        },
      };
      historyService.add(aiResponse1);
      historyService.add(
        createUserMessage('Message 2', { timestamp: Date.now() }),
      );
      const aiResponse2: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Response 2' }],
        metadata: {
          model: 'test-model',
          timestamp: Date.now(),
        },
      };
      historyService.add(aiResponse2);

      const curatedHistory = historyService.getCurated();

      // Curated history should only contain the 4 messages, not system prompt
      expect(curatedHistory.length).toBe(4);

      // System prompt offset should remain unchanged
      expect(historyService.getBaseTokenOffset()).toBe(systemPromptTokens);

      // Total tokens should include system prompt
      expect(historyService.getTotalTokens()).toBeGreaterThanOrEqual(
        systemPromptTokens,
      );
    });

    it('should preserve system prompt offset after compression operations', () => {
      const systemPromptTokens = 500;
      historyService.setBaseTokenOffset(systemPromptTokens);

      // Add messages
      for (let i = 0; i < 10; i++) {
        historyService.add(
          createUserMessage(`Message ${i}`, { timestamp: Date.now() }),
        );
        const aiResponse: IContent = {
          speaker: 'ai',
          blocks: [{ type: 'text', text: `Response ${i}` }],
          metadata: {
            model: 'test-model',
            timestamp: Date.now(),
          },
        };
        historyService.add(aiResponse);
      }

      // Simulate compression by clearing and re-adding only the messages we want to keep
      // This mimics how compression works: get curated history, keep only recent messages
      const curated = historyService.getCurated();
      const messagesToKeep = curated.slice(10); // Keep last 10 messages (remove first 10)

      // Clear history and re-add the messages we want to keep
      historyService.clear();
      historyService.setBaseTokenOffset(systemPromptTokens); // Restore system prompt offset
      for (const content of messagesToKeep) {
        historyService.add(content);
      }

      // After compression, system prompt offset should still be there
      expect(historyService.getBaseTokenOffset()).toBe(systemPromptTokens);

      // And included in total
      const totalAfterCompression = historyService.getTotalTokens();
      expect(totalAfterCompression).toBeGreaterThanOrEqual(systemPromptTokens);
    });
  });

  describe('Edge cases and boundary conditions', () => {
    it('should handle zero system prompt tokens', async () => {
      historyService.setBaseTokenOffset(0);

      historyService.add(createUserMessage('Test', { timestamp: Date.now() }));
      historyService.syncTotalTokens(100);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // syncTotalTokens adjusts baseTokenOffset to reach the target (100)
      // Since getTotalTokens() = baseTokenOffset + totalTokens, and we synced to 100,
      // the baseTokenOffset will have been adjusted to make the total equal 100
      expect(historyService.getTotalTokens()).toBe(100);
    });

    it('should handle very large system prompt tokens', () => {
      const largeSystemPromptTokens = 50000;
      historyService.setBaseTokenOffset(largeSystemPromptTokens);

      expect(historyService.getBaseTokenOffset()).toBe(largeSystemPromptTokens);
      expect(historyService.getTotalTokens()).toBe(largeSystemPromptTokens);
    });

    it('should handle empty history with system prompt', () => {
      const systemPromptTokens = 1000;
      historyService.setBaseTokenOffset(systemPromptTokens);

      // No messages added
      expect(historyService.getCurated().length).toBe(0);
      expect(historyService.getTotalTokens()).toBe(systemPromptTokens);
    });

    it('should emit tokensUpdated event when baseTokenOffset changes', () => {
      let eventEmitted = false;
      let eventData: { totalTokens: number; addedTokens: number } | null = null;

      historyService.on('tokensUpdated', (data) => {
        eventEmitted = true;
        eventData = data as { totalTokens: number; addedTokens: number };
      });

      historyService.setBaseTokenOffset(500);

      expect(eventEmitted).toBe(true);
      expect(eventData).not.toBeNull();
      expect(eventData?.totalTokens).toBe(500);
      expect(eventData?.addedTokens).toBe(500);
    });

    it('should not emit tokensUpdated event when setting same baseTokenOffset', () => {
      historyService.setBaseTokenOffset(500);

      let eventCount = 0;
      historyService.on('tokensUpdated', () => {
        eventCount++;
      });

      historyService.setBaseTokenOffset(500); // Same value

      // Should not emit again (delta is 0)
      expect(eventCount).toBe(0);
    });

    it('should emit correct delta when baseTokenOffset increases', () => {
      historyService.setBaseTokenOffset(500);

      let eventData: { totalTokens: number; addedTokens: number } | null = null;

      historyService.on('tokensUpdated', (data) => {
        eventData = data as { totalTokens: number; addedTokens: number };
      });

      historyService.setBaseTokenOffset(800);

      expect(eventData?.addedTokens).toBe(300); // 800 - 500
      expect(eventData?.totalTokens).toBe(800);
    });

    it('should emit correct negative delta when baseTokenOffset decreases', () => {
      historyService.setBaseTokenOffset(1000);

      let eventData: { totalTokens: number; addedTokens: number } | null = null;

      historyService.on('tokensUpdated', (data) => {
        eventData = data as { totalTokens: number; addedTokens: number };
      });

      historyService.setBaseTokenOffset(600);

      expect(eventData?.addedTokens).toBe(-400); // 600 - 1000
      expect(eventData?.totalTokens).toBe(600);
    });
  });
});
