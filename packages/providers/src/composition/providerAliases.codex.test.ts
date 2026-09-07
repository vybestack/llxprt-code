/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';

import {
  computeUnallowedParameters,
  loadProviderAliasEntries,
  type ProviderAliasEntry,
} from './providerAliases.js';
import { computeModelDefaults } from '../runtime/providerMutations.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

function configuredStaticModelIds(
  entry: ProviderAliasEntry | undefined,
): string[] {
  return (entry?.config.staticModels ?? []).map((model) => model.id);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SAMPLING_PARAMETERS = [
  'frequency_penalty',
  'presence_penalty',
  'temperature',
  'top_k',
  'top_p',
] as const;

describe('Codex provider alias', () => {
  it('should have a codex.config file (not .json extension)', () => {
    const codexConfigPath = path.join(__dirname, 'aliases', 'codex.config');
    expect(fs.existsSync(codexConfigPath)).toBe(true);
  });

  it('should load codex alias with correct configuration', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');

    expect(codexAlias).toBeDefined();
    expect(codexAlias?.config.baseProvider).toBe('openai-responses');
    // Config uses 'base-url' (kebab-case) for consistency with profiles
    expect(codexAlias?.config['base-url']).toBe(
      'https://chatgpt.com/backend-api/codex',
    );
    expect(codexAlias?.config.defaultModel).toBe('gpt-5.6-sol');
  });

  it('should set base-url to chatgpt.com/backend-api/codex', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');

    // Config uses 'base-url' (kebab-case) for consistency with profiles
    expect(codexAlias?.config['base-url']).toBe(
      'https://chatgpt.com/backend-api/codex',
    );
  });

  it('should use openai-responses as base provider', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');

    expect(codexAlias?.config.baseProvider).toBe('openai-responses');
  });

  it('should set default model to gpt-5.6-sol', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');

    expect(codexAlias?.config.defaultModel).toBe('gpt-5.6-sol');
  });

  it('should have a description mentioning Codex', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');

    expect(codexAlias?.config.description).toBeDefined();
    expect(codexAlias?.config.description?.toLowerCase()).toContain('codex');
  });

  it('should expose exactly the current Codex model set', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');
    const modelIds = configuredStaticModelIds(codexAlias);

    expect(modelIds).toStrictEqual([
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex-spark',
    ]);
  });

  it('exposes GPT-6 Astra with its OAuth context window while preserving provider defaults', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');
    const astra = codexAlias?.config.staticModels?.find(
      (model) => model.id === 'gpt-6-astra',
    );

    expect(astra).toStrictEqual({
      id: 'gpt-6-astra',
      name: 'GPT-6 Astra',
      contextWindow: 872000,
    });
    expect(codexAlias?.config.ephemeralSettings['context-limit']).toBe(262144);
    expect(codexAlias?.config.defaultModel).toBe('gpt-5.6-sol');
  });

  it('applies Astra and Spark context defaults without changing GPT-5.6 defaults', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');
    const rules = codexAlias?.config.modelDefaults ?? [];

    expect(computeModelDefaults('gpt-6-astra', rules)).toMatchObject({
      'context-limit': 872000,
    });
    for (const model of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
      expect(computeModelDefaults(model, rules)).not.toHaveProperty(
        'context-limit',
      );
    }
    expect(computeModelDefaults('gpt-5.3-codex-spark', rules)).toMatchObject({
      'context-limit': 131072,
    });
    expect(
      [...computeUnallowedParameters('gpt-6-astra', rules)].sort(),
    ).toStrictEqual([...SAMPLING_PARAMETERS]);
    expect(
      [...computeUnallowedParameters('gpt-5.6-sol', rules)].sort(),
    ).toStrictEqual([...SAMPLING_PARAMETERS]);
  });

  it('resolves Astra to 872000 while retaining the 262144 GPT-5.6 effective limit', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');
    if (!codexAlias) {
      throw new Error('codex alias entry not found');
    }
    const effectiveDefaults = (model: string): Record<string, unknown> => ({
      ...codexAlias.config.ephemeralSettings,
      ...computeModelDefaults(model, codexAlias.config.modelDefaults ?? []),
    });

    expect(effectiveDefaults('gpt-6-astra')['context-limit']).toBe(872000);
    expect(effectiveDefaults('gpt-5.6-sol')['context-limit']).toBe(262144);
  });

  it('sanctions only documented gpt-6-astra ids for the 872000 limit and sampling stripping @issue:3576', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');
    if (!codexAlias) {
      throw new Error('codex alias entry not found');
    }
    const rules = codexAlias.config.modelDefaults ?? [];
    const effectiveContextLimit = (model: string): unknown =>
      ({
        ...codexAlias.config.ephemeralSettings,
        ...computeModelDefaults(model, rules),
      })['context-limit'];

    const sanctionedModels = [
      'gpt-6-astra',
      'gpt-6-astra-latest',
      'gpt-6-astra-20260903',
      'gpt-6-astra-2026-09-03',
    ];
    for (const model of sanctionedModels) {
      expect(computeModelDefaults(model, rules)).toMatchObject({
        'context-limit': 872000,
      });
      expect(
        [...computeUnallowedParameters(model, rules)].sort(),
      ).toStrictEqual([...SAMPLING_PARAMETERS]);
      expect(effectiveContextLimit(model)).toBe(872000);
    }

    const lookalikeModels = [
      'gpt-6-astral',
      'gpt-6-astra-mini',
      'gpt-6-astra-solar',
      'gpt-6',
      'gpt-6-turbo',
    ];
    for (const model of lookalikeModels) {
      expect(computeModelDefaults(model, rules)).not.toHaveProperty(
        'context-limit',
      );
      expect(computeUnallowedParameters(model, rules).size).toBe(0);
      expect(effectiveContextLimit(model)).toBe(262144);
    }

    // Regression guards: GPT-5 behavior survives the anchored gpt-6 rules.
    expect(
      [...computeUnallowedParameters('gpt-5.6-sol', rules)].sort(),
    ).toStrictEqual([...SAMPLING_PARAMETERS]);
    expect(effectiveContextLimit('gpt-5.6-sol')).toBe(262144);
    expect(effectiveContextLimit('gpt-5.3-codex-spark')).toBe(131072);
  });

  it('should preserve the gpt-5.3-codex-spark 131072 context window', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');
    const spark = codexAlias?.config.staticModels?.find(
      (m) => m.id === 'gpt-5.3-codex-spark',
    );

    expect(spark).toBeDefined();
    expect(spark?.contextWindow).toBe(131072);
  });

  it('should be marked as builtin source', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');

    expect(codexAlias?.source).toBe('builtin');
  });

  it('should retain the 262144 Codex context-limit in ephemeralSettings @issue:2483', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');

    expect(codexAlias?.config.ephemeralSettings['context-limit']).toBe(262144);
  });

  it('sets contextWindow 262144 on GPT-5.6 tier staticModels @issue:2483', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');
    const tiers = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];

    for (const tierId of tiers) {
      const model = codexAlias?.config.staticModels?.find(
        (m) => m.id === tierId,
      );
      expect(model).toBeDefined();
      expect(model?.contextWindow).toBe(262144);
    }
  });

  it('pins media.pdf.enabled=false in ephemeralSettings @issue:2608', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');

    expect(codexAlias?.config.ephemeralSettings['media.pdf.enabled']).toBe(
      false,
    );
  });
});
