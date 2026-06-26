/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Machine secret provider.
 *
 * Supplies a stable 32-byte high-entropy secret that serves as the root of
 * trust for the SecureStore fallback encryption envelope (v:2). The secret is
 * resolved in this order:
 *
 *   1. In-memory cache (scoped by durable source identity so distinct
 *      filePaths / injected keyring sources never contaminate each other).
 *   2. OS keyring (preferred durable store) under a fixed service/account.
 *   3. File fallback at Storage.getMachineSecretPath() (or injected path).
 *   4. Generate crypto.randomBytes(32); persist to keyring (if available) or
 *      file; then return it.
 *
 * If the secret cannot be read, generated, or persisted, the provider returns
 * null rather than throwing, so SecureStore can degrade gracefully.
 *
 * Concurrency safety: concurrent first-time calls for the same durable source
 * share a single in-flight generation promise, and after it resolves the
 * provider re-reads the persisted winner so no caller ever returns a
 * non-durable secret.
 *
 * Existing-file permission repair: on Unix-like platforms, a pre-existing
 * machine_secret file is repaired to 0o600 before acceptance; if the repair
 * fails the secret is rejected (degrades to null) so an insecure secret is
 * never used.
 */

import * as crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as path from 'node:path';
import { Storage } from '../config/storage.js';
import {
  createDefaultKeyringAdapter,
  type KeyringAdapter,
} from './secure-store.js';

const MACHINE_SECRET_SERVICE = 'llxprt-code-machine-secret';
const MACHINE_SECRET_ACCOUNT = 'default';
const SECRET_BYTE_LENGTH = 32;

export interface MachineSecretOptions {
  /**
   * Overrides the on-disk path used for the file fallback. Defaults to
   * Storage.getMachineSecretPath(). Exposed for deterministic tests.
   */
  filePath?: string;
  /**
   * Overrides the OS keyring loader. Defaults to createDefaultKeyringAdapter.
   * Exposed for deterministic tests.
   */
  keyringLoader?: () => Promise<KeyringAdapter | null>;
  /**
   * When false, the provider only loads an existing secret (keyring → file)
   * and returns null if none is found, instead of generating and persisting a
   * new one. Read/decrypt paths use this so a missing or rotated secret fails
   * closed without minting a new root of trust as a side effect of a read
   * (which would otherwise orphan existing v:2 envelopes sealed under the
   * prior secret). Defaults to true.
   */
  generateIfMissing?: boolean;
}

/**
 * Cache entry: holds a resolved secret (Buffer when available, null on
 * graceful degradation) and an in-flight promise used to deduplicate
 * concurrent first-time generation for the same durable source.
 */
interface CacheEntry {
  secret: Buffer | null;
  inFlight: Promise<Buffer | null> | null;
}

type SecretReadResult =
  | { status: 'found'; secret: Buffer }
  | { status: 'missing' }
  | { status: 'unusable' };

/**
 * Cache scoped by durable source identity. The key is derived from the
 * resolved filePath plus whether a non-default (injected) keyring loader is
 * in use, so that tests/instances pointing at different paths or keyring
 * sources never contaminate each other.
 */
const cache = new Map<string, CacheEntry>();

/**
 * Sentinel key used when the default (production) file path is in use
 * without an injected keyring loader. Kept distinct from any injected
 * path to avoid accidental collisions.
 */
const DEFAULT_SOURCE_KEY = '__default__';
const keyringLoaderIds = new WeakMap<
  NonNullable<MachineSecretOptions['keyringLoader']>,
  number
>();
let nextKeyringLoaderId = 1;

function keyringLoaderIdOf(
  loader: NonNullable<MachineSecretOptions['keyringLoader']>,
): number {
  const existing = keyringLoaderIds.get(loader);
  if (existing !== undefined) {
    return existing;
  }
  const id = nextKeyringLoaderId++;
  keyringLoaderIds.set(loader, id);
  return id;
}

/**
 * Computes a durable cache key from the resolved options. Two option sets
 * that resolve to the same persisted location (or both use the default
 * location with the default keyring loader) share a key; everything else
 * is isolated.
 */
function sourceKeyOf(options?: MachineSecretOptions): string {
  const filePath = options?.filePath ?? Storage.getMachineSecretPath();
  const resolved = path.resolve(filePath);
  if (
    options?.keyringLoader === undefined &&
    resolved === path.resolve(Storage.getMachineSecretPath())
  ) {
    return DEFAULT_SOURCE_KEY;
  }
  const keyringSource =
    options?.keyringLoader === undefined
      ? 'default'
      : `injected:${keyringLoaderIdOf(options.keyringLoader)}`;
  return `file:${resolved}|keyring:${keyringSource}`;
}

export function resetMachineSecretCache(): void {
  cache.clear();
}

export async function getMachineSecret(
  options?: MachineSecretOptions,
): Promise<Buffer | null> {
  const key = sourceKeyOf(options);
  const entry = cache.get(key);
  // Resolved cache hit with a durable secret: always safe to return for any
  // caller, regardless of generate-vs-read-only mode.
  if (entry?.inFlight === null && entry.secret !== null) {
    return entry.secret;
  }
  // In-flight resolution: piggyback on the existing promise so concurrent
  // callers for the same source share a single resolution and converge on the
  // durable winner.
  if (entry?.inFlight) {
    return entry.inFlight;
  }

  // Read-only resolution (decrypt paths) must neither generate a new secret
  // nor poison the shared cache with a negative result: the absence of a
  // secret is not a durable fact (a later generating writer may create one),
  // and a cached null would cause a subsequent read to fail closed even after
  // a secret has been persisted. Resolve directly; only promote a positive
  // result to the cache.
  if (options?.generateIfMissing === false) {
    const secret = await resolveAndPersist(options);
    if (secret !== null) {
      cache.set(key, { secret, inFlight: null });
    }
    return secret;
  }

  // Generating path: a cached null from a prior generating attempt is returned
  // as-is so repeated generating calls that cannot persist degrade
  // consistently.
  if (entry?.inFlight === null) {
    return entry.secret;
  }

  const promise = resolveAndPersist(options);
  cache.set(key, { secret: null, inFlight: promise });

  const secret = await promise;
  cache.set(key, { secret, inFlight: null });
  return secret;
}

/**
 * Resolves the secret for the given options. Handles the read → generate →
 * persist flow, and enforces that no caller returns a generated secret
 * unless that exact secret is durably persisted. Concurrent
 * callers for the same source share this in-flight promise; after it
 * completes, the winner is whatever was durably persisted.
 */
async function resolveAndPersist(
  options?: MachineSecretOptions,
): Promise<Buffer | null> {
  const filePath = options?.filePath ?? Storage.getMachineSecretPath();
  const keyringLoader = options?.keyringLoader ?? createDefaultKeyringAdapter;

  const keyring = await loadKeyring(keyringLoader);

  // 1. Try the keyring (preferred durable store).
  let keyringRead: SecretReadResult = { status: 'missing' };
  if (keyring !== null) {
    keyringRead = await readFromKeyring(keyring);
    if (keyringRead.status === 'found') {
      return keyringRead.secret;
    }
  }

  // 2. Try the file fallback.
  const fileRead = await readFromFile(filePath);
  if (fileRead.status === 'found') {
    return fileRead.secret;
  }

  if (keyringRead.status === 'unusable' || fileRead.status === 'unusable') {
    return null;
  }

  // Read-only resolution: no existing secret was found and the caller opted
  // out of generation (e.g. a decrypt path). Fail closed with null rather than
  // minting a new root of trust as a side effect of a read.
  if (options?.generateIfMissing === false) {
    return null;
  }

  // 3. Nothing found — generate, persist, then RE-READ the winner so every
  //    concurrent caller converges on the durably persisted value.
  return generatePersistAndReread(keyring, filePath);
}

/**
 * Generates a new secret, persists it, then re-reads whatever is now durably
 * persisted at the primary durable source. This guarantees that even under a
 * race (two callers both generating), every caller returns the persisted
 * winner rather than a transient in-memory value that may have lost the
 * durability race.
 */
async function generatePersistAndReread(
  keyring: KeyringAdapter | null,
  filePath: string,
): Promise<Buffer | null> {
  const secret = crypto.randomBytes(SECRET_BYTE_LENGTH);
  const encoded = secret.toString('base64');

  if (keyring !== null) {
    const persisted = await persistToKeyring(keyring, encoded);
    if (persisted) {
      // Re-read the keyring winner in case a concurrent writer persisted a
      // different secret first.
      const winner = await readFromKeyring(keyring);
      return winner.status === 'found' ? winner.secret : secret;
    }
  }

  const filePersisted = await persistToFile(filePath, encoded);
  if (!filePersisted) {
    return null;
  }
  // Re-read the file winner.
  const winner = await readFromFile(filePath);
  return winner.status === 'found' ? winner.secret : secret;
}

async function loadKeyring(
  keyringLoader: () => Promise<KeyringAdapter | null>,
): Promise<KeyringAdapter | null> {
  try {
    return await keyringLoader();
  } catch {
    return null;
  }
}

async function readFromKeyring(
  keyring: KeyringAdapter,
): Promise<SecretReadResult> {
  try {
    const stored = await keyring.getPassword(
      MACHINE_SECRET_SERVICE,
      MACHINE_SECRET_ACCOUNT,
    );
    if (stored === null) {
      return { status: 'missing' };
    }
    const decoded = decodeSecret(stored);
    return decoded === null
      ? { status: 'unusable' }
      : { status: 'found', secret: decoded };
  } catch {
    return { status: 'unusable' };
  }
}

async function readFromFile(filePath: string): Promise<SecretReadResult> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const decoded = decodeSecret(content);
    if (decoded === null) {
      return { status: 'unusable' };
    }
    if (!(await ensureSecureDirectory(path.dirname(filePath)))) {
      return { status: 'unusable' };
    }
    // Repair permissions on existing files before accepting.
    if (!(await ensureSecurePermissions(filePath))) {
      return { status: 'unusable' };
    }
    return { status: 'found', secret: decoded };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing' };
    }
    return { status: 'unusable' };
  }
}

function decodeSecret(encoded: string): Buffer | null {
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length !== SECRET_BYTE_LENGTH) {
    return null;
  }
  return buf;
}

/**
 * Ensures an existing machine_secret file has restrictive permissions
 * (0o600 on Unix). On Windows this is a no-op (permissions are enforced via
 * ACLs, not POSIX modes). If the chmod fails, returns false so the caller
 * rejects the secret rather than using an insecure one.
 */
async function ensureSecurePermissions(filePath: string): Promise<boolean> {
  if (process.platform === 'win32') {
    return true;
  }
  try {
    const stat = await fs.stat(filePath);
    const currentMode = stat.mode & 0o777;
    if (currentMode !== 0o600) {
      await fs.chmod(filePath, 0o600);
    }
    return true;
  } catch {
    return false;
  }
}

async function ensureSecureDirectory(dirPath: string): Promise<boolean> {
  if (process.platform === 'win32') {
    return true;
  }
  try {
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) {
      return false;
    }
    const currentMode = stat.mode & 0o777;
    if (currentMode !== 0o700) {
      await fs.chmod(dirPath, 0o700);
    }
    return true;
  } catch {
    return false;
  }
}
async function persistToKeyring(
  keyring: KeyringAdapter,
  encoded: string,
): Promise<boolean> {
  try {
    await keyring.setPassword(
      MACHINE_SECRET_SERVICE,
      MACHINE_SECRET_ACCOUNT,
      encoded,
    );
    return true;
  } catch {
    return false;
  }
}

async function persistToFile(
  filePath: string,
  encoded: string,
): Promise<boolean> {
  const dir = path.dirname(filePath);
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    if (!(await ensureSecureDirectory(dir))) {
      return false;
    }
  } catch {
    return false;
  }

  const tempPath = filePath + '.tmp.' + crypto.randomUUID().substring(0, 8);

  let fd: FileHandle | null = null;
  try {
    fd = await fs.open(tempPath, 'w', 0o600);
    await fd.writeFile(encoded);
    await fd.sync();
    await fd.close();
    fd = null;

    await renameWithRetry(tempPath, filePath);
    await fs.chmod(filePath, 0o600).catch(() => {});
    return true;
  } catch {
    if (fd !== null) {
      await fd.close().catch(() => {});
    }
    await fs.unlink(tempPath).catch(() => {});
    return false;
  }
}

async function renameWithRetry(
  tempPath: string,
  finalPath: string,
): Promise<void> {
  let attempts = 0;
  while (attempts < 3) {
    try {
      await fs.rename(tempPath, finalPath);
      return;
    } catch (error) {
      attempts++;
      if (attempts >= 3 || (error as NodeJS.ErrnoException).code !== 'EPERM') {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
