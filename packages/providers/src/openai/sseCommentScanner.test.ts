/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createSseCommentScanner } from './sseCommentScanner.js';

/** Feed the given text chunks through a fresh scanner and count comments. */
function countComments(chunks: readonly string[]): number {
  let comments = 0;
  const scan = createSseCommentScanner(() => {
    comments += 1;
  });
  const encoder = new TextEncoder();
  for (const chunk of chunks) scan(encoder.encode(chunk));
  return comments;
}

describe('createSseCommentScanner', () => {
  it('reports each complete keepalive comment line', () => {
    expect(countComments([': keepalive\n\n', ': keepalive\n\n'])).toBe(2);
  });

  it('reports a comment line split across chunks once, when the line ends', () => {
    expect(countComments([': keep'])).toBe(0);
    expect(countComments([': keep', 'alive', '\n'])).toBe(1);
  });

  it('recognizes CR and CRLF line endings, including a CRLF split across chunks', () => {
    expect(countComments([':a\r:b\r\n', ':c\r', '\n'])).toBe(3);
  });

  it('ignores data, event and id fields, including values that contain a colon', () => {
    expect(
      countComments([
        'event: message\ndata: {"a":":b"}\nid: 1\n\ndata: [DONE]\n\n',
      ]),
    ).toBe(0);
  });

  it('ignores a colon that is not the first character of a line', () => {
    expect(countComments([' : not a comment\n', 'x:\n'])).toBe(0);
  });

  it('finds comments interleaved with data events in one chunk', () => {
    expect(
      countComments([': ping\n\ndata: {"x":1}\n\n:\n\ndata: [DONE]\n\n']),
    ).toBe(2);
  });
});
