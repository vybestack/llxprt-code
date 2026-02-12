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

  it('has modelDefaults for kimi.* with reasoning settings', () => {
    const entries = loadProviderAliasEntries();
    const entry = entries.find((candidate) => candidate.alias === 'kimi');

    expect(entry?.config.modelDefaults).toBeDefined();
    expect(Array.isArray(entry?.config.modelDefaults)).toBe(true);
    expect(entry?.config.modelDefaults).toHaveLength(1);
    expect(entry?.config.modelDefaults?.[0]?.pattern).toBe('kimi.*');

    const defaults = entry?.config.modelDefaults?.[0]?.ephemeralSettings;
    expect(defaults?.['reasoning.effort']).toBe('medium');
    expect(defaults?.['reasoning.enabled']).toBe(true);
    expect(defaults?.['reasoning.includeInResponse']).toBe(true);
    expect(defaults?.['reasoning.includeInContext']).toBe(true);
    expect(defaults?.['reasoning.stripFromContext']).toBe('none');
  });
});
