/*
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryService } from './HistoryService.js';
import type { IContent, ToolCallBlock } from './IContent.js';

describe('FindFiles Circular Reference Bug', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
  });

  it('getCuratedForProvider should handle FindFiles tool call with complex parameters', () => {
    // Simulate the exact flow from the logs

    // Step 1: User message
    historyService.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Find all test files' }],
    });

    // Step 2: AI calls FindFiles with a pattern
    const toolCallId = historyService.generateHistoryId(
      'turn-test',
      0,
      'anthropic',
      'call_find_test',
      'FindFiles',
    );

    // Create parameters that might have circular references
    // This simulates what happens when the assistant creates a FindFiles tool call
    const findFilesParams = {
      pattern: '**/*.test.ts',
      // Add nested objects that might create circular references
      options: {
        recursive: true,
        followSymlinks: false,
        // Some tools might add complex objects with circular refs
        cache: {} as Record<string, unknown>,
      },
    };

    // Create a circular reference in the cache
    findFilesParams.options.cache.parent = findFilesParams.options;

    historyService.add({
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'I will search for test files' },
        {
          type: 'tool_call',
          id: toolCallId,
          name: 'FindFiles',
          parameters: findFilesParams,
        } as ToolCallBlock,
      ],
    });

    // Step 3: getCurated is called BEFORE tool response
    // This happens during tool execution
    let curated: unknown[];
    let error: Error | null = null;

    try {
      curated = historyService.getCurated();
      // Try to stringify - getCurated() no longer adds synthetic responses
      // so circular refs in tool call params will cause an error
      JSON.stringify(curated);
    } catch (e) {
      error = e as Error;
    }

    // getCurated() doesn't handle circular refs anymore
    // The error WILL happen because of circular refs in tool call params
    expect(error).not.toBeNull();

    // Now test getCuratedForProvider which SHOULD handle this
    let curatedForProvider: IContent[];
    let errorForProvider: Error | null = null;

    try {
      curatedForProvider = historyService.getCuratedForProvider();
      // This should work even with circular refs
      JSON.stringify(curatedForProvider);
    } catch (e) {
      errorForProvider = e as Error;
    }

    // getCuratedForProvider should handle circular refs
    expect(errorForProvider).toBeNull();

    // Should NOT have synthetic response added in current implementation
    // getCuratedForProvider only cleans circular refs, doesn't add synthetic responses
    expect(
      curatedForProvider!.filter((c) => c.speaker === 'tool'),
    ).toHaveLength(0);

    // Step 4: Add the real tool response
    historyService.add({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: toolCallId,
          toolName: 'FindFiles',
          result: { files: ['test1.ts', 'test2.ts'] },
        },
      ],
    });

    // Step 5: getCurated after response
    const curated2 = historyService.getCurated();

    // getCurated still has circular refs in tool call params
    // It won't be directly serializable
    expect(() => JSON.stringify(curated2)).toThrow();

    // Should have the real response, not synthetic
    const toolResponses = curated2.filter((c) => c.speaker === 'tool');
    expect(toolResponses).toHaveLength(1);
    expect(toolResponses[0].metadata?.synthetic).toBeUndefined();
  });
});
