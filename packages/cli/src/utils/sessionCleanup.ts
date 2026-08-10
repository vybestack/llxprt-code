/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CLI entry point for session-recording cleanup.
 *
 * Delegates to the core session-recording janitor which performs a global
 * sweep across all 64-hex project-hash directories under the global temp
 * root.  Default-on with a 4 GiB aggregate size budget, no default age/count
 * limits, and a 1-day minimum retention floor.
 *
 * User-provided `sessionRetention` objects are resolved over defaults at the
 * consumer so a partial object cannot accidentally remove default-on size
 * bounding (AC-2).
 */

import {
  emptyResult,
  resolveRetentionConfig,
  runSessionCleanup,
  type Config,
  type SessionCleanupResult,
} from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-storage';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import type { Settings } from '../config/settings.js';

export type { SessionCleanupResult as CleanupResult };

/**
 * Main entry point for session cleanup during CLI startup.
 *
 * Cleanup is default-on.  The global janitor scans all project-hash
 * directories, losslessly archives eligible raw sessions, evicts cold
 * archives to meet the size budget, cleans stale locks, and removes
 * genuinely empty directories — all behind a single cross-process lease.
 *
 * Configuration resolution is intentionally separated from external,
 * best-effort filesystem handling (finding D): an invalid
 * `sessionRetention` value surfaces as a thrown configuration error rather
 * than being swallowed into a `configuredByteLimit`-0 result.  External
 * filesystem failures remain best-effort (logged, never blocking startup)
 * and preserve the resolved configured limit in their diagnostics.
 *
 * @param config - The CLI configuration (provides session ID and debug mode).
 * @param settings - User settings (provides `sessionRetention` overrides).
 * @param globalTempDirOverride - Optional override for the machine-global temp
 *   root.  Production callers omit this; it defaults to
 *   `Storage.getGlobalTempDir()`.  Tests pass a real temp directory so the
 *   full CLI→core pipeline is exercised without affecting the real machine
 *   global temp directory.
 */
export async function cleanupExpiredSessions(
  config: Config,
  settings: Settings,
  globalTempDirOverride?: string,
): Promise<SessionCleanupResult> {
  // Configuration resolution happens before any external filesystem access so
  // invalid settings fail fast and clearly (finding D).  This throw is
  // intentionally NOT caught here — it is a configuration error.
  const resolvedConfig = resolveRetentionConfig(settings.sessionRetention);

  const globalTempDir = globalTempDirOverride ?? Storage.getGlobalTempDir();
  const currentSessionId = config.getSessionId();

  try {
    const result = await runSessionCleanup({
      globalTempDir,
      currentSessionId,
      config: resolvedConfig,
    });

    if (config.getDebugMode() && !result.disabled) {
      debugLogger.debug(
        `Session cleanup: scanned=${result.scanned} archived=${result.archived} ` +
          `rawDeleted=${result.rawDeleted} archiveDeleted=${result.archiveDeleted} ` +
          `staleLocksRemoved=${result.staleLocksRemoved} skipped=${result.skipped} ` +
          `failed=${result.failed} bytesBefore=${result.bytesBefore} ` +
          `bytesAfter=${result.bytesAfter} wonLease=${result.janitorWonLease}`,
      );
    }

    return result;
  } catch (error) {
    // Best-effort external filesystem failure — log and continue startup
    // (AC-9).  The resolved configured limit is preserved so diagnostics
    // remain coherent instead of reporting a zeroed limit (finding D).
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    debugLogger.error(
      `Session cleanup failed (configuredByteLimit=${resolvedConfig.maxTotalSizeBytes}): ${errorMessage}`,
    );
    return {
      ...emptyResult(false, false, resolvedConfig.maxTotalSizeBytes),
      failed: 1,
    };
  }
}
