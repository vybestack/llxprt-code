/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3216 — Behavioral tests for provider-side image budget resolution.
 * Profile loading injects modelDefaults ephemerals verbatim without registry
 * validation, so an invalid value must throw rather than silently disable the
 * budget.
 */

import { describe, it, expect } from 'bun:test';
import { resolveAnthropicImageBudget } from './AnthropicImageSanitizer.js';

describe('resolveAnthropicImageBudget fail-fast validation (@issue:3216)', () => {
  it('resolves a valid dimension-only budget from profile-shaped ephemerals', () => {
    expect(
      resolveAnthropicImageBudget({ 'max-image-dimension': 2000 }),
    ).toEqual({ maxDimension: 2000 });
  });

  it('resolves a valid combined budget from profile-shaped ephemerals', () => {
    expect(
      resolveAnthropicImageBudget({
        'max-image-dimension': 2000,
        'max-image-pixels': 4_000_000,
      }),
    ).toEqual({ maxDimension: 2000, maxPixels: 4_000_000 });
  });

  it('resolves a pixel-only budget from profile-shaped ephemerals', () => {
    expect(
      resolveAnthropicImageBudget({ 'max-image-pixels': 4_000_000 }),
    ).toEqual({ maxPixels: 4_000_000 });
  });

  it('returns undefined when no budget keys are configured', () => {
    expect(resolveAnthropicImageBudget({})).toBeUndefined();
    expect(
      resolveAnthropicImageBudget({ 'unrelated.setting': true }),
    ).toBeUndefined();
  });

  it('throws on a numeric string instead of silently disabling the budget', () => {
    // The setting contract is a positive integer; a string must not coerce.
    expect(() =>
      resolveAnthropicImageBudget({ 'max-image-dimension': '2000' }),
    ).toThrow(/positive integer/);
  });

  it('throws on zero', () => {
    expect(() =>
      resolveAnthropicImageBudget({ 'max-image-dimension': 0 }),
    ).toThrow(/positive integer/);
  });

  it('throws on a negative value', () => {
    expect(() =>
      resolveAnthropicImageBudget({ 'max-image-dimension': -5 }),
    ).toThrow(/positive integer/);
  });

  it('throws on a fractional value', () => {
    expect(() =>
      resolveAnthropicImageBudget({ 'max-image-dimension': 1.5 }),
    ).toThrow(/positive integer/);
  });

  it('throws on an invalid max-image-pixels value', () => {
    expect(() =>
      resolveAnthropicImageBudget({ 'max-image-pixels': 'huge' }),
    ).toThrow(/positive integer/);
    expect(() =>
      resolveAnthropicImageBudget({ 'max-image-pixels': 0 }),
    ).toThrow(/positive integer/);
  });

  it('throws on a non-number truthy value from a malformed profile', () => {
    expect(() =>
      resolveAnthropicImageBudget({ 'max-image-dimension': true }),
    ).toThrow(/positive integer/);
    expect(() =>
      resolveAnthropicImageBudget({ 'max-image-dimension': null }),
    ).toThrow(/positive integer/);
  });

  it('shares the tool-side validation message (no divergent messages)', () => {
    // The provider-side resolution must use the same message contract as the
    // tool-side resolver.
    let providerMessage = '';
    try {
      resolveAnthropicImageBudget({ 'max-image-dimension': '2000' });
    } catch (error) {
      providerMessage = error instanceof Error ? error.message : '';
    }
    expect(providerMessage).toBe(
      'Invalid image dimension budget: max-image-dimension must be a positive integer',
    );
  });
});
