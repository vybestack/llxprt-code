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
    expect(codexAlias?.config.defaultModel).toBe('gpt-5.5');
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

  it('should set default model to gpt-5.5', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');

    expect(codexAlias?.config.defaultModel).toBe('gpt-5.5');
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
});
