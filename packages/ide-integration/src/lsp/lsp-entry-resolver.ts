/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LSP_PACKAGE_NAME = '@vybestack/llxprt-code-lsp';

type PathChecker = (targetPath: string) => Promise<boolean>;

async function resolveEntryFromPackagePath(
  packagePath: string,
  pathIsReadable: PathChecker,
): Promise<string | null> {
  let pkgRoot = dirname(packagePath);
  while (pkgRoot !== dirname(pkgRoot)) {
    if (await pathIsReadable(join(pkgRoot, 'package.json'))) {
      break;
    }
    pkgRoot = dirname(pkgRoot);
  }

  const srcEntry = join(pkgRoot, 'src', 'main.ts');
  if (await pathIsReadable(srcEntry)) return srcEntry;

  const distEntry = join(pkgRoot, 'dist', 'main.js');
  return (await pathIsReadable(distEntry)) ? distEntry : null;
}

async function resolveViaImportMeta(
  pathIsReadable: PathChecker,
): Promise<string | null> {
  const resolveImportMeta = (
    import.meta as unknown as {
      resolve?: (specifier: string) => string;
    }
  ).resolve;

  if (typeof resolveImportMeta !== 'function') {
    return null;
  }

  try {
    const packageUrl = resolveImportMeta(LSP_PACKAGE_NAME);
    return await resolveEntryFromPackagePath(
      fileURLToPath(packageUrl),
      pathIsReadable,
    );
  } catch (error) {
    const err = error as { code?: string };
    if (
      err.code !== 'MODULE_NOT_FOUND' &&
      err.code !== 'ERR_MODULE_NOT_FOUND'
    ) {
      throw error;
    }
  }
  return null;
}

async function resolveViaCreateRequire(
  pathIsReadable: PathChecker,
): Promise<string | null> {
  try {
    const require = createRequire(import.meta.url);
    const packagePath = require.resolve(LSP_PACKAGE_NAME);
    return await resolveEntryFromPackagePath(packagePath, pathIsReadable);
  } catch (error) {
    const err = error as { code?: string };
    if (
      err.code !== 'MODULE_NOT_FOUND' &&
      err.code !== 'ERR_MODULE_NOT_FOUND'
    ) {
      throw error;
    }
  }
  return null;
}

async function resolveMonorepoFallback(
  pathIsReadable: PathChecker,
): Promise<string | null> {
  let dir = dirname(fileURLToPath(import.meta.url));
  let foundPackagesDir = false;
  while (dir !== dirname(dir)) {
    if (basename(dir) === 'packages') {
      foundPackagesDir = true;
      break;
    }
    dir = dirname(dir);
  }
  if (foundPackagesDir) {
    const fallbackEntry = join(dir, 'lsp', 'src', 'main.ts');
    if (await pathIsReadable(fallbackEntry)) {
      return fallbackEntry;
    }
  }
  return null;
}

export async function resolveLspEntry(
  pathIsReadable: PathChecker,
): Promise<string | null> {
  let lspEntry = await resolveViaImportMeta(pathIsReadable);
  if (lspEntry !== null) {
    return lspEntry;
  }
  lspEntry = await resolveViaCreateRequire(pathIsReadable);
  if (lspEntry !== null) {
    return lspEntry;
  }
  return resolveMonorepoFallback(pathIsReadable);
}
