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
  writeFile?: (p: string, c: string) => void;
  exists?: (p: string) => boolean;
  mkdir?: (p: string, opts?: { recursive?: boolean }) => void;
}

interface AssociationFileData {
  version: number;
  associations: Record<
    string,
    {
      browser: BrowserKind;
      profileDirectory: string;
      displayName?: string;
    }
  >;
}

const DEFAULT_FILE_VERSION = 1;

function defaultFilePath(): string {
  return path.join(Storage.getGlobalDataDir(), 'oauth-browser-profiles.json');
}

function associationKey(provider: string, bucket: string): string {
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

/**
 * Runtime type guard for the persisted file shape. Ensures malformed or
 * partial JSON is rejected without relying on `any`.
 *
 * Validates not only that `associations` is an object, but that every entry
 * has the required `browser` and `profileDirectory` fields so malformed
 * entries cannot silently pass and cause runtime errors when consumed.
 */
function isAssociationFileData(value: unknown): value is AssociationFileData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.version !== 'number') {
    return false;
  }
  const associations = record.associations;
  if (typeof associations !== 'object' || associations === null) {
    return false;
  }
  const entries = associations as Record<string, unknown>;
  for (const entry of Object.values(entries)) {
    if (!isAssociationEntry(entry)) {
      return false;
    }
  }
  return true;
}

function isAssociationEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    isSupportedBrowserKind(entry.browser) &&
    typeof entry.profileDirectory === 'string' &&
    (entry.displayName === undefined || typeof entry.displayName === 'string')
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
  private readonly writeFileFn: (p: string, c: string) => void;
  private readonly existsFn: (p: string) => boolean;
  private readonly mkdirFn: (p: string, opts?: { recursive?: boolean }) => void;

  constructor(
    filePath: string = defaultFilePath(),
    fsOpts?: AssociationStoreFs,
  ) {
    this.filePath = filePath;
    this.readFileFn = fsOpts?.readFile ?? ((p) => fs.readFileSync(p, 'utf-8'));
    this.writeFileFn = fsOpts?.writeFile ?? fs.writeFileSync;
    this.existsFn = fsOpts?.exists ?? fs.existsSync;
    this.mkdirFn = fsOpts?.mkdir ?? ((p, opts) => fs.mkdirSync(p, opts));
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
    const data = this.readData();
    const key = associationKey(provider, bucket);

    data.associations[key] = cloneAssociation(association);
    this.writeData(data);
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
    const data = this.readData();
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
    const data = this.readData();
    const key = associationKey(provider, bucket);
    if (key in data.associations) {
      delete data.associations[key];
      this.writeData(data);
    }
  }

  /**
   * List all associations for a given provider.
   */
  listAssociations(
    provider: string,
  ): Array<{ bucket: string } & BrowserProfileAssociation> {
    const data = this.readData();
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
  private readData(): AssociationFileData {
    if (!this.existsFn(this.filePath)) {
      return { version: DEFAULT_FILE_VERSION, associations: {} };
    }

    let raw: string;
    try {
      raw = this.readFileFn(this.filePath);
    } catch {
      return { version: DEFAULT_FILE_VERSION, associations: {} };
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isAssociationFileData(parsed)) {
        return { version: DEFAULT_FILE_VERSION, associations: {} };
      }
      return parsed;
    } catch {
      return { version: DEFAULT_FILE_VERSION, associations: {} };
    }
  }

  /**
   * Write the file data. Creates parent directory if needed.
   */
  private writeData(data: AssociationFileData): void {
    const dir = path.dirname(this.filePath);
    if (!this.existsFn(dir)) {
      this.mkdirFn(dir, { recursive: true });
    }
    this.writeFileFn(this.filePath, JSON.stringify(data, null, 2));
  }
}
