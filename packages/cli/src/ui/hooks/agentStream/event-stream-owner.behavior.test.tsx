/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { act } from 'react';
import type { Agent, AgentEvent } from '@vybestack/llxprt-code-agents';
import { useCommandOwners } from '../../../__tests__/command-owner-fixture.js';
import { renderHook } from '../../../__tests__/render.js';
import { useAgentEventStream } from './useAgentEventStream.js';

function streamHook(owner: Agent, decoy: Agent, events: AgentEvent[]) {
  const stream: Agent['stream'] = (input, options) =>
    owner.stream(input, options);
  const setDisplayCallbacks: Agent['tools']['setDisplayCallbacks'] = (
    callbacks,
  ) => owner.tools.setDisplayCallbacks(callbacks);
  const setEditorCallbacks: Agent['tools']['setEditorCallbacks'] = (
    callbacks,
  ) => owner.tools.setEditorCallbacks(callbacks);
  return renderHook(() =>
    useAgentEventStream(
      Object.assign(
        { agent: decoy },
        {
          stream,
          setDisplayCallbacks,
          setEditorCallbacks,
          addItem: () => 0,
          processAgentEventRef: {
            current: (event: AgentEvent) => {
              events.push(event);
            },
          },
          flushPendingHistoryItem: () => {},
          clearPendingHistoryItem: () => {},
          performMemoryRefresh: async () => {},
        },
      ),
    ),
  );
}

describe('bound event stream owner', () => {
  const makeOwner = useCommandOwners();
  it('runs the bound session rather than a decoy and leaves a sibling usable after retirement', async () => {
    const owner = await makeOwner('stream-owner');
    const sibling = await makeOwner('stream-sibling');
    const events: AgentEvent[] = [];
    const first = streamHook(owner, sibling, events);
    try {
      await act(async () =>
        first.result.current.runStream(
          'bound owner turn',
          new AbortController().signal,
          'owner-turn',
        ),
      );
      expect(
        (await owner.getHistory())
          .flatMap((entry) => entry.blocks)
          .some(
            (block) =>
              block.type === 'text' && block.text.includes('bound owner turn'),
          ),
      ).toBe(true);
      expect(await sibling.getHistory()).toHaveLength(0);
      expect(events.some((event) => event.type === 'done')).toBe(true);
    } finally {
      first.unmount();
    }
    await owner.dispose();
    const second = streamHook(sibling, owner, []);
    try {
      await act(async () =>
        second.result.current.runStream(
          'surviving sibling turn',
          new AbortController().signal,
          'sibling-turn',
        ),
      );
      expect(
        (await sibling.getHistory())
          .flatMap((entry) => entry.blocks)
          .some(
            (block) =>
              block.type === 'text' &&
              block.text.includes('surviving sibling turn'),
          ),
      ).toBe(true);
    } finally {
      second.unmount();
    }
  });
});
