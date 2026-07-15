/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LlxprtExtension } from '@vybestack/llxprt-code-core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadExtension,
  ExtensionStorage,
  COMPAT_EXTENSIONS_DIRECTORY_NAME,
} from '../extension.js';

/**
 * Returns the ordered list of extension roots to scan: `.llxprt/extensions`
 * first (LLxprt precedence), then `.gemini/extensions` (compat fallback).
 */
function getExtensionRoots(): string[] {
  return [
    ExtensionStorage.getUserExtensionsDir(),
    path.join(os.homedir(), COMPAT_EXTENSIONS_DIRECTORY_NAME),
  ];
}

/**
 * Safely check whether a path is an accessible directory or symlink.
 * Uses `lstatSync` (not `statSync`) so broken symlinks do not throw.
 * Returns `false` on any FS error (permission denied, ENOENT, etc.).
 */
function isAccessibleDir(candidateDir: string): boolean {
  try {
    const stat = fs.lstatSync(candidateDir);
    return stat.isDirectory() || stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Safely attempt to load an extension from a directory. Returns `null` if
 * the directory is inaccessible, the manifest is missing/invalid, or loading
 * throws for any reason (e.g. malformed JSON, FS error). Per-entry errors
 * are caught so a single broken extension does not abort the entire scan.
 */
function tryLoadExtension(
  extensionDir: string,
  workspaceDir: string,
): LlxprtExtension | null {
  try {
    return loadExtension({ extensionDir, workspaceDir });
  } catch {
    return null;
  }
}

/**
 * Scan a single extension root directory for an extension matching `name`
 * (case-insensitive). Returns the loaded extension or `null`.
 *
 * Per-entry errors (broken symlink, malformed manifest) are caught so that a
 * single broken extension does not abort the scan.
 */
function findExtensionInRoot(
  extensionsDir: string,
  name: string,
  workspaceDir: string,
): LlxprtExtension | null {
  if (!fs.existsSync(extensionsDir)) {
    return null;
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(extensionsDir);
  } catch {
    return null;
  }
  const lowerName = name.toLowerCase();
  for (const subdir of entries) {
    const extensionDir = path.join(extensionsDir, subdir);
    if (!isAccessibleDir(extensionDir)) {
      continue;
    }
    const extension = tryLoadExtension(extensionDir, workspaceDir);
    if (extension && extension.name.toLowerCase() === lowerName) {
      return extension;
    }
  }
  return null;
}

/**
 * Loads an extension by name, scanning the root-aware extension roots in
 * precedence order (`.llxprt/extensions` before `.gemini/extensions`).
 *
 * Each directory entry is loaded independently; a broken or malformed
 * extension entry does not prevent other entries from being scanned.
 */
export function loadExtensionByName(
  name: string,
  workspaceDir: string = process.cwd(),
): LlxprtExtension | null {
  for (const extensionsDir of getExtensionRoots()) {
    const found = findExtensionInRoot(extensionsDir, name, workspaceDir);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * Resolve the physical registration directory for an extension — the actual
 * directory on disk under `.llxprt/extensions` or `.gemini/extensions` where
 * the extension was registered.
 *
 * For linked extensions this is NOT the link target
 * (`installMetadata.source`); it is the registration dir containing the
 * symlink and metadata file.
 *
 * Matching is by the extension's preserved physical/source identity: the
 * name from the manifest, or the install metadata source if available.
 * This avoids the semantic error of using `extension.path` for linked
 * extensions, since `extension.path` follows the symlink to the source
 * target rather than pointing to the registration directory.
 *
 * When multiple physical registrations share the same name across roots,
 * the first found in precedence order is returned.
 */
export function resolvePhysicalRegistrationDir(
  extension: LlxprtExtension,
): string {
  // Match by the extension's name — this searches all roots to find the
  // actual registration directory, not the symlink target.
  const foundByName = resolvePhysicalRegistrationDirByIdentifier(
    extension.name,
  );
  if (foundByName !== null) {
    return foundByName;
  }

  // If the extension has an install source (e.g. a git URL or local path),
  // match by source to find the registration.
  if (extension.installMetadata?.source !== undefined) {
    const foundBySource = resolvePhysicalRegistrationDirByIdentifier(
      extension.installMetadata.source,
    );
    if (foundBySource !== null) {
      return foundBySource;
    }
  }

  // Fallback: reconstruct the default registration dir from the extension
  // name using the standard storage layout. This is the historical behavior
  // for non-linked extensions that are not discoverable by scanning roots
  // (e.g. when the roots directory listing is unavailable).
  const storage = new ExtensionStorage(extension.name);
  return storage.getExtensionDir();
}

/**
 * Resolve the physical registration directory by an extension identifier
 * (name or install source). Searches all extension roots in precedence order.
 *
 * Matching strategy (Finding 2 — exact uninstall identity):
 *
 * 1. **Exact case-sensitive pass**: Scan all roots for a registration whose
 *    manifest name or install metadata source matches the identifier
 *    **case-sensitively**. If exactly one match is found, return it.
 *    If multiple exact matches are found across roots, return the first one
 *    in precedence order (`.llxprt/extensions` before `.gemini/extensions`).
 *
 * 2. **Case-insensitive fallback**: If no exact match is found, scan all roots
 *    for registrations whose name or source matches case-insensitively. If
 *    exactly one unambiguous match is found, return it. If multiple ambiguous
 *    matches exist (e.g. "MyExt" and "myext" in the same root), throw an error.
 *
 * 3. If no match is found in either pass, return `null`.
 *
 * @param identifier - Extension name or install source URL.
 * @returns The physical registration directory path, or null if not found.
 * @throws Error if one root contains multiple exact registrations or if the
 *   case-insensitive fallback finds multiple ambiguous registrations.
 */
export function resolvePhysicalRegistrationDirByIdentifier(
  identifier: string,
  workspaceDir: string = process.cwd(),
): string | null {
  const normalizedId = identifier.toLowerCase();

  // Pass 1: exact case-sensitive match with root precedence. Multiple exact
  // registrations within the selected root are destructive ambiguity.
  for (const extensionsDir of getExtensionRoots()) {
    const exactMatches = findMatchingRegistrationDirsInRootExact(
      extensionsDir,
      identifier,
      workspaceDir,
    );
    if (exactMatches.length === 1) {
      return exactMatches[0];
    }
    if (exactMatches.length > 1) {
      throw new Error(
        `Ambiguous extension identifier "${identifier}": found exact registrations: ${exactMatches.join(', ')}.`,
      );
    }
  }

  // Pass 2: case-insensitive fallback — collect ALL matches across all roots,
  // including multiple case variants registered under one root.
  const ciMatches: string[] = [];
  for (const extensionsDir of getExtensionRoots()) {
    ciMatches.push(
      ...findMatchingRegistrationDirsInRoot(
        extensionsDir,
        normalizedId,
        workspaceDir,
      ),
    );
  }

  if (ciMatches.length === 0) {
    return null;
  }

  if (ciMatches.length === 1) {
    return ciMatches[0];
  }

  // Multiple case-insensitive matches — ambiguous, refuse to guess
  throw new Error(
    `Ambiguous extension identifier "${identifier}": found ${ciMatches.length} case-variant registrations: ` +
      `${ciMatches.join(', ')}. Please specify the exact case-sensitive name or source.`,
  );
}

/**
 * Find a matching registration directory within a single extension root using
 * **exact case-sensitive** matching. Returns `null` if the root is inaccessible
 * or no match is found.
 */
function findMatchingRegistrationDirsInRootExact(
  extensionsDir: string,
  identifier: string,
  workspaceDir: string,
): string[] {
  if (!fs.existsSync(extensionsDir)) {
    return [];
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(extensionsDir);
  } catch {
    return [];
  }
  const matches: string[] = [];
  for (const subdir of entries) {
    const candidateDir = path.join(extensionsDir, subdir);
    const match = checkRegistrationMatchExact(
      candidateDir,
      identifier,
      workspaceDir,
    );
    if (match !== null) {
      matches.push(match);
    }
  }
  return matches;
}

/**
 * Check whether a candidate directory matches the identifier
 * **case-sensitively** by manifest name or install metadata source.
 */
function checkRegistrationMatchExact(
  candidateDir: string,
  identifier: string,
  workspaceDir: string,
): string | null {
  if (!isAccessibleDir(candidateDir)) {
    return null;
  }
  const candidateExt = tryLoadExtension(candidateDir, workspaceDir);
  if (candidateExt === null) {
    return null;
  }
  const nameMatch = candidateExt.name === identifier;
  const source =
    candidateExt.installMetadata !== undefined
      ? candidateExt.installMetadata.source
      : undefined;
  const sourceMatch = source !== undefined && source === identifier;
  return nameMatch || sourceMatch ? candidateDir : null;
}

/**
 * Find a matching registration directory within a single extension root.
 * Returns `null` if the root is inaccessible or no match is found.
 */
function findMatchingRegistrationDirsInRoot(
  extensionsDir: string,
  normalizedIdentifier: string,
  workspaceDir: string,
): string[] {
  if (!fs.existsSync(extensionsDir)) {
    return [];
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(extensionsDir);
  } catch {
    return [];
  }
  const matches: string[] = [];
  for (const subdir of entries) {
    const candidateDir = path.join(extensionsDir, subdir);
    const match = checkRegistrationMatch(
      candidateDir,
      normalizedIdentifier,
      workspaceDir,
    );
    if (match !== null) {
      matches.push(match);
    }
  }
  return matches;
}

/**
 * Check whether a candidate directory is a valid registration matching the
 * given normalized identifier (lowercase name or source URL). Returns the
 * directory path if it matches, or `null` if it is inaccessible, fails to
 * load, or does not match.
 */
function checkRegistrationMatch(
  candidateDir: string,
  normalizedIdentifier: string,
  workspaceDir: string,
): string | null {
  if (!isAccessibleDir(candidateDir)) {
    return null;
  }
  const candidateExt = tryLoadExtension(candidateDir, workspaceDir);
  if (candidateExt === null) {
    return null;
  }
  // Match by name (case-insensitive) or by install metadata source
  // (case-insensitive). This preserves exact physical registration
  // identity: only the registration whose name or source matches is
  // returned, not a different same-name extension in another root.
  const nameMatch = candidateExt.name.toLowerCase() === normalizedIdentifier;
  const source =
    candidateExt.installMetadata !== undefined
      ? candidateExt.installMetadata.source
      : undefined;
  const sourceMatch =
    source !== undefined && source.toLowerCase() === normalizedIdentifier;
  return nameMatch || sourceMatch ? candidateDir : null;
}
