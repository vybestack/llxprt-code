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
import stripJsonComments from 'strip-json-comments';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('codex.config reasoning.summary default @issue:922', () => {
  it('should have a codex.config file', () => {
    const codexConfigPath = path.join(__dirname, 'aliases', 'codex.config');
    expect(fs.existsSync(codexConfigPath)).toBe(true);
  });

  it('should set reasoning.summary=auto in ephemerals', () => {
    // Read the config file directly to avoid vitest module resolution issues
    const codexConfigPath = path.join(__dirname, 'aliases', 'codex.config');
    const raw = fs.readFileSync(codexConfigPath, 'utf-8');
    const config = JSON.parse(stripJsonComments(raw));

    expect(config.ephemeralSettings).toBeDefined();
    expect(config.ephemeralSettings['reasoning.summary']).toBe('auto');
  });

  it('should set reasoning.effort in ephemerals (existing behavior)', () => {
    // Read the config file directly to avoid vitest module resolution issues
    const codexConfigPath = path.join(__dirname, 'aliases', 'codex.config');
    const raw = fs.readFileSync(codexConfigPath, 'utf-8');
    const config = JSON.parse(stripJsonComments(raw));

    expect(config.ephemeralSettings).toBeDefined();
    // Codex should have some default effort level
    expect(config.ephemeralSettings['reasoning.effort']).toBeDefined();
  });
});
