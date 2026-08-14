/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * TDD tests for modelDefaults parsing/validation in providerAliases
 * Phase 01 & Phase 02 of the modeldefaults plan
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DebugLogger } from '@vybestack/llxprt-code-core';

// This test needs real config files plus temp dirs, not the global mock

import {
  loadProviderAliasEntries,
  type ModelDefaultRule,
} from './providerAliases.js';

function expectNoImageResizeDefaults(
  defaults: Readonly<Record<string, unknown>>,
): void {
  expect(defaults).not.toHaveProperty('image-resize.maxLongEdge');
  expect(defaults).not.toHaveProperty('image-resize.maxShortEdge');
  expect(defaults).not.toHaveProperty('image-resize.maxPixels');
}

/**
 * Helper to load entries from a temp user alias dir via Storage mock.
 * Shared across multiple test suites to avoid sonarjs/no-identical-functions.
 */
async function loadWithTempConfig(
  tmpDir: string,
  filename: string,
  config: Record<string, unknown>,
) {
  const { Storage } = await import('@vybestack/llxprt-code-settings');
  const fakeLlxprtDir = path.join(tmpDir, '.llxprt');
  const fakeProvidersDir = path.join(fakeLlxprtDir, 'providers');
  fs.mkdirSync(fakeProvidersDir, { recursive: true });

  const configPath = path.join(fakeProvidersDir, filename);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  vi.spyOn(Storage, 'getGlobalDataDir').mockReturnValue(fakeLlxprtDir);

  try {
    return loadProviderAliasEntries();
  } finally {
    (
      Storage.getGlobalDataDir as Mock<typeof Storage.getGlobalDataDir>
    ).mockRestore();
  }
}

describe('providerAliases modelDefaults parsing (Phase 01)', () => {
  let tmpDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-test-'));
    warnSpy = vi
      .spyOn(DebugLogger.prototype, 'warn')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('valid modelDefaults in config', () => {
    it('parses modelDefaults from a .config file with valid modelDefaults array', async () => {
      const entries = await loadWithTempConfig(tmpDir, 'test-provider.config', {
        name: 'test-provider',
        baseProvider: 'openai',
        modelDefaults: [
          {
            pattern: 'gpt-4.*',
            ephemeralSettings: { 'reasoning.enabled': true },
          },
        ],
      });

      const entry = entries.find((e) => e.alias === 'test-provider');
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults).toBeDefined();
      expect(entry?.config.modelDefaults).toBeInstanceOf(Array);
      expect(entry?.config.modelDefaults).toHaveLength(1);
      expect(entry?.config.modelDefaults?.[0]?.pattern).toBe('gpt-4.*');
      expect(entry?.config.modelDefaults?.[0]?.ephemeralSettings).toStrictEqual(
        {
          'reasoning.enabled': true,
        },
      );
    });
  });

  describe('invalid regex pattern', () => {
    it('strips invalid regex pattern and logs warning', async () => {
      const entries = await loadWithTempConfig(tmpDir, 'regex-test.config', {
        name: 'regex-test',
        baseProvider: 'openai',
        modelDefaults: [
          {
            pattern: '[',
            ephemeralSettings: { 'reasoning.enabled': true },
          },
        ],
      });

      const entry = entries.find((e) => e.alias === 'regex-test');
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults).toStrictEqual([]);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[ProviderAliases] Skipping modelDefaults entry with invalid regex pattern',
        ),
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('['));
    });
  });

  describe('mixed valid and invalid pattern rules', () => {
    it('keeps valid rules and strips invalid ones (length === 1)', async () => {
      const entries = await loadWithTempConfig(tmpDir, 'mixed-rules.config', {
        name: 'mixed-rules',
        baseProvider: 'openai',
        modelDefaults: [
          {
            pattern: 'gpt-4.*',
            ephemeralSettings: { 'reasoning.enabled': true },
          },
          {
            pattern: '[invalid',
            ephemeralSettings: { 'reasoning.effort': 'high' },
          },
        ],
      });

      const entry = entries.find((e) => e.alias === 'mixed-rules');
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults).toHaveLength(1);
      expect(entry?.config.modelDefaults?.[0]?.pattern).toBe('gpt-4.*');
    });
  });

  describe('pattern that is not a string', () => {
    it('skips entry with non-string pattern and logs warning', async () => {
      const entries = await loadWithTempConfig(
        tmpDir,
        'nonstring-pattern.config',
        {
          name: 'nonstring-pattern',
          baseProvider: 'openai',
          modelDefaults: [
            {
              pattern: 123,
              ephemeralSettings: { 'reasoning.enabled': true },
            },
          ],
        },
      );

      const entry = entries.find((e) => e.alias === 'nonstring-pattern');
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults).toStrictEqual([]);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[ProviderAliases] Skipping modelDefaults entry with non-string pattern',
        ),
      );
    });
  });

  describe('missing ephemeralSettings', () => {
    it('skips entry with missing ephemeralSettings and logs warning', async () => {
      const entries = await loadWithTempConfig(
        tmpDir,
        'missing-ephemeral.config',
        {
          name: 'missing-ephemeral',
          baseProvider: 'openai',
          modelDefaults: [
            {
              pattern: 'gpt-4.*',
            },
          ],
        },
      );

      const entry = entries.find((e) => e.alias === 'missing-ephemeral');
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults).toStrictEqual([]);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[ProviderAliases] Skipping modelDefaults entry with invalid ephemeralSettings',
        ),
      );
    });
  });

  describe('empty modelDefaults array', () => {
    it('handles empty modelDefaults array without crash', async () => {
      const entries = await loadWithTempConfig(
        tmpDir,
        'empty-defaults.config',
        {
          name: 'empty-defaults',
          baseProvider: 'openai',
          modelDefaults: [],
        },
      );

      const entry = entries.find((e) => e.alias === 'empty-defaults');
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults).toStrictEqual([]);
    });
  });

  describe('backward compatibility — no modelDefaults', () => {
    it('loads config without modelDefaults correctly', async () => {
      const entries = await loadWithTempConfig(tmpDir, 'no-defaults.config', {
        name: 'no-defaults',
        baseProvider: 'openai',
        defaultModel: 'gpt-4o',
      });

      const entry = entries.find((e) => e.alias === 'no-defaults');
      expect(entry).toBeDefined();
      expect(entry?.config.baseProvider).toBe('openai');
      expect(entry?.config.modelDefaults).toBeUndefined();
    });
  });

  describe('modelDefaults present but not an array', () => {
    it('drops the field entirely and logs warning', async () => {
      const entries = await loadWithTempConfig(tmpDir, 'not-array.config', {
        name: 'not-array',
        baseProvider: 'openai',
        modelDefaults: 'not-an-array',
      });

      const entry = entries.find((e) => e.alias === 'not-array');
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults).toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[ProviderAliases] Ignoring non-array modelDefaults',
        ),
      );
    });

    it('drops object modelDefaults and logs warning', async () => {
      const entries = await loadWithTempConfig(
        tmpDir,
        'object-defaults.config',
        {
          name: 'object-defaults',
          baseProvider: 'openai',
          modelDefaults: { pattern: 'foo', ephemeralSettings: {} },
        },
      );

      const entry = entries.find((e) => e.alias === 'object-defaults');
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults).toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[ProviderAliases] Ignoring non-array modelDefaults',
        ),
      );
    });
  });

  describe('non-object entries in modelDefaults array', () => {
    it('skips non-object entries (strings, numbers, null) with warning per entry', async () => {
      const entries = await loadWithTempConfig(tmpDir, 'non-objects.config', {
        name: 'non-objects',
        baseProvider: 'openai',
        modelDefaults: ['a-string', 42, null],
      });

      const entry = entries.find((e) => e.alias === 'non-objects');
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults).toStrictEqual([]);

      // One warning per non-object entry
      const nonObjectWarnings = warnSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('Skipping non-object modelDefaults entry'),
      );
      expect(nonObjectWarnings).toHaveLength(3);
    });
  });

  describe('entry with pattern field that is not a string', () => {
    it('skips entry when pattern is a number', async () => {
      const entries = await loadWithTempConfig(
        tmpDir,
        'pattern-number.config',
        {
          name: 'pattern-number',
          baseProvider: 'openai',
          modelDefaults: [
            {
              pattern: 999,
              ephemeralSettings: { foo: 'bar' },
            },
          ],
        },
      );

      const entry = entries.find((e) => e.alias === 'pattern-number');
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults).toStrictEqual([]);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[ProviderAliases] Skipping modelDefaults entry with non-string pattern',
        ),
      );
    });

    it('skips entry when pattern is boolean', async () => {
      const entries = await loadWithTempConfig(tmpDir, 'pattern-bool.config', {
        name: 'pattern-bool',
        baseProvider: 'openai',
        modelDefaults: [
          {
            pattern: true,
            ephemeralSettings: { foo: 'bar' },
          },
        ],
      });

      const entry = entries.find((e) => e.alias === 'pattern-bool');
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults).toStrictEqual([]);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[ProviderAliases] Skipping modelDefaults entry with non-string pattern',
        ),
      );
    });
  });

  describe('ephemeralSettings is not a plain object', () => {
    it('skips entry when ephemeralSettings is an array', async () => {
      const entries = await loadWithTempConfig(
        tmpDir,
        'ephemeral-array.config',
        {
          name: 'ephemeral-array',
          baseProvider: 'openai',
          modelDefaults: [
            {
              pattern: 'gpt-4.*',
              ephemeralSettings: [1, 2, 3],
            },
          ],
        },
      );

      const entry = entries.find((e) => e.alias === 'ephemeral-array');
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults).toStrictEqual([]);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[ProviderAliases] Skipping modelDefaults entry with invalid ephemeralSettings',
        ),
      );
    });

    it('skips entry when ephemeralSettings is a string', async () => {
      const entries = await loadWithTempConfig(
        tmpDir,
        'ephemeral-string.config',
        {
          name: 'ephemeral-string',
          baseProvider: 'openai',
          modelDefaults: [
            {
              pattern: 'gpt-4.*',
              ephemeralSettings: 'not-an-object',
            },
          ],
        },
      );

      const entry = entries.find((e) => e.alias === 'ephemeral-string');
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults).toStrictEqual([]);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[ProviderAliases] Skipping modelDefaults entry with invalid ephemeralSettings',
        ),
      );
    });
  });

  describe('non-scalar ephemeralSettings values (nested objects)', () => {
    it('allows non-scalar values through at parse time', async () => {
      const entries = await loadWithTempConfig(tmpDir, 'nested-values.config', {
        name: 'nested-values',
        baseProvider: 'openai',
        modelDefaults: [
          {
            pattern: 'gpt-4.*',
            ephemeralSettings: {
              'reasoning.enabled': true,
              nested: { deeply: { value: 42 } },
              anArray: [1, 2, 3],
            },
          },
        ],
      });

      const entry = entries.find((e) => e.alias === 'nested-values');
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults).toHaveLength(1);
      expect(entry?.config.modelDefaults?.[0]?.ephemeralSettings).toStrictEqual(
        {
          'reasoning.enabled': true,
          nested: { deeply: { value: 42 } },
          anArray: [1, 2, 3],
        },
      );
    });
  });

  describe('empty pattern string', () => {
    it('skips entry with empty pattern and logs warning', async () => {
      const entries = await loadWithTempConfig(tmpDir, 'empty-pattern.config', {
        name: 'empty-pattern',
        baseProvider: 'openai',
        modelDefaults: [
          {
            pattern: '',
            ephemeralSettings: { 'reasoning.enabled': true },
          },
        ],
      });

      const entry = entries.find((e) => e.alias === 'empty-pattern');
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults).toStrictEqual([]);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[ProviderAliases] Skipping modelDefaults entry with empty pattern',
        ),
      );
    });
  });
});

describe('anthropic.config modelDefaults (Phase 02)', () => {
  let tmpDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-test-'));
    warnSpy = vi
      .spyOn(DebugLogger.prototype, 'warn')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper: compute merged model defaults for a given model name by iterating
   * the modelDefaults rules array in order and merging matching rules.
   */
  function computeMatchedDefaults(
    modelName: string,
    rules: ModelDefaultRule[],
  ): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    for (const rule of rules) {
      if (new RegExp(rule.pattern, 'i').test(modelName)) {
        Object.assign(merged, rule.ephemeralSettings);
      }
    }
    return merged;
  }

  function getAnthropicEntry() {
    const entries = loadProviderAliasEntries();
    const anthropic = entries.find(
      (e) => e.alias === 'anthropic' && e.source === 'builtin',
    );
    expect(anthropic).toBeDefined();
    return anthropic!;
  }

  it('builtin anthropic.config has a modelDefaults array', () => {
    const entry = getAnthropicEntry();
    expect(entry.config.modelDefaults).toBeDefined();
    expect(Array.isArray(entry.config.modelDefaults)).toBe(true);
    expect(entry.config.modelDefaults!.length).toBeGreaterThanOrEqual(2);
  });

  it('builtin anthropic.config declares claude-opus-5 as defaultModel @issue:2665', () => {
    const entry = getAnthropicEntry();
    expect(entry.config.defaultModel).toBe('claude-opus-5');
  });

  it('claude-opus-5 matches a rule with reasoning.effort: "high"', () => {
    const entry = getAnthropicEntry();
    const defaults = computeMatchedDefaults(
      'claude-opus-5',
      entry.config.modelDefaults!,
    );
    expect(defaults['reasoning.effort']).toBe('high');
  });

  it('claude-sonnet-4-5-20250929 matches reasoning.enabled but NOT reasoning.effort', () => {
    const entry = getAnthropicEntry();
    const defaults = computeMatchedDefaults(
      'claude-sonnet-4-5-20250929',
      entry.config.modelDefaults!,
    );
    expect(defaults['reasoning.enabled']).toBe(true);
    expect(defaults).not.toHaveProperty(['reasoning.effort']);
  });

  it('claude-haiku-4-5-20251001 matches reasoning.enabled', () => {
    const entry = getAnthropicEntry();
    const defaults = computeMatchedDefaults(
      'claude-haiku-4-5-20251001',
      entry.config.modelDefaults!,
    );
    expect(defaults['reasoning.enabled']).toBe(true);
  });

  it('claude-sonnet-5 matches the broad Claude rule (adaptive thinking) @issue:2289', () => {
    const entry = getAnthropicEntry();
    const defaults = computeMatchedDefaults(
      'claude-sonnet-5',
      entry.config.modelDefaults!,
    );
    expect(defaults['reasoning.enabled']).toBe(true);
    expect(defaults['reasoning.adaptiveThinking']).toBe(true);
    expect(defaults['reasoning.includeInContext']).toBe(true);
  });

  it('non-Claude model like gpt-4o does NOT match any rule', () => {
    const entry = getAnthropicEntry();
    const defaults = computeMatchedDefaults(
      'gpt-4o',
      entry.config.modelDefaults!,
    );
    expect(Object.keys(defaults)).toHaveLength(0);
  });

  it('rules merge in order — claude-opus-5 gets broad + specific settings', () => {
    const entry = getAnthropicEntry();
    const defaults = computeMatchedDefaults(
      'claude-opus-5',
      entry.config.modelDefaults!,
    );

    // From the broad "claude-(opus|sonnet|haiku)" rule
    expect(defaults['reasoning.enabled']).toBe(true);
    expect(defaults['reasoning.adaptiveThinking']).toBe(true);
    expect(defaults['reasoning.includeInContext']).toBe(true);

    // From the specific "claude-opus-5" rule (merged on top)
    expect(defaults['reasoning.effort']).toBe('high');
    expect(defaults['context-limit']).toBe(1000000);
    // Opus 5 ships a 128K max output budget (1M context window).
    expect(defaults['maxOutputTokens']).toBe(128000);
  });

  it('rules merge in order — claude-opus-4-8 retains its specific settings @issue:2665', () => {
    const entry = getAnthropicEntry();
    const defaults = computeMatchedDefaults(
      'claude-opus-4-8',
      entry.config.modelDefaults!,
    );

    // From the broad "claude-(opus|sonnet|haiku)" rule
    expect(defaults['reasoning.enabled']).toBe(true);
    expect(defaults['reasoning.adaptiveThinking']).toBe(true);
    expect(defaults['reasoning.includeInContext']).toBe(true);

    // From the retained "claude-opus-4-8" rule (merged on top)
    expect(defaults['reasoning.effort']).toBe('high');
    expect(defaults['context-limit']).toBe(1000000);
  });

  // Claude Fable 5: the broad Claude pattern includes `fable` and a
  // fable-specific rule sets effort + context-limit. Guards the config-regex
  // gap where fable previously matched no rule.
  it('claude-fable-5 matches the broad Claude rule (reasoning defaults) @issue:2328', () => {
    const entry = getAnthropicEntry();
    const defaults = computeMatchedDefaults(
      'claude-fable-5',
      entry.config.modelDefaults!,
    );
    expect(defaults['reasoning.enabled']).toBe(true);
    expect(defaults['reasoning.adaptiveThinking']).toBe(true);
    expect(defaults['reasoning.includeInContext']).toBe(true);
  });

  it('rules merge in order — claude-fable-5 gets broad + fable-specific settings @issue:2328', () => {
    const entry = getAnthropicEntry();
    const defaults = computeMatchedDefaults(
      'claude-fable-5',
      entry.config.modelDefaults!,
    );
    // From the broad "claude-(opus|sonnet|haiku|fable)" rule
    expect(defaults['reasoning.enabled']).toBe(true);
    expect(defaults['reasoning.adaptiveThinking']).toBe(true);
    expect(defaults['reasoning.includeInContext']).toBe(true);
    // From the specific "claude-fable-5" rule (merged on top)
    expect(defaults['reasoning.effort']).toBe('high');
    expect(defaults['context-limit']).toBe(1000000);
  });

  it('anthropic applies image-resize limits to Opus and Sonnet families only', () => {
    const entry = loadProviderAliasEntries().find(
      (candidate) =>
        candidate.alias === 'anthropic' && candidate.source === 'builtin',
    );
    expect(entry).toBeDefined();
    const rules = entry?.config.modelDefaults ?? [];
    for (const model of [
      'claude-opus-4-5-20251101',
      'claude-opus-5',
      'claude-sonnet-4-20250514',
      'claude-sonnet-5',
    ]) {
      const defaults = computeMatchedDefaults(model, rules);
      expect(defaults).toMatchObject({
        'image-resize.maxLongEdge': 1568,
        'image-resize.maxShortEdge': 1568,
        'image-resize.maxPixels': 1_229_312,
      });
      expect(defaults['max-image-dimension']).toBeUndefined();
      expect(defaults['max-image-pixels']).toBeUndefined();
    }
    for (const model of ['claude-haiku-4-5', 'claude-fable-5']) {
      const defaults = computeMatchedDefaults(model, rules);
      expectNoImageResizeDefaults(defaults);
      expect(defaults['max-image-dimension']).toBeUndefined();
      expect(defaults['max-image-pixels']).toBeUndefined();
    }
  });

  it('claudecode applies max-image-dimension to Opus 5, Opus 4.8, and Sonnet 5 only @issue:3216', () => {
    const entry = loadProviderAliasEntries().find(
      (candidate) =>
        candidate.alias === 'claudecode' && candidate.source === 'builtin',
    );
    expect(entry).toBeDefined();
    const rules = entry?.config.modelDefaults ?? [];
    for (const model of [
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-sonnet-5',
    ]) {
      expect(computeMatchedDefaults(model, rules)).toMatchObject({
        'max-image-dimension': 2000,
      });
    }
    // Older Opus/Sonnet generations DO get implicit resize defaults (M2),
    // but do NOT get the hard image-dimension budget.
    for (const model of [
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-20250514',
    ]) {
      const defaults = computeMatchedDefaults(model, rules);
      expect(defaults['image-resize.maxLongEdge']).toBe(1568);
      expect(defaults['image-resize.maxShortEdge']).toBe(1568);
      expect(defaults['image-resize.maxPixels']).toBe(1_229_312);
      expect(defaults['max-image-dimension']).toBeUndefined();
    }
    // Haiku and Fable are NOT in the Opus/Sonnet family — no resize, no cap.
    expectNoImageResizeDefaults(
      computeMatchedDefaults('claude-haiku-4-5', rules),
    );
    expectNoImageResizeDefaults(
      computeMatchedDefaults('claude-fable-5', rules),
    );
    // Target models get the hard cap but NOT implicit resize defaults.
    for (const model of [
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-sonnet-5',
    ]) {
      const defaults = computeMatchedDefaults(model, rules);
      expect(defaults['image-resize.maxLongEdge']).toBeUndefined();
      expect(defaults['image-resize.maxShortEdge']).toBeUndefined();
      expect(defaults['image-resize.maxPixels']).toBeUndefined();
      expect(defaults['max-image-dimension']).toBe(2000);
    }
  });

  it.each(['openai', 'openai-responses', 'openai-vercel', 'codex'])(
    '%s applies image limits to every gpt- family model',
    (alias) => {
      const entry = loadProviderAliasEntries().find(
        (candidate) =>
          candidate.alias === alias && candidate.source === 'builtin',
      );
      expect(entry).toBeDefined();
      const rules = entry?.config.modelDefaults ?? [];
      expect(computeMatchedDefaults('gpt-future-vision', rules)).toMatchObject({
        'image-resize.maxLongEdge': 2048,
        'image-resize.maxShortEdge': 2048,
        'image-resize.maxPixels': 1_572_864,
      });
      expectNoImageResizeDefaults(computeMatchedDefaults('o4-mini', rules));
    },
  );
  it('user anthropic.config with different modelDefaults shadows the builtin', async () => {
    const { Storage } = await import('@vybestack/llxprt-code-settings');
    const fakeLlxprtDir = path.join(tmpDir, '.llxprt');
    const fakeProvidersDir = path.join(fakeLlxprtDir, 'providers');
    fs.mkdirSync(fakeProvidersDir, { recursive: true });

    // Write a user anthropic.config with custom modelDefaults
    const userConfig = {
      name: 'anthropic',
      baseProvider: 'anthropic',
      'base-url': 'https://api.anthropic.com',
      defaultModel: 'claude-opus-4-6',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      modelDefaults: [
        {
          pattern: 'claude-opus-4-6',
          ephemeralSettings: {
            'reasoning.effort': 'low',
            'custom.user.setting': true,
          },
        },
      ],
    };
    fs.writeFileSync(
      path.join(fakeProvidersDir, 'anthropic.config'),
      JSON.stringify(userConfig, null, 2),
    );

    vi.spyOn(Storage, 'getGlobalDataDir').mockReturnValue(fakeLlxprtDir);

    try {
      const entries = loadProviderAliasEntries();
      // User dir is checked first, so .find() returns the user entry
      const anthropic = entries.find((e) => e.alias === 'anthropic');
      expect(anthropic).toBeDefined();
      expect(anthropic!.source).toBe('user');
      expect(anthropic!.config.modelDefaults).toHaveLength(1);
      expect(anthropic!.config.modelDefaults![0].pattern).toBe(
        'claude-opus-4-6',
      );
      expect(
        anthropic!.config.modelDefaults![0].ephemeralSettings[
          'reasoning.effort'
        ],
      ).toBe('low');
      expect(
        anthropic!.config.modelDefaults![0].ephemeralSettings[
          'custom.user.setting'
        ],
      ).toBe(true);
    } finally {
      (
        Storage.getGlobalDataDir as Mock<typeof Storage.getGlobalDataDir>
      ).mockRestore();
    }
  });
});

describe('providerAliases sandbox field validation', () => {
  let tmpDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-sandbox-test-'));
    warnSpy = vi
      .spyOn(DebugLogger.prototype, 'warn')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('preserves valid sandbox-base-url string', async () => {
    const entries = await loadWithTempConfig(tmpDir, 'sandbox-valid.config', {
      name: 'sandbox-valid',
      baseProvider: 'openai',
      'sandbox-base-url': 'http://host.docker.internal:1234',
    });
    const entry = entries.find((e) => e.alias === 'sandbox-valid');
    expect(entry).toBeDefined();
    expect(entry?.config['sandbox-base-url']).toBe(
      'http://host.docker.internal:1234',
    );
  });

  it('drops non-string sandbox-base-url and warns', async () => {
    const entries = await loadWithTempConfig(tmpDir, 'sandbox-bad-url.config', {
      name: 'sandbox-bad-url',
      baseProvider: 'openai',
      'sandbox-base-url': 12345,
    });
    const entry = entries.find((e) => e.alias === 'sandbox-bad-url');
    expect(entry).toBeDefined();
    expect(entry?.config['sandbox-base-url']).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('non-string sandbox-base-url'),
    );
  });

  it('preserves valid requires-auth boolean', async () => {
    const entries = await loadWithTempConfig(tmpDir, 'auth-valid.config', {
      name: 'auth-valid',
      baseProvider: 'openai',
      'requires-auth': false,
    });
    const entry = entries.find((e) => e.alias === 'auth-valid');
    expect(entry).toBeDefined();
    expect(entry?.config['requires-auth']).toBe(false);
  });

  it('drops non-boolean requires-auth and warns', async () => {
    const entries = await loadWithTempConfig(tmpDir, 'auth-bad.config', {
      name: 'auth-bad',
      baseProvider: 'openai',
      'requires-auth': 'yes',
    });
    const entry = entries.find((e) => e.alias === 'auth-bad');
    expect(entry).toBeDefined();
    expect(entry?.config['requires-auth']).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('non-boolean requires-auth'),
    );
  });
});
