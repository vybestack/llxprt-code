/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * TDD tests for codex.config reasoning.summary default
 * @issue #922 - GPT-5.2-Codex thinking blocks not visible
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { loadProviderAliasEntries } from './providerAliases.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('codex.config reasoning.summary default @issue:922', () => {
  it('should have a codex.config file', () => {
    const codexConfigPath = path.join(__dirname, 'aliases', 'codex.config');
    expect(fs.existsSync(codexConfigPath)).toBe(true);
  });

  it('should set reasoning.summary=auto in ephemerals', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');

    expect(codexAlias).toBeDefined();
    expect(codexAlias?.config.ephemeralSettings).toBeDefined();
    expect(codexAlias?.config.ephemeralSettings?.['reasoning.summary']).toBe(
      'auto',
    );
  });

  it('should set reasoning.effort in ephemerals (existing behavior)', () => {
    const aliases = loadProviderAliasEntries();
    const codexAlias = aliases.find((a) => a.alias === 'codex');

    expect(codexAlias).toBeDefined();
    // Codex should have some default effort level
    expect(
      codexAlias?.config.ephemeralSettings?.['reasoning.effort'],
    ).toBeDefined();
  });
});
