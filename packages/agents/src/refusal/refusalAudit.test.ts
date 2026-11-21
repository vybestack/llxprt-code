/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { emptyModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { buildPartialOutputSnapshot } from './refusalAudit.js';

describe('refusal partial-output audit', () => {
  it('stores only the latest snapshot for each thinking stream id', () => {
    const output = emptyModelOutput();
    output.content.blocks = [
      { type: 'thinking', thought: 'draft', streamId: 'thought-1' },
      { type: 'text', text: 'between thoughts' },
      { type: 'thinking', thought: 'complete thought', streamId: 'thought-1' },
      { type: 'thinking', thought: 'other thought', streamId: 'thought-2' },
    ];

    const snapshot = buildPartialOutputSnapshot(output);

    expect(snapshot.items).toStrictEqual([
      {
        type: 'thinking',
        text: 'complete thought',
        original_bytes: 16,
        truncated: false,
      },
      {
        type: 'text',
        text: 'between thoughts',
        original_bytes: 16,
        truncated: false,
      },
      {
        type: 'thinking',
        text: 'other thought',
        original_bytes: 13,
        truncated: false,
      },
    ]);
  });
});
