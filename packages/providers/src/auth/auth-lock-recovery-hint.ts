/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds the user-facing message shown when an auth lock cannot be acquired,
 * including the `/auth ... lock status|unlock` commands that apply to the
 * observed lock state.
 */

import type { TokenStore } from './types.js';

function buildAuthCommand(
  providerName: string,
  action: 'lock status' | 'unlock',
  bucket: string | undefined,
  flags: string = '',
): string {
  const bucketArgument = bucket === undefined ? '' : ` ${bucket}`;
  const flagArguments = flags === '' ? '' : ` ${flags}`;
  return `/auth ${providerName} ${action}${bucketArgument}${flagArguments}`;
}

export async function buildLockRecoveryHint(
  tokenStore: TokenStore,
  providerName: string,
  bucket: string | undefined,
): Promise<string> {
  const bucketLabel = bucket ? `/${bucket}` : '';
  const base = `Failed to acquire auth lock for ${providerName}${bucketLabel}`;

  if (typeof tokenStore.inspectAuthLock !== 'function') {
    return `${base}. Run ${buildAuthCommand(providerName, 'lock status', bucket)} for details.`;
  }

  try {
    const status = await tokenStore.inspectAuthLock(providerName, bucket);
    const parts: string[] = [base];

    if (!status.exists) {
      // Absent lock: no recovery action needed. Do not suggest force
      // just because liveness defaults to 'unverifiable' for absent
      // locks.
      parts.push(`Lock file not found at ${status.canonicalPath}`);
      return parts.join('. ') + '.';
    }

    const ownerInfo: string[] = [];
    if (status.classification !== 'absent') {
      ownerInfo.push(`schema: ${status.classification}`);
    }
    if (status.ownerPid !== null) {
      ownerInfo.push(`PID: ${status.ownerPid}`);
    }
    if (status.ownerHostname !== null) {
      ownerInfo.push(`host: ${status.ownerHostname}`);
    }
    ownerInfo.push(`liveness: ${status.liveness.status}`);
    if (status.ageMs !== null) {
      ownerInfo.push(`age: ${Math.floor(status.ageMs / 1000)}s`);
    }
    parts.push(`Lock owner: ${ownerInfo.join(', ')}`);
    parts.push(`Lock path: ${status.canonicalPath}`);

    if (status.liveness.status === 'dead') {
      parts.push(
        `Recover with: ${buildAuthCommand(providerName, 'unlock', bucket)}`,
      );
    } else if (
      status.classification === 'legacy' ||
      status.classification === 'malformed' ||
      status.liveness.status === 'unverifiable'
    ) {
      parts.push(
        `Inspect with: ${buildAuthCommand(providerName, 'lock status', bucket)}`,
      );
      parts.push(
        `Force-remove with: ${buildAuthCommand(providerName, 'unlock', bucket, '--force --i-have-stopped-all-processes')}`,
      );
    } else {
      parts.push(
        `Inspect with: ${buildAuthCommand(providerName, 'lock status', bucket)}`,
      );
    }

    return parts.join('. ') + '.';
  } catch (error) {
    // Preserve useful error details instead of only directing the user
    // to repeat the same failing command.
    const detail = error instanceof Error ? error.message : String(error);
    return (
      `${base}. Lock inspection failed: ${detail}. ` +
      `Check permissions on the lock directory or run ${buildAuthCommand(providerName, 'lock status', bucket)} manually.`
    );
  }
}
