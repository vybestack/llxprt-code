/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { toLosslessTextDelta } from './textDelta.js';

describe('toLosslessTextDelta', () => {
  it('returns undefined for the truly empty string', () => {
    expect(toLosslessTextDelta('')).toBeUndefined();
  });

  it('preserves a standalone newline', () => {
    expect(toLosslessTextDelta('\n')).toBe('\n');
  });

  it('preserves a standalone space', () => {
    expect(toLosslessTextDelta(' ')).toBe(' ');
  });

  it('preserves a standalone tab', () => {
    expect(toLosslessTextDelta('\t')).toBe('\t');
  });

  it('preserves standalone whitespace-only content (multiple)', () => {
    expect(toLosslessTextDelta('  \n\t ')).toBe('  \n\t ');
  });

  it('preserves non-whitespace text', () => {
    expect(toLosslessTextDelta('hello world')).toBe('hello world');
  });

  it('preserves text with embedded newlines', () => {
    expect(toLosslessTextDelta('line1\nline2')).toBe('line1\nline2');
  });

  it('preserves a leading newline before text', () => {
    expect(toLosslessTextDelta('\nhello')).toBe('\nhello');
  });

  it('normalizes a lone CR to LF', () => {
    expect(toLosslessTextDelta('hello\r')).toBe('hello\n');
  });

  it('normalizes CRLF to LF', () => {
    expect(toLosslessTextDelta('hello\r\nworld')).toBe('hello\nworld');
  });

  it('normalizes CR-only line endings in a standalone newline chunk', () => {
    expect(toLosslessTextDelta('\r')).toBe('\n');
  });

  it('normalizes CRLF standalone newline chunk to LF', () => {
    expect(toLosslessTextDelta('\r\n')).toBe('\n');
  });

  it('does not invent separators at chunk boundaries', () => {
    const first = toLosslessTextDelta('foo');
    const second = toLosslessTextDelta('bar');
    const accumulated = `${first ?? ''}${second ?? ''}`;
    expect(accumulated).toBe('foobar');
  });

  it('does not trim surrounding whitespace from text deltas', () => {
    expect(toLosslessTextDelta('  spaced  ')).toBe('  spaced  ');
  });
});
