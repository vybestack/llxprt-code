/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileDocument, SourceFingerprint } from '../contracts/index.js';

/**
 * Thrown by {@link ProfileRepositoryPort.save} when the persisted fingerprint does not
 * match the caller's `expected` fingerprint.
 *
 * The mismatch means the underlying file changed outside the repository's knowledge since it
 * was loaded or last saved. The caller decides how to surface the conflict; no stack or
 * message scrubbing is done here because the record may already be redacted before this
 * error is constructed.
 */
export class ProfileRepositoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileRepositoryConflictError';
  }
}

/**
 * Persistence boundary for profile documents.
 *
 * Ports are the outer boundary of the profiles tree: implementations live outside core
 * (settings-owned or CLI adapter) and meet this shape without importing it. This
 * interface owns read/write of the raw document plus its source fingerprint.
 */
export interface ProfileRepositoryPort {
  /**
   * Load a profile by name.
   *
   * @returns the parsed document plus the fingerprint of the file it came from.
   * @throws when the named profile does not exist or cannot be parsed.
   */
  load(
    name: string,
  ): Promise<{ document: ProfileDocument; fingerprint: SourceFingerprint }>;

  /**
   * Persist a document under `name`.
   *
   * Pass `expected` to optimistically-conflict: when the fingerprint that is currently
   * persisted does not match (because of external modification), this throws
   * {@link ProfileRepositoryConflictError}. Pass `mustCreate` to refuse an existing
   * destination atomically with the same error instead of overwriting it.
   *
   * @returns the fingerprint of the file as written.
   */
  save(
    name: string,
    document: ProfileDocument,
    expected?: SourceFingerprint,
    opts?: { mustCreate?: boolean },
  ): Promise<SourceFingerprint>;

  /**
   * List every saved profile name.
   */
  list(): Promise<ReadonlyArray<{ name: string }>>;

  /**
   * Delete a saved profile.
   */
  delete(name: string): Promise<void>;

  /**
   * Return the current fingerprint of the persisted file, or `null` for a
   * missing/deleted file.
   */
  stat(name: string): Promise<SourceFingerprint | null>;
}
