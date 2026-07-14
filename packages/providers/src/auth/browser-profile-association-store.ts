/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { Storage } from '@vybestack/llxprt-code-storage';
import type { BrowserKind } from '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js';

/**
 * A bucket-to-browser-profile association.
 */
export interface BrowserProfileAssociation {
  browser: BrowserKind;
  profileDirectory: string;
  displayName?: string;
}

/**
 * The set of browser kinds supported by the secure browser launcher.
 * Mirrors the {@link BrowserKind} union so persisted values can be validated
 * on read and rejected if they do not name a supported browser.
 */
const SUPPORTED_BROWSER_KINDS: readonly BrowserKind[] = [
  'chrome',
  'firefox',
  'safari',
];

function isSupportedBrowserKind(value: unknown): value is BrowserKind {
  return (
    typeof value === 'string' &&
    (SUPPORTED_BROWSER_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Injectable filesystem accessors for testability.
 */
export interface AssociationStoreFs {
  readFile?: (p: string) => string;
  writeFile?: (p: string, c: string, opts?: { mode?: number }) => void;
  chmod?: (p: string, mode: number) => void;
  exists?: (p: string) => boolean;
  mkdir?: (p: string, opts?: { recursive?: boolean }) => void;
  rename?: (oldPath: string, newPath: string) => void;
  unlink?: (p: string) => void;
}

const DEFAULT_FILE_VERSION = 1;

interface AssociationFileData {
  version: typeof DEFAULT_FILE_VERSION;
  associations: Record<
    string,
    {
      browser: BrowserKind;
      profileDirectory: string;
      displayName?: string;
    }
  >;
}

interface AssociationFileReadResult {
  data: AssociationFileData;
  writable: boolean;
}

function emptyFileData(): AssociationFileData {
  return { version: DEFAULT_FILE_VERSION, associations: {} };
}

function defaultFilePath(): string {
  return path.join(Storage.getGlobalDataDir(), 'oauth-browser-profiles.json');
}

function validateProvider(provider: string): void {
  if (provider.length === 0 || provider.includes(':')) {
    throw new Error('Provider must be non-empty and must not contain colons.');
  }
}

function validateBucket(bucket: string): void {
  if (bucket.length === 0) {
    throw new Error('Bucket must be non-empty.');
  }
}

function associationKey(provider: string, bucket: string): string {
  validateProvider(provider);
  validateBucket(bucket);
  return `${provider}:${bucket}`;
}

/**
 * Build a fresh association object from a source so the store never hands
 * out or persists a reference to caller-owned objects.
 */
function cloneAssociation(
  source: BrowserProfileAssociation,
): BrowserProfileAssociation {
  const clone: BrowserProfileAssociation = {
    browser: source.browser,
    profileDirectory: source.profileDirectory,
  };
  if (source.displayName !== undefined) {
    clone.displayName = source.displayName;
  }
  return clone;
}

const CONTROL_CHARACTERS = /\p{Cc}/u;

function isValidAssociationText(value: string, allowEmpty: boolean): boolean {
  return (allowEmpty || value.length > 0) && !CONTROL_CHARACTERS.test(value);
}

function validateAssociation(association: BrowserProfileAssociation): void {
  if (!isSupportedBrowserKind(association.browser)) {
    throw new Error(`Unsupported browser kind: ${String(association.browser)}`);
  }
  if (!isValidAssociationText(association.profileDirectory, false)) {
    throw new Error(
      'Profile directory must be non-empty and must not contain control characters.',
    );
  }
  if (
    association.displayName !== undefined &&
    !isValidAssociationText(association.displayName, true)
  ) {
    throw new Error('Display name must not contain control characters.');
  }
}

/**
 * Runtime type guard for the persisted file's top-level shape (a numeric
 * version and an associations object). Does not validate individual entries —
 * use {@link sanitizeAssociations} to filter those — so one malformed entry
 * cannot cause the entire file (and all valid associations) to be discarded.
 */
function hasValidFileStructure(value: unknown): value is {
  version: typeof DEFAULT_FILE_VERSION;
  associations: Record<string, unknown>;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  if (!('version' in value) || value.version !== DEFAULT_FILE_VERSION) {
    return false;
  }
  if (
    !('associations' in value) ||
    typeof value.associations !== 'object' ||
    value.associations === null ||
    Array.isArray(value.associations)
  ) {
    return false;
  }
  return true;
}

function hasUnsupportedVersion(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  if (!('version' in value) || typeof value.version !== 'number') {
    return false;
  }
  return value.version !== DEFAULT_FILE_VERSION;
}

/**
 * Given a structurally-valid file, return an {@link AssociationFileData} with
 * only the well-formed association entries retained. Malformed entries are
 * silently dropped so a single bad write cannot hide the remaining valid
 * associations from every provider/bucket.
 */
function sanitizeAssociations(data: {
  version: typeof DEFAULT_FILE_VERSION;
  associations: Record<string, unknown>;
}): AssociationFileData {
  const validEntries = Object.entries(data.associations).filter(
    (entry): entry is [string, BrowserProfileAssociation] =>
      isAssociationEntry(entry[1]),
  );
  const associations = Object.fromEntries(
    validEntries.map(([key, entry]) => [key, cloneAssociation(entry)]),
  );
  return { version: data.version, associations };
}

function isAssociationEntry(
  value: unknown,
): value is BrowserProfileAssociation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  if (!('browser' in value) || !isSupportedBrowserKind(value.browser)) {
    return false;
  }
  if (
    !('profileDirectory' in value) ||
    typeof value.profileDirectory !== 'string' ||
    !isValidAssociationText(value.profileDirectory, false)
  ) {
    return false;
  }
  return (
    !('displayName' in value) ||
    value.displayName === undefined ||
    (typeof value.displayName === 'string' &&
      isValidAssociationText(value.displayName, true))
  );
}

/**
 * File-backed store for bucket-to-browser-profile associations.
 *
 * Each association maps a (provider, bucket) pair to a specific browser
 * binary and profile directory. This enables OAuth to always launch the
 * correct browser profile for the correct bucket.
 *
 * All filesystem operations can be injected for testing. When omitted,
 * real node:fs and the default Storage data dir are used.
 */
export class BrowserProfileAssociationStore {
  private readonly filePath: string;
  private readonly readFileFn: (p: string) => string;
  private readonly writeFileFn: (
    p: string,
    c: string,
    opts?: { mode?: number },
  ) => void;
  private readonly chmodFn: (p: string, mode: number) => void;
  private readonly existsFn: (p: string) => boolean;
  private readonly mkdirFn: (p: string, opts?: { recursive?: boolean }) => void;
  private readonly renameFn: (oldPath: string, newPath: string) => void;
  private readonly unlinkFn: (p: string) => void;

  constructor(
    filePath: string = defaultFilePath(),
    fsOpts?: AssociationStoreFs,
  ) {
    this.filePath = filePath;
    this.readFileFn = fsOpts?.readFile ?? ((p) => fs.readFileSync(p, 'utf-8'));
    this.writeFileFn =
      fsOpts?.writeFile ?? ((p, c, opts) => fs.writeFileSync(p, c, opts));
    this.chmodFn = fsOpts?.chmod ?? fs.chmodSync;
    this.existsFn = fsOpts?.exists ?? fs.existsSync;
    this.mkdirFn = fsOpts?.mkdir ?? ((p, opts) => fs.mkdirSync(p, opts));
    this.renameFn = fsOpts?.rename ?? fs.renameSync;
    this.unlinkFn = fsOpts?.unlink ?? fs.unlinkSync;
  }

  /**
   * Set the browser profile association for a provider+bucket.
   * Never mutates the input association; builds a fresh object.
   */
  setAssociation(
    provider: string,
    bucket: string,
    association: BrowserProfileAssociation,
  ): void {
    const key = associationKey(provider, bucket);
    validateAssociation(association);
    const result = this.readData();
    this.assertWritable(result);

    result.data.associations[key] = cloneAssociation(association);
    this.writeData(result.data);
  }

  /**
   * Get the association for a provider+bucket.
   * Bucket defaults to 'default'.
   * Returns undefined if missing or file malformed.
   */
  getAssociation(
    provider: string,
    bucket: string = 'default',
  ): BrowserProfileAssociation | undefined {
    const data = this.readData().data;
    const key = associationKey(provider, bucket);
    if (!(key in data.associations)) {
      return undefined;
    }
    const found = data.associations[key];

    // Return a fresh copy so external mutation does not affect the store
    return cloneAssociation(found);
  }

  /**
   * Clear the association for a provider+bucket.
   * Bucket defaults to 'default'.
   */
  clearAssociation(provider: string, bucket: string = 'default'): void {
    const result = this.readData();
    this.assertWritable(result);
    const key = associationKey(provider, bucket);
    if (key in result.data.associations) {
      delete result.data.associations[key];
      this.writeData(result.data);
    }
  }

  /**
   * List all associations for a given provider.
   */
  listAssociations(
    provider: string,
  ): Array<{ bucket: string } & BrowserProfileAssociation> {
    validateProvider(provider);
    const data = this.readData().data;
    const prefix = `${provider}:`;
    const results: Array<{ bucket: string } & BrowserProfileAssociation> = [];

    for (const [key, assoc] of Object.entries(data.associations)) {
      if (key.startsWith(prefix)) {
        const bucket = key.slice(prefix.length);
        results.push({ bucket, ...cloneAssociation(assoc) });
      }
    }

    return results;
  }

  /**
   * Read the file data. Resilient: missing or malformed file → empty data.
   * Does NOT overwrite on read failure.
   */
  private readData(): AssociationFileReadResult {
    if (!this.existsFn(this.filePath)) {
      return { data: emptyFileData(), writable: true };
    }

    let raw: string;
    try {
      raw = this.readFileFn(this.filePath);
    } catch (error) {
      if (this.existsFn(this.filePath)) {
        throw error;
      }
      return { data: emptyFileData(), writable: true };
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!hasValidFileStructure(parsed)) {
        return {
          data: emptyFileData(),
          writable: !hasUnsupportedVersion(parsed),
        };
      }
      return { data: sanitizeAssociations(parsed), writable: true };
    } catch {
      return { data: emptyFileData(), writable: true };
    }
  }

  private assertWritable(result: AssociationFileReadResult): void {
    if (!result.writable) {
      throw new Error(
        'Cannot modify browser profile associations from an unsupported file version.',
      );
    }
  }

  /**
   * Write the file data. Creates parent directory if needed.
   */
  private writeData(data: AssociationFileData): void {
    const dir = path.dirname(this.filePath);
    const tempSuffix = `${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    const tempPath = `${this.filePath}.tmp-${tempSuffix}`;
    // mkdir with recursive:true is a no-op when the directory already exists,
    // so no separate existence check is needed (and one would introduce a
    // TOCTOU window between check and write).
    this.mkdirFn(dir, { recursive: true });

    try {
      this.writeFileFn(tempPath, JSON.stringify(data, null, 2), {
        mode: 0o600,
      });
      if (process.platform !== 'win32') {
        this.chmodFn(tempPath, 0o600);
      }
      this.renameFn(tempPath, this.filePath);
    } catch (error) {
      try {
        this.unlinkFn(tempPath);
      } catch {
        // Best-effort cleanup only; preserve the original write/rename error.
      }
      throw error;
    }
  }
}
