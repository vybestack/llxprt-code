/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { toLosslessTextDelta, createStreamNormalizer } from './textDelta.js';

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

describe('createStreamNormalizer', () => {
  it('returns undefined for the truly empty string', () => {
    const n = createStreamNormalizer();
    expect(n.push('')).toBeUndefined();
  });

  it('preserves plain text content exactly', () => {
    const n = createStreamNormalizer();
    expect(n.push('hello world')).toBe('hello world');
  });

  it('preserves standalone whitespace (space, tab, newline)', () => {
    const n = createStreamNormalizer();
    expect(n.push(' ')).toBe(' ');
    expect(n.push('\t')).toBe('\t');
    expect(n.push('\n')).toBe('\n');
  });

  it('normalizes CRLF within a single delta', () => {
    const n = createStreamNormalizer();
    expect(n.push('hello\r\nworld')).toBe('hello\nworld');
  });

  it('preserves CRLF semantics across split chunk boundaries (a\\r then \\nb)', () => {
    const n = createStreamNormalizer();
    expect(n.push('a\r')).toBe('a');
    expect(n.push('\nb')).toBe('\nb');
  });

  it('does not invent an extra newline when CR is split from following LF', () => {
    const n = createStreamNormalizer();
    const accumulated = [n.push('a\r') ?? '', n.push('\nb') ?? ''].join('');
    expect(accumulated).toBe('a\nb');
    expect(n.flush()).toBeUndefined();
  });

  it('treats a lone CR followed by non-LF content as CR→LF then content', () => {
    const n = createStreamNormalizer();
    expect(n.push('a\r')).toBe('a');
    expect(n.push('b')).toBe('\nb');
  });

  it('flushes a pending CR as LF when the stream closes (ending in lone CR)', () => {
    const n = createStreamNormalizer();
    expect(n.push('hello\r')).toBe('hello');
    expect(n.flush()).toBe('\n');
  });

  it('returns undefined from flush when there is no pending CR', () => {
    const n = createStreamNormalizer();
    expect(n.flush()).toBeUndefined();
  });

  it('handles multiple consecutive CRLFs split across boundaries', () => {
    const n = createStreamNormalizer();
    expect(n.push('x\r\n\r')).toBe('x\n');
    expect(n.push('\ny')).toBe('\ny');
    expect(n.flush()).toBeUndefined();
  });

  it('accumulates the exact issue sequence losslessly', () => {
    const n = createStreamNormalizer();
    const parts = [
      'Analyzing the codebase...',
      '\n',
      'Found 3 issues:',
      '\n',
      '1. Missing import',
    ];
    const accumulated = parts.map((p) => n.push(p) ?? '').join('');
    expect(accumulated).toBe(
      'Analyzing the codebase...\nFound 3 issues:\n1. Missing import',
    );
  });

  it('does not invent separators at word-token fragment boundaries', () => {
    const n = createStreamNormalizer();
    const accumulated = ('Hello World'.match(/(\w+|\s)/g) ?? [])
      .map((t) => n.push(t) ?? '')
      .join('');
    expect(accumulated).toBe('Hello World');
  });

  it('normalizes CR/CRLF in a multi-delta stream ending with standalone whitespace', () => {
    const n = createStreamNormalizer();
    expect(n.push('a')).toBe('a');
    expect(n.push(' ')).toBe(' ');
    expect(n.push('b')).toBe('b');
    expect(n.push('\t')).toBe('\t');
    expect(n.push('c')).toBe('c');
    expect(n.push('\r')).toBeUndefined();
    expect(n.push('d\r\ne')).toBe('\nd\ne');
    expect(n.flush()).toBeUndefined();
  });

  it('treats an empty delta as a transport no-op even while a CR is pending', () => {
    const n = createStreamNormalizer();
    expect(n.push('a\r')).toBe('a');
    expect(n.push('')).toBeUndefined();
    expect(n.push('\nb')).toBe('\nb');
    expect(n.flush()).toBeUndefined();
  });

  it('survives repeated empty deltas while a CR is pending without emitting LF', () => {
    const n = createStreamNormalizer();
    expect(n.push('a\r')).toBe('a');
    expect(n.push('')).toBeUndefined();
    expect(n.push('')).toBeUndefined();
    expect(n.push('')).toBeUndefined();
    expect(n.push('\nb')).toBe('\nb');
    expect(n.flush()).toBeUndefined();
  });

  it('flushes a pending CR exactly once; repeated flush yields undefined', () => {
    const n = createStreamNormalizer();
    expect(n.push('hello\r')).toBe('hello');
    expect(n.flush()).toBe('\n');
    expect(n.flush()).toBeUndefined();
    expect(n.flush()).toBeUndefined();
  });

  it('handles internal CR/CRLF plus a trailing CR that is later consumed by LF', () => {
    const n = createStreamNormalizer();
    expect(n.push('x\ry\r\nz\r')).toBe('x\ny\nz');
    expect(n.push('\nw')).toBe('\nw');
    expect(n.flush()).toBeUndefined();
  });

  it('accumulates whitespace-only chunks without inventing separators', () => {
    const n = createStreamNormalizer();
    expect(n.push(' ')).toBe(' ');
    expect(n.push('\t')).toBe('\t');
    expect(n.push('\n')).toBe('\n');
    expect(n.flush()).toBeUndefined();
  });

  it('full-stream accumulation across the issue sequence produces no double newline', () => {
    const n = createStreamNormalizer();
    const accumulated = ['a\r', '', '\nb'].map((p) => n.push(p) ?? '').join('');
    expect(accumulated).toBe('a\nb');
  });

  it('provides independent state across separate instances', () => {
    const a = createStreamNormalizer();
    const b = createStreamNormalizer();
    expect(a.push('a\r')).toBe('a');
    expect(b.push('x')).toBe('x');
    expect(a.flush()).toBe('\n');
    expect(b.flush()).toBeUndefined();
  });
});
