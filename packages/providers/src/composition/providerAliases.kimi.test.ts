/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { computeModelDefaults } from '../runtime/providerMutations.js';
import {
  loadProviderAliasEntries,
  type ModelDefaultRule,
  type ProviderAliasEntry,
} from './providerAliases.js';

function configuredModelDefaults(
  entry: ProviderAliasEntry | undefined,
): ModelDefaultRule[] {
  return entry?.config.modelDefaults ?? [];
}

function configuredStaticModels(entry: ProviderAliasEntry | undefined) {
  return entry?.config.staticModels ?? [];
}

function configuredPattern(rule: ModelDefaultRule | undefined): string {
  return rule?.pattern ?? '';
}

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

  it('has modelDefaults with shared, K2.7, kimi-k3, and k3-256k rules', () => {
    const entries = loadProviderAliasEntries();
    const entry = entries.find((candidate) => candidate.alias === 'kimi');

    expect(entry?.config.modelDefaults).toBeDefined();
    expect(Array.isArray(entry?.config.modelDefaults)).toBe(true);
    expect(entry?.config.modelDefaults).toHaveLength(4);

    // The shared rule MUST come before the model-family rules so
    // array-order precedence lets the specific keys win for those models.
    const patterns = configuredModelDefaults(entry).map((rule) => rule.pattern);
    expect(patterns.indexOf('^kimi|^k3-256k$')).toBeLessThan(
      patterns.indexOf('^kimi-for-coding(?:-highspeed)?$'),
    );
    expect(patterns.indexOf('^kimi|^k3-256k$')).toBeLessThan(
      patterns.indexOf('kimi-k3'),
    );
    expect(patterns.indexOf('^kimi|^k3-256k$')).toBeLessThan(
      patterns.indexOf('k3-256k'),
    );

    // Broad rule — locate by pattern rather than array index.
    const broadRule = entry?.config.modelDefaults?.find(
      (rule) => rule.pattern === '^kimi|^k3-256k$',
    );
    expect(broadRule).toBeDefined();

    const broadDefaults = broadRule?.ephemeralSettings;
    expect(broadDefaults).not.toHaveProperty('reasoning.effort');
    expect(broadDefaults?.['reasoning.enabled']).toBe(true);
    expect(broadDefaults?.['reasoning.includeInResponse']).toBe(true);
    expect(broadDefaults?.['reasoning.includeInContext']).toBe(true);
    expect(broadDefaults?.['reasoning.stripFromContext']).toBe('none');
    // Geometry is declared on the broad rule too, so the model-switch
    // transition recognizes these as model-defaulted and can replace them
    // with the K3-specific values when switching to kimi-k3.
    expect(broadDefaults?.max_tokens).toBe(32768);
    expect(broadDefaults?.['context-limit']).toBe(262144);

    // Kimi sampling params are fixed server-side; the dialog must hide them.
    expect(broadRule?.unallowedParameters).toStrictEqual([
      'temperature',
      'top_p',
      'top_k',
      'frequency_penalty',
      'presence_penalty',
    ]);

    // The broad pattern must NOT bleed kimi's suppression onto foreign
    // models that merely contain 'k3' or 'kimi' as substrings.
    const broadRegex = new RegExp(broadRule!.pattern);
    expect(broadRegex.test('k3-256k')).toBe(true);
    expect(broadRegex.test('kimi-k3')).toBe(true);
    expect(broadRegex.test('claude-k3')).toBe(false);
    expect(broadRegex.test('k3-foreign-model')).toBe(false);
    expect(broadRegex.test('qwen-k3')).toBe(false);
  });

  it('ships a k3-256k modelDefaults rule with 256K geometry', () => {
    const entries = loadProviderAliasEntries();
    const entry = entries.find((candidate) => candidate.alias === 'kimi');

    const rule = entry?.config.modelDefaults?.find(
      (candidate) => candidate.pattern === 'k3-256k',
    );
    expect(rule).toBeDefined();
    expect(new RegExp(rule!.pattern).test('k3-256k')).toBe(true);
    expect(rule!.ephemeralSettings.max_tokens).toBe(131072);
    expect(rule!.ephemeralSettings['context-limit']).toBe(262144);
  });

  it('ships a K2.7-specific thinking rule without an effort default', () => {
    const entry = loadProviderAliasEntries().find(
      (candidate) => candidate.alias === 'kimi',
    );
    const rule = entry?.config.modelDefaults?.find(
      (candidate) => candidate.pattern === '^kimi-for-coding(?:-highspeed)?$',
    );

    expect(rule?.ephemeralSettings).toMatchObject({
      'reasoning.effortWireFormat': 'none',
      'reasoning.enabledWireFormat': 'thinking',
      'reasoning.enabledMap': { true: 'enabled', false: null },
    });
    expect(rule?.ephemeralSettings).not.toHaveProperty('reasoning.effort');
  });

  it('ships staticModels so the dialog lists real Kimi models, not API fallbacks', () => {
    const entries = loadProviderAliasEntries();
    const entry = entries.find((candidate) => candidate.alias === 'kimi');

    const ids = configuredStaticModels(entry).map((model) => model.id);
    expect(ids).toStrictEqual(
      expect.arrayContaining(['kimi-for-coding', 'kimi-k3', 'k3-256k']),
    );
    const k3 = entry?.config.staticModels?.find(
      (model) => model.id === 'kimi-k3',
    );
    expect(k3?.contextWindow).toBe(1048576);
    expect(k3?.maxOutputTokens).toBe(131072);
    const k3256 = entry?.config.staticModels?.find(
      (model) => model.id === 'k3-256k',
    );
    expect(k3256?.contextWindow).toBe(262144);
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
    expect(new RegExp(configuredPattern(k3Rule)).test('kimi-k3')).toBe(true);

    const k3Defaults = k3Rule?.ephemeralSettings;
    // K3 accepts only low | high | max (no medium) — default is max.
    expect(k3Defaults?.['reasoning.effort']).toBe('max');
    // K3 shipped geometry: 131072 default output, 1,000,000 context window.
    expect(k3Defaults?.max_tokens).toBe(131072);
    expect(k3Defaults?.['context-limit']).toBe(1000000);
  });

  it('declares PDF upload and gated video capabilities', () => {
    const entries = loadProviderAliasEntries();
    const entry = entries.find((candidate) => candidate.alias === 'kimi');

    expect(entry?.config.mediaSupport).toBeDefined();
    expect(entry?.config.mediaSupport?.inlineImages).toBe(true);
    expect(entry?.config.mediaSupport?.fileUpload).toBe(true);
    expect(entry?.config.mediaSupport?.videoSupport).toBe(true);
  });

  it('applies family-wide image limits to Kimi vision models', () => {
    const entry = loadProviderAliasEntries().find(
      (candidate) => candidate.alias === 'kimi',
    );
    const broadRule = entry?.config.modelDefaults?.find(
      (rule) => rule.pattern === '^kimi|^k3-256k$',
    );

    const imageLimits = {
      'image-resize.maxLongEdge': 4096,
      'image-resize.maxShortEdge': 2160,
      'image-resize.maxPixels': 8_847_360,
    };
    expect(broadRule?.ephemeralSettings).toMatchObject(imageLimits);
    const rules = configuredModelDefaults(entry);
    expect(computeModelDefaults('kimi-k3', rules)).toMatchObject(imageLimits);
    expect(computeModelDefaults('k3-256k', rules)).toMatchObject(imageLimits);
    expect(computeModelDefaults('custom-model', rules)).not.toHaveProperty(
      'image-resize.maxLongEdge',
    );
  });
});
