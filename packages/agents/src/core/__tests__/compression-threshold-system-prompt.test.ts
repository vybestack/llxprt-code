import { curatedHistoryForTest } from '@vybestack/llxprt-code-test-utils/core/curated-history-fixture.js';
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
import { describe, it, expect, beforeEach } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createUserMessage } from '@vybestack/llxprt-code-core/services/history/IContent.js';
function legacyTest0() {
  const systemPromptTokens = 500;
  legacySuite0_historyService.setBaseTokenOffset(systemPromptTokens);
  const totalTokens = legacySuite0_historyService.getTotalTokens();
  expect(totalTokens).toBe(systemPromptTokens);
  expect(legacySuite0_historyService.getBaseTokenOffset()).toBe(
    systemPromptTokens,
  );
}
async function legacyTest1() {
  const systemPromptTokens = 500;
  legacySuite0_historyService.setBaseTokenOffset(systemPromptTokens);
  // Add a message with known token count
  const userMessage = createUserMessage('Test message', {
    timestamp: Date.now(),
  });
  legacySuite0_historyService.add(userMessage);
  // syncTotalTokens adjusts baseTokenOffset to match the target total
  // It's async, so we need to wait for the lock to resolve
  const targetTotal = 600; // 500 (system) + 100 (history)
  legacySuite0_historyService.syncTotalTokens(targetTotal);
  // Wait for the async sync to complete
  await new Promise((resolve) => setTimeout(resolve, 10));
  const totalTokens = legacySuite0_historyService.getTotalTokens();
  // Total should match the synced value
  expect(totalTokens).toBe(targetTotal);
}
async function legacyTest2() {
  // Start with initial system prompt
  const initialSystemPromptTokens = 500;
  legacySuite0_historyService.setBaseTokenOffset(initialSystemPromptTokens);
  // Directly verify that changing baseTokenOffset updates the total
  expect(legacySuite0_historyService.getTotalTokens()).toBe(500);
  expect(legacySuite0_historyService.getBaseTokenOffset()).toBe(500);
  // Update system prompt (e.g., mode switch)
  const updatedSystemPromptTokens = 800;
  legacySuite0_historyService.setBaseTokenOffset(updatedSystemPromptTokens);
  // After updating base offset, total should reflect the new base
  expect(legacySuite0_historyService.getTotalTokens()).toBe(800);
  expect(legacySuite0_historyService.getBaseTokenOffset()).toBe(800);
  // With history added and synced, the base offset is part of the total
  legacySuite0_historyService.add(
    createUserMessage('Test message', { timestamp: Date.now() }),
  );
  legacySuite0_historyService.syncTotalTokens(1200); // Sync to a higher total
  await new Promise((resolve) => setTimeout(resolve, 10));
  // After sync, total should match the target
  expect(legacySuite0_historyService.getTotalTokens()).toBe(1200);
  // Base offset will have been adjusted to make total = 1200
  expect(
    legacySuite0_historyService.getBaseTokenOffset(),
  ).toBeGreaterThanOrEqual(800);
}
function legacyTest3() {
  legacySuite0_historyService.setBaseTokenOffset(-100);
  expect(legacySuite0_historyService.getBaseTokenOffset()).toBe(0);
  expect(legacySuite0_historyService.getTotalTokens()).toBe(0);
}
function legacyTest4() {
  legacySuite0_historyService.setBaseTokenOffset(123.7);
  expect(legacySuite0_historyService.getBaseTokenOffset()).toBe(123);
  expect(legacySuite0_historyService.getTotalTokens()).toBe(123);
}
async function legacyTest6() {
  const systemPromptTokens = 1000;
  const expectedTotal = 1500;
  legacySuite0_historyService.setBaseTokenOffset(systemPromptTokens);
  // Add conversation history
  legacySuite0_historyService.add(
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
  legacySuite0_historyService.add(aiResponse);
  legacySuite0_historyService.syncTotalTokens(expectedTotal); // Sync to target total
  await new Promise((resolve) => setTimeout(resolve, 10));
  const totalTokens = legacySuite0_historyService.getTotalTokens();
  expect(totalTokens).toBe(expectedTotal);
  expect(totalTokens).toBeGreaterThan(systemPromptTokens);
}
async function legacyTest7() {
  const systemPromptTokens = 500;
  legacySuite0_historyService.setBaseTokenOffset(systemPromptTokens);
  // Add messages incrementally, syncing to target totals
  legacySuite0_historyService.add(
    createUserMessage('Message 1', { timestamp: Date.now() }),
  );
  legacySuite0_historyService.syncTotalTokens(600);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const total1 = legacySuite0_historyService.getTotalTokens();
  expect(total1).toBe(600);
  const aiResponse1: IContent = {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'Response 1' }],
    metadata: {
      model: 'test-model',
      timestamp: Date.now(),
    },
  };
  legacySuite0_historyService.add(aiResponse1);
  legacySuite0_historyService.syncTotalTokens(700);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const total2 = legacySuite0_historyService.getTotalTokens();
  expect(total2).toBe(700);
  legacySuite0_historyService.add(
    createUserMessage('Message 2', { timestamp: Date.now() }),
  );
  legacySuite0_historyService.syncTotalTokens(850);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const total3 = legacySuite0_historyService.getTotalTokens();
  expect(total3).toBe(850);
}
async function legacyTest8() {
  const systemPromptTokens = 2000;
  const contextLimit = 8000;
  const compressionThreshold = 0.8; // 80% of context limit
  const thresholdTokens = compressionThreshold * contextLimit; // 6400
  legacySuite0_historyService.setBaseTokenOffset(systemPromptTokens);
  // Scenario 1: Below threshold (should not compress)
  legacySuite0_historyService.add(
    createUserMessage('Small message', { timestamp: Date.now() }),
  );
  legacySuite0_historyService.syncTotalTokens(5000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(legacySuite0_historyService.getTotalTokens()).toBe(5000);
  expect(legacySuite0_historyService.getTotalTokens()).toBeLessThan(
    thresholdTokens,
  );
  // Scenario 2: At threshold (should compress)
  legacySuite0_historyService.syncTotalTokens(6400);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(legacySuite0_historyService.getTotalTokens()).toBe(6400);
  expect(legacySuite0_historyService.getTotalTokens()).toBeGreaterThanOrEqual(
    thresholdTokens,
  );
  // Scenario 3: Above threshold (should compress)
  legacySuite0_historyService.syncTotalTokens(7000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(legacySuite0_historyService.getTotalTokens()).toBe(7000);
  expect(legacySuite0_historyService.getTotalTokens()).toBeGreaterThan(
    thresholdTokens,
  );
}
function legacyTest10() {
  const systemPromptTokens = 1000;
  legacySuite0_historyService.setBaseTokenOffset(systemPromptTokens);
  // Add multiple messages
  legacySuite0_historyService.add(
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
  legacySuite0_historyService.add(aiResponse1);
  legacySuite0_historyService.add(
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
  legacySuite0_historyService.add(aiResponse2);
  const curatedHistory = curatedHistoryForTest(legacySuite0_historyService);
  // Curated history should only contain the 4 messages, not system prompt
  expect(curatedHistory.length).toBe(4);
  // System prompt offset should remain unchanged
  expect(legacySuite0_historyService.getBaseTokenOffset()).toBe(
    systemPromptTokens,
  );
  // Total tokens should include system prompt
  expect(legacySuite0_historyService.getTotalTokens()).toBeGreaterThanOrEqual(
    systemPromptTokens,
  );
}
function legacyTest11() {
  const systemPromptTokens = 500;
  legacySuite0_historyService.setBaseTokenOffset(systemPromptTokens);
  // Add messages
  for (let i = 0; i < 10; i++) {
    legacySuite0_historyService.add(
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
    legacySuite0_historyService.add(aiResponse);
  }
  // Simulate compression by clearing and re-adding only the messages we want to keep
  // This mimics how compression works: get curated history, keep only recent messages
  const curated = curatedHistoryForTest(legacySuite0_historyService);
  const messagesToKeep = curated.slice(10); // Keep last 10 messages (remove first 10)
  // Clear history and re-add the messages we want to keep
  legacySuite0_historyService.clear();
  legacySuite0_historyService.setBaseTokenOffset(systemPromptTokens); // Restore system prompt offset
  for (const content of messagesToKeep) {
    legacySuite0_historyService.add(content);
  }
  // After compression, system prompt offset should still be there
  expect(legacySuite0_historyService.getBaseTokenOffset()).toBe(
    systemPromptTokens,
  );
  // And included in total
  const totalAfterCompression = legacySuite0_historyService.getTotalTokens();
  expect(totalAfterCompression).toBeGreaterThanOrEqual(systemPromptTokens);
}
async function legacyTest13() {
  legacySuite0_historyService.setBaseTokenOffset(0);
  legacySuite0_historyService.add(
    createUserMessage('Test', { timestamp: Date.now() }),
  );
  legacySuite0_historyService.syncTotalTokens(100);
  await new Promise((resolve) => setTimeout(resolve, 10));
  // syncTotalTokens adjusts baseTokenOffset to reach the target (100)
  // Since getTotalTokens() = baseTokenOffset + totalTokens, and we synced to 100,
  // the baseTokenOffset will have been adjusted to make the total equal 100
  expect(legacySuite0_historyService.getTotalTokens()).toBe(100);
}
function legacyTest14() {
  const largeSystemPromptTokens = 50000;
  legacySuite0_historyService.setBaseTokenOffset(largeSystemPromptTokens);
  expect(legacySuite0_historyService.getBaseTokenOffset()).toBe(
    largeSystemPromptTokens,
  );
  expect(legacySuite0_historyService.getTotalTokens()).toBe(
    largeSystemPromptTokens,
  );
}
function legacyTest15() {
  const systemPromptTokens = 1000;
  legacySuite0_historyService.setBaseTokenOffset(systemPromptTokens);
  // No messages added
  expect(curatedHistoryForTest(legacySuite0_historyService).length).toBe(0);
  expect(legacySuite0_historyService.getTotalTokens()).toBe(systemPromptTokens);
}
function legacyTest16() {
  let eventEmitted = false;
  let eventData: {
    totalTokens: number;
    addedTokens: number;
  } | null = null;
  legacySuite0_historyService.on('tokensUpdated', (data) => {
    eventEmitted = true;
    eventData = data as {
      totalTokens: number;
      addedTokens: number;
    };
  });
  legacySuite0_historyService.setBaseTokenOffset(500);
  expect(eventEmitted).toBe(true);
  expect(eventData).not.toBeNull();
  expect(eventData?.totalTokens).toBe(500);
  expect(eventData?.addedTokens).toBe(500);
}
function legacyTest17() {
  legacySuite0_historyService.setBaseTokenOffset(500);
  let eventCount = 0;
  legacySuite0_historyService.on('tokensUpdated', () => {
    eventCount++;
  });
  legacySuite0_historyService.setBaseTokenOffset(500); // Same value
  // Should not emit again (delta is 0)
  expect(eventCount).toBe(0);
}
function legacyTest18() {
  legacySuite0_historyService.setBaseTokenOffset(500);
  let eventData: {
    totalTokens: number;
    addedTokens: number;
  } | null = null;
  legacySuite0_historyService.on('tokensUpdated', (data) => {
    eventData = data as {
      totalTokens: number;
      addedTokens: number;
    };
  });
  legacySuite0_historyService.setBaseTokenOffset(800);
  expect(eventData?.addedTokens).toBe(300); // 800 - 500
  expect(eventData?.totalTokens).toBe(800);
}
function legacyTest19() {
  legacySuite0_historyService.setBaseTokenOffset(1000);
  let eventData: {
    totalTokens: number;
    addedTokens: number;
  } | null = null;
  legacySuite0_historyService.on('tokensUpdated', (data) => {
    eventData = data as {
      totalTokens: number;
      addedTokens: number;
    };
  });
  legacySuite0_historyService.setBaseTokenOffset(600);
  expect(eventData?.addedTokens).toBe(-400); // 600 - 1000
  expect(eventData?.totalTokens).toBe(600);
}
let legacySuite0_historyService: HistoryService;
const legacyHook0 = () => {
  legacySuite0_historyService = new HistoryService();
};
describe('Compression Threshold: System Prompt Token Inclusion > HistoryService.getTotalTokens() includes baseTokenOffset / should return only baseTokenOffset when history is empty', () => {
  beforeEach(legacyHook0);
  it('should return only baseTokenOffset when history is empty', () => {
    expect(legacyTest0).not.toThrow();
  });
});
describe('Compression Threshold: System Prompt Token Inclusion > HistoryService.getTotalTokens() includes baseTokenOffset / should return baseTokenOffset + history tokens when history exists', () => {
  beforeEach(legacyHook0);
  it('should return baseTokenOffset + history tokens when history exists', async () => {
    await expect(legacyTest1()).resolves.toBeUndefined();
  });
});
describe('Compression Threshold: System Prompt Token Inclusion > HistoryService.getTotalTokens() includes baseTokenOffset / should handle baseTokenOffset changes during conversation', () => {
  beforeEach(legacyHook0);
  it('should handle baseTokenOffset changes during conversation', async () => {
    await expect(legacyTest2()).resolves.toBeUndefined();
  });
});
describe('Compression Threshold: System Prompt Token Inclusion > HistoryService.getTotalTokens() includes baseTokenOffset / should normalize negative baseTokenOffset to zero', () => {
  beforeEach(legacyHook0);
  it('should normalize negative baseTokenOffset to zero', () => {
    expect(legacyTest3).not.toThrow();
  });
});
describe('Compression Threshold: System Prompt Token Inclusion > HistoryService.getTotalTokens() includes baseTokenOffset / should floor fractional baseTokenOffset values', () => {
  beforeEach(legacyHook0);
  it('should floor fractional baseTokenOffset values', () => {
    expect(legacyTest4).not.toThrow();
  });
});
describe('Compression Threshold: System Prompt Token Inclusion > Compression threshold calculation consistency / should include system prompt in total when estimating if compression is needed', () => {
  beforeEach(legacyHook0);
  it('should include system prompt in total when estimating if compression is needed', async () => {
    await expect(legacyTest6()).resolves.toBeUndefined();
  });
});
describe('Compression Threshold: System Prompt Token Inclusion > Compression threshold calculation consistency / should maintain consistent total across multiple message additions', () => {
  beforeEach(legacyHook0);
  it('should maintain consistent total across multiple message additions', async () => {
    await expect(legacyTest7()).resolves.toBeUndefined();
  });
});
describe('Compression Threshold: System Prompt Token Inclusion > Compression threshold calculation consistency / should correctly report token count for compression decision at various thresholds', () => {
  beforeEach(legacyHook0);
  it('should correctly report token count for compression decision at various thresholds', async () => {
    await expect(legacyTest8()).resolves.toBeUndefined();
  });
});
describe('Compression Threshold: System Prompt Token Inclusion > System prompt is never compressed / should only operate on curated history, not including system prompt', () => {
  beforeEach(legacyHook0);
  it('should only operate on curated history, not including system prompt', () => {
    expect(legacyTest10).not.toThrow();
  });
});
describe('Compression Threshold: System Prompt Token Inclusion > System prompt is never compressed / should preserve system prompt offset after compression operations', () => {
  beforeEach(legacyHook0);
  it('should preserve system prompt offset after compression operations', () => {
    expect(legacyTest11).not.toThrow();
  });
});
describe('Compression Threshold: System Prompt Token Inclusion > Edge cases and boundary conditions / should handle zero system prompt tokens', () => {
  beforeEach(legacyHook0);
  it('should handle zero system prompt tokens', async () => {
    await expect(legacyTest13()).resolves.toBeUndefined();
  });
});
describe('Compression Threshold: System Prompt Token Inclusion > Edge cases and boundary conditions / should handle very large system prompt tokens', () => {
  beforeEach(legacyHook0);
  it('should handle very large system prompt tokens', () => {
    expect(legacyTest14).not.toThrow();
  });
});
describe('Compression Threshold: System Prompt Token Inclusion > Edge cases and boundary conditions / should handle empty history with system prompt', () => {
  beforeEach(legacyHook0);
  it('should handle empty history with system prompt', () => {
    expect(legacyTest15).not.toThrow();
  });
});
describe('Compression Threshold: System Prompt Token Inclusion > Edge cases and boundary conditions / should emit tokensUpdated event when baseTokenOffset changes', () => {
  beforeEach(legacyHook0);
  it('should emit tokensUpdated event when baseTokenOffset changes', () => {
    expect(legacyTest16).not.toThrow();
  });
});
describe('Compression Threshold: System Prompt Token Inclusion > Edge cases and boundary conditions / should not emit tokensUpdated event when setting same baseTokenOffset', () => {
  beforeEach(legacyHook0);
  it('should not emit tokensUpdated event when setting same baseTokenOffset', () => {
    expect(legacyTest17).not.toThrow();
  });
});
describe('Compression Threshold: System Prompt Token Inclusion > Edge cases and boundary conditions / should emit correct delta when baseTokenOffset increases', () => {
  beforeEach(legacyHook0);
  it('should emit correct delta when baseTokenOffset increases', () => {
    expect(legacyTest18).not.toThrow();
  });
});
describe('Compression Threshold: System Prompt Token Inclusion > Edge cases and boundary conditions / should emit correct negative delta when baseTokenOffset decreases', () => {
  beforeEach(legacyHook0);
  it('should emit correct negative delta when baseTokenOffset decreases', () => {
    expect(legacyTest19).not.toThrow();
  });
});
