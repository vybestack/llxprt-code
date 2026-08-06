/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Exhaustive one-time parity coverage for the data-driven model-limits
 * catalog. This test checks every legacy exact / prefix / ordered value
 * against the shipped catalog so that deletions or value drift fail loudly.
 *
 * The legacy table is stored as a checked-in JSON fixture
 * (legacy-model-limits.expected.txt) — NOT as a production TypeScript
 * hardcode or package asset — so the production resolver stays data-driven while
 * the fixture pins the full set of values that existed before the refactor.
 *
 * If a value is intentionally changed, update the fixture in the same PR.
 *
 * @issue #2280 — Make default model limits data-driven.
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'bun:test';
import { ModelLimitsCatalogSchema } from './model-limits.schema.js';
import {
  DEFAULT_TOKEN_LIMIT,
  resolveOrderedRuleFromCatalog,
  tokenLimit,
} from './tokenLimits.js';
import catalogData from './model-limits.json' with { type: 'json' };

const legacyExpected = ModelLimitsCatalogSchema.parse(
  JSON.parse(
    readFileSync(
      new URL('./legacy-model-limits.expected.txt', import.meta.url),
      'utf8',
    ),
  ),
);

describe('model-limits catalog exhaustive parity (@issue:2280)', () => {
  it('defaultLimit matches the legacy value', () => {
    expect(catalogData.defaultLimit).toBe(legacyExpected.defaultLimit);
  });

  it('exactLimits has the same number of entries as the legacy table', () => {
    expect(Object.keys(catalogData.exactLimits)).toHaveLength(
      Object.keys(legacyExpected.exactLimits).length,
    );
  });

  it('every legacy exact-limit key+value is present in the catalog', () => {
    for (const [model, limit] of Object.entries(legacyExpected.exactLimits)) {
      expect(catalogData.exactLimits[model]).toBe(limit);
    }
  });

  it('the catalog contains no exact-limit keys absent from the legacy table', () => {
    for (const model of Object.keys(catalogData.exactLimits)) {
      expect(legacyExpected.exactLimits[model]).toBeDefined();
    }
  });

  it('prefixLimits matches the legacy table entry-by-entry', () => {
    expect(catalogData.prefixLimits).toStrictEqual(legacyExpected.prefixLimits);
  });

  it('orderedRules count matches the legacy table', () => {
    expect(catalogData.orderedRules).toHaveLength(
      legacyExpected.orderedRules.length,
    );
  });

  it('every ordered rule matches its legacy counterpart (type, match, limit)', () => {
    for (let i = 0; i < legacyExpected.orderedRules.length; i++) {
      const legacy = legacyExpected.orderedRules[i];
      const actual = catalogData.orderedRules[i];
      expect(actual).toStrictEqual(legacy);
    }
  });
});

describe('substringCaseInsensitive normalizes both sides (@issue:2280)', () => {
  it.each([
    'Claude-Sonnet-5-20260630',
    'CLAUDE-FABLE-5-20260701',
    'Claude-Opus-5-20260724',
  ])(
    'matches mixed-case model %s against its lowercase catalog rule',
    (model) => {
      const catalog = ModelLimitsCatalogSchema.parse(catalogData);
      expect(resolveOrderedRuleFromCatalog(catalog, model, '')).toBe(200_000);
    },
  );

  it('matches a mixed-case model against a mixed-case catalog substring', () => {
    const mixedCatalog = ModelLimitsCatalogSchema.parse({
      defaultLimit: 1048576,
      exactLimits: {},
      prefixLimits: [],
      orderedRules: [
        {
          type: 'substringCaseInsensitive',
          substring: 'Claude-SonNet-5',
          limit: 200000,
        },
      ],
    });
    expect(
      resolveOrderedRuleFromCatalog(
        mixedCatalog,
        'CLAUDE-SONNET-5-20260630',
        '',
      ),
    ).toBe(200_000);
  });
});

describe('exact-limit lookup safety (@issue:2280)', () => {
  it('does not treat inherited object properties as model entries', () => {
    expect(tokenLimit('toString')).toBe(DEFAULT_TOKEN_LIMIT);
  });
});

describe('model-limits package asset (@issue:2280)', () => {
  it('copies the catalog beside the compiled core module', () => {
    const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
    const repositoryRoot = join(packageRoot, '..', '..');
    const sourceCatalog = join(packageRoot, 'src', 'core', 'model-limits.json');
    const copyScript = join(repositoryRoot, 'scripts', 'copy_files.ts');
    const tempPackage = mkdtempSync(join(tmpdir(), 'llxprt-model-limits-'));
    const stagedCoreDir = join(tempPackage, 'src', 'core');
    const builtCatalog = join(
      tempPackage,
      'dist',
      'src',
      'core',
      'model-limits.json',
    );

    try {
      mkdirSync(stagedCoreDir, { recursive: true });
      copyFileSync(sourceCatalog, join(stagedCoreDir, 'model-limits.json'));
      execFileSync('bun', [copyScript], {
        cwd: tempPackage,
        stdio: 'pipe',
        timeout: 10_000,
      });
      expect(readFileSync(builtCatalog)).toStrictEqual(
        readFileSync(sourceCatalog),
      );
    } finally {
      rmSync(tempPackage, { recursive: true, force: true });
    }
  });
});
