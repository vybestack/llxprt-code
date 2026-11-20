/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RefusalStreamAudit } from './refusalStreamAudit.js';
import type { RefusalContextRows } from './refusalContextTracker.js';

function rows(contents: readonly IContent[]): RefusalContextRows {
  return { count: contents.length, readAt: (index) => contents[index] };
}

function entry(text: string, seq = 1): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: {
      chronology: { seq, userTurn: seq, step: 1, recordedAt: seq * 1000 },
    },
  };
}

describe('RefusalStreamAudit lifecycle', () => {
  it('makes the baseline unavailable when the runtime audit is disposed', async () => {
    const audit = new RefusalStreamAudit();
    audit.commit(1, 'prior-prompt', 0);

    audit.dispose();

    const fingerprint = await audit.snapshot(rows([entry('after dispose')]));
    expect(fingerprint.baseline_available).toBe(false);
    expect(fingerprint.baseline_prompt_id).toBeNull();
    expect(fingerprint.baseline_attempt_index).toBeNull();
    expect(fingerprint.baseline_time).toBeNull();
  });

  it('resets only the baseline when history is cleared during runtime rebind', async () => {
    const audit = new RefusalStreamAudit();
    audit.commit(1, 'prior-prompt', 0);
    audit.recordCompression({
      summaryAuthorModel: 'summarizer',
      summaryAuthorProvider: 'openai',
      compressionStrategy: 'one-shot',
    });

    audit.rebind();

    const fingerprint = await audit.snapshot(rows([entry('after clear')]));
    expect(fingerprint.baseline_available).toBe(false);
    expect(fingerprint.compression_count).toBe(1);
    expect(fingerprint.summary_author_model).toBe('summarizer');
  });

  it('records applied compression with an unavailable summary author', async () => {
    const audit = new RefusalStreamAudit();
    audit.recordCompression({
      summaryAuthorModel: null,
      summaryAuthorProvider: null,
      compressionStrategy: 'top-down-truncation',
    });

    const fingerprint = await audit.snapshot(
      rows([entry('truncated history')]),
    );
    expect(fingerprint.compression_count).toBe(1);
    expect(fingerprint.summary_author_model).toBeNull();
    expect(fingerprint.summary_author_provider).toBeNull();
    expect(fingerprint.compression_strategy).toBe('top-down-truncation');
  });
});
