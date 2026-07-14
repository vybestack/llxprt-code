/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  FatalConfigError,
  getErrorMessage,
  isWithinRoot,
  getIdeTrust,
} from '@vybestack/llxprt-code-core';
import stripJsonComments from 'strip-json-comments';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import type { Settings } from './settings.js';
import { formatConfigFileErrors } from './configError.js';
import { USER_SETTINGS_DIR } from './paths.js';

export const TRUSTED_FOLDERS_FILENAME = 'trustedFolders.json';

export function getTrustedFoldersPath(): string {
  if (process.env['LLXPRT_CODE_TRUSTED_FOLDERS_PATH']) {
    return process.env['LLXPRT_CODE_TRUSTED_FOLDERS_PATH'];
  }
  return path.join(USER_SETTINGS_DIR, TRUSTED_FOLDERS_FILENAME);
}

export enum TrustLevel {
  TRUST_FOLDER = 'TRUST_FOLDER',
  TRUST_PARENT = 'TRUST_PARENT',
  DO_NOT_TRUST = 'DO_NOT_TRUST',
}

export function isTrustLevel(value: unknown): value is TrustLevel {
  return (
    typeof value === 'string' &&
    Object.values(TrustLevel).includes(value as TrustLevel)
  );
}

export interface TrustRule {
  path: string;
  trustLevel: TrustLevel;
}

export interface ResolvedTrustRule {
  readonly rule: TrustRule;
  readonly effectivePath: string;
  readonly trusted: boolean;
  readonly provenance: 'direct' | 'inherited';
}

export interface TrustedFoldersError {
  message: string;
  path: string;
}

export interface TrustedFoldersFile {
  config: Record<string, TrustLevel>;
  path: string;
}

export interface TrustedFolderSnapshot {
  readonly canonicalPath: string;
  readonly entries: ReadonlyArray<readonly [string, TrustLevel]>;
}

function resolveCanonicalPath(location: string): string | undefined {
  try {
    return fs.realpathSync(path.resolve(location));
  } catch {
    return undefined;
  }
}

function requireCanonicalPath(location: string): string {
  const canonicalPath = resolveCanonicalPath(location);
  if (canonicalPath === undefined) {
    throw new Error(`Unable to resolve canonical path for "${location}".`);
  }
  return canonicalPath;
}

export class LoadedTrustedFolders {
  constructor(
    readonly user: TrustedFoldersFile,
    readonly errors: TrustedFoldersError[],
  ) {}

  get rules(): TrustRule[] {
    return Object.entries(this.user.config).map(([path, trustLevel]) => ({
      path,
      trustLevel,
    }));
  }

  /**
   * Returns true or false if the path should be "trusted". This function
   * should only be invoked when the folder trust setting is active.
   *
   * @param location path
   * @returns
   */
  isPathTrusted(location: string): boolean | undefined {
    return this.resolvePathTrust(location)?.trusted;
  }

  resolvePathTrust(location: string): ResolvedTrustRule | undefined {
    const resolvedLocation = resolveCanonicalPath(location);
    if (resolvedLocation === undefined) {
      return undefined;
    }
    const matches = this.rules.flatMap((rule) => {
      const canonicalRulePath = resolveCanonicalPath(rule.path);
      if (canonicalRulePath === undefined) {
        return [];
      }
      const effectivePath =
        rule.trustLevel === TrustLevel.TRUST_PARENT
          ? path.dirname(canonicalRulePath)
          : canonicalRulePath;
      if (!isWithinRoot(resolvedLocation, effectivePath)) {
        return [];
      }
      return [
        {
          rule,
          effectivePath,
          trusted: rule.trustLevel !== TrustLevel.DO_NOT_TRUST,
          provenance:
            resolvedLocation === effectivePath
              ? ('direct' as const)
              : ('inherited' as const),
        },
      ];
    });

    // The most specific rule wins; at equal specificity, denial wins so an
    // ambiguous configuration cannot accidentally grant trust.
    matches.sort((left, right) => {
      const specificity =
        right.effectivePath.length - left.effectivePath.length;
      return specificity !== 0
        ? specificity
        : Number(left.trusted) - Number(right.trusted);
    });
    return matches[0];
  }

  getValue(location: string): TrustLevel | undefined {
    const canonicalPath = resolveCanonicalPath(location);
    return canonicalPath === undefined
      ? undefined
      : this.user.config[canonicalPath];
  }

  snapshotValue(location: string): TrustedFolderSnapshot {
    const canonicalPath = requireCanonicalPath(location);
    return {
      canonicalPath,
      entries: Object.entries(this.user.config).filter(
        ([rulePath]) => resolveCanonicalPath(rulePath) === canonicalPath,
      ),
    };
  }

  restoreSnapshot(snapshot: TrustedFolderSnapshot): void {
    const originalConfig = { ...this.user.config };
    for (const rulePath of Object.keys(this.user.config)) {
      if (resolveCanonicalPath(rulePath) === snapshot.canonicalPath) {
        delete this.user.config[rulePath];
      }
    }
    for (const [rulePath, trustLevel] of snapshot.entries) {
      this.user.config[rulePath] = trustLevel;
    }
    try {
      saveTrustedFolders(this.user);
    } catch (e) {
      this.user.config = originalConfig;
      throw e;
    }
  }

  setValue(location: string, trustLevel: TrustLevel): void {
    const canonicalPath = requireCanonicalPath(location);
    const originalConfig = { ...this.user.config };
    const aliases = Object.keys(this.user.config).filter(
      (rulePath) => resolveCanonicalPath(rulePath) === canonicalPath,
    );
    for (const alias of aliases) {
      delete this.user.config[alias];
    }
    this.user.config[canonicalPath] = trustLevel;
    try {
      saveTrustedFolders(this.user);
    } catch (e) {
      this.user.config = originalConfig;
      throw e;
    }
  }

  deleteValue(location: string): void {
    const canonicalPath = requireCanonicalPath(location);
    const originalConfig = { ...this.user.config };
    const aliases = Object.keys(this.user.config).filter(
      (rulePath) => resolveCanonicalPath(rulePath) === canonicalPath,
    );
    if (aliases.length === 0) {
      return;
    }
    for (const alias of aliases) {
      delete this.user.config[alias];
    }
    try {
      saveTrustedFolders(this.user);
    } catch (e) {
      this.user.config = originalConfig;
      throw e;
    }
  }
}

let loadedTrustedFolders: LoadedTrustedFolders | undefined;

/**
 * FOR TESTING PURPOSES ONLY.
 * Resets the in-memory cache of the trusted folders configuration.
 */
export function resetTrustedFoldersForTesting(): void {
  loadedTrustedFolders = undefined;
}

export function loadTrustedFolders(): LoadedTrustedFolders {
  if (loadedTrustedFolders) {
    return loadedTrustedFolders;
  }

  const errors: TrustedFoldersError[] = [];
  const userConfig: Record<string, TrustLevel> = {};

  const userPath = getTrustedFoldersPath();

  // Load user trusted folders
  try {
    if (fs.existsSync(userPath)) {
      const content = fs.readFileSync(userPath, 'utf-8');
      const parsed: unknown = JSON.parse(stripJsonComments(content));

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        errors.push({
          message: 'Trusted folders file is not a valid JSON object.',
          path: userPath,
        });
      } else {
        processTrustedFoldersEntries(
          parsed as Record<string, unknown>,
          userConfig,
          errors,
          userPath,
        );
      }
    }
  } catch (error: unknown) {
    errors.push({
      message: getErrorMessage(error),
      path: userPath,
    });
  }

  loadedTrustedFolders = new LoadedTrustedFolders(
    { path: userPath, config: userConfig },
    errors,
  );
  return loadedTrustedFolders;
}

function removeTemporaryFile(temporaryPath: string): void {
  try {
    fs.unlinkSync(temporaryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      debugLogger.warn(
        `Failed to remove trusted folders temporary file ${temporaryPath}:`,
        error,
      );
    }
  }
}

function isUnsupportedFileModeError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) {
    return false;
  }
  return (
    error.code === 'ENOSYS' ||
    error.code === 'ENOTSUP' ||
    error.code === 'EOPNOTSUPP'
  );
}

function secureTemporaryFileMode(temporaryPath: string): void {
  try {
    fs.chmodSync(temporaryPath, 0o600);
    const temporaryMode = fs.statSync(temporaryPath).mode & 0o777;
    if (temporaryMode !== 0o600) {
      throw new Error(
        `Trusted folders temporary file has mode ${temporaryMode.toString(8)} instead of 600.`,
      );
    }
  } catch (error) {
    if (!isUnsupportedFileModeError(error)) {
      throw error;
    }
    debugLogger.warn(
      `Filesystem for trusted folders does not support POSIX file modes; continuing with the mode requested at file creation for ${temporaryPath}:`,
      error,
    );
  }
}

export function saveTrustedFolders(
  trustedFoldersFile: TrustedFoldersFile,
): void {
  // Ensure the directory exists
  const dirPath = path.dirname(trustedFoldersFile.path);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  const temporaryPath = path.join(
    dirPath,
    `.${path.basename(trustedFoldersFile.path)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    fs.writeFileSync(
      temporaryPath,
      JSON.stringify(trustedFoldersFile.config, null, 2),
      { encoding: 'utf-8', mode: 0o600, flag: 'wx' },
    );
    if (process.platform !== 'win32') {
      secureTemporaryFileMode(temporaryPath);
    }
  } catch (error) {
    removeTemporaryFile(temporaryPath);
    throw error;
  }

  // Atomic replacement is the commit point; nothing fallible may follow it on
  // success. A failed commit still owns the temporary file and must remove it.
  try {
    fs.renameSync(temporaryPath, trustedFoldersFile.path);
  } catch (error) {
    removeTemporaryFile(temporaryPath);
    throw error;
  }
}

/** Is folder trust feature enabled per the current applied settings */
export function isFolderTrustEnabled(settings: Settings): boolean {
  // In llxprt, we use flat settings structure
  const folderTrustSetting = settings.folderTrust ?? false;
  return folderTrustSetting;
}

export function resolveWorkspaceTrust(
  settings: Settings,
  trustedFolders: LoadedTrustedFolders,
  workingDirectory: string,
  ideTrust: boolean | undefined = getIdeTrust(),
): boolean | undefined {
  if (!isFolderTrustEnabled(settings)) {
    return true;
  }
  if (ideTrust !== undefined) {
    return ideTrust;
  }
  return trustedFolders.isPathTrusted(workingDirectory);
}

export function resolveLocalWorkspaceTrust(
  settings: Settings,
  trustedFolders: LoadedTrustedFolders,
  workingDirectory: string,
): boolean | undefined {
  if (!isFolderTrustEnabled(settings)) {
    return true;
  }
  return trustedFolders.isPathTrusted(workingDirectory);
}

export function isWorkspaceTrusted(
  settings: Settings,
  workingDirectory: string = process.cwd(),
  ideTrust: boolean | undefined = getIdeTrust(),
): boolean | undefined {
  if (!isFolderTrustEnabled(settings)) {
    return true;
  }
  if (ideTrust !== undefined) {
    return ideTrust;
  }

  const trustedFolders = loadTrustedFolders();
  if (trustedFolders.errors.length > 0) {
    throw new FatalConfigError(
      formatConfigFileErrors(trustedFolders.errors, 'configuration file'),
    );
  }
  return resolveWorkspaceTrust(
    settings,
    trustedFolders,
    workingDirectory,
    ideTrust,
  );
}

/**
 * Process entries from parsed trusted folders JSON.
 */
function processTrustedFoldersEntries(
  parsed: Record<string, unknown>,
  userConfig: Record<string, TrustLevel>,
  errors: TrustedFoldersError[],
  userPath: string,
): void {
  for (const [folderPath, trustLevel] of Object.entries(parsed)) {
    if (isTrustLevel(trustLevel)) {
      userConfig[folderPath] = trustLevel;
    } else {
      const possibleValues = Object.values(TrustLevel).join(', ');
      errors.push({
        message: `Invalid trust level "${trustLevel}" for path "${folderPath}". Possible values are: ${possibleValues}.`,
        path: userPath,
      });
    }
  }
}
