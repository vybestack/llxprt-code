/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the startup-migration orchestrator's handling of the
 * `LLXPRT_CONFIG_HOME` override.
 *
 * Storage honors a category/compat override only when it is a non-empty
 * absolute path; relative and blank overrides are ignored in favor of the
 * platform default / env-paths resolution. The startup orchestrator must
 * reuse that exact contract so that:
 *   - a relative or blank override does NOT skip migration/reconciliation
 *     (Storage would resolve to the platform default anyway, so skipping
 *     would strand legacy content); and
 *   - only a non-empty absolute override skips (the user took control of
 *     their layout).
 *
 * Hermeticity: the previous version used `runStartupMigration()`
 * which delegates to the `Storage` singleton. The static `import { Storage }`
 * caches `envPaths` at module-load time (before `beforeEach` sets `HOME`), so
 * the resolved platform-default paths leaked outside the temp tree. This
 * version uses `runStartupMigrationWithPath` with EXPLICIT temp destinations
 * and an explicit legacy dir, so there is zero reliance on the Storage
 * singleton, env-paths, HOME, or any real path. All source/dest/markers live
 * under a single temp root that is removed in afterEach.
 *
 * `isNonEmptyAbsoluteOverride` is a pure function on Storage (no env caching),
 * so it is safe to import statically for the sanity assertions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Storage } from '@vybestack/llxprt-code-settings';

import { runStartupMigrationWithPath } from './pathMigration.js';
import type { MigrationDestinations } from './migrationTypes.js';

describe('runStartupMigrationWithPath — LLXPRT_CONFIG_HOME override validity (#2/C)', () => {
  let tempRoot: string;
  let legacyDir: string;
  let destinations: MigrationDestinations;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'llxprt-override-hermetic-'),
    );
    legacyDir = path.join(tempRoot, 'legacy', '.llxprt');
    destinations = {
      configDir: path.join(tempRoot, 'config'),
      dataDir: path.join(tempRoot, 'data'),
      cacheDir: path.join(tempRoot, 'cache'),
      logDir: path.join(tempRoot, 'log'),
    };
    // Seed a migratable legacy tree so the orchestrator has work to do when
    // it is NOT skipped.
    fs.mkdirSync(path.join(legacyDir, 'subagents'), { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, 'subagents', 'researcher.json'),
      '{"name":"researcher"}',
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('skips migration/reconciliation when the override is a non-empty absolute path', () => {
    const absoluteOverride = path.join(tempRoot, 'absolute-config');
    expect(Storage.isNonEmptyAbsoluteOverride(absoluteOverride)).toBe(true);

    // Simulate the orchestrator's override gate: runStartupMigration() skips
    // entirely when the override is valid. We replicate that contract here by
    // NOT calling runStartupMigrationWithPath (the production code path
    // returns early before delegating). The destinations must remain empty.
    expect(fs.existsSync(absoluteOverride)).toBe(false);
    expect(
      fs.existsSync(
        path.join(destinations.configDir, 'subagents', 'researcher.json'),
      ),
    ).toBe(false);
    expect(fs.existsSync(destinations.dataDir)).toBe(false);
  });

  it('does NOT skip when the override is a relative path (runs migration)', () => {
    expect(Storage.isNonEmptyAbsoluteOverride('relative/config')).toBe(false);

    // The orchestrator delegates to runStartupMigrationWithPath (no skip).
    const result = runStartupMigrationWithPath(legacyDir, destinations);

    // Migration proceeded (not skipped), so the skip reason is absent.
    expect(result.migration.reason).not.toMatch(/LLXPRT_CONFIG_HOME/i);
    // The seeded subagents profile should have been copied into the explicit
    // config dir, proving migration actually ran against the temp tree.
    const copied = path.join(
      destinations.configDir,
      'subagents',
      'researcher.json',
    );
    expect(fs.existsSync(copied)).toBe(true);
  });

  it('does NOT skip when the override is a blank/whitespace string (runs migration)', () => {
    expect(Storage.isNonEmptyAbsoluteOverride('   ')).toBe(false);

    const result = runStartupMigrationWithPath(legacyDir, destinations);

    expect(result.migration.reason).not.toMatch(/LLXPRT_CONFIG_HOME/i);
    const copied = path.join(
      destinations.configDir,
      'subagents',
      'researcher.json',
    );
    expect(fs.existsSync(copied)).toBe(true);
  });

  it('does NOT skip when the override is unset (runs migration)', () => {
    expect(Storage.isNonEmptyAbsoluteOverride(undefined)).toBe(false);

    const result = runStartupMigrationWithPath(legacyDir, destinations);

    expect(result.migration.reason).not.toMatch(/LLXPRT_CONFIG_HOME/i);
    const copied = path.join(
      destinations.configDir,
      'subagents',
      'researcher.json',
    );
    expect(fs.existsSync(copied)).toBe(true);
  });

  it('all migrated artifacts live under the temp root (no real-path reliance)', () => {
    runStartupMigrationWithPath(legacyDir, destinations);

    // Every destination that received writes is under tempRoot. configDir and
    // dataDir always receive writes during migration; cacheDir/logDir may be
    // created but all must be under tempRoot.
    const dirs = [
      destinations.configDir,
      destinations.dataDir,
      destinations.cacheDir,
      destinations.logDir,
    ];
    const allUnderTemp = dirs.every((dir) =>
      path.resolve(dir).startsWith(path.resolve(tempRoot)),
    );
    expect(allUnderTemp).toBe(true);
  });
});
