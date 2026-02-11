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

export interface TrustRule {
  path: string;
  trustLevel: TrustLevel;
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
    const trustedPaths: string[] = [];
    const untrustedPaths: string[] = [];

    for (const rule of this.rules) {
      switch (rule.trustLevel) {
        case TrustLevel.TRUST_FOLDER:
          trustedPaths.push(rule.path);
          break;
        case TrustLevel.TRUST_PARENT:
          trustedPaths.push(path.dirname(rule.path));
          break;
        case TrustLevel.DO_NOT_TRUST:
          untrustedPaths.push(rule.path);
          break;
        default:
          // Do nothing for unknown trust levels.
          break;
      }
    }

    for (const trustedPath of trustedPaths) {
      if (isWithinRoot(location, trustedPath)) {
        return true;
      }
    }

    for (const untrustedPath of untrustedPaths) {
      if (path.normalize(location) === path.normalize(untrustedPath)) {
        return false;
      }
    }

    return undefined;
  }

  setValue(path: string, trustLevel: TrustLevel): void {
    const originalTrustLevel = this.user.config[path];
    this.user.config[path] = trustLevel;
    try {
      saveTrustedFolders(this.user);
    } catch (e) {
      // Revert the in-memory change if the save failed.
      if (originalTrustLevel === undefined) {
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
  let userConfig: Record<string, TrustLevel> = {};

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
        userConfig = parsed as Record<string, TrustLevel>;
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

  fs.writeFileSync(
    trustedFoldersFile.path,
    JSON.stringify(trustedFoldersFile.config, null, 2),
    { encoding: 'utf-8', mode: 0o600 },
  );
}

/** Is folder trust feature enabled per the current applied settings */
export function isFolderTrustEnabled(settings: Settings): boolean {
  // In llxprt, we use flat settings structure
  const folderTrustSetting = settings.folderTrust ?? false;
  return folderTrustSetting;
}

function getWorkspaceTrustFromLocalConfig(): boolean | undefined {
  const folders = loadTrustedFolders();

  if (folders.errors.length > 0) {
    const errorMessages = folders.errors.map(
      (error) => `Error in ${error.path}: ${error.message}`,
    );
    throw new FatalConfigError(
      `${errorMessages.join('\n')}\nPlease fix the configuration file and try again.`,
    );
  }

  return folders.isPathTrusted(process.cwd());
}

export function isWorkspaceTrusted(settings: Settings): boolean | undefined {
  if (!isFolderTrustEnabled(settings)) {
    return true;
  }

  const ideTrust = getIdeTrust();
  if (ideTrust !== undefined) {
    return ideTrust;
  }

  // Fall back to the local user configuration
  return getWorkspaceTrustFromLocalConfig();
}
