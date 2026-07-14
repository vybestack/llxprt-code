/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { ModelLimitsCatalogSchema } from './model-limits.schema.js';
import catalogData from './model-limits.json' with { type: 'json' };

describe('ModelLimitsCatalogSchema', () => {
  it('validates the shipped catalog without error', () => {
    const parsed = ModelLimitsCatalogSchema.safeParse(catalogData);
    expect(parsed.success).toBe(true);
  });

  it.each([-1, 0])(
    'rejects a catalog with a non-positive defaultLimit: %s',
    (defaultLimit) => {
      const bad = { ...catalogData, defaultLimit };
      expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
    },
  );

  it.each(['exactLimits', 'prefixLimits', 'orderedRules'] as const)(
    'rejects a catalog missing required field %s',
    (field) => {
      const valid = {
        defaultLimit: 1000,
        exactLimits: {},
        prefixLimits: [],
        orderedRules: [],
      };
      const bad = Object.fromEntries(
        Object.entries(valid).filter(([key]) => key !== field),
      );
      expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
    },
  );

  it('rejects an ordered rule with an unknown type', () => {
    const bad = {
      ...catalogData,
      orderedRules: [{ type: 'bogus', limit: 100 }],
    };
    expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects non-integer limits', () => {
    const bad = { ...catalogData, defaultLimit: 1.5 };
    expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
  });

  // --- Behavioral rejection: non-empty match strings ---

  it('rejects an empty substring in a substring rule', () => {
    const bad = {
      ...catalogData,
      orderedRules: [{ type: 'substring', substring: '', limit: 100 }],
    };
    expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a whitespace-only substring in a substring rule', () => {
    const bad = {
      ...catalogData,
      orderedRules: [{ type: 'substring', substring: '   ', limit: 100 }],
    };
    expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an empty substring in a substringOrProviderPrefix rule', () => {
    const bad = {
      ...catalogData,
      orderedRules: [
        {
          type: 'substringOrProviderPrefix',
          substring: '',
          providerPrefix: 'codex',
          limit: 100,
        },
      ],
    };
    expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an empty providerPrefix in a substringOrProviderPrefix rule', () => {
    const bad = {
      ...catalogData,
      orderedRules: [
        {
          type: 'substringOrProviderPrefix',
          substring: 'codex',
          providerPrefix: '',
          limit: 100,
        },
      ],
    };
    expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an empty substring in a substringCaseInsensitive rule', () => {
    const bad = {
      ...catalogData,
      orderedRules: [
        { type: 'substringCaseInsensitive', substring: '', limit: 100 },
      ],
    };
    expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
  });

  // --- Behavioral rejection: prefix groups ---

  it('rejects a prefixGroup with an empty prefixes array', () => {
    const bad = {
      ...catalogData,
      orderedRules: [{ type: 'prefixGroup', prefixes: [], limit: 100 }],
    };
    expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a prefixGroup with an empty-string entry', () => {
    const bad = {
      ...catalogData,
      orderedRules: [{ type: 'prefixGroup', prefixes: ['o3', ''], limit: 100 }],
    };
    expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a prefixGroup with a whitespace-only entry', () => {
    const bad = {
      ...catalogData,
      orderedRules: [
        { type: 'prefixGroup', prefixes: ['o3', '   '], limit: 100 },
      ],
    };
    expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
  });

  it.each(['', '   ', ' gpt-4.1', 'gpt-4.1 '])(
    'rejects an invalid prefixLimit prefix: %j',
    (prefix) => {
      const bad = {
        ...catalogData,
        prefixLimits: [{ prefix, limit: 100 }],
      };
      expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
    },
  );

  it.each([-1, 1.5])('rejects an invalid prefixLimit limit: %s', (limit) => {
    const bad = {
      ...catalogData,
      prefixLimits: [{ prefix: 'gpt-4.1', limit }],
    };
    expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
  });

  // --- Behavioral rejection: exact limits ---

  it('rejects an empty key in exactLimits', () => {
    const bad = { ...catalogData, exactLimits: { '': 100 } };
    expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
  });

  it.each([0, -1, 1.5])(
    'rejects an invalid limit in exactLimits: %s',
    (limit) => {
      const bad = { ...catalogData, exactLimits: { 'gpt-4o': limit } };
      expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
    },
  );

  it.each([-5, 0])(
    'rejects a non-positive limit in an ordered rule: %s',
    (limit) => {
      const bad = {
        ...catalogData,
        orderedRules: [{ type: 'substring', substring: 'codex', limit }],
      };
      expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
    },
  );

  // --- Behavioral rejection: strict catalog object ---

  it('rejects an unknown top-level key (strict catalog)', () => {
    const bad = { ...catalogData, extraField: 'oops' };
    expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown key inside a substring rule (strict object)', () => {
    const bad = {
      ...catalogData,
      orderedRules: [
        { type: 'substring', substring: 'codex', limit: 100, extra: true },
      ],
    };
    expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown key inside a prefixLimit entry (strict object)', () => {
    const bad = {
      ...catalogData,
      prefixLimits: [{ prefix: 'gpt-4.1', limit: 1000000, bogus: true }],
    };
    expect(ModelLimitsCatalogSchema.safeParse(bad).success).toBe(false);
  });

  it('preserves authored casing for substringCaseInsensitive rules', () => {
    const parsed = ModelLimitsCatalogSchema.parse({
      ...catalogData,
      orderedRules: [
        {
          type: 'substringCaseInsensitive',
          substring: 'Claude-SonNet-5',
          limit: 200000,
        },
      ],
    });
    expect(parsed.orderedRules).toContainEqual({
      type: 'substringCaseInsensitive',
      substring: 'Claude-SonNet-5',
      limit: 200000,
    });
  });
});
