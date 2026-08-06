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
  runStartupMigrationWithPath,
  shouldMigrate,
  MIGRATION_MARKER_VERSION,
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

  it('does not recreate a deleted canonical entry when the migration marker is current', () => {
    // Safety property (#3081): with a CURRENT marker, shouldMigrate returns
    // false and the legacy copy pass is skipped, so an entry the user
    // deliberately deleted from the canonical directories is never resurrected
    // from the legacy directory. oauth_creds.json is the concrete case — it is
    // deleted by OAuthCredentialStorage.clearCredentials() on logout, and
    // re-running the copy pass would silently re-authenticate a user who
    // logged out. The marker version stays at 1: bumping it would re-run the
    // whole copy pass and recreate every deleted entry.
    writeFile(legacyDir, 'oauth_creds.json', '{"token":"LEGACY"}');
    // Canonical data dir exists but oauth_creds.json was deleted by the user.
    fs.mkdirSync(destinations.dataDir, { recursive: true });
    writeFile(
      destinations.dataDir,
      '.migration-complete.json',
      JSON.stringify({
        version: MIGRATION_MARKER_VERSION,
        completedAt: '2026-01-01T00:00:00.000Z',
      }),
    );

    // A current marker means the production startup orchestrator must skip
    // the legacy copy pass. Calling performMigration directly would bypass the
    // marker by design; runStartupMigrationWithPath is the single production
    // authority that composes shouldMigrate with the copy operation.
    expect(shouldMigrate(legacyDir, destinations)).toBe(false);
    runStartupMigrationWithPath(legacyDir, destinations);

    // The deleted credential is not recreated from the legacy directory.
    expect(
      fs.existsSync(path.join(destinations.dataDir, 'oauth_creds.json')),
    ).toBe(false);
  });

  it('gives top-level skills/ precedence over tmp/skills/ on a same-name collision', () => {
    // Both <legacy>/skills and <legacy>/tmp/skills target <config>/skills.
    // For a same-named skill, the top-level copy must win (explicit
    // precedence implemented by deterministic name-sorted iteration order
    // combined with no-overwrite COPYFILE_EXCL copy semantics).
    writeFile(
      legacyDir,
      path.join('skills', 'shared', 'SKILL.md'),
      'TOP_LEVEL',
    );
    writeFile(
      legacyDir,
      path.join('tmp', 'skills', 'shared', 'SKILL.md'),
      'TMP',
    );

    performMigration(legacyDir, destinations);

    expect(
      fs.readFileSync(
        path.join(destinations.configDir, 'skills', 'shared', 'SKILL.md'),
        'utf-8',
      ),
    ).toBe('TOP_LEVEL');
  });
});
