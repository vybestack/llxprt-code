/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  GEMINI_MODEL_ALIAS_PRO,
  GEMINI_MODEL_ALIAS_FLASH,
  GEMINI_MODEL_ALIAS_FLASH_LITE,
  PREVIEW_GEMINI_MODEL,
  resolveModel,
  isGemini2Model,
} from '../models.js';

describe('model alias constants', () => {
  it('GEMINI_MODEL_ALIAS_PRO is defined', () => {
    expect(GEMINI_MODEL_ALIAS_PRO).toBe('gemini-pro');
  });

  it('GEMINI_MODEL_ALIAS_FLASH is defined', () => {
    expect(GEMINI_MODEL_ALIAS_FLASH).toBe('gemini-flash');
  });

  it('GEMINI_MODEL_ALIAS_FLASH_LITE is defined', () => {
    expect(GEMINI_MODEL_ALIAS_FLASH_LITE).toBe('gemini-flash-lite');
  });

  it('PREVIEW_GEMINI_MODEL is defined', () => {
    expect(PREVIEW_GEMINI_MODEL).toBe('gemini-3-pro-preview');
  });
});

describe('resolveModel()', () => {
  it('resolves gemini-pro alias to DEFAULT_GEMINI_MODEL when preview disabled', () => {
    const result = resolveModel('gemini-pro', false);
    expect(result).toBe('gemini-2.5-pro');
  });

  it('resolves gemini-flash alias to DEFAULT_GEMINI_FLASH_MODEL', () => {
    const result = resolveModel('gemini-flash', false);
    expect(result).toBe('gemini-2.5-flash');
  });

  it('resolves gemini-flash-lite alias to DEFAULT_GEMINI_FLASH_LITE_MODEL', () => {
    const result = resolveModel('gemini-flash-lite', false);
    expect(result).toBe('gemini-2.5-flash-lite');
  });

  it('returns model as-is when not an alias', () => {
    const result = resolveModel('custom-model-v1', false);
    expect(result).toBe('custom-model-v1');
  });

  it('resolves gemini-pro to preview model when preview enabled', () => {
    const result = resolveModel('gemini-pro', true);
    expect(result).toBe('gemini-3-pro-preview');
  });
});

describe('isGemini2Model()', () => {
  it('returns true for gemini-2.5-pro', () => {
    expect(isGemini2Model('gemini-2.5-pro')).toBe(true);
  });

  it('returns true for gemini-2.5-flash', () => {
    expect(isGemini2Model('gemini-2.5-flash')).toBe(true);
  });

  it('returns false for gemini-3-pro-preview', () => {
    expect(isGemini2Model('gemini-3-pro-preview')).toBe(false);
  });

  it('returns false for a non-gemini model', () => {
    expect(isGemini2Model('claude-3-opus')).toBe(false);
  });

  it('returns true for gemini-2.0-flash', () => {
    expect(isGemini2Model('gemini-2.0-flash')).toBe(true);
  });
});
