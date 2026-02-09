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
    expect(codexAlias?.config.defaultModel).toBe('gpt-5.3-codex');
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

  it('should set default model to gpt-5.3-codex', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');

    expect(codexAlias?.config.defaultModel).toBe('gpt-5.3-codex');
  });

  it('should have a description mentioning Codex', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');

    expect(codexAlias?.config.description).toBeDefined();
    expect(codexAlias?.config.description?.toLowerCase()).toContain('codex');
  });

  it('should include staticModels with gpt-5.3-codex first', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');

    expect(codexAlias?.config.staticModels).toBeDefined();
    expect(Array.isArray(codexAlias?.config.staticModels)).toBe(true);
    expect(codexAlias?.config.staticModels?.[0]?.id).toBe('gpt-5.3-codex');
    expect(
      codexAlias?.config.staticModels?.some((m) => m.id === 'gpt-5.2-codex'),
    ).toBe(true);
  });

  it('should be marked as builtin source', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');

    expect(codexAlias?.source).toBe('builtin');
  });
});
