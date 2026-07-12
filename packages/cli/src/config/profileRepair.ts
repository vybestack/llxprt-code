/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import {
  repairCanonicalProfiles,
  type CanonicalRepairOutcome,
} from '@vybestack/llxprt-code-settings';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import type {
  MigrationDestinations,
  MigrationResult,
} from './migrationTypes.js';

const logger = new DebugLogger('llxprt:config:profileRepair');

/**
 * CLI thin orchestrator: delegates the actual repair transaction to the
 * settings-owned {@link repairCanonicalProfiles} cohesive API. This module
 * only translates the outcome into the CLI {@link MigrationResult} shape for
 * marker/reporting orchestration in pathMigration.ts.
 *
 * Marker semantics (#4): the caller (pathMigration) should only stamp the
 * repair marker when this returns a non-busy result with >=1 actual repair.
 * 'busy' returns a benign deferred result with NO error flag so no marker is
 * written and no user-facing warning is emitted — the next startup retries.
 */
export function repairProfiles(
  legacyDir: string,
  destinations: MigrationDestinations,
): MigrationResult {
  const canonicalDir = path.join(destinations.configDir, 'profiles');
  const legacyProfilesDir = path.join(legacyDir, 'profiles');

  let outcome: CanonicalRepairOutcome;
  try {
    outcome = repairCanonicalProfiles(canonicalDir, legacyProfilesDir);
  } catch (error) {
    logger.error('Profile repair failed:', error);
    return {
      migrated: false,
      reason: 'profile repair encountered an internal error',
      filesCopied: 0,
      error: true,
    };
  }

  return translateOutcome(outcome);
}

/**
 * Translate the settings-owned repair outcome into a CLI MigrationResult.
 *
 * - 'repaired': success, profilesRepaired > 0.
 * - 'none': no candidates found — not an error, no marker (so later
 *   appearance is not suppressed).
 * - 'busy': lock busy — benign deferral, NO error flag, NO marker. Next
 *   startup retries.
 * - 'error': repair attempt failed.
 */
function translateOutcome(outcome: CanonicalRepairOutcome): MigrationResult {
  switch (outcome.kind) {
    case 'repaired':
      return {
        migrated: true,
        reason: 'profile repair complete',
        filesCopied: 0,
        profilesRepaired: outcome.profilesRepaired,
      };
    case 'none':
      return {
        migrated: false,
        reason: 'no profiles to repair',
        filesCopied: 0,
      };
    case 'busy':
      // Benign deferral — no error, no marker. Next startup retries.
      return {
        migrated: false,
        reason: 'profiles lock busy; repair deferred to next startup',
        filesCopied: 0,
      };
    case 'error':
      logger.debug('Profile repair errors:', outcome.errors);
      return {
        migrated: false,
        reason: 'profile repair encountered an internal error',
        filesCopied: 0,
        error: true,
      };
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}
