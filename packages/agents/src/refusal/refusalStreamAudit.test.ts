/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { RefusalStreamAudit } from './refusalStreamAudit.js';

function entry(text: string) {
  return {
    speaker: 'human' as const,
    blocks: [{ type: 'text' as const, text }],
  };
}

describe('RefusalStreamAudit lifecycle', () => {
  it('makes the baseline unavailable when the runtime audit is disposed', () => {
    const audit = new RefusalStreamAudit();
    audit.commit([entry('before dispose')], 'prior-prompt', 0);

    audit.dispose();

    const fingerprint = audit.snapshot([entry('after dispose')], []);
    expect(fingerprint.baseline_available).toBe(false);
    expect(fingerprint.baseline_prompt_id).toBeNull();
    expect(fingerprint.baseline_attempt_index).toBeNull();
    expect(fingerprint.baseline_time).toBeNull();
  });

  it('resets only the baseline when history is cleared during runtime rebind', () => {
    const audit = new RefusalStreamAudit();
    audit.commit([entry('before clear')], 'prior-prompt', 0);
    audit.recordCompression({
      summaryAuthorModel: 'summarizer',
      summaryAuthorProvider: 'openai',
      compressionStrategy: 'one-shot',
    });

    audit.rebind();

    const fingerprint = audit.snapshot([entry('after clear')], []);
    expect(fingerprint.baseline_available).toBe(false);
    expect(fingerprint.compression_count).toBe(1);
    expect(fingerprint.summary_author_model).toBe('summarizer');
  });

  it('records applied compression with an unavailable summary author', () => {
    const audit = new RefusalStreamAudit();
    audit.recordCompression({
      summaryAuthorModel: null,
      summaryAuthorProvider: null,
      compressionStrategy: 'top-down-truncation',
    });

    const fingerprint = audit.snapshot([entry('truncated history')], []);
    expect(fingerprint.compression_count).toBe(1);
    expect(fingerprint.summary_author_model).toBeNull();
    expect(fingerprint.summary_author_provider).toBeNull();
    expect(fingerprint.compression_strategy).toBe('top-down-truncation');
  });
});
