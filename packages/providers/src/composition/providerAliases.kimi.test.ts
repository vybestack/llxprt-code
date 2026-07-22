/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { loadProviderAliasEntries } from './providerAliases.js';

describe('builtin kimi provider alias', () => {
  it('ships kimi with defaultModel + required ephemerals', () => {
    const entries = loadProviderAliasEntries();
    const entry = entries.find((candidate) => candidate.alias === 'kimi');

    expect(entry).toBeDefined();
    expect(entry?.source).toBe('builtin');

    expect(entry?.config.baseProvider).toBe('openai');
    expect(entry?.config['base-url']).toBe('https://api.kimi.com/coding/v1');
    expect(entry?.config.defaultModel).toBe('kimi-for-coding');

    const ephemerals = entry?.config.ephemeralSettings;
    expect(ephemerals).toBeDefined();
    expect(ephemerals?.['context-limit']).toBe(262144);
    expect(ephemerals?.max_tokens).toBe(32768);
    expect(ephemerals?.['user-agent']).toBe('RooCode/1.0');
  });

  it('has modelDefaults with a broad kimi.* rule and a kimi-k3 override', () => {
    const entries = loadProviderAliasEntries();
    const entry = entries.find((candidate) => candidate.alias === 'kimi');

    expect(entry?.config.modelDefaults).toBeDefined();
    expect(Array.isArray(entry?.config.modelDefaults)).toBe(true);
    expect(entry?.config.modelDefaults).toHaveLength(2);

    // The broad rule MUST come before the kimi-k3 rule so array-order
    // precedence lets the K3-specific keys win for kimi-k3 models.
    const patterns = (entry?.config.modelDefaults ?? []).map((r) => r.pattern);
    expect(patterns.indexOf('kimi.*')).toBeLessThan(
      patterns.indexOf('kimi-k3'),
    );

    // Broad K2.x rule — locate by pattern rather than array index.
    const broadRule = entry?.config.modelDefaults?.find(
      (rule) => rule.pattern === 'kimi.*',
    );
    expect(broadRule).toBeDefined();

    const broadDefaults = broadRule?.ephemeralSettings;
    expect(broadDefaults?.['reasoning.effort']).toBe('medium');
    expect(broadDefaults?.['reasoning.enabled']).toBe(true);
    expect(broadDefaults?.['reasoning.includeInResponse']).toBe(true);
    expect(broadDefaults?.['reasoning.includeInContext']).toBe(true);
    expect(broadDefaults?.['reasoning.stripFromContext']).toBe('none');
    // Geometry is declared on the broad rule too, so the model-switch
    // transition recognizes these as model-defaulted and can replace them
    // with the K3-specific values when switching to kimi-k3.
    expect(broadDefaults?.max_tokens).toBe(32768);
    expect(broadDefaults?.['context-limit']).toBe(262144);
  });

  it('ships a kimi-k3 modelDefaults rule with K3-valid geometry and effort', () => {
    const entries = loadProviderAliasEntries();
    const entry = entries.find((candidate) => candidate.alias === 'kimi');

    // K3-specific rule (the broad kimi.* rule also matches kimi-k3, so locate
    // the more-specific entry by its exact pattern).
    const k3Rule = entry?.config.modelDefaults?.find(
      (rule) => rule.pattern === 'kimi-k3',
    );
    expect(k3Rule).toBeDefined();
    // The pattern, used as a RegExp per modelDefaults semantics, matches kimi-k3.
    expect(new RegExp(k3Rule?.pattern ?? '').test('kimi-k3')).toBe(true);

    const k3Defaults = k3Rule?.ephemeralSettings;
    // K3 accepts only low | high | max (no medium) — default is max.
    expect(k3Defaults?.['reasoning.effort']).toBe('max');
    // K3 shipped geometry: 131072 default output, 1,000,000 context window.
    expect(k3Defaults?.max_tokens).toBe(131072);
    expect(k3Defaults?.['context-limit']).toBe(1000000);
  });
});
