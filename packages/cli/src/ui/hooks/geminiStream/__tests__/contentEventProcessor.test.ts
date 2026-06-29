/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for processContentEvent's content-prefix identity threading
 * (issue #2263).
 *
 * The content-prefix identity (profileName:modelName) must be threaded from the
 * `getContentPrefixIdentity` dep into the gemini history item's `profileName`
 * field, which is display-only (consumed by GeminiMessage.tsx's [profileName]
 * prefix rendering).
 */

import { describe, it, expect, vi } from 'vitest';
import type React from 'react';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';
import type { HistoryItemWithoutId } from '../../../types.js';
import {
  processContentEvent,
  type ContentEventDeps,
} from '../contentEventProcessor.js';

function createDeps(
  getContentPrefixIdentity: () => string | null,
  overrides: Partial<ContentEventDeps> = {},
): ContentEventDeps {
  return {
    addItem: vi.fn(),
    sanitizeContent: (text: string) => ({ text, blocked: false }),
    flushPendingHistoryItem: vi.fn(),
    pendingHistoryItemRef: {
      current: null,
    } as React.MutableRefObject<HistoryItemWithoutId | null>,
    thinkingBlocksRef: {
      current: [],
    } as React.MutableRefObject<ThinkingBlock[]>,
    turnCancelledRef: { current: false },
    setPendingHistoryItem: vi.fn(),
    getContentPrefixIdentity,
    ...overrides,
  };
}

describe('processContentEvent content-prefix identity (issue #2263)', () => {
  it('threads profileName:modelName into the pending gemini item', () => {
    const setPendingHistoryItem = vi.fn();
    const deps = createDeps(() => 'work:gpt-4', { setPendingHistoryItem });

    processContentEvent('hello world', '', Date.now(), deps);

    // ensureGeminiPendingItem creates the new pending item via the first call
    // (object form). Later calls use the callback form for content updates.
    const firstCall = setPendingHistoryItem.mock.calls[0][0];
    expect(firstCall.profileName).toBe('work:gpt-4');

    // Verify profileName survives the callback-form content update path
    // (buildFullSplitItem), which produces the final rendered item.
    const callbackCalls = setPendingHistoryItem.mock.calls.filter(
      (call) => typeof call[0] === 'function',
    );
    expect(callbackCalls.length).toBeGreaterThan(0);
    const updatedItem = (callbackCalls[0][0] as (item: unknown) => unknown)(
      firstCall,
    );
    expect((updatedItem as { profileName?: string }).profileName).toBe(
      'work:gpt-4',
    );
  });

  it('omits profileName when getContentPrefixIdentity returns null', () => {
    const setPendingHistoryItem = vi.fn();
    const deps = createDeps(() => null, { setPendingHistoryItem });

    processContentEvent('hello world', '', Date.now(), deps);

    const firstCall = setPendingHistoryItem.mock.calls[0][0];
    expect(firstCall.profileName).toBeUndefined();
  });

  it('treats empty string as absent (the production resolver never returns empty)', () => {
    const setPendingHistoryItem = vi.fn();
    const deps = createDeps(() => '', { setPendingHistoryItem });

    processContentEvent('hello world', '', Date.now(), deps);

    const firstCall = setPendingHistoryItem.mock.calls[0][0];
    expect(firstCall.profileName).toBeUndefined();
  });
});
