/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  BoundedStreamCollector,
  createByteBudget,
  ACQUISITION_HARD_MAX_BYTES,
} from './index.js';

function positiveFiniteBudgets(
  cases: ReadonlyArray<readonly [number, number | undefined]>,
): ReadonlyArray<readonly [number, number | undefined]> {
  return cases.filter(([bytes]) => bytes > 0 && Number.isFinite(bytes));
}

describe('ByteBudget', () => {
  it('creates a valid budget from a positive number', () => {
    const budget = createByteBudget(1024 * 1024);
    expect(budget.bytes).toBe(1024 * 1024);
  });

  it('rejects zero', () => {
    expect(() => createByteBudget(0)).toThrow(/finite positive/);
  });

  it('rejects negative', () => {
    expect(() => createByteBudget(-100)).toThrow(/finite positive/);
  });

  it('rejects NaN', () => {
    expect(() => createByteBudget(NaN)).toThrow(/finite positive/);
  });

  it('rejects Infinity', () => {
    expect(() => createByteBudget(Infinity)).toThrow(/finite positive/);
  });

  it('clamps to the hard max', () => {
    const budget = createByteBudget(ACQUISITION_HARD_MAX_BYTES * 10);
    expect(budget.bytes).toBe(ACQUISITION_HARD_MAX_BYTES);
  });

  it('enforces a minimum of 1024 bytes', () => {
    const budget = createByteBudget(100);
    expect(budget.bytes).toBe(1024);
  });
});

describe('ByteBudget - absolute hard-max invariants (issue #3200 finding 10)', () => {
  it('clamps a custom hardMax above 64 MiB down to the absolute ceiling', () => {
    // A caller passing a giant hardMax must still get a budget <= 64 MiB.
    const budget = createByteBudget(200 * 1024 * 1024, 500 * 1024 * 1024);
    expect(budget.bytes).toBe(ACQUISITION_HARD_MAX_BYTES);
  });

  it('never exceeds 64 MiB for any finite hardMax value', () => {
    const ceilings = [
      128 * 1024 * 1024,
      256 * 1024 * 1024,
      1024 * 1024 * 1024,
      Number.MAX_SAFE_INTEGER,
    ];
    for (const ceiling of ceilings) {
      const budget = createByteBudget(ceiling, ceiling);
      expect(budget.bytes).toBeLessThanOrEqual(ACQUISITION_HARD_MAX_BYTES);
    }
  });

  it('ignores a non-finite or nonpositive hardMax, falling back to the absolute ceiling', () => {
    expect(createByteBudget(8192, NaN).bytes).toBe(8192);
    expect(createByteBudget(8192, -1).bytes).toBe(8192);
    expect(createByteBudget(8192, 0).bytes).toBe(8192);
    expect(createByteBudget(8192, Infinity).bytes).toBe(8192);
  });

  it('never produces a budget below 1024 even when hardMax is below the floor', () => {
    // A custom hardMax below 1024 must NOT let the result violate the 1024
    // minimum (issue #3200 finding 10). The floor wins over a sub-1024 ceiling.
    expect(createByteBudget(100, 500).bytes).toBe(1024);
    expect(createByteBudget(1, 1).bytes).toBe(1024);
    expect(createByteBudget(50, 100).bytes).toBe(1024);
  });

  it('clamps a requested value above a valid sub-HARD_MAX ceiling down to that ceiling', () => {
    // hardMax=4096 is a valid ceiling; a request above it is clamped to 4096.
    expect(createByteBudget(999_999, 4096).bytes).toBe(4096);
    // A request below the ceiling but above the floor is honored.
    expect(createByteBudget(2048, 4096).bytes).toBe(2048);
  });

  it('the result always lies in [1024, HARD_MAX] for any finite inputs', () => {
    const cases: Array<[number, number]> = [
      [1, 1],
      [0, 0],
      [500, 500],
      [1024, 1024],
      [2048, 4096],
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      [Number.MAX_SAFE_INTEGER, 1],
    ];
    for (const [bytes, hardMax] of positiveFiniteBudgets(cases)) {
      const budget = createByteBudget(bytes, hardMax);
      expect(budget.bytes).toBeGreaterThanOrEqual(1024);
      expect(budget.bytes).toBeLessThanOrEqual(ACQUISITION_HARD_MAX_BYTES);
    }
  });

  it('produces a runtime-immutable (frozen) budget', () => {
    const budget = createByteBudget(8192);
    expect(Object.isFrozen(budget)).toBe(true);
    // Mutation is a no-op in non-strict mode and throws in strict mode.
    expect(() => {
      (budget as { bytes: number }).bytes = 999;
    }).toThrow('Attempted to assign to readonly property.');
    expect(budget.bytes).toBe(8192);
  });
});

describe('BoundedStreamCollector - finite overflow', () => {
  it('retains all output when under budget', () => {
    const collector = new BoundedStreamCollector({
      budget: createByteBudget(4096),
    });
    collector.append(Buffer.from('hello world'));
    const result = collector.getResult();
    expect(result.text).toBe('hello world');
    expect(result.metadata.truncated).toBe(false);
    expect(result.metadata.observedBytes).toBe(11);
    expect(result.metadata.retainedBytes).toBe(11);
    expect(result.metadata.omittedBytes).toBe(0);
    expect(result.omissionNotice).toBeNull();
  });

  it('truncates with bounded head/tail and accurate metadata', () => {
    const budget = createByteBudget(2048);
    const collector = new BoundedStreamCollector({ budget });

    // Write 8 KiB total in 1024-byte chunks.
    for (let i = 0; i < 8; i++) {
      collector.append(Buffer.alloc(1024, 65 + i)); // A, B, C, D, ...
    }

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.observedBytes).toBe(8192);
    expect(result.metadata.retainedBytes).toBeLessThanOrEqual(budget.bytes);
    expect(result.metadata.omittedBytes).toBe(
      8192 - result.metadata.retainedBytes,
    );
    expect(result.omissionNotice).not.toBeNull();
    expect(result.omissionNotice).toContain('truncated');
    expect(result.omissionNotice).toContain(
      result.metadata.omittedBytes.toLocaleString('en-US'),
    );
  });

  it('head contains the beginning of output', () => {
    const collector = new BoundedStreamCollector({
      budget: createByteBudget(1024),
    });
    collector.append(Buffer.from('HEAD_START|'));
    for (let i = 0; i < 10; i++) {
      collector.append(Buffer.alloc(512, 88)); // 'X'
    }
    collector.append(Buffer.from('|TAIL_END'));

    const result = collector.getResult();
    expect(result.headText).toContain('HEAD_START');
  });

  it('tail contains the end of output', () => {
    const collector = new BoundedStreamCollector({
      budget: createByteBudget(1024),
    });
    collector.append(Buffer.from('HEAD_START|'));
    for (let i = 0; i < 10; i++) {
      collector.append(Buffer.alloc(512, 88)); // 'X'
    }
    collector.append(Buffer.from('|TAIL_END'));

    const result = collector.getResult();
    expect(result.tailText).toContain('TAIL_END');
  });
});

describe('BoundedStreamCollector - continue and drain', () => {
  it('continues accepting output after retention fills (side effects visible)', () => {
    const collector = new BoundedStreamCollector({
      budget: createByteBudget(1024),
    });

    // Fill the budget.
    collector.append(Buffer.alloc(2048, 65));

    // Additional output after overflow should still be accepted.
    const sideEffectMarker = '|FINAL_MARKER|';
    collector.append(Buffer.from(sideEffectMarker));

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(true);
    // The tail should contain the final marker.
    expect(result.tailText).toContain(sideEffectMarker);
    // Total observed includes the post-overflow chunk.
    expect(result.metadata.observedBytes).toBe(2048 + sideEffectMarker.length);
  });
});

describe('BoundedStreamCollector - one huge chunk', () => {
  it('handles a single chunk larger than the entire budget', () => {
    const collector = new BoundedStreamCollector({
      budget: createByteBudget(1024),
    });
    // One 1 MiB chunk.
    collector.append(Buffer.alloc(1024 * 1024, 90)); // 'Z'

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.observedBytes).toBe(1024 * 1024);
    expect(result.metadata.retainedBytes).toBeLessThanOrEqual(1024);
  });
});

describe('BoundedStreamCollector - many tiny chunks', () => {
  it('handles thousands of 1-byte chunks', () => {
    const collector = new BoundedStreamCollector({
      budget: createByteBudget(2048),
    });
    // 4000 single-byte chunks.
    for (let i = 0; i < 4000; i++) {
      collector.append(Buffer.from([65 + (i % 26)]));
    }

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.observedBytes).toBe(4000);
    expect(result.metadata.retainedBytes).toBeLessThanOrEqual(2048);
  });
});

describe('BoundedStreamCollector - UTF-8 multibyte boundaries', () => {
  it('correctly handles multibyte UTF-8 split across chunk boundaries', () => {
    const collector = new BoundedStreamCollector({
      budget: createByteBudget(4096),
    });

    // "héllo" — the é is 2 bytes in UTF-8 (0xC3 0xA9).
    // Split it: first chunk ends with the first byte of é.
    collector.append(Buffer.from('h', 'utf-8'));
    collector.append(Buffer.from([0xc3])); // First byte of é
    collector.append(Buffer.from([0xa9])); // Second byte of é
    collector.append(Buffer.from('llo', 'utf-8'));

    // Flush decoder.
    collector.flushDecoder();

    const headText = collector.getHeadText();
    expect(headText).toBe('héllo');
  });

  it('handles a multibyte character split at the head boundary', () => {
    // The minimum budget is 1024 bytes, so to genuinely test a multibyte
    // split at the head/tail omission boundary we must write enough data to
    // exceed the budget. With headFraction 0.5, head=512 and tail=512 bytes.
    // We place a 3-byte 世 (0xE4 0xB8 0x96) right at the 511-byte mark so the
    // head boundary cuts through it, forcing the trimmer to drop the partial
    // sequence.
    const collector = new BoundedStreamCollector({
      budget: createByteBudget(1024),
      headFraction: 0.5, // head=512, tail=512
    });

    // 511 ASCII bytes, then 世 (3 bytes) straddling byte 512, then filler to
    // overflow, then a tail marker.
    const headPart = 'a'.repeat(511);
    collector.append(Buffer.from(headPart, 'utf-8'));
    collector.append(Buffer.from('世', 'utf-8')); // straddles byte 512
    collector.append(Buffer.alloc(2048, 88)); // 'X' filler → truncation
    collector.append(Buffer.from('TAIL世', 'utf-8')); // multibyte in tail

    const result = collector.getResult();
    // Genuinely truncated: observed well beyond the 1024 budget.
    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.observedBytes).toBeGreaterThan(1024);
    // No replacement chars at either boundary — partial multibyte sequences
    // are trimmed, not emitted as U+FFFD.
    expect(result.headText).not.toContain('\uFFFD');
    expect(result.tailText).not.toContain('\uFFFD');
    // Head retains the leading ASCII, tail retains the final marker.
    expect(result.headText.startsWith('a')).toBe(true);
    expect(result.tailText).toContain('TAIL');
  });

  it('handles 4-byte emoji at chunk boundaries', () => {
    const collector = new BoundedStreamCollector({
      budget: createByteBudget(4096),
    });

    // 😀 is 4 bytes: F0 9F 98 80
    const emoji = '😀';
    const buf = Buffer.from(emoji, 'utf-8');
    // Feed each byte separately.
    for (const byte of buf) {
      collector.append(Buffer.from([byte]));
    }
    collector.flushDecoder();

    const text = collector.getHeadText();
    expect(text).toBe(emoji);
  });
});

describe('BoundedStreamCollector - O(1) accounting', () => {
  it('observedByteCount is O(1) regardless of chunk count', () => {
    const collector = new BoundedStreamCollector({
      budget: createByteBudget(1024 * 1024),
    });

    // Feed 100,000 tiny chunks — this would be O(n) if using reduce.
    for (let i = 0; i < 100_000; i++) {
      collector.append(Buffer.from([65]));
    }

    expect(collector.observedByteCount).toBe(100_000);
    expect(collector.isTruncated).toBe(false);
  });
});

describe('BoundedStreamCollector - byte-copy isolation (no subarray retention)', () => {
  it('copies retained head bytes so a huge source Buffer is not kept alive', () => {
    // This is the key test for the Buffer.subarray retention defect:
    // subarray() shares the backing allocation. If we retain a subarray of
    // a 1 MiB buffer, the entire 1 MiB stays alive. We must copy instead.
    const budget = createByteBudget(2048);
    const collector = new BoundedStreamCollector({ budget });

    // Create a huge source buffer with a known pattern.
    const hugeSize = 1024 * 1024; // 1 MiB
    const huge = Buffer.alloc(hugeSize, 65); // 'A'
    // Put a marker at the very start.
    huge.write('STARTMARKER', 0);

    collector.append(huge);

    // Mutate the source buffer AFTER appending — if the collector retained
    // a subarray, the retained data would change too. If it copied, it won't.
    huge.fill(90); // Overwrite everything with 'Z'.

    const result = collector.getResult();
    const head = result.headText;

    // The head must still contain the original marker, proving bytes were
    // copied, not subarray'd.
    expect(head).toContain('STARTMARKER');
    // And it must NOT contain the mutation.
    expect(head).not.toContain('Z');
  });

  it('copies retained tail bytes so a huge source Buffer is not kept alive', () => {
    const budget = createByteBudget(1024);
    const collector = new BoundedStreamCollector({ budget });

    // Fill the head first (so everything after goes to tail).
    collector.append(Buffer.alloc(2000, 65)); // 'A' — exceeds head budget

    // Now append a huge chunk — its tail portion should be copied.
    const huge = Buffer.alloc(512 * 1024, 66); // 'B'
    huge.write('TAILMARKER', huge.length - 11);
    collector.append(huge);

    // Mutate the source.
    huge.fill(90); // 'Z'

    const result = collector.getResult();
    // The tail must still contain the original marker.
    expect(result.tailText).toContain('TAILMARKER');
    expect(result.tailText).not.toMatch(/Z{10,}/);
  });
});

describe('BoundedStreamCollector - no replacement chars at omission boundary', () => {
  it('does not emit replacement chars when multibyte chars straddle boundaries', () => {
    // Construct output with multibyte chars scattered throughout, with enough
    // total data to cause truncation. The head boundary (byte headBytes) and
    // the tail start boundary (byte total-tailFilled) may cut through a
    // multibyte character. The trimming helpers ensure no U+FFFD is emitted.
    const budget = createByteBudget(1024);
    const collector = new BoundedStreamCollector({ budget });

    // Build a large string with multibyte chars scattered throughout.
    // Each segment: 10 ASCII + 3 multibyte chars (9 bytes) = 19 bytes.
    // 100 segments = 1900 bytes > 1024 budget.
    const segment = 'AAAAAAAAAA\u4e16\u4e16\u4e16';
    const text = segment.repeat(100);
    collector.append(Buffer.from(text, 'utf-8'));

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(true);

    // CRITICAL: no replacement characters anywhere.
    expect(result.headText).not.toContain('\uFFFD');
    expect(result.tailText).not.toContain('\uFFFD');
    expect(result.text).not.toContain('\uFFFD');
  });

  it('preserves complete multibyte characters in truncated head and tail', () => {
    const budget = createByteBudget(1024);
    const collector = new BoundedStreamCollector({ budget });

    collector.append(Buffer.from('世'.repeat(500), 'utf-8'));

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(true);
    expect(result.headText.length).toBeGreaterThan(0);
    expect(result.tailText.length).toBeGreaterThan(0);
    expect(result.headText).not.toContain('\uFFFD');
    expect(result.tailText).not.toContain('\uFFFD');
  });

  it('preserves complete multibyte chars in non-truncated output', () => {
    const budget = createByteBudget(100);
    const collector = new BoundedStreamCollector({ budget });

    collector.append(Buffer.from('caf\u00e9 r\u00e9sum\u00e9', 'utf-8'));

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(false);
    expect(result.text).toBe('caf\u00e9 r\u00e9sum\u00e9');
    expect(result.text).not.toContain('\uFFFD');
  });
});

describe('BoundedStreamCollector - many tiny chunks data integrity', () => {
  it('retains correct tail content from many tiny chunks (ring buffer correctness)', () => {
    const budget = createByteBudget(1024);
    const collector = new BoundedStreamCollector({
      budget,
      headFraction: 0.1, // head=102, tail=922
    });

    // Write distinct single-byte markers in a known sequence.
    const total = 2048;
    for (let i = 0; i < total; i++) {
      collector.append(Buffer.from(String.fromCharCode(48 + (i % 10))));
    }

    const result = collector.getResult();
    expect(result.metadata.observedBytes).toBe(total);
    expect(result.metadata.truncated).toBe(true);

    // The tail must end with the last characters written.
    // Total 2048 chars, pattern 0-9 repeating. Last char: i=2047 → 48+7='7'.
    expect(result.tailText.endsWith('7')).toBe(true);

    // The tail must NOT contain replacement chars.
    expect(result.tailText).not.toContain('\uFFFD');
  });

  it('handles 50k tiny chunks efficiently (no quadratic shift)', () => {
    const budget = createByteBudget(4096);
    const collector = new BoundedStreamCollector({ budget });

    // 50,000 one-byte chunks — shift()-based design would be O(n²) here.
    for (let i = 0; i < 50_000; i++) {
      collector.append(Buffer.from([88])); // 'X'
    }

    const result = collector.getResult();
    expect(result.metadata.observedBytes).toBe(50_000);
    expect(result.metadata.retainedBytes).toBeLessThanOrEqual(4096);
    // Tail should be all 'X'.
    expect(result.tailText).toMatch(/^X+$/);
  });
});

describe('BoundedStreamCollector - exact-budget boundary', () => {
  it('does not truncate when output exactly fills the budget', () => {
    const budget = createByteBudget(1024);
    const collector = new BoundedStreamCollector({ budget });

    collector.append(Buffer.alloc(1024, 65)); // exactly fills budget

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(false);
    expect(result.metadata.observedBytes).toBe(1024);
    expect(result.metadata.retainedBytes).toBe(1024);
  });

  it('truncates when output is one byte over budget', () => {
    const budget = createByteBudget(1024);
    const collector = new BoundedStreamCollector({ budget });

    collector.append(Buffer.alloc(1025, 65));

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.omittedBytes).toBe(1);
  });
});

describe('BoundedStreamCollector - retained segment boundary', () => {
  it('decodes one complete under-budget stream across the head/tail split', () => {
    const collector = new BoundedStreamCollector({
      budget: createByteBudget(1024),
    });
    const output = `${'x'.repeat(511)}😀tail`;

    collector.append(Buffer.from(output));

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(false);
    expect(result.text).toBe(output);
    expect(result.text).not.toContain('�');
  });
});

describe('BoundedStreamCollector - detected encoding labels', () => {
  it('decodes retained Windows code-page bytes with TextDecoder', () => {
    const collector = new BoundedStreamCollector({
      budget: createByteBudget(1024),
      encoding: 'windows-1252',
    });

    collector.append(Buffer.from([0x80, 0x20, 0x63, 0x61, 0x66, 0xe9]));

    expect(collector.getResult().text).toBe('€ café');
  });

  it('encodes string input with the configured UTF-16LE label', () => {
    const collector = new BoundedStreamCollector({
      budget: createByteBudget(1024),
      encoding: 'utf-16le',
    });
    const output = 'hello \u03A9';

    collector.append(output);

    expect(collector.observedByteCount).toBe(
      Buffer.byteLength(output, 'utf16le'),
    );
    expect(collector.getResult().text).toBe(output);
  });
});
