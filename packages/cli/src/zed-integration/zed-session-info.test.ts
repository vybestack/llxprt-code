/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for session-info derivation (issue #1611):
 * - The title is a truncated preview of the first user prompt, derived
 *   consistently with SessionDiscovery.readFirstUserMessage (which feeds the
 *   durable session listing). No LLM call.
 * - The ACP session_info_update notification carries title and/or updatedAt
 *   using the SDK's discriminated-union variant directly (no casts).
 * - Title eligibility is consumed synchronously (race-safe for overlapping
 *   prompts), even when the first prompt has no text (finding 1).
 * - Restored sessions hydrate title from history so later prompts never retitle
 *   them (finding 2).
 * - Live title normalization matches durable SessionDiscovery behavior
 *   (finding 5): no trimming, no newline collapsing.
 */

import { describe, it, expect } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';
import {
  SESSION_TITLE_MAX_LENGTH,
  type IContent,
} from '@vybestack/llxprt-code-core';
import {
  deriveSessionTitle,
  deriveTitleFromHistory,
  buildSessionInfoUpdate,
  SessionTitleTracker,
} from './zed-session-info.js';

describe('deriveSessionTitle (issue #1611: first-prompt title)', () => {
  it('extracts text from a single text block', () => {
    const title = deriveSessionTitle([
      { type: 'text', text: 'Investigate session lifecycle' },
    ]);
    expect(title).toBe('Investigate session lifecycle');
  });

  it('concatenates text across multiple text blocks', () => {
    const title = deriveSessionTitle([
      { type: 'text', text: 'Fix the ' },
      { type: 'text', text: 'bug in parser' },
    ]);
    expect(title).toBe('Fix the bug in parser');
  });

  it('truncates a long prompt to the bounded length used by the listing', () => {
    const long = 'x'.repeat(500);
    const title = deriveSessionTitle([{ type: 'text', text: long }]);
    expect(title).toHaveLength(SESSION_TITLE_MAX_LENGTH);
    expect(title).toBe(long.slice(0, SESSION_TITLE_MAX_LENGTH));
  });

  it('ignores non-text blocks (images, resource links) and still titles from text', () => {
    const title = deriveSessionTitle([
      { type: 'resource_link', uri: 'file:///p', name: 'p.ts' },
      { type: 'text', text: 'Review this file' },
    ]);
    expect(title).toBe('Review this file');
  });

  it('returns null when the prompt has no text content (only media/resources)', () => {
    const title = deriveSessionTitle([
      { type: 'image', data: 'base64', mimeType: 'image/png' },
      { type: 'resource_link', uri: 'file:///p', name: 'p.ts' },
    ]);
    expect(title).toBeNull();
  });

  it('returns null for an empty prompt', () => {
    expect(deriveSessionTitle([])).toBeNull();
  });

  it('preserves whitespace-only text without trimming to null', () => {
    const title = deriveSessionTitle([{ type: 'text', text: '   ' }]);
    expect(title).toBe('   ');
  });

  // Finding #5: live normalization must match durable SessionDiscovery behavior
  // (extractUserMessageText: join with '', NO trim, NO newline collapse).
  it('does NOT trim leading/trailing whitespace, matching durable behavior (finding 5)', () => {
    const title = deriveSessionTitle([
      { type: 'text', text: '  hello world  ' },
    ]);
    // Durable extractUserMessageText does NOT trim — live must match.
    expect(title).toBe('  hello world  ');
  });

  it('does NOT collapse newlines, matching durable behavior (finding 5)', () => {
    const title = deriveSessionTitle([
      { type: 'text', text: 'line one\nline two\nline three' },
    ]);
    // Durable extractUserMessageText does NOT replace newlines — live must
    // match so the durable listing title and the live title are identical.
    expect(title).toBe('line one\nline two\nline three');
  });

  it('does NOT collapse tabs or other whitespace, matching durable behavior (finding 5)', () => {
    const title = deriveSessionTitle([{ type: 'text', text: 'col1\tcol2' }]);
    expect(title).toBe('col1\tcol2');
  });
});

describe('deriveTitleFromHistory (issue #1611: restored-session title hydration)', () => {
  function humanContent(text: string): IContent {
    return {
      speaker: 'human',
      blocks: [{ type: 'text', text }],
    };
  }

  it('extracts the first human-speaker text from history', () => {
    const history: IContent[] = [
      humanContent('First user message'),
      { speaker: 'ai', blocks: [{ type: 'text', text: 'response' }] },
    ];
    expect(deriveTitleFromHistory(history)).toBe('First user message');
  });

  it('skips ai/tool entries and uses the first human text', () => {
    const history: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'welcome' }] },
      { speaker: 'tool', blocks: [{ type: 'text', text: 'result' }] },
      humanContent('Actual first user message'),
    ];
    expect(deriveTitleFromHistory(history)).toBe('Actual first user message');
  });

  it('returns null when history has no human text', () => {
    const history: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'response' }] },
    ];
    expect(deriveTitleFromHistory(history)).toBeNull();
  });

  it('skips human entries with no text blocks', () => {
    const history: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            data: 'base64',
            mimeType: 'image/png',
            encoding: 'base64',
          },
        ],
      },
      humanContent('Second human has text'),
    ];
    expect(deriveTitleFromHistory(history)).toBe('Second human has text');
  });

  it('skips human entries with an empty blocks array', () => {
    const history: IContent[] = [
      { speaker: 'human', blocks: [] },
      humanContent('Next human has text'),
    ];
    expect(deriveTitleFromHistory(history)).toBe('Next human has text');
  });

  it('returns null for empty history', () => {
    expect(deriveTitleFromHistory([])).toBeNull();
  });

  it('truncates long history text to the bounded length', () => {
    const long = 'y'.repeat(500);
    const history: IContent[] = [humanContent(long)];
    expect(deriveTitleFromHistory(history)).toBe(
      long.slice(0, SESSION_TITLE_MAX_LENGTH),
    );
  });

  it('does NOT trim or collapse newlines, matching durable behavior (finding 5)', () => {
    const history: IContent[] = [humanContent('  line one\nline two  ')];
    expect(deriveTitleFromHistory(history)).toBe('  line one\nline two  ');
  });
});

describe('buildSessionInfoUpdate (issue #1611: ACP session_info_update)', () => {
  it('builds a title-only update using the SDK discriminated-union variant', () => {
    const update = buildSessionInfoUpdate({ title: 'My session' });
    expect(update).toStrictEqual<acp.SessionUpdate>({
      sessionUpdate: 'session_info_update',
      title: 'My session',
    });
  });

  it('builds an updatedAt-only update', () => {
    const update = buildSessionInfoUpdate({
      updatedAt: '2026-07-12T00:00:00Z',
    });
    expect(update).toStrictEqual<acp.SessionUpdate>({
      sessionUpdate: 'session_info_update',
      updatedAt: '2026-07-12T00:00:00Z',
    });
  });

  it('builds a combined title + updatedAt update', () => {
    const update = buildSessionInfoUpdate({
      title: 'My session',
      updatedAt: '2026-07-12T00:00:00Z',
    });
    expect(update).toStrictEqual<acp.SessionUpdate>({
      sessionUpdate: 'session_info_update',
      title: 'My session',
      updatedAt: '2026-07-12T00:00:00Z',
    });
  });
});

describe('SessionTitleTracker.consumeTitleEligibility (issue #1611 finding 1: synchronous, race-safe)', () => {
  it('wins the title on the first text-bearing prompt', () => {
    const tracker = new SessionTitleTracker();
    const result = tracker.consumeTitleEligibility([
      { type: 'text', text: 'First prompt here' },
    ]);
    expect(result.wonTitle).toBe(true);
    expect(result.title).toBe('First prompt here');
  });

  it('consumes eligibility even when the first prompt has no text (no retitle later)', () => {
    const tracker = new SessionTitleTracker();
    const first = tracker.consumeTitleEligibility([
      { type: 'image', data: 'base64', mimeType: 'image/png' },
    ]);
    expect(first.wonTitle).toBe(false);
    expect(first.title).toBeUndefined();

    // A LATER text-bearing prompt must NOT win — eligibility was consumed.
    const second = tracker.consumeTitleEligibility([
      { type: 'text', text: 'Now with text' },
    ]);
    expect(second.wonTitle).toBe(false);
    expect(second.title).toBeUndefined();
  });

  it('does NOT win on the second prompt (title set once, eligibility consumed once)', () => {
    const tracker = new SessionTitleTracker();
    tracker.consumeTitleEligibility([
      { type: 'text', text: 'First prompt here' },
    ]);
    const result = tracker.consumeTitleEligibility([
      { type: 'text', text: 'Second prompt here' },
    ]);
    expect(result.wonTitle).toBe(false);
    expect(result.title).toBe('First prompt here');
  });

  it('is race-safe: only the first synchronous call wins, regardless of turn completion order', () => {
    // Simulate overlapping prompts: both call consumeTitleEligibility before
    // either turn completes. Only the first wins.
    const tracker = new SessionTitleTracker();
    const promptA = tracker.consumeTitleEligibility([
      { type: 'text', text: 'Prompt A' },
    ]);
    const promptB = tracker.consumeTitleEligibility([
      { type: 'text', text: 'Prompt B' },
    ]);
    expect(promptA.wonTitle).toBe(true);
    expect(promptA.title).toBe('Prompt A');
    expect(promptB.wonTitle).toBe(false);
    expect(promptB.title).toBe('Prompt A');
  });
});

describe('SessionTitleTracker.hydrateFromHistory (issue #1611 finding 2: restored sessions)', () => {
  it('sets the title from the first human text in restored history', () => {
    const tracker = new SessionTitleTracker();
    const title = tracker.hydrateFromHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Restored session title' }],
      },
    ]);
    expect(title).toBe('Restored session title');
    expect(tracker.getTitle()).toBe('Restored session title');
  });

  it('consumes title eligibility so a later live prompt never retitles', () => {
    const tracker = new SessionTitleTracker();
    tracker.hydrateFromHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Restored title' }],
      },
    ]);
    const result = tracker.consumeTitleEligibility([
      { type: 'text', text: 'New prompt after restore' },
    ]);
    expect(result.wonTitle).toBe(false);
    expect(result.title).toBe('Restored title');
  });

  it('is idempotent: a second hydrate is a no-op', () => {
    const tracker = new SessionTitleTracker();
    tracker.hydrateFromHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'First title' }],
      },
    ]);
    const title = tracker.hydrateFromHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Second title' }],
      },
    ]);
    expect(title).toBe('First title');
  });

  it('consumes title eligibility when restored history has no human text', () => {
    const tracker = new SessionTitleTracker();
    const title = tracker.hydrateFromHistory([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'response' }] },
    ]);
    expect(title).toBeUndefined();
    const result = tracker.consumeTitleEligibility([
      { type: 'text', text: 'First live prompt' },
    ]);
    expect(result.wonTitle).toBe(false);
    expect(result.title).toBeUndefined();
  });
});

describe('SessionTitleTracker.recordTurn (issue #1611: updatedAt-per-turn)', () => {
  it('returns an updatedAt update', () => {
    const tracker = new SessionTitleTracker();
    const result = tracker.recordTurn('2026-07-12T00:00:00Z');
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).toStrictEqual<acp.SessionUpdate>({
      sessionUpdate: 'session_info_update',
      updatedAt: '2026-07-12T00:00:00Z',
    });
  });

  it('advances updatedAt on each turn', () => {
    const tracker = new SessionTitleTracker();
    tracker.recordTurn('2026-07-12T00:00:00Z');
    const result = tracker.recordTurn('2026-07-12T00:01:00Z');
    expect(result.updates[0]).toStrictEqual<acp.SessionUpdate>({
      sessionUpdate: 'session_info_update',
      updatedAt: '2026-07-12T00:01:00Z',
    });
    expect(tracker.getUpdatedAt()).toBe('2026-07-12T00:01:00Z');
  });

  it('does not carry a title field (title is handled by consumeTitleEligibility)', () => {
    const tracker = new SessionTitleTracker();
    tracker.consumeTitleEligibility([{ type: 'text', text: 'First' }]);
    const result = tracker.recordTurn('2026-07-12T00:00:00Z');
    expect(result.updates[0]).not.toHaveProperty('title');
  });
});
