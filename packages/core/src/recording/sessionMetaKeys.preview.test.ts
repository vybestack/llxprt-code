/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { MIB } from '../journal/__tests__/support/streamedBody.js';
import { previewOfContent, SESSION_PREVIEW_LENGTH } from './sessionMetaKeys.js';

const RETAINED_BOUND = 4 * MIB;
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

  it('keeps none of the row it was cut from alive', async () => {
    const baseline = await settledHeap();
    let held: string | undefined;
    const cut = (): void => {
      held = previewOfContent({
        speaker: 'human',
        blocks: [text(bigText(40 * MIB)), text(bigText(40 * MIB))],
      });
    };
    cut();
    const afterCut = await settledHeap();

    expect(held).toHaveLength(SESSION_PREVIEW_LENGTH);
    expect(afterCut - baseline).toBeLessThan(RETAINED_BOUND);
  });

  it('control: holding the row itself shows in the same measurement', async () => {
    const baseline = await settledHeap();
    const row = { speaker: 'human', blocks: [text(bigText(40 * MIB))] };
    const preview = previewOfContent(row);
    const withRow = await settledHeap();

    expect(preview).toHaveLength(SESSION_PREVIEW_LENGTH);
    expect(row.blocks).toHaveLength(1);
    expect(withRow - baseline).toBeGreaterThan(
      40 * MIB * CONTROL_FLOOR_FRACTION,
    );
  });
});
