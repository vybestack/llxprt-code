/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { recordMemoryGate } from '../journal/__tests__/support/memory-gate-evidence.js';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { MIB } from '../journal/__tests__/support/streamedBody.js';
import { previewOfContent, SESSION_PREVIEW_LENGTH } from './sessionMetaKeys.js';

const PREVIEW_BYTES = Buffer.byteLength('x'.repeat(SESSION_PREVIEW_LENGTH));
/** Smallest two-block fixture peak measured on 2026-11-13. */
const FIXED_OVERHEAD_BYTES = 5_431;
/** UTF-16 input and owned output preview, not the original text blocks. */
const PREVIEW_ENCODING_FACTOR = 4;
const RETAINED_BOUND =
  FIXED_OVERHEAD_BYTES + PREVIEW_ENCODING_FACTOR * PREVIEW_BYTES;
const CONTROL_FLOOR_FRACTION = 0.5;

function text(value: string): { type: string; text: string } {
  return { type: 'text', text: value };
}

/** Text of `bytes` characters, built from distinct pieces so it is a real allocation. */
function bigText(bytes: number): string {
  const pieces: string[] = [];
  for (let at = 0, index = 0; at < bytes; at += MIB, index++) {
    pieces.push(
      index
        .toString(36)
        .padStart(6, '0')
        .repeat(MIB / 6),
    );
  }
  return pieces.join('').slice(0, bytes);
}

describe('previewOfContent', () => {
  it('cuts the text blocks of a human row to the preview length', () => {
    const preview = previewOfContent({
      speaker: 'human',
      blocks: [text('a'.repeat(150)), { type: 'media' }, text('b'.repeat(150))],
    });
    expect(preview).toBe('a'.repeat(150) + 'b'.repeat(50));
    expect(preview).toHaveLength(SESSION_PREVIEW_LENGTH);
  });

  it('offers nothing for a row of another speaker or without text', () => {
    expect(
      previewOfContent({ speaker: 'ai', blocks: [text('hello')] }),
    ).toBeUndefined();
    expect(
      previewOfContent({ speaker: 'human', blocks: [{ type: 'media' }] }),
    ).toBeUndefined();
    expect(
      previewOfContent({ speaker: 'human', blocks: [text('')] }),
    ).toBeUndefined();
  });

  it.each([SESSION_PREVIEW_LENGTH, MIB])(
    'keeps none of the row with %i-byte blocks alive',
    async (bytes) => {
      const baseline = await settledHeap();
      let held: string | undefined;
      const cut = (): void => {
        held = previewOfContent({
          speaker: 'human',
          blocks: [text(bigText(bytes)), text(bigText(bytes))],
        });
      };
      cut();
      const afterCut = await settledHeap();

      expect(held).toHaveLength(SESSION_PREVIEW_LENGTH);
      recordMemoryGate('preview', {
        bytes: 2 * bytes,
        peak: afterCut - baseline,
      });
      expect(afterCut - baseline).toBeLessThan(RETAINED_BOUND);
    },
  );

  it('control: holding the row itself shows in the same measurement', async () => {
    const baseline = await settledHeap();
    const row = { speaker: 'human', blocks: [text(bigText(2 * MIB))] };
    const preview = previewOfContent(row);
    const withRow = await settledHeap();

    expect(preview).toHaveLength(SESSION_PREVIEW_LENGTH);
    expect(row.blocks).toHaveLength(1);
    expect(withRow - baseline).toBeGreaterThan(3 * RETAINED_BOUND);
    recordMemoryGate('preview-control', {
      bytes: 2 * MIB,
      peak: withRow - baseline,
    });
    expect(withRow - baseline).toBeGreaterThan(
      2 * MIB * CONTROL_FLOOR_FRACTION,
    );
  });
});
