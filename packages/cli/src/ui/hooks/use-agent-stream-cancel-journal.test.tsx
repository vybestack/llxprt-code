/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { act } from 'react';
import type { IContent } from '@vybestack/llxprt-code-core';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { withJournalStreamHook } from './agentStream/__tests__/journal-stream-hook-fixture.js';
import { gate } from './agentStream/__tests__/journal-provider-test-helpers.js';
import { StreamingState } from '../types.js';

describe('journal-backed user cancellation', () => {
  it('preserves content received before cancellation and ignores subsequent provider content', async () => {
    const firstRead = gate();
    const release = gate();
    const provider = spyOn(
      FakeProvider.prototype,
      'generateChatCompletion',
    ).mockImplementation(async function* (): AsyncIterableIterator<IContent> {
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'Initial' }] };
      firstRead.release();
      await release.promise;
      yield { speaker: 'ai', blocks: [{ type: 'text', text: ' Canceled' }] };
    });
    try {
      await withJournalStreamHook([[]], async ({ state, items }) => {
        let submission = Promise.resolve();
        act(() => {
          submission = state().submitQuery('long running query');
        });
        await firstRead.promise;
        act(() => {
          state().cancelOngoingRequest();
        });
        await act(async () => {
          release.release();
          await submission;
        });
        const responses = (await items())
          .filter((item) => item.type === 'gemini')
          .map((item) => item.text);
        expect(responses[0]).toBe('Initial');
        expect(responses.join('')).not.toContain('Canceled');
        expect(state().streamingState).toBe(StreamingState.Idle);
      });
    } finally {
      release.release();
      provider.mockRestore();
    }
  });
});
