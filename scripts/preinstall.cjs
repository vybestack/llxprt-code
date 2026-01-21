#!/usr/bin/env node

/**
 * Preinstall script to clean up leftover temp directories from failed npm installs.
 * This prevents ENOTEMPTY errors during npm global upgrades.
 *
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env node */
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Resolves the @vybestack directory for cleanup.
 * Prefers npm_config_prefix-based paths (correct for npm staging during global installs),
 * falling back to __dirname-based paths if prefix is not available.
 *
 * @returns {string|null} Path to @vybestack directory or null if not found
 */
function resolveVybestackDir() {
  const npmPrefix = process.env.npm_config_prefix;

  // Try npm_config_prefix first (correct for npm staging during global installs)
  if (npmPrefix) {
    // On Unix: prefix/lib/node_modules
    // On Windows: prefix/node_modules
    const isWindows = os.platform() === 'win32';
    const nodeModulesFromPrefix = isWindows
      ? path.join(npmPrefix, 'node_modules')
      : path.join(npmPrefix, 'lib', 'node_modules');

    const vybestackFromPrefix = path.join(nodeModulesFromPrefix, '@vybestack');

    if (fs.existsSync(vybestackFromPrefix)) {
      return vybestackFromPrefix;
    }
  }

  // Fall back to __dirname-based resolution
  // For global installs, this will be something like /opt/homebrew/lib/node_modules/@vybestack/llxprt-code
  const scriptDir = __dirname;
  const packageDir = path.dirname(scriptDir);
  const vybestackDir = path.dirname(packageDir);

  if (fs.existsSync(vybestackDir)) {
    return vybestackDir;
  }

  return null;
}

/**
 * Attempts to clean up leftover .llxprt-code-* temp directories that cause
 * ENOTEMPTY errors during npm global package upgrades.
 *
 * These temp directories are created by npm during atomic rename operations
 * and can be left behind if the install fails or is interrupted.
 */
function cleanupTempDirectories() {
  // Only run cleanup for global installs
  if (process.env.npm_config_global !== 'true') {
    return;
  }

  try {
    const vybestackDir = resolveVybestackDir();
    if (!vybestackDir) {
      return;
    }

    const entries = fs.readdirSync(vybestackDir);
    let cleanedCount = 0;

    for (const entry of entries) {
      // Match temp directories like .llxprt-code-ofqtIqCy
      if (entry.startsWith('.llxprt-code-')) {
        const tempPath = path.join(vybestackDir, entry);
        try {
          fs.rmSync(tempPath, { recursive: true, force: true });
          console.log(`Cleaned up leftover temp directory: ${entry}`);
          cleanedCount++;
        } catch (rmError) {
          // Ignore errors - best effort cleanup
          console.warn(
            `Warning: Could not remove ${entry}: ${rmError.message}`,
          );
        }
      }
    }

    if (cleanedCount > 0) {
      console.log(
        `Cleaned up ${cleanedCount} leftover temp director${cleanedCount === 1 ? 'y' : 'ies'} from previous failed install.`,
      );
    }
  } catch {
    // Silently ignore errors - this is best-effort cleanup
    // We don't want to fail the install if cleanup fails
  }
}

cleanupTempDirectories();
