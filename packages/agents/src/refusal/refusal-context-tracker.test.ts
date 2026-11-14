/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RefusalContextTracker } from './refusalContextTracker.js';

function entry(seq: number, text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: {
      chronology: { seq, userTurn: seq, step: 1, recordedAt: seq * 1000 },
    },
  };
}

describe('RefusalContextTracker (REQ-4101-D2)', () => {
  it('compares send-boundary content to the last successful commit and hashes rewrites', () => {
    const tracker = new RefusalContextTracker();
    const first = entry(1, 'committed prompt');
    expect(tracker.snapshot([first], [first]).baseline_available).toBe(false);
    tracker.commit([first], 'p1', 0);
    tracker.recordCompression({
      summaryAuthorModel: 'separate-summarizer',
      summaryAuthorProvider: 'anthropic',
      compressionStrategy: 'one-shot',
    });

    const added = entry(2, 'new tool result');
    const pending = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'next prompt' }],
    } satisfies IContent;
    const initial = tracker.snapshot([first, added], [first, added, pending]);
    expect(initial.baseline_available).toBe(true);
    expect(initial.baseline_prompt_id).toBe('p1');
    expect(initial.added_entry_count).toBe(1);
    expect(initial.added_entries[0]?.identity).toBe('seq:2');
    expect(initial.pending_entries).toHaveLength(1);
    expect(initial.compression_count).toBe(1);
    expect(initial.summary_author_model).toBe('separate-summarizer');
    expect(initial.summary_author_provider).toBe('anthropic');
    expect(initial.compression_strategy).toBe('one-shot');
    expect(initial.prompt_tokens).toBeNull();

    const rewritten = entry(2, 'rewritten tool result');
    const revised = tracker.snapshot(
      [first, rewritten],
      [first, rewritten, pending],
    );
    expect(revised.added_entry_count).toBe(1);
    expect(revised.added_entries[0]?.content_hash).not.toBe(
      initial.added_entries[0]?.content_hash,
    );
    expect(revised.digest).not.toBe(initial.digest);
  });

  it('marks the baseline unavailable when the session tracker is reset', () => {
    const tracker = new RefusalContextTracker();
    tracker.commit([entry(1, 'previous session')], 'old-prompt', 2);

    tracker.reset();
    const afterReset = tracker.snapshot([entry(1, 'current session')], []);

    expect(afterReset.baseline_available).toBe(false);
    expect(afterReset.baseline_prompt_id).toBeNull();
    expect(afterReset.baseline_attempt_index).toBeNull();
    expect(afterReset.baseline_time).toBeNull();
  });

  it('advances only on commit and bounds previews under one UTF-8 budget', () => {
    const tracker = new RefusalContextTracker();
    tracker.commit([entry(1, 'baseline')], 'p1', 0);
    const current = Array.from({ length: 130 }, (_, index) =>
      entry(index + 2, '🦀'.repeat(4096)),
    );
    const refused = tracker.snapshot([entry(1, 'baseline'), ...current], []);
    const previewBytes = new TextEncoder().encode(
      refused.added_entries.map((item) => item.preview).join('') +
        refused.pending_entries.map((item) => item.preview).join(''),
    ).byteLength;
    expect(refused.added_entry_count).toBe(130);
    expect(refused.omitted_entry_count).toBeGreaterThan(0);
    expect(previewBytes).toBeLessThanOrEqual(32 * 1024);
    expect(refused.baseline_prompt_id).toBe('p1');
  });
});
