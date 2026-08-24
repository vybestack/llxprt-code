/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { createKeypressPipeline, PASTE_TIMEOUT } from './KeypressContext.js';

type ParsedKey = {
  name: string;
  sequence: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  insertable?: boolean;
};

const feed = (chunks: string[]): ParsedKey[] => {
  const keys: ParsedKey[] = [];
  const push = createKeypressPipeline((k) => keys.push(k));
  for (const chunk of chunks) push(chunk);
  return keys;
};

describe('bracketed paste decoding (AC4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('encapsulates the payload in a single paste key with no per-character keys (AC4.1)', () => {
    const keys = feed(['\x1b[200~hello\x1b[201~']);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toStrictEqual({
      name: 'paste',
      shift: false,
      meta: false,
      ctrl: false,
      sequence: 'hello',
      insertable: true,
    });
  });

  it('an empty paste emits no key at all (AC4.2)', () => {
    const keys = feed(['\x1b[200~\x1b[201~']);
    expect(keys).toHaveLength(0);
  });

  it('reassembles a control-sequence-looking payload verbatim (AC4.3)', () => {
    const keys = feed(['\x1b[200~\x1b[A\x1b[201~']);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toStrictEqual({
      name: 'paste',
      shift: false,
      meta: false,
      ctrl: false,
      sequence: '\x1b[A',
      insertable: true,
    });
  });

  it('preserves newlines and tabs byte-for-byte (AC4.4)', () => {
    const keys = feed(['\x1b[200~line1\n\tline2\x1b[201~']);
    expect(keys).toHaveLength(1);
    expect(keys[0]?.sequence).toBe('line1\n\tline2');
  });
  it('keeps a trailing CR inside the payload instead of a separate return key (AC4.5)', () => {
    const keys = feed(['\x1b[200~x\r\x1b[201~']);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toStrictEqual({
      name: 'paste',
      shift: false,
      meta: false,
      ctrl: false,
      sequence: 'x\r',
      insertable: true,
    });
  });
  it('after PASTE_TIMEOUT with no end marker the payload is still flushed (AC4.6)', () => {
    const flushed = feed(['\x1b[200~stuck']);
    // The end marker never arrives, so nothing is delivered while the paste
    // buffer is still open.
    expect(flushed).toHaveLength(0);

    vi.advanceTimersByTime(PASTE_TIMEOUT);

    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toStrictEqual({
      name: 'paste',
      shift: false,
      meta: false,
      ctrl: false,
      sequence: 'stuck',
      insertable: true,
    });
  });
});
