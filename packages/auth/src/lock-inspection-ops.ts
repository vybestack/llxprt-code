/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import {
  buildCurrentProcessOwnerMetadata,
  parseLegacyLockRecord,
  parseOwnerMetadata,
  probeOwnerLiveness,
  type LockOwnerMetadata,
  type OwnerLiveness,
} from './lock-owner.js';
import type {
  AuthLockRecoveryResult,
  AuthLockStatus,
  ForceRecoverOptions,
  LockSchemaClassification,
  LockStartTimeSource,
  TokenVisibility,
} from './token-store.js';
import type { OAuthToken } from './types.js';

const TOKEN_VISIBILITY_TIMEOUT_MS = 500;

export interface LockInspectionDeps {
  readonly authLockFilePath: (provider: string, bucket?: string) => string;
  readonly getToken: (
    provider: string,
    bucket?: string,
  ) => Promise<OAuthToken | null>;
}

export interface LockRecoveryDeps extends LockInspectionDeps {
  readonly readRawOwnerContent: (lockPath: string) => Promise<string>;
  readonly tryWinFence: (
    fencePath: string,
    owner: LockOwnerMetadata,
  ) => Promise<'won' | 'lost'>;
  readonly removeOwnedFile: (
    lockPath: string,
    ownerToken: string,
  ) => Promise<void>;
  readonly removeFileIfExists: (lockPath: string) => Promise<void>;
}

export interface OwnerFingerprint {
  readonly ownerToken: string | null;
  readonly rawContent: string;
}

interface LockFileRead {
  readonly content: string | null;
  readonly mtimeMs: number | null;
}

interface OwnerClassification {
  readonly classification: LockSchemaClassification;
  readonly ownerPid: number | null;
  readonly ownerHostname: string | null;
  readonly ownerStartTimeMs: number | null;
  readonly ownerStartTimeSource: LockStartTimeSource;
  readonly liveness: OwnerLiveness;
}

type FencedOwnerRead =
  | { readonly state: 'absent' }
  | { readonly state: 'changed' }
  | { readonly state: 'unchanged'; readonly owner: OwnerClassification };

interface SafeRecoveryContext {
  readonly provider: string;
  readonly bucket: string;
  readonly canonicalPath: string;
  readonly fencePath: string;
  readonly fingerprint: OwnerFingerprint;
  readonly owner: LockOwnerMetadata;
}

type FilesystemLockStatus = Omit<AuthLockStatus, 'tokenVisibility'>;

interface FilesystemLockSnapshot {
  readonly status: FilesystemLockStatus;
  readonly rawContent: string | null;
}

function errnoCodeOf(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return undefined;
}

function isErrnoCode(error: unknown, expected: string): boolean {
  return errnoCodeOf(error) === expected;
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runWithFenceCleanup(
  operation: () => Promise<AuthLockRecoveryResult>,
  cleanup: () => Promise<void>,
): Promise<AuthLockRecoveryResult> {
  let result: AuthLockRecoveryResult;
  try {
    result = await operation();
  } catch (operationError) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [operationError, cleanupError],
        `Lock recovery failed and recovery fence cleanup also failed: ${errorMessageOf(cleanupError)}`,
      );
    }
    throw operationError;
  }

  try {
    await cleanup();
    return result;
  } catch (cleanupError) {
    return {
      ...result,
      cleanupDiagnostic: `Recovery fence cleanup failed: ${errorMessageOf(cleanupError)}`,
    };
  }
}

function tokenVisibilityFor(token: OAuthToken | null): TokenVisibility {
  if (token === null) {
    return { status: 'invalid' };
  }
  const nowInSeconds = Math.floor(Date.now() / 1000);
  return token.expiry > nowInSeconds + 30
    ? { status: 'valid' }
    : { status: 'invalid' };
}

function resolveTokenVisibility(
  deps: LockInspectionDeps,
  provider: string,
  bucket: string,
): Promise<TokenVisibility> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (visibility: TokenVisibility): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(visibility);
    };
    const timeout = setTimeout(
      () =>
        finish({
          status: 'unknown',
          diagnostic: `Token store did not respond within ${TOKEN_VISIBILITY_TIMEOUT_MS}ms`,
        }),
      TOKEN_VISIBILITY_TIMEOUT_MS,
    );
    deps.getToken(provider, bucket).then(
      (token) => finish(tokenVisibilityFor(token)),
      (error: unknown) =>
        finish({
          status: 'unknown',
          diagnostic: error instanceof Error ? error.message : String(error),
        }),
    );
  });
}

function buildOwnerFingerprint(rawContent: string): OwnerFingerprint {
  const versioned = parseOwnerMetadata(rawContent);
  if (versioned !== null) {
    return { ownerToken: versioned.ownerToken, rawContent };
  }
  const legacy = parseLegacyLockRecord(rawContent);
  return {
    ownerToken: legacy?.ownerToken ?? null,
    rawContent,
  };
}

async function closeHandle(
  handle: fs.FileHandle,
  operationError: unknown,
): Promise<void> {
  try {
    await handle.close();
  } catch (closeError) {
    if (operationError === undefined) {
      throw closeError;
    }
  }
}

async function readOpenLockFile(handle: fs.FileHandle): Promise<LockFileRead> {
  let operationError: unknown;
  try {
    const stat = await handle.stat();
    const content = await handle.readFile('utf8');
    return { content, mtimeMs: Number(stat.mtimeMs) };
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    await closeHandle(handle, operationError);
  }
}

async function readLockFile(lockPath: string): Promise<LockFileRead> {
  try {
    const handle = await fs.open(lockPath, 'r');
    return await readOpenLockFile(handle);
  } catch (error) {
    if (!isErrnoCode(error, 'ENOENT')) {
      throw error;
    }
    return { content: null, mtimeMs: null };
  }
}

async function classifyOwner(content: string): Promise<OwnerClassification> {
  const versionedOwner = parseOwnerMetadata(content);
  if (versionedOwner !== null) {
    return {
      classification: 'versioned',
      ownerPid: versionedOwner.pid,
      ownerHostname: versionedOwner.hostname,
      ownerStartTimeMs: versionedOwner.startTimeMs,
      ownerStartTimeSource: versionedOwner.startTimeSource,
      liveness: await probeOwnerLiveness(versionedOwner, {
        probeTimeoutMs: 500,
      }),
    };
  }

  const legacyOwner = parseLegacyLockRecord(content);
  if (legacyOwner !== null) {
    return {
      classification: 'legacy',
      ownerPid: legacyOwner.pid,
      ownerHostname: null,
      ownerStartTimeMs: null,
      ownerStartTimeSource: 'unavailable',
      liveness: { status: 'unverifiable' },
    };
  }

  return {
    classification: 'malformed',
    ownerPid: null,
    ownerHostname: null,
    ownerStartTimeMs: null,
    ownerStartTimeSource: 'unavailable',
    liveness: { status: 'unverifiable' },
  };
}

async function inspectFilesystemLock(
  deps: LockInspectionDeps,
  provider: string,
  bucket: string | undefined,
  resolvedBucket: string,
): Promise<FilesystemLockSnapshot> {
  const lockPath = deps.authLockFilePath(provider, bucket);
  const lockFile = await readLockFile(lockPath);
  if (lockFile.content === null || lockFile.mtimeMs === null) {
    return {
      rawContent: null,
      status: {
        provider,
        bucket: resolvedBucket,
        exists: false,
        canonicalPath: lockPath,
        classification: 'absent',
        ownerPid: null,
        ownerHostname: null,
        ownerStartTimeMs: null,
        ownerStartTimeSource: 'unavailable',
        liveness: { status: 'unverifiable' },
        ageMs: null,
      },
    };
  }

  const owner = await classifyOwner(lockFile.content);
  return {
    rawContent: lockFile.content,
    status: {
      provider,
      bucket: resolvedBucket,
      exists: true,
      canonicalPath: lockPath,
      classification: owner.classification,
      ownerPid: owner.ownerPid,
      ownerHostname: owner.ownerHostname,
      ownerStartTimeMs: owner.ownerStartTimeMs,
      ownerStartTimeSource: owner.ownerStartTimeSource,
      liveness: owner.liveness,
      ageMs:
        lockFile.mtimeMs > 0 ? Date.now() - Number(lockFile.mtimeMs) : null,
    },
  };
}

export async function inspectAuthLock(
  deps: LockInspectionDeps,
  provider: string,
  bucket: string | undefined,
  resolvedBucket: string,
): Promise<AuthLockStatus> {
  const [snapshot, tokenVisibility] = await Promise.all([
    inspectFilesystemLock(deps, provider, bucket, resolvedBucket),
    resolveTokenVisibility(deps, provider, resolvedBucket),
  ]);
  return { ...snapshot.status, tokenVisibility };
}

function alreadyAbsentRecovery(
  provider: string,
  bucket: string,
  canonicalPath: string,
): AuthLockRecoveryResult {
  return {
    provider,
    bucket,
    recovered: true,
    reason: 'Lock was already absent after fenced takeover',
    canonicalPath,
  };
}

async function readUnchangedOwnerUnderFence(
  deps: LockRecoveryDeps,
  lockPath: string,
  fingerprint: OwnerFingerprint,
): Promise<FencedOwnerRead> {
  let content: string;
  try {
    content = await deps.readRawOwnerContent(lockPath);
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) {
      return { state: 'absent' };
    }
    throw error;
  }
  if (content !== fingerprint.rawContent) {
    return { state: 'changed' };
  }
  const observed = buildOwnerFingerprint(content);
  if (observed.ownerToken !== fingerprint.ownerToken) {
    return { state: 'changed' };
  }
  return { state: 'unchanged', owner: await classifyOwner(content) };
}

async function recoverDeadOwnerUnderFence(
  deps: LockRecoveryDeps,
  context: SafeRecoveryContext,
): Promise<AuthLockRecoveryResult> {
  const fenceResult = await deps.tryWinFence(context.fencePath, context.owner);
  if (fenceResult === 'lost') {
    return notRecovered(
      context.provider,
      context.bucket,
      context.canonicalPath,
      'Another contender holds the recovery fence',
    );
  }

  const postFenceOwner = await readUnchangedOwnerUnderFence(
    deps,
    context.canonicalPath,
    context.fingerprint,
  );
  if (postFenceOwner.state === 'absent') {
    return alreadyAbsentRecovery(
      context.provider,
      context.bucket,
      context.canonicalPath,
    );
  }
  if (
    postFenceOwner.state === 'changed' ||
    postFenceOwner.owner.classification !== 'versioned' ||
    postFenceOwner.owner.liveness.status !== 'dead'
  ) {
    return notRecovered(
      context.provider,
      context.bucket,
      context.canonicalPath,
      'Lock owner changed or is no longer provably dead during fenced recovery',
    );
  }

  await deps.removeFileIfExists(context.canonicalPath);
  return {
    provider: context.provider,
    bucket: context.bucket,
    recovered: true,
    reason: 'Lock recovered via fenced takeover',
    canonicalPath: context.canonicalPath,
  };
}

export async function recoverAuthLock(
  deps: LockRecoveryDeps,
  provider: string,
  bucket: string | undefined,
  resolvedBucket: string,
): Promise<AuthLockRecoveryResult> {
  const snapshot = await inspectFilesystemLock(
    deps,
    provider,
    bucket,
    resolvedBucket,
  );
  const { status, rawContent } = snapshot;
  if (!status.exists || rawContent === null) {
    return notRecovered(
      provider,
      resolvedBucket,
      status.canonicalPath,
      'No lock file present',
    );
  }
  if (status.classification !== 'versioned') {
    return notRecovered(
      provider,
      resolvedBucket,
      status.canonicalPath,
      `Lock is ${status.classification}; use force recovery to remove it`,
    );
  }
  if (status.liveness.status !== 'dead') {
    return notRecovered(
      provider,
      resolvedBucket,
      status.canonicalPath,
      `Owner is ${status.liveness.status}, not provably dead`,
    );
  }

  const owner = await buildCurrentProcessOwnerMetadata(500);
  const context: SafeRecoveryContext = {
    provider,
    bucket: resolvedBucket,
    canonicalPath: status.canonicalPath,
    fencePath: `${status.canonicalPath}.fence`,
    fingerprint: buildOwnerFingerprint(rawContent),
    owner,
  };
  return runWithFenceCleanup(
    () => recoverDeadOwnerUnderFence(deps, context),
    () => deps.removeOwnedFile(context.fencePath, owner.ownerToken),
  );
}

function validateForceRecoveryStatus(
  status: FilesystemLockStatus,
  options: ForceRecoverOptions,
): AuthLockRecoveryResult | null {
  if (!status.exists) {
    return notRecovered(
      status.provider,
      status.bucket,
      status.canonicalPath,
      'No lock file present',
    );
  }
  if (status.liveness.status === 'live') {
    return notRecovered(
      status.provider,
      status.bucket,
      status.canonicalPath,
      `Owner PID ${status.ownerPid} is verified-live — refusing to remove`,
    );
  }
  const needsAck =
    status.classification === 'legacy' ||
    status.classification === 'malformed' ||
    status.liveness.status === 'unverifiable';
  if (!needsAck || options.acknowledgeAllStopped) {
    return null;
  }
  return notRecovered(
    status.provider,
    status.bucket,
    status.canonicalPath,
    `Lock is ${status.classification}/${status.liveness.status}. ` +
      'Add --i-have-stopped-all-processes to acknowledge that all LLxprt ' +
      'processes sharing this path have been stopped.',
  );
}

function validateForceRecoveryOwnerUnderFence(
  status: FilesystemLockStatus,
  observed: OwnerClassification | null,
  options: ForceRecoverOptions,
): AuthLockRecoveryResult | null {
  if (observed === null) {
    return notRecovered(
      status.provider,
      status.bucket,
      status.canonicalPath,
      'Lock content or owner changed since inspection — refusing to delete a potential successor',
    );
  }
  if (observed.liveness.status === 'live') {
    return notRecovered(
      status.provider,
      status.bucket,
      status.canonicalPath,
      `Owner PID ${observed.ownerPid} became verified-live — refusing to remove`,
    );
  }
  if (observed.liveness.status !== 'dead' && !options.acknowledgeAllStopped) {
    return notRecovered(
      status.provider,
      status.bucket,
      status.canonicalPath,
      'Lock remains unverifiable and requires explicit acknowledgment',
    );
  }
  return null;
}

export async function forceRecoverAuthLock(
  deps: LockRecoveryDeps,
  provider: string,
  bucket: string | undefined,
  resolvedBucket: string,
  options: ForceRecoverOptions,
): Promise<AuthLockRecoveryResult> {
  const snapshot = await inspectFilesystemLock(
    deps,
    provider,
    bucket,
    resolvedBucket,
  );
  const { status, rawContent } = snapshot;
  const invalidStatus = validateForceRecoveryStatus(status, options);
  if (invalidStatus !== null) {
    return invalidStatus;
  }
  if (rawContent === null) {
    return notRecovered(
      provider,
      resolvedBucket,
      status.canonicalPath,
      'No lock file present',
    );
  }

  const fingerprint = buildOwnerFingerprint(rawContent);
  const owner = await buildCurrentProcessOwnerMetadata(500);
  const fencePath = `${status.canonicalPath}.fence`;
  return runWithFenceCleanup(
    async () => {
      const fenceResult = await deps.tryWinFence(fencePath, owner);
      if (fenceResult === 'lost') {
        return notRecovered(
          provider,
          resolvedBucket,
          status.canonicalPath,
          'Another contender holds the recovery fence',
        );
      }

      const postFenceOwner = await readUnchangedOwnerUnderFence(
        deps,
        status.canonicalPath,
        fingerprint,
      );
      if (postFenceOwner.state === 'absent') {
        return alreadyAbsentRecovery(
          provider,
          resolvedBucket,
          status.canonicalPath,
        );
      }
      const invalidOwner = validateForceRecoveryOwnerUnderFence(
        status,
        postFenceOwner.state === 'unchanged' ? postFenceOwner.owner : null,
        options,
      );
      if (invalidOwner !== null) {
        return invalidOwner;
      }

      await deps.removeFileIfExists(status.canonicalPath);
      return {
        provider,
        bucket: resolvedBucket,
        recovered: true,
        reason: `Lock force-removed (${status.classification}/${status.liveness.status})`,
        canonicalPath: status.canonicalPath,
      };
    },
    () => deps.removeOwnedFile(fencePath, owner.ownerToken),
  );
}

function notRecovered(
  provider: string,
  bucket: string,
  canonicalPath: string,
  reason: string,
): AuthLockRecoveryResult {
  return { provider, bucket, recovered: false, reason, canonicalPath };
}
