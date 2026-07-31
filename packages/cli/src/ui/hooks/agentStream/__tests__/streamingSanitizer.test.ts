/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { EmojiFilter } from '@vybestack/llxprt-code-core';
import { StreamingSanitizer } from '../streamingSanitizer.js';

/** Deterministic PRNG so failures are reproducible. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function chunk(text: string, random: () => number): string[] {
  const chunks: string[] = [];
  let index = 0;
  while (index < text.length) {
    const size = 1 + Math.floor(random() * 5);
    chunks.push(text.slice(index, index + size));
    index += size;
  }
  return chunks;
}

function streamThrough(
  sanitizer: StreamingSanitizer,
  chunks: string[],
): string {
  let committed = '';
  for (const piece of chunks) {
    committed += sanitizer.push(piece).stable;
  }
  return committed + sanitizer.flush().stable;
}

function expectedFor(text: string, mode: 'auto' | 'warn'): string {
  const result = new EmojiFilter({ mode }).filterText(text);
  return typeof result.filtered === 'string' ? result.filtered : '';
}

const CORPUS: ReadonlyArray<readonly [string, string]> = [
  ['plain ascii', 'The quick brown fox jumps over the lazy dog. Twice!'],
  ['no emoji multiline', 'line one\nline two\n\nline three with words'],
  ['converted check mark', 'Build ✅ passed and tests ✅ too.'],
  ['converted warning with vs16', 'Careful ⚠️ this is risky.'],
  ['converted keycap digits', 'Step 1️⃣ then 2️⃣ then 3️⃣ done.'],
  ['decorative emoji stripped', 'Great work 😀 keep going 🎉 now.'],
  ['zwj family sequence', 'Family 👨‍👩‍👧‍👦 photo attached.'],
  ['adjacent emoji run', '✅⚠️❌⚡⭐ all together.'],
  ['emoji at very end', 'All finished ✅'],
  ['emoji at very start', '✅ all finished'],
  ['no whitespace at all', 'aaaa✅bbbb⚠️cccc'],
  ['empty', ''],
  ['only whitespace', '   \n\t  '],
  ['surrogate heavy', '𝔘𝔫𝔦𝔠𝔬𝔡𝔢 text 𝕥𝕖𝕤𝕥 here.'],
  [
    'long unbroken non-ascii run (BMP)',
    '✅'.repeat(400) + ' tail words after the run.',
  ],
  [
    'long unbroken supplementary-plane run',
    '😀'.repeat(400) + ' tail words after the run.',
  ],
  [
    'long unbroken ZWJ-sequence run',
    '👨‍👩‍👧‍👦'.repeat(120) + ' tail words after the run.',
  ],
  ['long unbroken keycap run', '1️⃣'.repeat(200) + ' tail words.'],
  [
    'long realistic response',
    Array.from(
      { length: 60 },
      (_, i) => `Paragraph ${i} explains something ✅ and warns ⚠️ about it.`,
    ).join('\n\n'),
  ],
];

describe('StreamingSanitizer', () => {
  describe('produces the same committed text as whole-text filtering', () => {
    for (const mode of ['auto', 'warn'] as const) {
      for (const [name, text] of CORPUS) {
        it(`matches filterText for "${name}" in ${mode} mode`, () => {
          const expected = expectedFor(text, mode);
          for (let seed = 1; seed <= 15; seed += 1) {
            const sanitizer = new StreamingSanitizer(new EmojiFilter({ mode }));
            const committed = streamThrough(
              sanitizer,
              chunk(text, createRandom(seed)),
            );
            expect({ seed, committed }).toStrictEqual({
              seed,
              committed: expected,
            });
          }
        });
      }
    }
  });

  it('matches whole-text filtering for every single-character chunking', () => {
    const text = 'Done ✅ and ⚠️ plus 1️⃣ and 👨‍👩‍👧‍👦 end.';
    const expected = expectedFor(text, 'auto');
    const sanitizer = new StreamingSanitizer(new EmojiFilter({ mode: 'auto' }));
    const committed = streamThrough(sanitizer, [...text]);
    expect(committed).toBe(expected);
  });

  it('passes text through untouched when no filter is configured', () => {
    const sanitizer = new StreamingSanitizer(undefined);
    const text = 'Emoji ✅ survives when filtering is disabled.';
    expect(streamThrough(sanitizer, [...text])).toBe(text);
  });

  it('shows the held-back tail provisionally so display stays per-delta', () => {
    const sanitizer = new StreamingSanitizer(new EmojiFilter({ mode: 'auto' }));
    const first = sanitizer.push('Hel');
    const second = sanitizer.push('lo');
    expect({
      firstVisible: first.stable + first.provisional,
      secondVisible: second.stable + second.provisional,
    }).toStrictEqual({ firstVisible: 'Hel', secondVisible: 'Hello' });
  });

  it('never loses the tail when the stream ends mid-word', () => {
    const sanitizer = new StreamingSanitizer(new EmojiFilter({ mode: 'auto' }));
    sanitizer.push('trailing wor');
    const flushed = sanitizer.flush();
    expect(flushed.stable).toBe('wor');
  });

  it('blocks in error mode when an emoji arrives', () => {
    const sanitizer = new StreamingSanitizer(
      new EmojiFilter({ mode: 'error' }),
    );
    const clean = sanitizer.push('all good ');
    const dirty = sanitizer.push('now ✅ ');
    expect({
      cleanBlocked: clean.blocked,
      dirtyBlocked: dirty.blocked,
    }).toStrictEqual({ cleanBlocked: false, dirtyBlocked: true });
  });

  it('emits warn-mode feedback once per turn rather than once per delta', () => {
    const sanitizer = new StreamingSanitizer(new EmojiFilter({ mode: 'warn' }));
    const feedbacks: string[] = [];
    for (const piece of ['first ✅ ', 'second ✅ ', 'third ✅ ']) {
      const result = sanitizer.push(piece);
      if (result.feedback !== undefined) {
        feedbacks.push(result.feedback);
      }
    }
    expect(feedbacks).toHaveLength(1);
  });

  it('re-arms feedback after reset', () => {
    const sanitizer = new StreamingSanitizer(new EmojiFilter({ mode: 'warn' }));
    const first = sanitizer.push('one ✅ ');
    sanitizer.reset();
    const second = sanitizer.push('two ✅ ');
    expect({
      firstHasFeedback: first.feedback !== undefined,
      secondHasFeedback: second.feedback !== undefined,
    }).toStrictEqual({ firstHasFeedback: true, secondHasFeedback: true });
  });

  it('drops carried state on reset', () => {
    const sanitizer = new StreamingSanitizer(new EmojiFilter({ mode: 'auto' }));
    sanitizer.push('stale tai');
    sanitizer.reset();
    expect(sanitizer.flush().stable).toBe('');
  });

  it('examines each character a bounded number of times', () => {
    const text = 'const value = 1; // a line of streamed code\n'.repeat(5_000);
    const sanitizer = new StreamingSanitizer(new EmojiFilter({ mode: 'auto' }));
    for (let index = 0; index < text.length; index += 4) {
      sanitizer.push(text.slice(index, index + 4));
    }
    sanitizer.flush();
    expect(sanitizer.charactersProcessed).toBeLessThan(text.length * 2);
  });

  it('keeps the held-back tail bounded for text with no whitespace', () => {
    const sanitizer = new StreamingSanitizer(new EmojiFilter({ mode: 'auto' }));
    const blob = 'a'.repeat(50_000);
    for (let index = 0; index < blob.length; index += 10) {
      sanitizer.push(blob.slice(index, index + 10));
    }
    // A quadratic implementation would revisit the whole accumulated blob on
    // every delta: 5000 deltas x 50000 characters.
    expect(sanitizer.charactersProcessed).toBeLessThan(blob.length * 3);
  });
});
