/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared type definitions for the path-migration and profile-repair modules.
 * Extracted into a standalone module so that {@link profileRepair} and
 * {@link pathMigration} can both depend on these contracts without creating
 * a circular import (pathMigration imports profileRepair for orchestration).
 */

export interface MigrationDestinations {
  readonly configDir: string;
  readonly dataDir: string;
  readonly cacheDir: string;
  readonly logDir: string;
}

export interface MigrationResult {
  readonly migrated: boolean;
  readonly reason: string;
  readonly filesCopied: number;
  readonly profilesRepaired?: number;
  readonly error?: boolean;
}

export interface StartupMigrationResult {
  readonly migration: MigrationResult;
  readonly repair: MigrationResult;
}
