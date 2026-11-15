/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036: a rewrite notice reaches every reader of the task, so it must
 * not carry the text of a tool result, which can hold credentials.
 */

import { describe, expect, it } from 'bun:test';
import {
  describeRefusalStop,
  describeReviewRewrite,
} from './refusalNotices.js';

describe('terminal refusal notices', () => {
  it('shows diagnostic details while preserving null evidence and stripping terminal controls', () => {
    const notice = describeRefusalStop({
      model: 'model\nname',
      refusals: 1,
      delaysMs: [],
      rewrites: [],
      category: 'cyber\t',
      explanation: 'detail\nline',
    });

    expect(notice).toContain('Category: cyber. detail line');
    expect(notice).not.toContain('\n');
    expect(notice).not.toContain('\t');
    expect(
      describeRefusalStop({
        model: 'model',
        refusals: 1,
        delaysMs: [],
        rewrites: [],
        category: null,
        explanation: null,
      }),
    ).not.toContain('Category:');
  });
});

describe('the rewrite notice', () => {
  it('shows a preview of a rewritten message', () => {
    const notice = describeReviewRewrite({
      reviewer: 'reviewer-model',
      operationId: 'op-1',
      changes: [
        {
          kind: 'assistant_text',
          originalText: 'forbidden wording',
          newText: 'neutral wording',
        },
      ],
    });

    expect(notice).toContain('"forbidden wording" → "neutral wording"');
  });

  it('omits the text of a rewritten tool result', () => {
    const notice = describeReviewRewrite({
      reviewer: 'reviewer-model',
      operationId: 'op-1',
      changes: [
        {
          kind: 'tool_result',
          originalText: 'API_TOKEN=sk-live-secret-value',
          newText: 'API_TOKEN=[redacted]',
        },
      ],
    });

    expect(notice).not.toContain('sk-live-secret-value');
    expect(notice).not.toContain('[redacted]');
    expect(notice).toContain('tool_result');
    expect(notice).toContain('30 → 20 characters');
  });
});
