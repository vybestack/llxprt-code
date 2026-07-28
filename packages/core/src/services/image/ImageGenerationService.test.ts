/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  ImageValidationError,
  validateImagePrompt,
} from './ImageGenerationService.js';

describe('validateImagePrompt', () => {
  it('throws ImageValidationError for an empty string', () => {
    expect(() => validateImagePrompt('')).toThrow(ImageValidationError);
  });

  it('throws ImageValidationError for a whitespace-only string', () => {
    expect(() => validateImagePrompt('   \t\n  ')).toThrow(
      ImageValidationError,
    );
  });

  // String(null)/String(undefined) produce the literal words "null"/"undefined",
  // which are non-empty strings. The validator correctly accepts them; the A4
  // contract is about empty/whitespace rejection, not JavaScript coercion
  // semantics. These tests document that boundary.
  it('accepts the literal string "null" produced by String(null)', () => {
    expect(() => validateImagePrompt(String(null))).not.toThrow();
  });

  it('accepts the literal string "undefined" produced by String(undefined)', () => {
    expect(() => validateImagePrompt(String(undefined))).not.toThrow();
  });

  it('accepts a normal prompt without throwing', () => {
    expect(() => validateImagePrompt('a cat wearing a tiny hat')).not.toThrow();
  });

  it('accepts a prompt with leading and trailing whitespace', () => {
    expect(() =>
      validateImagePrompt('   a cat wearing a tiny hat   '),
    ).not.toThrow();
  });

  it('produces a message describing the validation failure', () => {
    const error = (() => {
      try {
        validateImagePrompt('   ');
        return null;
      } catch (err) {
        return err;
      }
    })();
    expect(error).toBeInstanceOf(ImageValidationError);
    expect((error as Error).message).toMatch(/prompt/i);
  });
});
