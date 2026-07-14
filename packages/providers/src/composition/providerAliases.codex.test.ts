/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';

// This test needs real config files, not the global mock
vi.unmock('./providerAliases.js');

import { loadProviderAliasEntries } from './providerAliases.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    const modelIds = (codexAlias?.config.staticModels ?? []).map((m) => m.id);

    expect(modelIds).toStrictEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex-spark',
    ]);
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
});
