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
    expect(entry?.config.baseUrl).toBe('https://api.kimi.com/coding/v1');
    expect(entry?.config.defaultModel).toBe('kimi-for-coding');

    const ephemerals = entry?.config.ephemeralSettings;
    expect(ephemerals).toBeDefined();
    expect(ephemerals?.['context-limit']).toBe(262144);
    expect(ephemerals?.max_tokens).toBe(32768);
    expect(ephemerals?.['reasoning.effort']).toBe('medium');
    expect(ephemerals?.['reasoning.enabled']).toBe(true);
    expect(ephemerals?.['reasoning.includeInResponse']).toBe(true);
    expect(ephemerals?.['reasoning.includeInContext']).toBe(true);
    expect(ephemerals?.['reasoning.stripFromContext']).toBe('none');
    expect(ephemerals?.['user-agent']).toBe('RooCode/1.0');
  });
});
