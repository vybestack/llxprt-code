/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../../../../test-utils/render.js';
import { useSessionInitialization } from './useSessionInitialization.js';
import {
  EMOJI_BLOCKED_ERROR_TEXT,
  iContentToHistoryItems,
} from '../../../utils/iContentToHistoryItems.js';
import type { IContent } from '@vybestack/llxprt-code-core';

// Behavioral coverage for the startup seeding path (#2888): unlike
// useSessionInitialization.test.ts, the converter is NOT mocked, so these
// tests prove the seeded UI text actually renders filtered exactly as it
// would have live.

const makeConfig = (emojiMode: string | undefined) =>
  ({
    hooks: {},
    memory: {
      getLlxprtMdFileCount: vi.fn().mockReturnValue(0),
      getCoreMemoryFileCount: vi.fn().mockReturnValue(0),
    },
    agentClientSource: {
      getAgentClient: vi.fn().mockReturnValue(null),
    },
    ephemeral: {
      getEphemeralSetting: vi.fn().mockReturnValue(emojiMode),
    },
  }) as never;

const makeAgent = () =>
  ({ hooks: { triggerSessionStart: vi.fn().mockResolvedValue({}) } }) as never;

// Emojis are written as escapes (U+2705 check mark, U+1F44D thumbs up) so
// the source stays ASCII-stable.
const RESUMED_HISTORY: IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'nice \u{1F44D}' }] },
  { speaker: 'ai', blocks: [{ type: 'text', text: 'Done \u2705' }] },
];

async function seedWith(
  emojiMode: string | undefined,
  resumedHistory: IContent[] = RESUMED_HISTORY,
) {
  const loadHistory = vi.fn();
  renderHook(() =>
    useSessionInitialization({
      uiRuntime: makeConfig(emojiMode),
      agent: makeAgent(),
      addItem: vi.fn(),
      loadHistory,
      resumedHistory,
    }),
  );
  await act(async () => {
    await Promise.resolve();
  });
  return loadHistory;
}

describe('useSessionInitialization emoji filtering (#2888)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('seeds filtered model text and verbatim user text by default', async () => {
    const loadHistory = await seedWith(undefined);

    expect(loadHistory).toHaveBeenCalledTimes(1);
    expect(loadHistory).toHaveBeenCalledWith([
      { id: -1, type: 'user', text: 'nice \u{1F44D}' },
      { id: -2, type: 'gemini', text: 'Done [OK]' },
    ]);
  });

  it('seeds verbatim text when the setting allows emojis', async () => {
    const loadHistory = await seedWith('allowed');

    expect(loadHistory).toHaveBeenCalledWith([
      { id: -1, type: 'user', text: 'nice \u{1F44D}' },
      { id: -2, type: 'gemini', text: 'Done \u2705' },
    ]);
  });

  it('seeds the live error item for blocked model text in error mode', async () => {
    const loadHistory = await seedWith('error');

    // The blocked turn replays as the same error item the live path renders;
    // user text stays verbatim.
    expect(loadHistory).toHaveBeenCalledWith([
      { id: -1, type: 'user', text: 'nice \u{1F44D}' },
      { id: -2, type: 'error', text: EMOJI_BLOCKED_ERROR_TEXT },
    ]);
  });

  it('matches direct conversion output for the same mode', async () => {
    const loadHistory = await seedWith('warn');

    // Warn mode appends the feedback info item after the filtered turn,
    // exactly as the live path would have shown it.
    expect(loadHistory).toHaveBeenCalledWith(
      iContentToHistoryItems(RESUMED_HISTORY, 'warn'),
    );
  });

  it('seeds thinking blocks with blanked thoughts in error mode', async () => {
    // Thought-only emoji does not block the turn (blocking is decided by
    // main text, mirroring the live pipeline): the gemini item is kept and
    // the thought renders blanked.
    const withThinking: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'hmm \u2705' },
          { type: 'text', text: 'Answer' },
        ],
      },
    ];
    const loadHistory = await seedWith('error', withThinking);

    expect(loadHistory).toHaveBeenCalledWith([
      { id: -1, type: 'user', text: 'hi' },
      {
        id: -2,
        type: 'gemini',
        text: 'Answer',
        thinkingBlocks: [{ type: 'thinking', thought: '' }],
      },
    ]);
  });
});
