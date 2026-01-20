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
    // Get the path where this package is being installed
    // For global installs, this will be something like /opt/homebrew/lib/node_modules/@vybestack/llxprt-code
    const scriptDir = __dirname;
    const packageDir = path.dirname(scriptDir);

    // The temp directories are created in the parent of node_modules/@vybestack
    // e.g., /opt/homebrew/lib/node_modules/@vybestack/.llxprt-code-ofqtIqCy
    const nodeModulesDir = path.dirname(path.dirname(packageDir));

    if (!nodeModulesDir || !fs.existsSync(nodeModulesDir)) {
      return;
    }

    // Look for @vybestack directory (parent of this package)
    const vybestackDir = path.dirname(packageDir);
    if (!fs.existsSync(vybestackDir)) {
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
