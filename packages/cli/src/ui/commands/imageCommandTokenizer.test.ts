/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  tokenizeImageCommand,
  parseImageCommand,
  ImageCommandParseError,
} from './imageCommandTokenizer.js';

describe('tokenizeImageCommand', () => {
  it('tokenizes a simple output path and double-quoted prompt', () => {
    expect(tokenizeImageCommand('out.png "a cat"')).toStrictEqual([
      'out.png',
      'a cat',
    ]);
  });

  it('tokenizes single-quoted prompt', () => {
    expect(tokenizeImageCommand("out.png 'a cat'")).toStrictEqual([
      'out.png',
      'a cat',
    ]);
  });

  it('tokenizes quoted paths with spaces', () => {
    expect(
      tokenizeImageCommand('"my output.png" "my input.png" "a prompt"'),
    ).toStrictEqual(['my output.png', 'my input.png', 'a prompt']);
  });

  it('handles escaped quotes inside double-quoted strings', () => {
    expect(tokenizeImageCommand('out.png "say \\"hello\\""')).toStrictEqual([
      'out.png',
      'say "hello"',
    ]);
  });

  it('handles escaped quotes inside single-quoted strings', () => {
    expect(tokenizeImageCommand("out.png 'say \\'hello\\''")).toStrictEqual([
      'out.png',
      "say 'hello'",
    ]);
  });

  it('treats backslash before non-quote as literal backslash', () => {
    expect(tokenizeImageCommand('out.png "C:\\\\path"')).toStrictEqual([
      'out.png',
      'C:\\path',
    ]);
  });

  it('rejects unterminated double quote', () => {
    expect(() => tokenizeImageCommand('out.png "unterminated')).toThrow(
      ImageCommandParseError,
    );
  });

  it('rejects unterminated single quote', () => {
    expect(() => tokenizeImageCommand("out.png 'unterminated")).toThrow(
      ImageCommandParseError,
    );
  });

  it('returns empty array for empty/whitespace input', () => {
    expect(tokenizeImageCommand('')).toStrictEqual([]);
    expect(tokenizeImageCommand('   ')).toStrictEqual([]);
  });

  it('tokenizes unquoted single tokens', () => {
    expect(tokenizeImageCommand('out.png input.png prompt_word')).toStrictEqual(
      ['out.png', 'input.png', 'prompt_word'],
    );
  });
});

describe('parseImageCommand', () => {
  it('parses a generate command (output + quoted prompt)', () => {
    const result = parseImageCommand('out.png "draw a cat"');
    expect(result.outputPath).toBe('out.png');
    expect(result.inputPaths).toStrictEqual([]);
    expect(result.prompt).toBe('draw a cat');
    expect(result.operation).toBe('generate');
  });

  it('parses an edit command (output + input + quoted prompt)', () => {
    const result = parseImageCommand('fixed.png original.png "fix the text"');
    expect(result.outputPath).toBe('fixed.png');
    expect(result.inputPaths).toStrictEqual(['original.png']);
    expect(result.prompt).toBe('fix the text');
    expect(result.operation).toBe('edit');
  });

  it('parses multiple inputs', () => {
    const result = parseImageCommand(
      'comp.png subj.png bg.png "compose the images"',
    );
    expect(result.outputPath).toBe('comp.png');
    expect(result.inputPaths).toStrictEqual(['subj.png', 'bg.png']);
    expect(result.operation).toBe('edit');
  });

  it('rejects missing output path', () => {
    expect(() => parseImageCommand('"just a prompt"')).toThrow(/output path/i);
  });

  it('rejects missing prompt (only output)', () => {
    expect(() => parseImageCommand('out.png')).toThrow(/prompt/i);
  });

  it('rejects an unquoted multiword prompt', () => {
    expect(() => parseImageCommand('out.png draw a cat')).toThrow(/quote/i);
  });

  it('rejects an unterminated quote', () => {
    expect(() => parseImageCommand('out.png "unterminated')).toThrow(
      ImageCommandParseError,
    );
  });

  it('rejects more than five inputs', () => {
    expect(() =>
      parseImageCommand(
        'out.png a.png b.png c.png d.png e.png f.png "too many"',
      ),
    ).toThrow(/five/i);
  });

  it('rejects unexpected trailing arguments after the prompt', () => {
    expect(() => parseImageCommand('out.png "a prompt" trailing')).toThrow(
      /trailing/i,
    );
  });

  it('rejects -- separator', () => {
    expect(() => parseImageCommand('-- out.png "prompt"')).toThrow(/usage/i);
  });

  it('preserves spaces in quoted paths and prompt', () => {
    const result = parseImageCommand(
      '"my output file.png" "my input.png" "a cat with a hat"',
    );
    expect(result.outputPath).toBe('my output file.png');
    expect(result.inputPaths).toStrictEqual(['my input.png']);
    expect(result.prompt).toBe('a cat with a hat');
  });

  it('accepts a single-word unquoted prompt (degenerate but valid)', () => {
    const result = parseImageCommand('out.png cat');
    expect(result.prompt).toBe('cat');
    expect(result.operation).toBe('generate');
  });
});
