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
import type { Settings } from './settings.js';
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
    const resolvedLocation = path.resolve(location);
    const matches = this.rules.flatMap((rule) => {
      const effectivePath = path.resolve(
        rule.trustLevel === TrustLevel.TRUST_PARENT
          ? path.dirname(rule.path)
          : rule.path,
      );
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

  setValue(path: string, trustLevel: TrustLevel): void {
    const hadOriginalTrustLevel = Object.hasOwn(this.user.config, path);
    const originalTrustLevel = this.user.config[path];
    this.user.config[path] = trustLevel;
    try {
      saveTrustedFolders(this.user);
    } catch (e) {
      // Revert the in-memory change if the save failed.
      if (!hadOriginalTrustLevel) {
        delete this.user.config[path];
      } else {
        this.user.config[path] = originalTrustLevel;
      }
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
      fs.chmodSync(temporaryPath, 0o600);
      const temporaryMode = fs.statSync(temporaryPath).mode & 0o777;
      if (temporaryMode !== 0o600) {
        throw new Error(
          `Trusted folders temporary file has mode ${temporaryMode.toString(8)} instead of 600.`,
        );
      }
    }
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }

  // Atomic replacement is the commit point; nothing fallible may follow it on
  // success. A failed commit still owns the temporary file and must remove it.
  try {
    fs.renameSync(temporaryPath, trustedFoldersFile.path);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Preserve the rename error if cleanup also fails.
    }
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
    const errorMessages = trustedFolders.errors.map(
      (error) => `Error in ${error.path}: ${error.message}`,
    );
    throw new FatalConfigError(
      `${errorMessages.join('\n')}\nPlease fix the configuration file and try again.`,
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
