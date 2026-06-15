/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

// This test needs real config files, not the global mock
vi.unmock('./providerAliases.js');

import { loadProviderAliasEntries } from './providerAliases.js';

describe('Built-in provider aliases (Qwen defaults)', () => {
  it('ships qwen and qwenvercel with defaultModel + safe ephemeralSettings', () => {
    const builtinEntries = loadProviderAliasEntries().filter(
      (entry) => entry.source === 'builtin',
    );

    const assertQwenDefaults = (alias: 'qwen' | 'qwenvercel') => {
      const entry = builtinEntries.find(
        (candidate) => candidate.alias === alias,
      );
      expect(entry).toBeDefined();
      expect(entry?.config.defaultModel).toBe('qwen3-coder-plus');

      const ephemerals = (
        entry?.config as { ephemeralSettings?: Record<string, unknown> }
      ).ephemeralSettings;
      expect(ephemerals).toBeDefined();
      expect(ephemerals?.['context-limit']).toBe(200000);
      expect(ephemerals?.max_tokens).toBe(50000);
    };

    assertQwenDefaults('qwen');
    assertQwenDefaults('qwenvercel');
  });
});
