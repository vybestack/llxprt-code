/**
 * Test that compression is atomic and blocks concurrent operations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeminiClient } from './client.js';
import { Config } from '../config/index.js';

describe('Atomic Compression', () => {
  let client: GeminiClient;
  let config: Config;

  beforeEach(() => {
    config = new Config();
    client = new GeminiClient(config);
  });

  it('should block concurrent compressions', async () => {
    // Mock tryCompressChat to track calls and add delay
    const compressionCalls: number[] = [];
    let compressionCount = 0;

    client.tryCompressChat = vi.fn(
      async (prompt_id: string, _force = false) => {
        const callNumber = ++compressionCount;
        compressionCalls.push(callNumber);

        // Simulate compression taking time
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Mark when this compression ends
        compressionCalls.push(-callNumber); // Negative to indicate end

        return null; // Return null for simplicity
      },
    );

    // Start two sendChat operations concurrently
    const promise1 = (async () => {
      const generator = client.sendChat([{ text: 'Message 1' }]);
      for await (const _event of generator) {
        // Just consume events
      }
    })();

    const promise2 = (async () => {
      // Start slightly after first one
      await new Promise((resolve) => setTimeout(resolve, 10));
      const generator = client.sendChat([{ text: 'Message 2' }]);
      for await (const _event of generator) {
        // Just consume events
      }
    })();

    // Wait for both to complete
    await Promise.all([promise1, promise2]);

    // Check that compressions were serialized, not concurrent
    // Should see: [1, -1, 2, -2] not [1, 2, -1, -2]
    expect(compressionCalls).toEqual([1, -1, 2, -2]);
    expect(client.tryCompressChat).toHaveBeenCalledTimes(2);
  });

  it('should skip compression when tool calls are pending', async () => {
    // Mock history service to have unmatched tool calls
    const mockHistoryService = {
      waitForPendingOperations: vi.fn(async () => {}),
      findUnmatchedToolCalls: vi.fn(() => [
        { id: 'tool_1', name: 'test_tool', parameters: {} },
      ]),
      startCompression: vi.fn(),
      endCompression: vi.fn(),
      getCurated: vi.fn(() => []),
      getTotalTokens: vi.fn(() => 1000),
      recalculateTokens: vi.fn(async () => {}),
    };

    const mockChat = client.getChat();
    mockChat.getHistoryService = vi.fn(() => mockHistoryService);

    const result = await client.tryCompressChat('test_prompt_id', false);

    // Should skip compression due to pending tool calls
    expect(result).toBeNull();
    expect(mockHistoryService.startCompression).not.toHaveBeenCalled();
  });
});
