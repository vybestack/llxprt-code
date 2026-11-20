/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { encoding_for_model } from '@dqbd/tiktoken';
import {
  EncodingCache,
  encodingLongTextCounter,
} from './neutral-long-piece.js';

describe('owned neutral encoding cache', () => {
  it('shares vocabulary and counters within an owner without sharing between owners', () => {
    const first = new EncodingCache();
    const second = new EncodingCache();
    const vocabularies = new Set([
      first.ranks('o200k_base'),
      first.ranks('o200k_base'),
      second.ranks('o200k_base'),
      second.ranks('o200k_base'),
    ]);
    expect(vocabularies.size).toBe(2);
    const counters = new Set([
      encodingLongTextCounter('o200k_base', first),
      encodingLongTextCounter('o200k_base', first),
      encodingLongTextCounter('o200k_base', second),
      encodingLongTextCounter('o200k_base', second),
    ]);
    expect(counters.size).toBe(2);
    const counter = encodingLongTextCounter('o200k_base', first);
    const oracle = encoding_for_model('gpt-4o');
    try {
      const text = 'history 雪 '.repeat(1024);
      expect(counter(text, (piece) => oracle.encode(piece).length)).toBe(
        oracle.encode(text).length,
      );
    } finally {
      oracle.free();
    }
  });
});
