/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * TDD tests for unallowedParameters in ModelDefaultRule (issue #125 follow-up).
 * Models like Kimi K3 and Claude Opus 5 reject sampling params with HTTP 400;
 * alias configs declare those params as unallowed so the model-config dialog
 * hides them.
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

import {
  computeUnallowedParameters,
  loadProviderAliasEntries,
} from './providerAliases.js';

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

describe('providerAliases unallowedParameters', () => {
  let tmpDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-unallowed-'));
    warnSpy = vi
      .spyOn(DebugLogger.prototype, 'warn')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('parsing', () => {
    it('parses a valid unallowedParameters array on a rule', async () => {
      const entries = await loadWithTempConfig(tmpDir, 'k3.config', {
        name: 'k3',
        baseProvider: 'openai',
        modelDefaults: [
          {
            pattern: 'k3',
            ephemeralSettings: { 'reasoning.effort': 'max' },
            unallowedParameters: ['temperature', 'top_p'],
          },
        ],
      });

      const rule = entries.find((e) => e.alias === 'k3')?.config
        .modelDefaults?.[0];
      expect(rule?.unallowedParameters).toStrictEqual(['temperature', 'top_p']);
    });

    it('strips a rule whose unallowedParameters is not an array of strings', async () => {
      const entries = await loadWithTempConfig(tmpDir, 'bad.config', {
        name: 'bad',
        baseProvider: 'openai',
        modelDefaults: [
          {
            pattern: 'bad',
            ephemeralSettings: { 'reasoning.effort': 'max' },
            unallowedParameters: 'temperature',
          },
        ],
      });

      const entry = entries.find((e) => e.alias === 'bad');
      // The invalid RULE is stripped, but the alias entry itself is preserved.
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults ?? []).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('unallowedParameters'),
      );
    });

    it('strips a rule whose unallowedParameters contains empty strings', async () => {
      const entries = await loadWithTempConfig(tmpDir, 'empty.config', {
        name: 'empty',
        baseProvider: 'openai',
        modelDefaults: [
          {
            pattern: 'empty',
            ephemeralSettings: { 'reasoning.effort': 'max' },
            unallowedParameters: ['temperature', ''],
          },
        ],
      });

      const entry = entries.find((e) => e.alias === 'empty');
      expect(entry).toBeDefined();
      expect(entry?.config.modelDefaults ?? []).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('unallowedParameters'),
      );
    });

    it('keeps rules without unallowedParameters unchanged', async () => {
      const entries = await loadWithTempConfig(tmpDir, 'plain.config', {
        name: 'plain',
        baseProvider: 'openai',
        modelDefaults: [
          {
            pattern: 'plain',
            ephemeralSettings: { 'reasoning.effort': 'max' },
          },
        ],
      });

      const rule = entries.find((e) => e.alias === 'plain')?.config
        .modelDefaults?.[0];
      expect(rule).toBeDefined();
      expect(rule?.unallowedParameters).toBeUndefined();
    });
  });

  describe('computeUnallowedParameters', () => {
    const rules = [
      {
        pattern: 'kimi|k3',
        ephemeralSettings: {},
        unallowedParameters: ['temperature', 'top_p'],
      },
      {
        pattern: 'kimi-k3',
        ephemeralSettings: {},
        unallowedParameters: ['top_k'],
      },
      {
        pattern: 'kimi-k3',
        ephemeralSettings: {},
        // Rule without the field — must not contribute or crash.
      },
    ];

    it('unions unallowed params across all matching rules', () => {
      const result = computeUnallowedParameters('kimi-k3', rules);
      expect([...result].sort()).toStrictEqual([
        'temperature',
        'top_k',
        'top_p',
      ]);
    });

    it('matches case-insensitively like computeModelDefaults', () => {
      const result = computeUnallowedParameters('KIMI-K3', rules);
      expect(result.has('temperature')).toBe(true);
    });

    it('returns an empty set when no rules match', () => {
      const result = computeUnallowedParameters('gpt-5', rules);
      expect(result.size).toBe(0);
    });

    it('returns an empty set for empty rules', () => {
      expect(computeUnallowedParameters('anything', []).size).toBe(0);
    });

    it('does not match models outside the pattern', () => {
      const result = computeUnallowedParameters('claude-opus-5', rules);
      expect(result.size).toBe(0);
    });
  });
});
