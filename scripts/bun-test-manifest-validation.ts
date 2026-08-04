/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * File-existence and preload-path validation extracted from
 * `bun-test-manifest.ts` so the manifest module stays under the ESLint
 * `max-lines` budget (800 lines after blank/comment removal).
 *
 * All functions are pure with respect to an injectable `stat` dependency.
 */

import type {
  BunManifestDependencies,
  BunTestFile,
} from './bun-test-manifest.js';
import { BunManifestStatError, getErrorCode } from './bun-test-manifest.js';

/**
 * Validates that every resolved test file exists on disk and is a regular
 * file. Collects missing (ENOENT) and non-file paths, then validates all
 * declared preload/tsconfig/globalSetup paths. Throws a single aggregated
 * error when any path is missing or not a file.
 */
export function validateResolvedFiles(
  files: readonly BunTestFile[],
  dependencies: BunManifestDependencies,
): void {
  const missingFiles: string[] = [];
  const nonFiles: string[] = [];
  for (const { file } of files) {
    checkFileExists(dependencies, file, missingFiles, nonFiles);
  }
  validatePreloadPaths(files, dependencies);
  rejectMissingOrNonFiles(missingFiles, nonFiles);
}

function checkFileExists(
  dependencies: BunManifestDependencies,
  file: string,
  missingFiles: string[],
  nonFiles: string[],
): void {
  try {
    if (!dependencies.stat(file).isFile()) {
      nonFiles.push(file);
    }
  } catch (error: unknown) {
    const code = getErrorCode(error);
    if (code === 'ENOENT') {
      missingFiles.push(file);
    } else {
      throw new BunManifestStatError(file, code, error);
    }
  }
}

function validatePreloadPaths(
  files: readonly BunTestFile[],
  dependencies: BunManifestDependencies,
): void {
  const preloadPaths = collectPreloadPaths(files);
  for (const preload of preloadPaths) {
    validatePreloadExists(preload, dependencies);
  }
}

function collectPreloadPaths(files: readonly BunTestFile[]): Set<string> {
  const preloadPaths = new Set<string>();
  for (const { preloads, tsconfig, globalSetup } of files) {
    for (const preload of preloads) {
      preloadPaths.add(preload);
    }
    if (tsconfig !== undefined) {
      preloadPaths.add(tsconfig);
    }
    if (globalSetup !== undefined) {
      preloadPaths.add(globalSetup);
    }
  }
  return preloadPaths;
}

function validatePreloadExists(
  preload: string,
  dependencies: BunManifestDependencies,
): void {
  try {
    if (!dependencies.stat(preload).isFile()) {
      throw new BunManifestStatError(
        preload,
        undefined,
        new Error('not a file'),
      );
    }
  } catch (error: unknown) {
    if (error instanceof BunManifestStatError) {
      throw error;
    }
    const code = getErrorCode(error);
    if (code === 'ENOENT') {
      throw new Error(
        `Bun native test manifest declares a missing preload: ${preload}`,
      );
    }
    throw new BunManifestStatError(preload, code, error);
  }
}

function rejectMissingOrNonFiles(
  missingFiles: string[],
  nonFiles: string[],
): void {
  if (missingFiles.length > 0) {
    throw new Error(
      `Bun native test manifest contains missing files:\n${missingFiles
        .map((file) => `  - ${file}`)
        .join('\n')}`,
    );
  }
  if (nonFiles.length > 0) {
    throw new Error(
      `Bun native test manifest contains non-files:\n${nonFiles
        .map((file) => `  - ${file}`)
        .join('\n')}`,
    );
  }
}
