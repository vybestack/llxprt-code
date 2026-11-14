/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import { EmojiFilter } from '@vybestack/llxprt-code-core';
import { waitFor } from '../../../../__tests__/async.js';
import {
  withJournalResponse,
  sealText,
} from './journal-response-test-helpers.js';

function deltas(text: string, size: number): string[] {
  return Array.from({ length: Math.ceil(text.length / size) }, (_, index) =>
    text.slice(index * size, (index + 1) * size),
  );
}

const prose = Array.from(
  { length: 30 },
  (_, index) =>
    `Paragraph ${index} describes a step of the plan in some detail.`,
).join('\n\n');
const code =
  'Here is the implementation:\n\n```ts\n' +
  Array.from(
    { length: 400 },
    (_, index) => `const value${index} = compute(${index});`,
  ).join('\n');

describe('journal streamed content pipeline (issue #2852)', () => {
  it('advances the journal display on every delta without an accumulated UI buffer', async () => {
    await withJournalResponse(async (fixture) => {
      const arrival = await fixture.open('live');
      const expected = ['Hel', 'Hello ', 'Hello wor', 'Hello world'];
      for (const [index, text] of ['Hel', 'lo ', 'wor', 'ld'].entries()) {
        await arrival.append({ type: 'text', text });
        await waitFor(async () => {
          expect((await fixture.items())[0]?.text).toBe(expected[index]);
        });
      }
      await arrival.seal({});
      expect((await fixture.items()).map((item) => item.text)).toStrictEqual([
        'Hello world',
      ]);
    });
  });

  for (const [name, source] of [
    ['prose', prose],
    ['unterminated code', code],
  ]) {
    it(`commits ${name} byte-identically across chunk boundaries`, async () => {
      await withJournalResponse(async (fixture) => {
        for (const size of [1, 7, 64]) {
          await sealText(fixture, `size-${size}`, deltas(source, size));
        }
        expect((await fixture.items()).map((item) => item.text)).toStrictEqual([
          source,
          source,
          source,
        ]);
      });
    });
  }

  it('filters emoji-bearing content identically to whole-text filtering', async () => {
    const source =
      'Result ✅ ready.\n\nWarning ⚠️ applies to step 1️⃣ only.\n\nDone 😀 now.';
    const filtered = new EmojiFilter({ mode: 'auto' }).filterText(
      source,
    ).filtered;
    if (typeof filtered !== 'string') throw new Error('Expected filtered text');
    await withJournalResponse(async (fixture) => {
      for (const size of [1, 2, 9])
        await sealText(fixture, `emoji-${size}`, deltas(source, size));
      expect(
        (await fixture.items('auto')).map((item) => item.text),
      ).toStrictEqual([filtered, filtered, filtered]);
    });
  });

  it('does not lose a trailing partial word when the stream ends', async () => {
    await withJournalResponse(async (fixture) => {
      await sealText(fixture, 'trailing', [
        'complete words then trailing',
        'Frag',
      ]);
      expect((await fixture.items())[0]?.text).toBe(
        'complete words then trailingFrag',
      );
    });
  });

  it('drops an abandoned attempt and rejects deltas after cancellation', async () => {
    await withJournalResponse(async (fixture) => {
      const arrival = await fixture.open('cancelled');
      await arrival.append({ type: 'text', text: 'abandoned text' });
      await arrival.interrupt('superseded');
      expect(() =>
        arrival.append({ type: 'text', text: 'after cancel' }),
      ).toThrow('finished');
      expect(await fixture.items()).toStrictEqual([]);
    });
  });
});
