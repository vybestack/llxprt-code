/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #3081: the legacy → canonical migration
 * categorizer previously routed `welcomeConfig.json`, `trustedFolders.json`
 * and `skills/` to the DATA directory, while the application reads all three
 * from the CONFIG directory. These tests drive the REAL `performMigration`
 * (and `shouldMigrate`/`isMigrationComplete`) against real temp directories
 * — no module mocking, no mock-theater — so they pin observable outcomes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  performMigration,
  shouldMigrate,
  type MigrationDestinations,
} from '../src/config/pathMigration.js';

async function makeTempDir(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'llxprt-migration-3081-'));
}

function makeDestinations(base: string): MigrationDestinations {
  return {
    configDir: path.join(base, 'config'),
    dataDir: path.join(base, 'data'),
    cacheDir: path.join(base, 'cache'),
    logDir: path.join(base, 'log'),
  };
}

function writeFile(root: string, relPath: string, content: string): void {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe('#3081 migration categorizer (config entries)', () => {
  let legacyDir: string;
  let destBase: string;
  let destinations: MigrationDestinations;

  beforeEach(async () => {
    legacyDir = await makeTempDir();
    destBase = await makeTempDir();
    destinations = makeDestinations(destBase);
  });

  afterEach(async () => {
    await fs.promises.rm(legacyDir, { recursive: true, force: true });
    await fs.promises.rm(destBase, { recursive: true, force: true });
  });

  it('migrates legacy welcomeConfig.json to the CONFIG destination (not data)', () => {
    writeFile(
      legacyDir,
      'welcomeConfig.json',
      JSON.stringify({ welcomeCompleted: true }),
    );

    const result = performMigration(legacyDir, destinations);

    expect(result.filesCopied).toBeGreaterThan(0);
    expect(
      fs.existsSync(path.join(destinations.configDir, 'welcomeConfig.json')),
    ).toBe(true);
    // It must NOT also land in the data directory (the old, buggy route).
    expect(
      fs.existsSync(path.join(destinations.dataDir, 'welcomeConfig.json')),
    ).toBe(false);
  });

  it('migrates legacy trustedFolders.json to the CONFIG destination (not data)', () => {
    writeFile(
      legacyDir,
      'trustedFolders.json',
      JSON.stringify({ trustedFolders: [] }),
    );

    const result = performMigration(legacyDir, destinations);

    expect(result.filesCopied).toBeGreaterThan(0);
    expect(
      fs.existsSync(path.join(destinations.configDir, 'trustedFolders.json')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(destinations.dataDir, 'trustedFolders.json')),
    ).toBe(false);
  });

  it('migrates a legacy skills/<name>/SKILL.md tree under <configDir>/skills/', () => {
    writeFile(legacyDir, path.join('skills', 'greet', 'SKILL.md'), '# greet');

    const result = performMigration(legacyDir, destinations);

    expect(result.filesCopied).toBeGreaterThan(0);
    expect(
      fs.existsSync(
        path.join(destinations.configDir, 'skills', 'greet', 'SKILL.md'),
      ),
    ).toBe(true);
  });

  it('does not overwrite a pre-existing canonical file on re-run after the marker version bump', () => {
    // Pre-existing canonical welcome marker (already migrated correctly).
    writeFile(destinations.configDir, 'welcomeConfig.json', 'CANONICAL');
    // Legacy still carries a (different) copy.
    writeFile(legacyDir, 'welcomeConfig.json', 'LEGACY');
    // Stamp an outdated v1 marker: after the bump to v2, isMigrationComplete
    // must treat it as stale so the re-run actually happens.
    fs.mkdirSync(destinations.dataDir, { recursive: true });
    writeFile(
      destinations.dataDir,
      '.migration-complete.json',
      JSON.stringify({ version: 1, completedAt: '1970-01-01T00:00:00.000Z' }),
    );

    // The marker version bump causes shouldMigrate to re-run.
    expect(shouldMigrate(legacyDir, destinations)).toBe(true);

    performMigration(legacyDir, destinations);

    // No-overwrite copy semantics: the canonical file is untouched.
    expect(
      fs.readFileSync(
        path.join(destinations.configDir, 'welcomeConfig.json'),
        'utf-8',
      ),
    ).toBe('CANONICAL');
  });

  it('keeps the tmp/skills special case benign alongside the top-level skills config entry', () => {
    // Both <legacy>/skills and <legacy>/tmp/skills now target <config>/skills.
    // They must merge without clobbering each other (distinct child names).
    writeFile(legacyDir, path.join('skills', 'a', 'SKILL.md'), '# a');
    writeFile(legacyDir, path.join('tmp', 'skills', 'b', 'SKILL.md'), '# b');

    const result = performMigration(legacyDir, destinations);

    expect(result.filesCopied).toBeGreaterThan(0);
    expect(
      fs.existsSync(
        path.join(destinations.configDir, 'skills', 'a', 'SKILL.md'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(destinations.configDir, 'skills', 'b', 'SKILL.md'),
      ),
    ).toBe(true);
  });
});
