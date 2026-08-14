/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3216 (M1+M2) — claudecode alias model defaults:
 *
 * M1: The hard `max-image-dimension: 2000` budget must be anchored to the
 *     EXACT IDs `claude-opus-5`, `claude-opus-4-8`, and `claude-sonnet-5`.
 *     Substring matching (e.g. `claude-opus-50`, `claude-opus-5-preview`) must
 *     NOT match.
 *
 * M2: Older supported Opus/Sonnet models must keep their prior resize defaults
 *     (1568/1568/1,229,312). The three target models are excluded from implicit
 *     resize and only receive the hard 2000-pixel cap.
 */

import { describe, it, expect } from 'bun:test';
import { loadProviderAliasEntries } from './providerAliases.js';
import { computeModelDefaults } from '../runtime/providerMutations.js';

function claudecodeModelDefaults() {
  const entry = loadProviderAliasEntries().find(
    (e) => e.alias === 'claudecode',
  );
  if (!entry) {
    throw new Error('claudecode alias entry not found');
  }
  return entry.config.modelDefaults ?? [];
}

describe('claudecode max-image-dimension exact-ID anchoring (@issue:3216 M1)', () => {
  it.each(['claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-5'])(
    'applies max-image-dimension 2000 for exact target ID %s',
    (model) => {
      const defaults = computeModelDefaults(model, claudecodeModelDefaults());
      expect(defaults['max-image-dimension']).toBe(2000);
    },
  );

  it.each([
    'claude-opus-50',
    'claude-sonnet-50',
    'claude-opus-5-preview',
    'claude-opus-5-20260101',
    'claude-sonnet-5-preview',
    'claude-opus-4-80',
    'xclaude-opus-5',
    'anthropic-claude-opus-5',
  ])('does NOT apply max-image-dimension for non-target ID %s', (model) => {
    const defaults = computeModelDefaults(model, claudecodeModelDefaults());
    expect(defaults['max-image-dimension']).toBeUndefined();
  });
});

describe('claudecode target models get no implicit resize (@issue:3216 M1)', () => {
  it.each(['claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-5'])(
    'does NOT set image-resize.* for %s',
    (model) => {
      const defaults = computeModelDefaults(model, claudecodeModelDefaults());
      expect(defaults['image-resize.maxLongEdge']).toBeUndefined();
      expect(defaults['image-resize.maxShortEdge']).toBeUndefined();
      expect(defaults['image-resize.maxPixels']).toBeUndefined();
    },
  );
});

describe('claudecode older Opus/Sonnet models keep resize defaults (@issue:3216 M2)', () => {
  it.each([
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-opus-4-5-20251101',
    'claude-opus-4-5',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-20250514',
  ])('applies 1568/1568/1229312 resize defaults for %s', (model) => {
    const defaults = computeModelDefaults(model, claudecodeModelDefaults());
    expect(defaults['image-resize.maxLongEdge']).toBe(1568);
    expect(defaults['image-resize.maxShortEdge']).toBe(1568);
    expect(defaults['image-resize.maxPixels']).toBe(1_229_312);
  });

  it('does NOT set max-image-dimension for older models', () => {
    for (const model of [
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-20250514',
    ]) {
      const defaults = computeModelDefaults(model, claudecodeModelDefaults());
      expect(defaults['max-image-dimension']).toBeUndefined();
    }
  });

  it('does NOT apply resize defaults for Haiku or Fable', () => {
    for (const model of ['claude-haiku-4-5', 'claude-fable-5']) {
      const defaults = computeModelDefaults(model, claudecodeModelDefaults());
      expect(defaults['image-resize.maxLongEdge']).toBeUndefined();
      expect(defaults['image-resize.maxShortEdge']).toBeUndefined();
      expect(defaults['image-resize.maxPixels']).toBeUndefined();
    }
  });

  it('rule ordering cannot reapply resize to target models (merge safety)', () => {
    // computeModelDefaults applies rules in order; later rules overwrite.
    // Verify that the final merged result for target models has resize off
    // even though the resize rule appears in the same config.
    for (const model of [
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-sonnet-5',
    ]) {
      const defaults = computeModelDefaults(model, claudecodeModelDefaults());
      expect(defaults['image-resize.maxLongEdge']).toBeUndefined();
      expect(defaults['image-resize.maxShortEdge']).toBeUndefined();
      expect(defaults['image-resize.maxPixels']).toBeUndefined();
      expect(defaults['max-image-dimension']).toBe(2000);
    }
  });
});
