/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { emptyModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { createHash } from 'node:crypto';
import {
  buildPartialOutputSnapshot,
  PartialOutputRecorder,
} from './refusalAudit.js';

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

  it('records a streamed output as a bounded prefix with total length and hash', () => {
    const recorder = new PartialOutputRecorder();
    const delta = 'y'.repeat(1024);
    const hash = createHash('sha256');
    for (let index = 0; index < 256; index++) {
      recorder.add({
        content: { speaker: 'ai', blocks: [{ type: 'text', text: delta }] },
      });
      hash.update(delta);
      hash.update('\0');
    }

    const snapshot = recorder.snapshot();

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.original_bytes).toBe(256 * 1024);
    expect(snapshot.preview_bytes).toBeLessThanOrEqual(32 * 1024);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.omitted_items).toBe(0);
    expect(snapshot.output_sha256).toBe(hash.digest('hex'));
  });

  it('keeps a bounded number of items and counts the rest', () => {
    const recorder = new PartialOutputRecorder();
    for (let index = 0; index < 100; index++) {
      recorder.add({
        content: {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: `call-${index}`,
              name: 'read_file',
              parameters: { index },
            },
          ],
        },
      });
    }

    const snapshot = recorder.snapshot();

    expect(snapshot.items).toHaveLength(64);
    expect(snapshot.omitted_items).toBe(36);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.original_bytes).toBe(
      Array.from(
        { length: 100 },
        (_, index) => JSON.stringify({ index }).length,
      ).reduce((total, size) => total + size, 0),
    );
  });
});
