/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3216 — claudecode alias model defaults:
 *
 * The hard `max-image-dimension: 2000` budget applies only to the exact IDs
 * `claude-opus-5`, `claude-opus-4-8`, and `claude-sonnet-5`; substring matches
 * (e.g. `claude-opus-50`, `claude-opus-5-preview`) must not match. Older
 * supported Opus/Sonnet models keep their prior resize defaults
 * (1568/1568/1,229,312); the three target models receive only the hard cap.
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
    // Later rules overwrite earlier ones; verify resize stays off for targets.
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

describe('claudecode 4-8 exclusion is Opus-only (@issue:3216)', () => {
  // The 4-8 exclusion applies to Opus only (where the exact-ID hard cap
  // applies); Sonnet continues to exclude version 5 only.

  it('claude-sonnet-4-8 receives legacy 1568 resize defaults and no hard cap', () => {
    const defaults = computeModelDefaults(
      'claude-sonnet-4-8',
      claudecodeModelDefaults(),
    );
    expect(defaults['image-resize.maxLongEdge']).toBe(1568);
    expect(defaults['image-resize.maxShortEdge']).toBe(1568);
    expect(defaults['image-resize.maxPixels']).toBe(1_229_312);
    expect(defaults['max-image-dimension']).toBeUndefined();
  });

  it('the three exact target IDs remain unchanged (hard cap, no resize)', () => {
    for (const model of [
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-sonnet-5',
    ]) {
      const defaults = computeModelDefaults(model, claudecodeModelDefaults());
      expect(defaults['max-image-dimension']).toBe(2000);
      expect(defaults['image-resize.maxLongEdge']).toBeUndefined();
      expect(defaults['image-resize.maxShortEdge']).toBeUndefined();
      expect(defaults['image-resize.maxPixels']).toBeUndefined();
    }
  });

  it('near-match sonnet IDs do not receive the hard cap', () => {
    for (const model of [
      'claude-sonnet-4-8',
      'claude-sonnet-4-8-preview',
      'claude-sonnet-4-80',
      'claude-sonnet-48',
    ]) {
      const defaults = computeModelDefaults(model, claudecodeModelDefaults());
      expect(defaults['max-image-dimension']).toBeUndefined();
    }
  });

  it('near-match opus IDs do not receive the hard cap (only the exact ID does)', () => {
    for (const model of ['claude-opus-4-8-preview', 'claude-opus-4-80']) {
      const defaults = computeModelDefaults(model, claudecodeModelDefaults());
      expect(defaults['max-image-dimension']).toBeUndefined();
    }
  });

  it('claude-sonnet-5 stays excluded from legacy resize (version 5 for both families)', () => {
    const defaults = computeModelDefaults(
      'claude-sonnet-5',
      claudecodeModelDefaults(),
    );
    expect(defaults['image-resize.maxLongEdge']).toBeUndefined();
    expect(defaults['max-image-dimension']).toBe(2000);
  });
});
