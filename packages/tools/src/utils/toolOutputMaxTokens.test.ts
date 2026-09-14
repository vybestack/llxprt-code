/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { parseToolOutputMaxTokens } from './toolOutputMaxTokens.js';

describe('parseToolOutputMaxTokens', () => {
  it.each([undefined, null])(
    'defaults unset value %s to 50000 tokens',
    (raw) => {
      expect(parseToolOutputMaxTokens(raw)).toStrictEqual({
        kind: 'limited',
        maxTokens: 50000,
      });
    },
  );

  it.each([75000, -5, 0.5, Infinity])('preserves numeric limit %s', (raw) => {
    expect(parseToolOutputMaxTokens(raw)).toStrictEqual({
      kind: 'limited',
      maxTokens: raw,
    });
  });

  it.each([0, NaN, false, '', '50', 'abc', true, {}])(
    'disables the limit for %s',
    (raw) => {
      expect(parseToolOutputMaxTokens(raw)).toStrictEqual({ kind: 'disabled' });
    },
  );
});
