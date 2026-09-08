/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for the shared session-journal notice (issue #2933). The wording is a
 * correctness fix as much as a shared string: the recorded journal is not
 * guaranteed to be a complete transcript, and reading it whole would cost more
 * context than the compression that prompted the lookup saved.
 */

import { describe, it, expect } from 'bun:test';
import { buildTranscriptPathNotice } from './transcriptPathNotice.js';

describe('buildTranscriptPathNotice', () => {
  it('embeds the supplied path verbatim', () => {
    const notice = buildTranscriptPathNotice(
      '/home/user/.llxprt/chats/session-2026-08-22.jsonl',
    );

    expect(notice).toContain(
      '/home/user/.llxprt/chats/session-2026-08-22.jsonl',
    );
  });

  it('distinguishes different paths', () => {
    const first = buildTranscriptPathNotice('/tmp/a.jsonl');
    const second = buildTranscriptPathNotice('/tmp/b.jsonl');

    expect(first).not.toBe(second);
    expect(first).not.toContain('/tmp/b.jsonl');
  });

  it('does not claim the journal is a complete transcript', () => {
    const notice = buildTranscriptPathNotice('/tmp/a.jsonl');

    expect(notice).not.toContain('full pre-compression transcript');
    expect(notice.toLowerCase()).toContain('incomplete');
  });

  it('steers toward searching the file rather than reading it whole', () => {
    const notice = buildTranscriptPathNotice('/tmp/a.jsonl');

    expect(notice.toLowerCase()).toContain('search');
    expect(notice.toLowerCase()).toContain('not read whole');
  });

  it('asks for the path to survive into the summary', () => {
    const notice = buildTranscriptPathNotice('/tmp/a.jsonl');

    expect(notice.toLowerCase()).toContain('verbatim in your summary');
  });
});
