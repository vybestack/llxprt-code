/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { BoundedLineFramer } from './lineFramer.js';

function feedCollect(framer: BoundedLineFramer, chunk: Buffer): string[] {
  const lines: string[] = [];
  framer.feedChunk(chunk, (line) => lines.push(line));
  return lines;
}

function flushCollect(framer: BoundedLineFramer): string[] {
  const lines: string[] = [];
  framer.flushRemaining((line) => lines.push(line));
  return lines;
}

describe('BoundedLineFramer - LF line splitting', () => {
  it('emits complete LF-terminated lines', () => {
    const framer = new BoundedLineFramer();
    expect(feedCollect(framer, Buffer.from('hello\nworld\n'))).toEqual([
      'hello',
      'world',
    ]);
  });

  it('retains a partial line across feed calls', () => {
    const framer = new BoundedLineFramer();
    expect(feedCollect(framer, Buffer.from('hel'))).toEqual([]);
    expect(feedCollect(framer, Buffer.from('lo\nwor'))).toEqual(['hello']);
    expect(feedCollect(framer, Buffer.from('ld\n'))).toEqual(['world']);
  });

  it('flushRemaining returns the unterminated partial as a final line', () => {
    const framer = new BoundedLineFramer();
    feedCollect(framer, Buffer.from('hello\nworld'));
    expect(flushCollect(framer)).toEqual(['world']);
  });

  it('flushRemaining returns empty when nothing remains', () => {
    const framer = new BoundedLineFramer();
    feedCollect(framer, Buffer.from('hello\nworld\n'));
    expect(flushCollect(framer)).toEqual([]);
  });
});

describe('BoundedLineFramer - LF is the sole delimiter', () => {
  it('preserves lone CR as content inside a line', () => {
    const framer = new BoundedLineFramer();
    expect(feedCollect(framer, Buffer.from('a\rb\r\n'))).toEqual(['a\rb']);
  });

  it('preserves lone CR in a line with no trailing newline', () => {
    const framer = new BoundedLineFramer();
    const lines = feedCollect(framer, Buffer.from('x\ry'));
    expect(lines).toEqual([]);
    expect(flushCollect(framer)).toEqual(['x\ry']);
  });

  it('strips exactly one CR before LF for CRLF', () => {
    const framer = new BoundedLineFramer();
    expect(feedCollect(framer, Buffer.from('a\r\nb\r\n'))).toEqual(['a', 'b']);
  });

  it('does not strip CR when not immediately before LF', () => {
    const framer = new BoundedLineFramer();
    expect(feedCollect(framer, Buffer.from('a\r \nb\n'))).toEqual([
      'a\r ',
      'b',
    ]);
  });

  it('handles CRLF split across chunk boundaries', () => {
    const framer = new BoundedLineFramer();
    const first = feedCollect(framer, Buffer.from('hello\r'));
    const second = feedCollect(framer, Buffer.from('\nworld\r\n'));
    expect([...first, ...second]).toEqual(['hello', 'world']);
  });

  it('handles mixed LF and CRLF in one stream', () => {
    const framer = new BoundedLineFramer();
    expect(feedCollect(framer, Buffer.from('a\nb\r\nc\nd\r\n'))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('preserves CR that appears between two LF-terminated records', () => {
    const framer = new BoundedLineFramer();
    expect(feedCollect(framer, Buffer.from('line1\n\r\nline3\n'))).toEqual([
      'line1',
      '',
      'line3',
    ]);
  });

  it('CR at end of chunk followed by non-LF keeps CR as content', () => {
    const framer = new BoundedLineFramer();
    const first = feedCollect(framer, Buffer.from('hello\r'));
    const second = feedCollect(framer, Buffer.from('world\n'));
    expect([...first, ...second]).toEqual(['hello\rworld']);
  });

  it('preserves CR CR LF (two CR before LF strips only the last)', () => {
    const framer = new BoundedLineFramer();
    expect(feedCollect(framer, Buffer.from('a\r\r\n'))).toEqual(['a\r']);
  });

  it('does NOT emit a lone CR as its own record', () => {
    const framer = new BoundedLineFramer();
    expect(feedCollect(framer, Buffer.from('hello\r'))).toEqual([]);
    expect(flushCollect(framer)).toEqual(['hello\r']);
  });
});

describe('BoundedLineFramer - empty records', () => {
  it('emits an empty record for consecutive LF', () => {
    const framer = new BoundedLineFramer();
    expect(feedCollect(framer, Buffer.from('\n\n'))).toEqual(['', '']);
  });

  it('emits an empty record for empty CRLF line', () => {
    const framer = new BoundedLineFramer();
    expect(feedCollect(framer, Buffer.from('\r\n'))).toEqual(['']);
  });

  it('emits empty record at the start of input', () => {
    const framer = new BoundedLineFramer();
    expect(feedCollect(framer, Buffer.from('\nhello\n'))).toEqual([
      '',
      'hello',
    ]);
  });
});

describe('BoundedLineFramer - multibyte UTF-8 across chunk boundaries', () => {
  it('reassembles a multibyte character split across chunks', () => {
    const framer = new BoundedLineFramer();
    feedCollect(framer, Buffer.from([0xe4, 0xb8]));
    const lines = feedCollect(framer, Buffer.from([0x96, 0x0a]));
    expect(lines).toEqual(['世']);
  });

  it('handles multibyte chars mixed with ASCII across chunks', () => {
    const framer = new BoundedLineFramer();
    feedCollect(framer, Buffer.from([0x68, 0xc3]));
    const lines = feedCollect(
      framer,
      Buffer.from([0xa9, 0x6c, 0x6c, 0x6f, 0x0a]),
    );
    expect(lines).toEqual(['héllo']);
    expect(flushCollect(framer)).toEqual([]);
  });

  it('handles emoji (4-byte) split across chunks', () => {
    const framer = new BoundedLineFramer();
    feedCollect(framer, Buffer.from([0xf0, 0x9f]));
    const lines = feedCollect(framer, Buffer.from([0x98, 0x80, 0x0a]));
    expect(lines).toEqual(['😀']);
  });

  it('does not emit replacement characters for valid multibyte sequences', () => {
    const framer = new BoundedLineFramer();
    const chars = 'café 世界 ';
    const bytes = Buffer.from(chars + '\n', 'utf-8');
    const allLines: string[] = [];
    for (let i = 0; i < bytes.length; i++) {
      framer.feedChunk(bytes.subarray(i, i + 1), (line) => allLines.push(line));
    }
    framer.flushRemaining((line) => allLines.push(line));
    expect(allLines.length).toBe(1);
    expect(allLines[0]).toBe(chars);
    expect(allLines[0]).not.toContain('\uFFFD');
  });
});

describe('BoundedLineFramer - invalid UTF-8 fatal decoding', () => {
  it('drops an invalid UTF-8 record and sets wasLineDropped', () => {
    const framer = new BoundedLineFramer();
    const lines = feedCollect(framer, Buffer.from([0xff, 0xfe, 0x0a]));
    expect(lines).toEqual([]);
    expect(framer.wasLineDropped).toBe(true);
  });

  it('does not emit U+FFFD for invalid bytes', () => {
    const framer = new BoundedLineFramer();
    const lines: string[] = [];
    framer.feedChunk(Buffer.from([0xff, 0x0a]), (line) => {
      expect(line).not.toContain('\uFFFD');
      lines.push(line);
    });
    expect(lines).toEqual([]);
    expect(framer.wasLineDropped).toBe(true);
  });

  it('continues parsing after dropping an invalid record', () => {
    const framer = new BoundedLineFramer();
    const lines = feedCollect(
      framer,
      Buffer.from([0xff, 0x0a, 0x67, 0x6f, 0x6f, 0x64, 0x0a]),
    );
    expect(lines).toEqual(['good']);
    expect(framer.wasLineDropped).toBe(true);
  });

  it('flushRemaining drops an invalid unterminated partial', () => {
    const framer = new BoundedLineFramer();
    feedCollect(framer, Buffer.from([0xff, 0xfe]));
    expect(flushCollect(framer)).toEqual([]);
    expect(framer.wasLineDropped).toBe(true);
  });
});

describe('BoundedLineFramer - oversized line discard', () => {
  it('discards an oversized record continuously until its real LF delimiter', () => {
    const framer = new BoundedLineFramer({ maxLineBytes: 50 });
    feedCollect(framer, Buffer.alloc(100, 65));
    const lines = feedCollect(
      framer,
      Buffer.from('phantom_match:42:data\ngenuine_line\n'),
    );
    expect(lines).toEqual(['genuine_line']);
    expect(lines).not.toContain('phantom_match:42:data');
    expect(framer.wasLineDropped).toBe(true);
  });

  it('discards across many tiny chunks until the delimiter', () => {
    const framer = new BoundedLineFramer({ maxLineBytes: 20 });
    for (let i = 0; i < 10; i++) {
      feedCollect(framer, Buffer.alloc(3, 65));
    }
    expect(framer.wasLineDropped).toBe(true);
    const lines = feedCollect(framer, Buffer.from('\nreal\n'));
    expect(lines).toEqual(['real']);
  });

  it('does not emit any suffix of an oversized record from flushRemaining', () => {
    const framer = new BoundedLineFramer({ maxLineBytes: 10 });
    feedCollect(framer, Buffer.alloc(30, 65));
    expect(flushCollect(framer)).toEqual([]);
    expect(framer.wasLineDropped).toBe(true);
  });

  it('emits a new record after the oversized one is fully discarded', () => {
    const framer = new BoundedLineFramer({ maxLineBytes: 10 });
    feedCollect(framer, Buffer.alloc(20, 65));
    const lines = feedCollect(framer, Buffer.from('\ngood\n'));
    expect(lines).toEqual(['good']);
    expect(framer.wasLineDropped).toBe(true);
  });

  it('keeps a partial line exactly at the limit', () => {
    const framer = new BoundedLineFramer({ maxLineBytes: 10 });
    feedCollect(framer, Buffer.alloc(10, 65));
    expect(framer.wasLineDropped).toBe(false);
    const lines = feedCollect(framer, Buffer.from('\n'));
    expect(lines).toEqual([Buffer.alloc(10, 65).toString()]);
  });

  it('rejects maxLineBytes+1 content bytes', () => {
    const framer = new BoundedLineFramer({ maxLineBytes: 10 });
    feedCollect(framer, Buffer.alloc(11, 65));
    expect(framer.wasLineDropped).toBe(true);
    const lines = feedCollect(framer, Buffer.from('\ngood\n'));
    expect(lines).toEqual(['good']);
  });

  it('accepts exactly maxLineBytes content with CRLF terminator', () => {
    const framer = new BoundedLineFramer({ maxLineBytes: 10 });
    const content = Buffer.alloc(10, 65);
    feedCollect(framer, content);
    expect(framer.wasLineDropped).toBe(false);
    const lines = feedCollect(framer, Buffer.from('\r\n'));
    expect(lines).toEqual([content.toString()]);
    expect(framer.wasLineDropped).toBe(false);
  });

  it('accepts exactly maxLineBytes content with CRLF split across chunks', () => {
    const framer = new BoundedLineFramer({ maxLineBytes: 10 });
    const content = Buffer.alloc(10, 65);
    feedCollect(framer, content);
    const first = feedCollect(framer, Buffer.from('\r'));
    const second = feedCollect(framer, Buffer.from('\n'));
    expect([...first, ...second]).toEqual([content.toString()]);
    expect(framer.wasLineDropped).toBe(false);
  });

  it('discards maxLineBytes+1 content with CRLF terminator', () => {
    const framer = new BoundedLineFramer({ maxLineBytes: 10 });
    feedCollect(framer, Buffer.alloc(11, 65));
    expect(framer.wasLineDropped).toBe(true);
    const lines = feedCollect(framer, Buffer.from('\r\ngood\r\n'));
    expect(lines).toEqual(['good']);
  });

  it('handles multiple oversized records in sequence', () => {
    const framer = new BoundedLineFramer({ maxLineBytes: 10 });
    feedCollect(framer, Buffer.alloc(20, 65));
    feedCollect(framer, Buffer.from('\n'));
    feedCollect(framer, Buffer.alloc(20, 66));
    const lines = feedCollect(framer, Buffer.from('\nok\n'));
    expect(lines).toEqual(['ok']);
    expect(framer.wasLineDropped).toBe(true);
  });
});

describe('BoundedLineFramer - callback safety', () => {
  it('resets internal state before invoking callback so reentrancy cannot corrupt', () => {
    const framer = new BoundedLineFramer();
    const seen: string[] = [];
    framer.feedChunk(Buffer.from('first\nsecond\n'), (line) => {
      seen.push(line);
      framer.feedChunk(Buffer.from('inner\n'), (rl) => seen.push(rl));
    });
    expect(seen).toEqual(['first', 'inner', 'second', 'inner']);
  });

  it('survives a throwing callback without corrupting state', () => {
    const framer = new BoundedLineFramer();
    let callCount = 0;
    expect(() => {
      framer.feedChunk(Buffer.from('a\nb\n'), () => {
        callCount++;
        if (callCount === 1) throw new Error('boom');
      });
    }).toThrow('boom');
    expect(callCount).toBe(1);
    const lines = feedCollect(framer, Buffer.from('c\n'));
    expect(lines).toEqual(['c']);
  });
});

describe('BoundedLineFramer - maxLineBytes validation', () => {
  it('throws RangeError for zero', () => {
    expect(() => new BoundedLineFramer({ maxLineBytes: 0 })).toThrow(
      RangeError,
    );
  });

  it('throws RangeError for negative', () => {
    expect(() => new BoundedLineFramer({ maxLineBytes: -1 })).toThrow(
      RangeError,
    );
  });

  it('throws RangeError for NaN', () => {
    expect(() => new BoundedLineFramer({ maxLineBytes: NaN })).toThrow(
      RangeError,
    );
  });

  it('throws RangeError for Infinity', () => {
    expect(() => new BoundedLineFramer({ maxLineBytes: Infinity })).toThrow(
      RangeError,
    );
  });

  it('throws RangeError for fractional', () => {
    expect(() => new BoundedLineFramer({ maxLineBytes: 1.5 })).toThrow(
      RangeError,
    );
  });

  it('throws RangeError for unsafe integer', () => {
    expect(
      () =>
        new BoundedLineFramer({ maxLineBytes: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow(RangeError);
  });

  it('throws RangeError for value exceeding hard cap', () => {
    expect(
      () => new BoundedLineFramer({ maxLineBytes: 17 * 1024 * 1024 }),
    ).toThrow(RangeError);
  });

  it('accepts the default', () => {
    expect(() => new BoundedLineFramer()).not.toThrow();
  });

  it('accepts a valid positive safe integer', () => {
    expect(() => new BoundedLineFramer({ maxLineBytes: 42 })).not.toThrow();
  });
});

describe('BoundedLineFramer - grep-like output', () => {
  it('parses git-grep style lines incrementally', () => {
    const framer = new BoundedLineFramer();
    const output = Buffer.from(
      'src/index.ts:1:const x = 1;\nsrc/util.ts:5:export function foo() {\n',
    );
    expect(feedCollect(framer, output)).toEqual([
      'src/index.ts:1:const x = 1;',
      'src/util.ts:5:export function foo() {',
    ]);
  });

  it('handles a huge single line then many small lines (bounded)', () => {
    const framer = new BoundedLineFramer({ maxLineBytes: 1024 * 1024 });
    const huge = 'x'.repeat(100_000) + '\n';
    let smalls = '';
    for (let i = 0; i < 1000; i++) {
      smalls += `file.ts:${i}:match\n`;
    }
    const lines = feedCollect(framer, Buffer.from(huge + smalls));
    expect(lines.length).toBe(1001);
    expect(lines[0].length).toBe(100_000);
    expect(lines[1]).toBe('file.ts:0:match');
    expect(framer.wasLineDropped).toBe(false);
  });

  it('does not materialize the full stream as a single array (callback API)', () => {
    const framer = new BoundedLineFramer();
    const seen: string[] = [];
    const output = Buffer.from(
      Array.from({ length: 500 }, (_, i) => `line${i}`).join('\n') + '\n',
    );
    framer.feedChunk(output, (line) => seen.push(line));
    expect(seen.length).toBe(500);
    expect(seen[0]).toBe('line0');
    expect(seen[499]).toBe('line499');
  });
});

describe('BoundedLineFramer - adversarial large chunks', () => {
  it('handles a single chunk much larger than maxLineBytes with many lines', () => {
    const maxLineBytes = 1024;
    const framer = new BoundedLineFramer({ maxLineBytes });
    const lineCount = 5000;
    const parts: string[] = [];
    for (let i = 0; i < lineCount; i++) {
      parts.push(`file_${i}.ts:${i}:match_content_${i}`);
    }
    const big = Buffer.from(parts.join('\n') + '\n');
    const lines = feedCollect(framer, big);
    expect(lines.length).toBe(lineCount);
    expect(lines[0]).toBe('file_0.ts:0:match_content_0');
    expect(lines[lineCount - 1]).toBe(
      `file_${lineCount - 1}.ts:${lineCount - 1}:match_content_${lineCount - 1}`,
    );
    expect(framer.wasLineDropped).toBe(false);
  });

  it('handles a pathological chunk with no newlines larger than maxLineBytes', () => {
    const maxLineBytes = 100;
    const framer = new BoundedLineFramer({ maxLineBytes });
    const huge = Buffer.alloc(maxLineBytes * 100, 65);
    feedCollect(framer, huge);
    expect(framer.wasLineDropped).toBe(true);
    const lines = feedCollect(framer, Buffer.from('\nrecovered\n'));
    expect(lines).toEqual(['recovered']);
  });

  it('handles alternating huge and normal lines in one chunk', () => {
    const maxLineBytes = 50;
    const framer = new BoundedLineFramer({ maxLineBytes });
    const parts: Buffer[] = [
      Buffer.alloc(200, 65),
      Buffer.from('\n'),
      Buffer.from('ok_line\n'),
      Buffer.alloc(200, 66),
      Buffer.from('\n'),
      Buffer.from('done\n'),
    ];
    const lines = feedCollect(framer, Buffer.concat(parts));
    expect(lines).toEqual(['ok_line', 'done']);
    expect(framer.wasLineDropped).toBe(true);
  });

  it('bulk-copies a multi-MB chunk of small lines without corruption', () => {
    const framer = new BoundedLineFramer();
    const lineCount = 10000;
    const parts: string[] = [];
    for (let i = 0; i < lineCount; i++) {
      parts.push(`${i}`);
    }
    const big = Buffer.from(parts.join('\n') + '\n');
    const lines = feedCollect(framer, big);
    expect(lines.length).toBe(lineCount);
    for (let i = 0; i < lineCount; i++) {
      expect(lines[i]).toBe(String(i));
    }
  });
});
