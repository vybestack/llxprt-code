/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  detectImageMode,
  isImageModeActive,
  validateImageModeArgs,
  ImageModeError,
} from './imageMode.js';

describe('isImageModeActive', () => {
  it('returns false when no image flags are present', () => {
    expect(isImageModeActive({})).toBe(false);
    expect(isImageModeActive({ prompt: 'hi', model: 'gpt' } as never)).toBe(
      false,
    );
  });

  it('returns true when --image-output is present', () => {
    expect(isImageModeActive({ imageOutput: 'cat.png' })).toBe(true);
  });

  it('returns true when --image-prompt is present', () => {
    expect(isImageModeActive({ imagePrompt: 'draw a cat' })).toBe(true);
  });

  it('returns true when --image-input is present', () => {
    expect(isImageModeActive({ imageInput: ['in.png'] })).toBe(true);
  });

  it('returns true when any combination is present', () => {
    expect(
      isImageModeActive({
        imageOutput: 'cat.png',
        imageInput: ['a.png'],
        imagePrompt: 'edit',
      }),
    ).toBe(true);
  });
});

describe('detectImageMode', () => {
  it('returns null when no image flags are present', () => {
    expect(detectImageMode({})).toBeNull();
  });

  it('returns a validated request when all required flags are present', () => {
    expect(
      detectImageMode({
        imageOutput: 'cat.png',
        imagePrompt: 'draw a cat',
      }),
    ).not.toBeNull();
  });
});

describe('validateImageModeArgs', () => {
  it('requires both output and prompt', () => {
    expect(() => validateImageModeArgs({ imageOutput: 'cat.png' })).toThrow(
      ImageModeError,
    );
    expect(() => validateImageModeArgs({ imagePrompt: 'draw' })).toThrow(
      ImageModeError,
    );
  });

  it('passes with output + prompt (generate)', () => {
    const result = validateImageModeArgs({
      imageOutput: 'cat.png',
      imagePrompt: 'draw a cat',
    });
    expect(result.operation).toBe('generate');
    expect(result.outputPath).toBe('cat.png');
    expect(result.prompt).toBe('draw a cat');
    expect(result.inputPaths).toStrictEqual([]);
  });

  it('passes with output + prompt + inputs (edit)', () => {
    const result = validateImageModeArgs({
      imageOutput: 'out.png',
      imagePrompt: 'add a mouse',
      imageInput: ['in.png'],
    });
    expect(result.operation).toBe('edit');
    expect(result.inputPaths).toStrictEqual(['in.png']);
  });

  it('preserves input order without comma-splitting', () => {
    const result = validateImageModeArgs({
      imageOutput: 'out.png',
      imagePrompt: 'edit',
      imageInput: ['a.png', 'b.png', 'c.png'],
    });
    expect(result.inputPaths).toStrictEqual(['a.png', 'b.png', 'c.png']);
  });

  it('rejects more than five inputs', () => {
    expect(() =>
      validateImageModeArgs({
        imageOutput: 'out.png',
        imagePrompt: 'edit',
        imageInput: ['a', 'b', 'c', 'd', 'e', 'f'],
      }),
    ).toThrow(/at most 5/i);
  });

  it('rejects a non-png output', () => {
    expect(() =>
      validateImageModeArgs({
        imageOutput: 'out.jpg',
        imagePrompt: 'draw',
      }),
    ).toThrow(/png/i);
  });

  it('rejects conflict with positional prompt', () => {
    expect(() =>
      validateImageModeArgs(
        {
          imageOutput: 'out.png',
          imagePrompt: 'draw',
        },
        { positionalPrompt: 'some text' },
      ),
    ).toThrow(/mutually exclusive|conflict/i);
  });

  it('rejects conflict with --prompt', () => {
    expect(() =>
      validateImageModeArgs(
        {
          imageOutput: 'out.png',
          imagePrompt: 'draw',
        },
        { prompt: 'other' },
      ),
    ).toThrow(/mutually exclusive|conflict/i);
  });

  it('rejects conflict with --prompt-interactive', () => {
    expect(() =>
      validateImageModeArgs(
        {
          imageOutput: 'out.png',
          imagePrompt: 'draw',
        },
        { promptInteractive: 'other' },
      ),
    ).toThrow(/mutually exclusive|conflict/i);
  });

  it('rejects stream-json output format', () => {
    expect(() =>
      validateImageModeArgs(
        {
          imageOutput: 'out.png',
          imagePrompt: 'draw',
        },
        { outputFormat: 'stream-json' },
      ),
    ).toThrow(/stream-json/i);
  });
});
