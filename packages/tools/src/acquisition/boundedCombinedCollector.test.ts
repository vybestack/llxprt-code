/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { BoundedCombinedCollector, createByteBudget } from './index.js';

describe('BoundedCombinedCollector - shared stdout/stderr budget', () => {
  it('retains both stdout and stderr under budget', () => {
    const collector = new BoundedCombinedCollector({
      budget: createByteBudget(4096),
    });
    collector.append(Buffer.from('out1\n'), 'stdout');
    collector.append(Buffer.from('err1\n'), 'stderr');
    collector.append(Buffer.from('out2\n'), 'stdout');

    const result = collector.getResult();
    expect(result.stdoutText).toContain('out1');
    expect(result.stdoutText).toContain('out2');
    expect(result.stderrText).toContain('err1');
    expect(result.metadata.truncated).toBe(false);
  });

  it('shares one aggregate budget across both streams', () => {
    const collector = new BoundedCombinedCollector({
      budget: createByteBudget(1024),
    });

    // Fill budget entirely from stdout.
    collector.append(Buffer.alloc(768, 65), 'stdout');
    // Now stderr fills the rest.
    collector.append(Buffer.alloc(512, 66), 'stderr');

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.observedBytes).toBe(1280);
    expect(result.metadata.retainedBytes).toBeLessThanOrEqual(1024);
  });

  it('preserves interleaved arrival order', () => {
    const collector = new BoundedCombinedCollector({
      budget: createByteBudget(4096),
    });

    // Interleave stdout and stderr.
    collector.append(Buffer.from('A'), 'stdout');
    collector.append(Buffer.from('B'), 'stderr');
    collector.append(Buffer.from('C'), 'stdout');
    collector.append(Buffer.from('D'), 'stderr');

    const result = collector.getResult();
    // The combined text should preserve A, B, C, D order.
    expect(result.text).toContain('A');
    expect(result.text).toContain('B');
    expect(result.text).toContain('C');
    expect(result.text).toContain('D');

    // Check relative order in combined text.
    const posA = result.text.indexOf('A');
    const posB = result.text.indexOf('B');
    const posC = result.text.indexOf('C');
    const posD = result.text.indexOf('D');
    expect(posA).toBeLessThan(posB);
    expect(posB).toBeLessThan(posC);
    expect(posC).toBeLessThan(posD);
  });

  it('preserves stdout/stderr provenance after truncation', () => {
    const collector = new BoundedCombinedCollector({
      budget: createByteBudget(512),
    });

    collector.append(Buffer.from('STDOUT_HEAD|'), 'stdout');
    collector.append(Buffer.alloc(2000, 88), 'stdout'); // 'X' filler
    collector.append(Buffer.from('|STDERR_HEAD|'), 'stderr');
    collector.append(Buffer.alloc(2000, 89), 'stderr'); // 'Y' filler
    collector.append(Buffer.from('|STDOUT_TAIL'), 'stdout');
    collector.append(Buffer.from('|STDERR_TAIL'), 'stderr');

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(true);
    // Provenance preserved: stdoutText only has stdout content.
    expect(result.stdoutText).not.toContain('STDERR');
    expect(result.stderrText).not.toContain('STDOUT');
  });
});

describe('BoundedCombinedCollector - bounded raw buffer', () => {
  it('getBoundedRawBuffer never exceeds the budget', () => {
    const collector = new BoundedCombinedCollector({
      budget: createByteBudget(1024),
    });

    // Write 100 KiB.
    for (let i = 0; i < 100; i++) {
      collector.append(Buffer.alloc(1024, 65 + (i % 26)), 'stdout');
    }

    const raw = collector.getBoundedRawBuffer();
    expect(raw.length).toBeLessThanOrEqual(1024);
  });

  it('getBoundedRawBuffer returns all data when under budget', () => {
    const collector = new BoundedCombinedCollector({
      budget: createByteBudget(4096),
    });
    collector.append(Buffer.from('hello'), 'stdout');
    collector.append(Buffer.from('world'), 'stderr');

    const raw = collector.getBoundedRawBuffer();
    expect(raw.toString('utf-8')).toBe('helloworld');
  });

  it('returns a copied prefix for fixed-size binary sniffing', () => {
    const collector = new BoundedCombinedCollector({
      budget: createByteBudget(1024),
    });
    const source = Buffer.from('abcdef');
    collector.append(source, 'stdout');

    const head = collector.getHeadBytes(3);
    source.fill(0);

    expect(head.toString('utf-8')).toBe('abc');
  });
});

describe('BoundedCombinedCollector - multibyte and chunk patterns', () => {
  it('handles UTF-8 multibyte across stream boundaries', () => {
    const collector = new BoundedCombinedCollector({
      budget: createByteBudget(4096),
    });

    // Split a multibyte char across stdout/stderr (unusual but valid).
    collector.append(Buffer.from('hello'), 'stdout');
    collector.append(Buffer.from([0xe4, 0xb8]), 'stdout'); // 世 partial
    collector.append(Buffer.from([0x96]), 'stdout'); // 世 complete
    collector.append(Buffer.from('world'), 'stderr');

    collector.flushAllDecoders();
    expect(collector.getStdoutText()).toContain('世');
  });

  it('handles many tiny interleaved chunks', () => {
    const collector = new BoundedCombinedCollector({
      budget: createByteBudget(1024),
    });

    for (let i = 0; i < 2000; i++) {
      const source = i % 2 === 0 ? 'stdout' : 'stderr';
      collector.append(Buffer.from([65 + (i % 26)]), source);
    }

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.observedBytes).toBe(2000);
  });
});

describe('BoundedCombinedCollector - provenance and arrival order after truncation', () => {
  it('preserves combined arrival order in text after truncation', () => {
    // Write a sequence that overflows the budget, then verify the combined
    // text preserves the arrival order of the retained head and tail.
    const budget = createByteBudget(1024);
    const collector = new BoundedCombinedCollector({ budget });

    // Interleave with distinct markers, enough filler to trigger truncation.
    collector.append(Buffer.from('A1-'), 'stdout');
    collector.append(Buffer.from('B1-'), 'stderr');
    // Fill the middle with filler to trigger truncation.
    collector.append(Buffer.alloc(2048, 88), 'stdout'); // 'X' filler
    collector.append(Buffer.from('A2-'), 'stdout');
    collector.append(Buffer.from('B2-'), 'stderr');

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(true);

    // Head must preserve A1-B1 order.
    const posA1 = result.headText.indexOf('A1');
    const posB1 = result.headText.indexOf('B1');
    expect(posA1).toBeGreaterThanOrEqual(0);
    expect(posB1).toBeGreaterThanOrEqual(0);
    expect(posA1).toBeLessThan(posB1);

    // Tail must preserve A2-B2 order.
    const posA2 = result.tailText.indexOf('A2');
    const posB2 = result.tailText.indexOf('B2');
    expect(posA2).toBeGreaterThanOrEqual(0);
    expect(posB2).toBeGreaterThanOrEqual(0);
    expect(posA2).toBeLessThan(posB2);
  });

  it('preserves stdout/stderr provenance exactly after truncation', () => {
    const budget = createByteBudget(1024);
    const collector = new BoundedCombinedCollector({ budget });

    // Head: stdout marker + stderr marker.
    collector.append(Buffer.from('OUT_HEAD'), 'stdout');
    collector.append(Buffer.from('ERR_HEAD'), 'stderr');
    // Overflow filler.
    collector.append(Buffer.alloc(4096, 70), 'stdout'); // 'F'
    // Tail: stderr marker + stdout marker.
    collector.append(Buffer.from('ERR_TAIL'), 'stderr');
    collector.append(Buffer.from('OUT_TAIL'), 'stdout');

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(true);

    // stdoutText must contain ONLY stdout markers.
    expect(result.stdoutText).toContain('OUT_HEAD');
    expect(result.stdoutText).toContain('OUT_TAIL');
    expect(result.stdoutText).not.toContain('ERR');

    // stderrText must contain ONLY stderr markers.
    expect(result.stderrText).toContain('ERR_HEAD');
    expect(result.stderrText).toContain('ERR_TAIL');
    expect(result.stderrText).not.toContain('OUT_');
  });

  it('no replacement chars at omission boundary in combined text', () => {
    // Write enough data with multibyte chars to cause truncation.
    const budget = createByteBudget(1024);
    const collector = new BoundedCombinedCollector({ budget });

    // Build large multibyte-heavy content from both streams.
    const segment = 'AAAAA\u4e16\u4e16\u4e16';
    // 50 segments * 14 bytes = 700 bytes from stdout + 700 from stderr = 1400 > 1024.
    collector.append(Buffer.from(segment.repeat(50), 'utf-8'), 'stdout');
    collector.append(Buffer.from(segment.repeat(50), 'utf-8'), 'stderr');

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(true);
    // No replacement characters anywhere.
    expect(result.text).not.toContain('\uFFFD');
    expect(result.stdoutText).not.toContain('\uFFFD');
    expect(result.stderrText).not.toContain('\uFFFD');
  });
});

describe('BoundedCombinedCollector - byte-copy isolation', () => {
  it('copies bytes so a huge source Buffer is not retained', () => {
    const budget = createByteBudget(2048);
    const collector = new BoundedCombinedCollector({ budget });

    const huge = Buffer.alloc(512 * 1024, 65); // 'A', 512 KiB
    huge.write('HEADSTART', 0);
    collector.append(huge, 'stdout');

    // Mutate the source buffer.
    huge.fill(90); // 'Z'

    const result = collector.getResult();
    // Retained head must still show the original data.
    expect(result.stdoutText).toContain('HEADSTART');
    expect(result.stdoutText).not.toMatch(/Z{10,}/);
  });

  it('getBoundedRawBuffer copies bytes (not subarray)', () => {
    const budget = createByteBudget(1024);
    const collector = new BoundedCombinedCollector({ budget });

    const huge = Buffer.alloc(256 * 1024, 66); // 'B'
    huge.write('XYZ', 0);
    collector.append(huge, 'stdout');

    const raw = collector.getBoundedRawBuffer();
    expect(raw.length).toBeLessThanOrEqual(1024);

    // Mutate source — raw must be unaffected.
    huge.fill(90);
    expect(raw.toString('utf-8', 0, 3)).toBe('XYZ');
  });
});

describe('BoundedCombinedCollector - 50k tiny chunks (ring correctness)', () => {
  it('handles 50k tiny interleaved chunks with correct tail content', () => {
    const budget = createByteBudget(2048);
    const collector = new BoundedCombinedCollector({ budget });

    for (let i = 0; i < 50_000; i++) {
      const source = i % 3 === 0 ? 'stderr' : 'stdout';
      collector.append(Buffer.from([48 + (i % 10)]), source);
    }

    const result = collector.getResult();
    expect(result.metadata.observedBytes).toBe(50_000);
    expect(result.metadata.retainedBytes).toBeLessThanOrEqual(2048);
    // Last written char: i=49999 → 48 + (49999 % 10) = 48 + 9 = '9'.
    expect(result.text.endsWith('9')).toBe(true);
    expect(result.text).not.toContain('\uFFFD');
  });
});

describe('BoundedCombinedCollector - retained segment boundary', () => {
  it('decodes complete combined and per-source text across the head/tail split', () => {
    const collector = new BoundedCombinedCollector({
      budget: createByteBudget(1024),
    });
    const output = `${'x'.repeat(511)}tail`;

    collector.append(Buffer.from(output), 'stdout');

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(false);
    expect(result.text).toBe(output);
    expect(result.stdoutText).toBe(output);
    expect(result.stderrText).toBe('');
    expect(result.text).not.toContain('?');
  });
});

// U+4E16 (shi) = E4 B8 96, U+2605 (star) = E2 98 85. Defined as byte arrays to
// avoid any literal multibyte characters in source.
const SHI_BYTES = Buffer.from([0xe4, 0xb8, 0x96]);
const STAR_BYTES = Buffer.from([0xe2, 0x98, 0x85]);
const SHI = SHI_BYTES.toString('utf8');
const STAR = STAR_BYTES.toString('utf8');

describe('BoundedCombinedCollector - independent per-source decoders (issue #3200 finding 5)', () => {
  it('stderr inserted between split stdout bytes does not corrupt the stdout character', () => {
    // Split a 3-byte UTF-8 char across stdout with a stderr byte in the middle.
    // A single shared decoder would emit U+FFFD for stdout because the stderr
    // byte (0x58) interrupts the multibyte sequence. Independent per-source
    // decoders reassemble the char correctly.
    const collector = new BoundedCombinedCollector({
      budget: createByteBudget(4096),
    });
    collector.append(Buffer.from([SHI_BYTES[0]]), 'stdout');
    collector.append(Buffer.from('X'), 'stderr');
    collector.append(Buffer.from([SHI_BYTES[1], SHI_BYTES[2]]), 'stdout');

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(false);
    expect(result.stdoutText).toBe(SHI);
    expect(result.stderrText).toBe('X');
    expect(result.stdoutText).not.toContain('\uFFFD');
    expect(result.text).toContain(SHI);
    expect(result.text).toContain('X');
    expect(result.text).not.toContain('\uFFFD');
  });

  it('repeated interleaving of single bytes across sources decodes each source intact', () => {
    const collector = new BoundedCombinedCollector({
      budget: createByteBudget(4096),
    });
    for (let i = 0; i < SHI_BYTES.length; i++) {
      collector.append(Buffer.from([SHI_BYTES[i]]), 'stdout');
      collector.append(Buffer.from([STAR_BYTES[i]]), 'stderr');
    }
    const result = collector.getResult();
    expect(result.stdoutText).toBe(SHI);
    expect(result.stderrText).toBe(STAR);
    expect(result.stdoutText).not.toContain('\uFFFD');
    expect(result.stderrText).not.toContain('\uFFFD');
  });

  it('a multibyte char straddling the head/tail omission boundary is trimmed, not corrupted', () => {
    // budget 1024 -> head 512, tail 512. Place a 3-byte char (E4 B8 96) so the
    // lead byte is the last head byte and the continuation bytes begin the tail,
    // then append enough filler to push observed just past the budget. The lead
    // byte is trimmed from the head tail; the surviving continuation byte at the
    // tail start is trimmed from the tail head. The split char is dropped
    // entirely (it is omitted anyway) rather than emitted as replacement chars.
    const budget = createByteBudget(1024);
    const collector = new BoundedCombinedCollector({ budget });
    collector.append(Buffer.alloc(511, 65), 'stdout'); // bytes 0-510 (head fill)
    collector.append(SHI_BYTES, 'stdout'); // byte 511 -> head (full); 512,513 -> tail
    collector.append(Buffer.alloc(511, 66), 'stdout'); // bytes 514-1024 -> tail

    const result = collector.getResult();
    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.observedBytes).toBe(1025);
    // No replacement characters: boundary trimming drops the split char.
    expect(result.stdoutText).not.toContain('\uFFFD');
    expect(result.text).not.toContain('\uFFFD');
    // Head retains the leading A's, tail retains the trailing B's.
    expect(result.headText).toMatch(/^A+$/);
    expect(result.tailText).toMatch(/^B+$/);
  });
});

describe('BoundedCombinedCollector - structural / peak allocation bounds (issue #3200 finding 5)', () => {
  it('peak retained bytes never exceed the budget under massive source switching', () => {
    // The run-based design retains only the budget regardless of source-switch
    // count; the old per-byte-tag design would allocate a tag array as large as
    // the observed bytes.
    const budget = createByteBudget(2048);
    const collector = new BoundedCombinedCollector({ budget });
    for (let i = 0; i < 524_288; i++) {
      collector.append(
        Buffer.from([65 + (i % 26)]),
        i % 2 === 0 ? 'stdout' : 'stderr',
      );
    }
    const result = collector.getResult();
    expect(result.metadata.retainedBytes).toBeLessThanOrEqual(budget.bytes);
    expect(result.metadata.observedBytes).toBe(524_288);
    expect(collector.getBoundedRawBuffer().length).toBeLessThanOrEqual(
      budget.bytes,
    );
    expect(result.metadata.truncated).toBe(true);
  });

  it('a single huge chunk retains only the budget (huge-chunk efficiency)', () => {
    const budget = createByteBudget(1024);
    const collector = new BoundedCombinedCollector({ budget });
    collector.append(Buffer.alloc(8 * 1024 * 1024, 90), 'stdout');

    const result = collector.getResult();
    expect(result.metadata.retainedBytes).toBeLessThanOrEqual(budget.bytes);
    expect(result.metadata.observedBytes).toBe(8 * 1024 * 1024);
    expect(collector.getBoundedRawBuffer().length).toBeLessThanOrEqual(
      budget.bytes,
    );
  });

  it('does not materialize full-budget copies repeatedly for raw + result', () => {
    const budget = createByteBudget(2048);
    const collector = new BoundedCombinedCollector({ budget });
    collector.append(Buffer.alloc(4096, 67), 'stdout');

    const r1 = collector.getResult();
    const raw1 = collector.getBoundedRawBuffer();
    const r2 = collector.getResult();
    const raw2 = collector.getBoundedRawBuffer();

    expect(raw1.length).toBe(raw2.length);
    expect(raw1.equals(raw2)).toBe(true);
    expect(r1.metadata.retainedBytes).toBe(r2.metadata.retainedBytes);
    expect(raw1.length).toBeLessThanOrEqual(budget.bytes);
  });

  it('exact metadata: observed/retained/omitted are precise after interleaved truncation', () => {
    const budget = createByteBudget(1024);
    const collector = new BoundedCombinedCollector({ budget });
    collector.append(Buffer.alloc(300, 65), 'stdout');
    collector.append(Buffer.alloc(300, 66), 'stderr');
    collector.append(Buffer.alloc(300, 67), 'stdout');
    collector.append(Buffer.alloc(300, 68), 'stderr');

    const result = collector.getResult();
    expect(result.metadata.observedBytes).toBe(1200);
    expect(result.metadata.retainedBytes).toBeLessThanOrEqual(budget.bytes);
    expect(result.metadata.omittedBytes).toBe(
      result.metadata.observedBytes - result.metadata.retainedBytes,
    );
    expect(result.metadata.truncated).toBe(true);
  });

  it('materializes a head-only collector without tail modulo arithmetic', () => {
    const budget = createByteBudget(1024);
    const collector = new BoundedCombinedCollector({
      budget,
      headFraction: 1,
    });

    collector.append(Buffer.alloc(2048, 65), 'stdout');

    const result = collector.getResult();
    expect(result.metadata.retainedBytes).toBe(budget.bytes);
    expect(result.metadata.omittedBytes).toBe(budget.bytes);
    expect(result.stdoutText.startsWith('A')).toBe(true);
  });
});
