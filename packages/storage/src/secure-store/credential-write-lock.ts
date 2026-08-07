/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cross-process advisory write lock for credential items.
 *
 * Mirrors the fenced O_EXCL owner protocol proven in
 * `packages/auth/src/keyring-token-store.ts` and `packages/auth/src/lock-owner.ts`.
 *
 * ARCHITECTURE NOTE — why this is a storage-local copy rather than an import
 * from `packages/auth`:
 *
 * `packages/auth` is a deliberate zero-dependency leaf —
 * `packages/auth/src/__tests__/package-boundary.test.ts` asserts that the auth
 * package has NO `@vybestack/*` dependencies, and `storage` sits below `auth`
 * in the workspace DAG. Neither package can import the other. The on-disk
 * owner-record shape is kept byte-compatible with the auth lock records so
 * the two lock families remain interchangeable if the boundary is ever
 * revisited.
 *
 * The lock is fail-closed: on acquisition timeout it throws a
 * `SecureStoreError` with code `TIMEOUT`. The mutating callback is NEVER
 * invoked without ownership — an unlocked write would permit overlapping
 * set/set and set/delete on the same keychain item, which is exactly the
 * unserialized mutation this lock exists to eliminate.
 *
 * Lock-file naming uses an injective, non-cryptographic percent-encoding of
 * the (service, account) identifiers — NOT a hash. The hashed input is never
 * a credential value (call sites pass keychain service/account identifiers),
 * so hashing added only downsides: a needless collision risk, undebuggable
 * lock files, and a false-positive CodeQL `js/insufficient-password-hash`
 * alert. See `lockFilePath` for details.
 *
 * @plan PLAN-20260801-ISSUE2927
 * @requirement R3, R4
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { hostname as nodeHostname } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { StorageLogger } from '../types/logger.js';
import { NullStorageLoggerImpl } from '../types/logger.js';
import { SecureStoreError } from './secure-store-errors.js';

/**
 * Internal sentinel error signalling that a lock file carries a NEWER
 * version than this code understands. It is a distinct subclass — not a
 * string match on a message — so the acquire loop can let it propagate
 * immediately instead of swallowing it as a generic recovery failure (which
 * would degrade to TIMEOUT and hide a precisely diagnosable condition).
 */
class NewerLockVersionError extends SecureStoreError {
  constructor(version: number, lockPath: string) {
    super(
      `Credential lock file at ${lockPath} carries version ${version}, which ` +
        `is newer than the supported version ${LOCK_VERSION}. A newer llxprt ` +
        `may be holding it with an incompatible protocol; stealing it would ` +
        `break serialization. Remove the file manually only if you are ` +
        `certain no newer llxprt process is running.`,
      'UNAVAILABLE',
      `Upgrade llxprt to a version that supports lock version ${version}, ` +
        `or remove ${lockPath} after confirming no newer process holds it`,
    );
  }
}

const execFileAsync = promisify(execFile);

const LOCK_VERSION = 1;
const DEFAULT_WAIT_MS = 5_000;
const PROCESS_START_TOLERANCE_MS = 2_000;
const PROCESS_PROBE_TIMEOUT_MS = 250;
const LOCK_BACKOFF_BASE_MS = 50;
const LOCK_BACKOFF_CAP_MS = 500;
const LOCK_BACKOFF_JITTER_MS = 30;

// ─── Owner record types (byte-compatible with auth lock-owner.ts) ───────────

type StartTimeSource = 'canonical' | 'approximate' | 'unavailable';

interface LockOwnerMetadata {
  readonly version: number;
  readonly ownerToken: string;
  readonly pid: number;
  readonly hostname: string;
  readonly startTimeMs: number;
  readonly startTimeSource: StartTimeSource;
}

type OwnerLiveness =
  | { readonly status: 'dead' }
  | { readonly status: 'live' }
  | { readonly status: 'unverifiable' };

/**
 * Discriminated result of classifying a raw owner record.
 *
 * - `valid`: parseable record at exactly LOCK_VERSION with all fields sane —
 *   the only record shape this code can ever write, so it may represent a
 *   live owner.
 * - `newer`: a well-formed JSON object whose version is GREATER than
 *   LOCK_VERSION. A future llxprt may hold the lock under a protocol we do
 *   not understand; stealing it would break cross-version serialization.
 *   Must NOT be reclaimed.
 * - `unusable`: everything else — bad JSON, non-object, missing/invalid
 *   fields, or a numeric version LESS than LOCK_VERSION. No supported
 *   version of this code can produce such a record, so it cannot represent a
 *   live owner of this protocol and may be reclaimed via a fenced takeover.
 */
type OwnerRecord =
  | { readonly kind: 'valid'; readonly owner: LockOwnerMetadata }
  | { readonly kind: 'newer'; readonly version: number }
  | { readonly kind: 'unusable' };

// ─── Helpers ────────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function isValidStartTimeSource(value: unknown): value is StartTimeSource {
  return (
    value === 'canonical' || value === 'approximate' || value === 'unavailable'
  );
}

// ─── Owner metadata build / serialize / parse ───────────────────────────────

function buildOwnerMetadata(
  startTimeMs: number,
  startTimeSource: StartTimeSource,
  ownerToken: string,
): LockOwnerMetadata {
  return {
    version: LOCK_VERSION,
    ownerToken,
    pid: process.pid,
    hostname: nodeHostname(),
    startTimeMs,
    startTimeSource,
  };
}

function serializeOwnerMetadata(owner: LockOwnerMetadata): string {
  return JSON.stringify(owner);
}

/**
 * Classifies a raw owner record string into one of three buckets.
 *
 * This is the single source of truth for record validity. It never collapses
 * distinct conditions to one value: a `newer` record is distinguished from
 * an `unusable` one so callers can refuse to steal a future-version lock
 * while still reclaiming garbage written by no supported version of this
 * code.
 */
function classifyOwnerRecord(raw: string): OwnerRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'unusable' };
  }
  if (!isPlainObject(parsed)) {
    return { kind: 'unusable' };
  }
  if (typeof parsed.version !== 'number' || !Number.isFinite(parsed.version)) {
    return { kind: 'unusable' };
  }
  if (parsed.version > LOCK_VERSION) {
    return { kind: 'newer', version: parsed.version };
  }
  if (parsed.version !== LOCK_VERSION) {
    return { kind: 'unusable' };
  }
  if (typeof parsed.ownerToken !== 'string' || parsed.ownerToken === '') {
    return { kind: 'unusable' };
  }
  if (typeof parsed.hostname !== 'string' || parsed.hostname === '') {
    return { kind: 'unusable' };
  }
  if (
    typeof parsed.pid !== 'number' ||
    !Number.isSafeInteger(parsed.pid) ||
    parsed.pid <= 0
  ) {
    return { kind: 'unusable' };
  }
  if (
    typeof parsed.startTimeMs !== 'number' ||
    !Number.isFinite(parsed.startTimeMs)
  ) {
    return { kind: 'unusable' };
  }
  const startTimeSource = isValidStartTimeSource(parsed.startTimeSource)
    ? parsed.startTimeSource
    : 'approximate';
  return {
    kind: 'valid',
    owner: {
      version: parsed.version,
      ownerToken: parsed.ownerToken,
      pid: parsed.pid,
      hostname: parsed.hostname,
      startTimeMs: parsed.startTimeMs,
      startTimeSource,
    },
  };
}

/**
 * Thin wrapper over {@link classifyOwnerRecord} for call sites that only need
 * a valid owner or null. Kept so the public surface stays tidy; the
 * discriminated classifier is the source of truth.
 */
function parseOwnerMetadata(raw: string): LockOwnerMetadata | null {
  const record = classifyOwnerRecord(raw);
  return record.kind === 'valid' ? record.owner : null;
}

// ─── Process start-time probing ─────────────────────────────────────────────

let cachedCurrentProcessStartTime:
  | { readonly startTimeMs: number; readonly startTimeSource: 'canonical' }
  | undefined;

/**
 * Platforms with a canonical process start-time source (`ps -o lstart=`).
 *
 * Exported because the tests must fabricate owner records whose
 * `startTimeSource` matches what this module would really write; a second,
 * hand-copied list could drift from this one silently.
 */
export const CANONICAL_START_TIME_PLATFORMS: readonly string[] = [
  'darwin',
  'linux',
  'freebsd',
];

async function readProcessStartTimeMs(
  pid: number,
  timeoutMs: number = PROCESS_PROBE_TIMEOUT_MS,
): Promise<number | null> {
  if (!CANONICAL_START_TIME_PLATFORMS.includes(process.platform)) {
    return null;
  }
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-o', 'lstart=', '-p', String(pid)],
      {
        timeout: Math.max(1, timeoutMs),
        killSignal: 'SIGKILL',
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
      },
    );
    // `ps -o lstart=` prints a local-time string carrying no UTC offset, so
    // the epoch value depends on two timezones agreeing: the one `ps`
    // formats in (the child's) and the one Date.parse interprets in (this
    // process's JS timezone). Pinning the child to UTC and parsing as UTC
    // removes both dependencies, so writer and prober always agree on the
    // same instant even when a runtime desynchronizes its JS timezone from
    // the environment. Without this, a probe can misread a live owner's
    // start time by a whole UTC offset, judge it dead, and steal its lock —
    // defeating the serialization this lock exists to provide.
    const value = Date.parse(`${stdout.trim()} UTC`);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function getApproximateStartTimeMs(): number {
  return Date.now() - process.uptime() * 1000;
}

function boundedProcessStartProbe(
  probe: Promise<number | null>,
  timeoutMs: number,
): Promise<number | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), Math.max(0, timeoutMs));
    probe
      .then(resolve, () => resolve(null))
      .finally(() => clearTimeout(timeout));
  });
}

async function buildCurrentProcessOwnerMetadata(
  ownerToken: string,
): Promise<LockOwnerMetadata> {
  if (cachedCurrentProcessStartTime !== undefined) {
    return buildOwnerMetadata(
      cachedCurrentProcessStartTime.startTimeMs,
      cachedCurrentProcessStartTime.startTimeSource,
      ownerToken,
    );
  }
  const canonical = await readProcessStartTimeMs(process.pid);
  if (canonical !== null) {
    cachedCurrentProcessStartTime = {
      startTimeMs: canonical,
      startTimeSource: 'canonical',
    };
    return buildOwnerMetadata(canonical, 'canonical', ownerToken);
  }
  return buildOwnerMetadata(
    getApproximateStartTimeMs(),
    'approximate',
    ownerToken,
  );
}

async function probeOwnerLiveness(
  owner: LockOwnerMetadata,
  probeTimeoutMs: number,
): Promise<OwnerLiveness> {
  if (owner.hostname !== nodeHostname()) {
    return { status: 'unverifiable' };
  }
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (isErrnoCode(error, 'ESRCH')) {
      return { status: 'dead' };
    }
    return { status: 'unverifiable' };
  }
  if (owner.startTimeSource !== 'canonical') {
    return { status: 'unverifiable' };
  }
  const observed = await boundedProcessStartProbe(
    readProcessStartTimeMs(owner.pid),
    probeTimeoutMs,
  );
  if (observed === null) {
    return { status: 'unverifiable' };
  }
  return Math.abs(owner.startTimeMs - observed) > PROCESS_START_TOLERANCE_MS
    ? { status: 'dead' }
    : { status: 'live' };
}

// ─── Backoff ────────────────────────────────────────────────────────────────

function computeBackoffDelay(
  attempt: number,
  base: number,
  cap: number,
  jitter: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.min(attempt, 16);
  const jitterRange = Math.min(jitter, cap);
  const exp = Math.min(cap - jitterRange, base * 2 ** exponent);
  return exp + Math.floor(random() * jitterRange);
}

// ─── Lock path derivation ───────────────────────────────────────────────────

/**
 * Maximum length, in characters, of the entire encoded lock-file name
 * (including the `cred-` prefix and `.lock` suffix). Most filesystems cap a
 * filename at 255 bytes; percent-encoding can expand input up to 3x. The cap
 * leaves comfortable headroom and is only reachable with pathological
 * identifiers — `SecureStore.validateKey` already constrains keys.
 */
const LOCK_FILE_NAME_CAP = 220;

/**
 * Characters that are unsafe or reserved on one or more of Windows, macOS, or
 * Linux filesystems. The delimiter `@` is included so it can serve as a
 * component separator that can never appear inside an encoded component.
 */
const FILESYSTEM_UNSAFE_CHARS = '*<>:"/\\|?@%';

/**
 * Returns true if a character must be percent-encoded because it is a
 * filesystem-reserved character, an ASCII control character (0x00–0x1F or
 * 0x7F), or non-ASCII (outside the printable ASCII range 0x20–0x7E).
 *
 * The `@` delimiter is deliberately treated as unsafe so it can never appear
 * inside an encoded component — only between them.
 */
function isUnsafeChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    FILESYSTEM_UNSAFE_CHARS.includes(char) ||
    code < 0x20 ||
    code === 0x7f ||
    code > 0x7e
  );
}

/**
 * Percent-encodes a single component (service or account) into a
 * filesystem-safe, ASCII-only string that contains none of the unsafe
 * characters — and crucially never contains the `@` delimiter used to join
 * components.
 *
 * Non-ASCII characters are also encoded so the filename is deterministic
 * across UTF-8 normalization differences.
 *
 * Escape sequences are always two hex digits. Without the zero pad, a code
 * below 0x10 would emit a single digit and could absorb the following
 * character: `[0x09, 'A']` and `[0x9A]` would both encode to `%9A`, silently
 * breaking injectivity and letting two different (service, account) pairs
 * share one lock file.
 */
function escapeComponent(component: string): string {
  let result = '';
  for (const char of component) {
    result += isUnsafeChar(char)
      ? '%' + char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
      : char;
  }
  return result;
}

/**
 * Derives a deterministic, injective, filesystem-safe lock-file path from a
 * (service, account) pair.
 *
 * **Why encoding, not a hash:** the input is a keychain service name and an
 * account/key name — identifiers, never credential values. A cryptographic
 * hash was previously used purely to produce a filesystem-safe filename, but
 * hashing is the wrong tool: it is lossy (introducing a collision risk that
 * did not need to exist), makes lock files undebuggable (the original
 * identifiers are unrecoverable), and trips CodeQL's
 * `js/insufficient-password-hash` rule (a false positive — no password is
 * involved). A non-cryptographic, injective percent-encoding satisfies every
 * requirement without any of these drawbacks.
 *
 * Injectivity is guaranteed by encoding each component independently and
 * joining them with a `@` delimiter that `escapeComponent` can never emit,
 * so `('ab', 'c')` and `('a', 'bc')` always produce distinct filenames.
 */
function lockFilePath(
  lockDir: string,
  service: string,
  account: string,
): string {
  const fileName = `cred-${escapeComponent(service)}@${escapeComponent(account)}.lock`;
  if (fileName.length > LOCK_FILE_NAME_CAP) {
    throw new SecureStoreError(
      `Credential lock file name exceeds the ${LOCK_FILE_NAME_CAP}-character filesystem cap ` +
        `for service=${JSON.stringify(service)}, account=${JSON.stringify(account)}.`,
      'CORRUPT',
      'Shorten the service name or key name so the lock-file name fits within filesystem limits',
    );
  }
  return join(lockDir, fileName);
}

// ─── Operation settlement ───────────────────────────────────────────────────

/**
 * Settled outcome of the guarded operation.
 *
 * Captured as a discriminated union so the lock can always run its release
 * step and still re-surface the operation's original result or error, without
 * needing a sentinel value for the rejected case.
 */
type OperationOutcome<T> =
  | { readonly status: 'fulfilled'; readonly value: T }
  | { readonly status: 'rejected'; readonly error: unknown };

async function settleOperation<T>(
  operation: () => Promise<T>,
): Promise<OperationOutcome<T>> {
  try {
    return { status: 'fulfilled', value: await operation() };
  } catch (error) {
    return { status: 'rejected', error };
  }
}

// ─── CredentialWriteLock ────────────────────────────────────────────────────

export interface CredentialWriteLockOptions {
  readonly lockDir: string;
  readonly waitMs?: number;
  readonly logger?: StorageLogger;
}

export interface WithLockCallOptions {
  readonly waitMs?: number;
}

/**
 * Cross-process advisory write lock keyed on service + account.
 *
 * @plan PLAN-20260801-ISSUE2927
 * @requirement R3, R4
 */
export class CredentialWriteLock {
  private readonly lockDir: string;
  private readonly defaultWaitMs: number;
  private readonly logger: StorageLogger;
  private readonly ownerToken: string;
  /**
   * Per-instance promise chain keyed by lock path. Same-instance overlapping
   * calls for one key serialize in memory (an O_EXCL file lock cannot be
   * re-acquired by the holder); distinct instances contend through the
   * filesystem instead.
   */
  private readonly inFlightChains = new Map<string, Promise<unknown>>();

  constructor(options: CredentialWriteLockOptions) {
    this.lockDir = options.lockDir;
    this.defaultWaitMs = options.waitMs ?? DEFAULT_WAIT_MS;
    this.logger = options.logger ?? new NullStorageLoggerImpl();
    this.ownerToken = randomUUID();
  }

  /**
   * Serializes same-instance overlapping operations for one lock path in
   * memory. Two independently constructed instances deliberately do NOT share
   * this chain — they must contend through the filesystem (the real
   * cross-process path).
   */
  private serializeInProcess<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.inFlightChains.get(key) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    this.inFlightChains.set(key, current);
    const cleanup = (): void => {
      if (this.inFlightChains.get(key) === current) {
        this.inFlightChains.delete(key);
      }
    };
    current.then(cleanup, cleanup);
    return current;
  }

  /**
   * Returns the deterministic lock file path for a (service, account) pair.
   * Exposed for testing and diagnostics.
   */
  lockFilePath(service: string, account: string): string {
    return lockFilePath(this.lockDir, service, account);
  }

  /**
   * Executes `operation` under the advisory lock for (service, account).
   *
   * If the lock cannot be acquired within `waitMs`, throws a
   * `SecureStoreError` with code `TIMEOUT` — the mutating callback is NEVER
   * invoked without ownership.
   *
   * NOT reentrant: a callback that awaits `withLock` for the same instance
   * and key will self-deadlock behind its own in-process serialization chain.
   * No production path does this.
   *
   * @plan PLAN-20260801-ISSUE2927
   * @requirement R3
   */
  async withLock<T>(
    service: string,
    account: string,
    operation: () => Promise<T>,
    callOptions?: WithLockCallOptions,
  ): Promise<T> {
    const lockPath = this.lockFilePath(service, account);
    const waitMs = callOptions?.waitMs ?? this.defaultWaitMs;
    return this.serializeInProcess(lockPath, async () => {
      let acquired: boolean;
      try {
        acquired = await this.acquire(lockPath, waitMs);
      } catch (error) {
        // O5: Wrap raw errno errors from lock infrastructure (acquisition
        // path only) as SecureStoreError so callers and
        // isLockInfrastructureError see a coherent error. Errors from the
        // caller's operation() are handled separately below and pass through
        // unchanged.
        if (error instanceof SecureStoreError) {
          throw error;
        }
        throw new SecureStoreError(
          `Lock acquisition failed for ${service}:${account} at ${lockPath}: ${error instanceof Error ? error.message : String(error)}`,
          'UNAVAILABLE',
          'Check filesystem permissions for the lock directory and lock files',
        );
      }
      if (!acquired) {
        throw new SecureStoreError(
          `Timed out waiting ${waitMs}ms to acquire credential write lock for ${service}:${account}. ` +
            `Another live process may hold it, or it may be stale. ` +
            `Inspect or remove: ${lockPath}`,
          'TIMEOUT',
          `Wait for the other process to finish, or if no process is writing, ` +
            `remove the lock file at ${lockPath}`,
        );
      }
      const outcome = await settleOperation(operation);
      try {
        await this.release(lockPath);
      } catch (releaseError) {
        // M4: The primary operation outcome always wins. Log the release
        // failure so it is not silently discarded, but never let it replace
        // the operation's result or error.
        this.logger.warn(
          () =>
            `[credential-lock] release failed for ${service}:${account} at ${lockPath}: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
        );
      }
      if (outcome.status === 'rejected') {
        throw outcome.error;
      }
      return outcome.value;
    });
  }

  // ─── Acquisition ─────────────────────────────────────────────────────────

  private async acquire(lockPath: string, waitMs: number): Promise<boolean> {
    try {
      await this.ensureLockDir();
    } catch (error) {
      throw new SecureStoreError(
        `Failed to create credential lock directory: ${error instanceof Error ? error.message : String(error)}`,
        'UNAVAILABLE',
        'Check filesystem permissions for the lock directory',
      );
    }
    const owner = await buildCurrentProcessOwnerMetadata(this.ownerToken);
    const deadline = Date.now() + Math.max(0, waitMs);

    let attempt = 0;
    let firstAttempt = true;
    while (firstAttempt || Date.now() < deadline) {
      const isFirstPass = firstAttempt;
      firstAttempt = false;
      const created = await this.tryCreateLock(lockPath, owner);
      if (created) {
        return true;
      }
      // Always make at least one dead-owner recovery attempt. Acquisition
      // setup can spawn `ps` to read a canonical start time, which under load
      // can consume a short waitMs budget entirely. Bailing out here on the
      // first pass would strand a lock whose owner is provably dead and is
      // therefore reclaimable, reporting TIMEOUT without ever having tried.
      if (!isFirstPass && Date.now() >= deadline) {
        return false;
      }
      // O4: Dead-owner recovery is best-effort. A non-ENOENT filesystem
      // error during recovery (EACCES, EIO, ENOSPC, ENOTDIR) must not abort
      // the retry loop — log it and keep backing off until the deadline,
      // after which the normal TIMEOUT error is thrown.
      //
      // Exception: NewerLockVersionError must propagate immediately. It
      // represents a precisely diagnosable condition (a newer-version lock
      // we must not steal), and swallowing it would degrade to a generic
      // TIMEOUT that hides the actionable cause.
      let recovered: boolean;
      try {
        recovered = await this.maybeRecoverDeadOwnerLock(
          lockPath,
          owner,
          Math.max(0, deadline - Date.now()),
        );
      } catch (error) {
        if (error instanceof NewerLockVersionError) {
          throw error;
        }
        this.logger.warn(
          () =>
            `[credential-lock] dead-owner recovery failed at ${lockPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
        recovered = false;
      }
      if (recovered) {
        return true;
      }
      const delay = computeBackoffDelay(
        attempt,
        LOCK_BACKOFF_BASE_MS,
        LOCK_BACKOFF_CAP_MS,
        LOCK_BACKOFF_JITTER_MS,
      );
      attempt += 1;
      await sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
    }
    return false;
  }

  private async ensureLockDir(): Promise<void> {
    await fs.mkdir(this.lockDir, { recursive: true, mode: 0o700 });
  }

  /**
   * Publishes the owner record through a same-directory temp file + `fs.link()`
   * (atomic — never replaces an existing owner).
   */
  private async publishOwnerFile(
    targetPath: string,
    owner: LockOwnerMetadata,
  ): Promise<boolean> {
    const temporaryPath = `${targetPath}.${owner.ownerToken}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(serializeOwnerMetadata(owner), 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await fs.link(temporaryPath, targetPath);
      } catch (error) {
        if (isErrnoCode(error, 'EEXIST')) {
          return false;
        }
        throw error;
      }
      return true;
    } finally {
      await handle?.close().catch(() => undefined);
      await fs.unlink(temporaryPath).catch(() => undefined);
    }
  }

  private async tryCreateLock(
    lockPath: string,
    owner: LockOwnerMetadata,
  ): Promise<boolean> {
    return this.publishOwnerFile(lockPath, owner);
  }

  // ─── Dead-owner recovery (fenced takeover) ───────────────────────────────

  private async maybeRecoverDeadOwnerLock(
    lockPath: string,
    owner: LockOwnerMetadata,
    probeTimeoutMs: number,
  ): Promise<boolean> {
    let existingContent: string;
    try {
      existingContent = await fs.readFile(lockPath, 'utf8');
    } catch (error) {
      if (isErrnoCode(error, 'ENOENT')) {
        return false;
      }
      throw error;
    }

    const record = classifyOwnerRecord(existingContent);

    if (record.kind === 'newer') {
      // A newer llxprt may hold this lock under a protocol we do not
      // understand. Stealing it would break cross-version serialization, so
      // fail fast with an actionable error instead of grinding to a generic
      // TIMEOUT. This is a distinct subclass so the acquire loop lets it
      // propagate immediately rather than swallowing it.
      throw new NewerLockVersionError(record.version, lockPath);
    }

    if (record.kind === 'unusable') {
      // No supported version of this code can write such a record, so it
      // cannot represent a live owner of this protocol. Reclaim it via a
      // fenced takeover that enforces EXACT byte equality (proving nobody
      // mutated it while we decided) but skips the liveness re-probe —
      // there is no owner to probe.
      return this.fencedTakeover(
        lockPath,
        existingContent,
        owner,
        probeTimeoutMs,
        false,
      );
    }

    // valid: probe liveness, fenced takeover only when dead.
    const liveness = await probeOwnerLiveness(record.owner, probeTimeoutMs);
    if (liveness.status !== 'dead') {
      return false;
    }

    return this.fencedTakeover(
      lockPath,
      existingContent,
      owner,
      probeTimeoutMs,
      true,
    );
  }

  /**
   * Wins an exclusive fence, then reclaims the lock file it covers.
   *
   * `reprobeLiveness` is forwarded to {@link executeFencedClaim}: true when
   * reclaiming a `valid` record from an owner already observed dead, false
   * when reclaiming an `unusable` record that can represent no live owner.
   */
  private async fencedTakeover(
    lockPath: string,
    deadRawContent: string,
    owner: LockOwnerMetadata,
    probeTimeoutMs: number,
    reprobeLiveness: boolean,
  ): Promise<boolean> {
    const fencePath = `${lockPath}.fence`;
    const fenceWon = await this.publishOwnerFile(fencePath, owner);
    if (!fenceWon) {
      // A fence loser: probe the fence owner and clean up if it is dead.
      const fenceOwner = await this.readOwner(fencePath);
      if (fenceOwner !== null) {
        const fenceLiveness = await probeOwnerLiveness(
          fenceOwner,
          probeTimeoutMs,
        );
        if (fenceLiveness.status === 'dead') {
          await this.removeOwnedFile(fencePath, fenceOwner.ownerToken);
        }
      }
      return false;
    }

    try {
      const cleared = await this.executeFencedClaim(
        lockPath,
        deadRawContent,
        probeTimeoutMs,
        reprobeLiveness,
      );
      if (!cleared) {
        await this.removeOwnedFile(fencePath, owner.ownerToken);
        return false;
      }
      const claimed = await this.tryCreateLock(lockPath, owner);
      // M2: A fence-cleanup failure must not discard a successful
      // acquisition. If the lock was claimed, release it normally (or via
      // removeOwnedFile if the fence cleanup already failed) so we never
      // orphan a lock owned by this live process.
      try {
        await this.removeOwnedFile(fencePath, owner.ownerToken);
      } catch (fenceCleanupError) {
        if (claimed) {
          // Release the newly claimed lock so it is not orphaned.
          await this.removeOwnedFile(lockPath, owner.ownerToken).catch(
            () => undefined,
          );
        }
        throw fenceCleanupError;
      }
      return claimed;
    } catch (claimError) {
      // If the fence was won but the claim failed, still clean up the fence.
      await this.removeOwnedFile(fencePath, owner.ownerToken).catch(
        () => undefined,
      );
      throw claimError;
    }
  }

  /**
   * Under the fence, re-read the lock and require EXACT byte equality with the
   * record we inspected before taking the fence. That equality check is the
   * ENTIRE safety argument — it proves nobody mutated the record while we
   * decided — and is never skipped.
   *
   * `reprobeLiveness` distinguishes the two reclaim reasons. For a `valid`
   * record the owner is re-parsed and re-probed, so a lock is only ever
   * stolen from a confirmed-dead owner. For an `unusable` record there is no
   * owner to probe — no supported version of this code can write one — so the
   * probe would be meaningless and is skipped.
   */
  private async executeFencedClaim(
    lockPath: string,
    deadRawContent: string,
    probeTimeoutMs: number,
    reprobeLiveness: boolean,
  ): Promise<boolean> {
    let postFenceContent: string;
    try {
      postFenceContent = await fs.readFile(lockPath, 'utf8');
    } catch (error) {
      if (isErrnoCode(error, 'ENOENT')) {
        return false;
      }
      throw error;
    }
    if (postFenceContent !== deadRawContent) {
      return false;
    }
    if (reprobeLiveness) {
      const postFenceOwner = parseOwnerMetadata(postFenceContent);
      if (postFenceOwner === null) {
        return false;
      }
      const liveness = await probeOwnerLiveness(postFenceOwner, probeTimeoutMs);
      if (liveness.status !== 'dead') {
        return false;
      }
    }
    try {
      await fs.unlink(lockPath);
    } catch (error) {
      if (!isErrnoCode(error, 'ENOENT')) {
        throw error;
      }
    }
    return true;
  }

  private async readOwner(lockPath: string): Promise<LockOwnerMetadata | null> {
    try {
      return parseOwnerMetadata(await fs.readFile(lockPath, 'utf8'));
    } catch (error) {
      if (isErrnoCode(error, 'ENOENT')) {
        return null;
      }
      throw error;
    }
  }

  private async removeOwnedFile(
    lockPath: string,
    ownerToken: string,
  ): Promise<void> {
    const observed = await this.readOwner(lockPath);
    if (observed?.ownerToken !== ownerToken) {
      return;
    }
    try {
      await fs.unlink(lockPath);
    } catch (error) {
      if (!isErrnoCode(error, 'ENOENT')) {
        throw error;
      }
    }
  }

  // ─── Release ─────────────────────────────────────────────────────────────

  private async release(lockPath: string): Promise<void> {
    const observed = await this.readOwner(lockPath);
    if (observed?.ownerToken !== this.ownerToken) {
      return;
    }
    try {
      await fs.unlink(lockPath);
    } catch (error) {
      if (!isErrnoCode(error, 'ENOENT')) {
        throw error;
      }
    }
  }
}
