/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { isGemini2Model, isGemini3Model } from '../models.js';

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

describe('isGemini3Model()', () => {
  it('returns true for gemini-3-pro-preview', () => {
    expect(isGemini3Model('gemini-3-pro-preview')).toBe(true);
  });

  it('returns true for gemini-3-flash-preview', () => {
    expect(isGemini3Model('gemini-3-flash-preview')).toBe(true);
  });

  it('returns false for gemini-2.5-pro', () => {
    expect(isGemini3Model('gemini-2.5-pro')).toBe(false);
  });

  it('returns false for a non-gemini model', () => {
    expect(isGemini3Model('claude-3-opus')).toBe(false);
  });
});
