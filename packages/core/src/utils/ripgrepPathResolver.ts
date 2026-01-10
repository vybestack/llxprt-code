/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Cross-platform ripgrep path resolution
 * Implements the robust solution described in issue 483
 */

let ripgrepAvailabilityCache: boolean | null = null;

/**
 * Check if ripgrep is available on the system.
 * This is a non-throwing wrapper around getRipgrepPath that returns a boolean.
 * Results are cached for performance.
 *
 * @returns true if ripgrep is available, false otherwise
 */
export async function isRipgrepAvailable(): Promise<boolean> {
  if (ripgrepAvailabilityCache !== null) {
    return ripgrepAvailabilityCache;
  }

  try {
    await getRipgrepPath();
    ripgrepAvailabilityCache = true;
    return true;
  } catch {
    ripgrepAvailabilityCache = false;
    return false;
  }
}

/**
 * Clear the ripgrep availability cache.
 * Useful for testing or when configuration changes.
 */
export function clearRipgrepAvailabilityCache(): void {
  ripgrepAvailabilityCache = null;
}

export async function getRipgrepPath(): Promise<string> {
  const isWindows = os.platform() === 'win32';

  // 1. Try packaged version first
  try {
    const { rgPath } = await import('@lvce-editor/ripgrep');
    // Verify the binary actually exists
    if (fs.existsSync(rgPath)) {
      return rgPath;
    }
  } catch (_error) {
    // Package not available or binary doesn't exist, continue to next option
  }

  // 2. Try system installation
  try {
    const { execSync } = await import('child_process');
    const checkCmd = isWindows ? 'where rg' : 'which rg';
    const systemPath = execSync(checkCmd, { encoding: 'utf8' }).trim();
    if (fs.existsSync(systemPath)) {
      return systemPath;
    }
  } catch (_error) {
    // System ripgrep not found
  }

  // 3. Windows specific locations
  if (isWindows) {
    const windowsPaths = [
      path.join(
        process.env.PROGRAMFILES || 'C:\\Program Files',
        'ripgrep',
        'rg.exe',
      ),
      path.join(
        process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
        'ripgrep',
        'rg.exe',
      ),
    ];
    for (const windowsPath of windowsPaths) {
      if (fs.existsSync(windowsPath)) {
        return windowsPath;
      }
    }

    // Try common installation locations
    const commonWindowsPaths = [
      'C:\\Program Files\\ripgrep\\rg.exe',
      'C:\\Program Files (x86)\\ripgrep\\rg.exe',
      'C:\\tools\\ripgrep\\rg.exe',
    ];

    for (const windowsPath of commonWindowsPaths) {
      if (fs.existsSync(windowsPath)) {
        return windowsPath;
      }
    }
  }

  // 4. Try common Unix locations (macOS/Linux)
  if (!isWindows) {
    const unixPaths = [
      '/usr/local/bin/rg',
      '/usr/bin/rg',
      '/opt/homebrew/bin/rg',
      '/home/linuxbrew/.linuxbrew/bin/rg',
    ];

    for (const unixPath of unixPaths) {
      if (fs.existsSync(unixPath)) {
        return unixPath;
      }
    }
  }

  // 5. Bundle-specific path resolution
  // Check if running from bundled environment
  const projectRoot = process.cwd();
  const isBundled =
    (process as unknown as { pkg?: { entrypoint?: string } }).pkg?.entrypoint ||
    !fs.existsSync(path.join(projectRoot, 'node_modules'));

  if (isBundled) {
    // In bundle environment, look for ripgrep in bundle directory
    const bundleDir = path.join(projectRoot, 'bundle');
    const bundledRgPath = path.join(bundleDir, isWindows ? 'rg.exe' : 'rg');

    if (fs.existsSync(bundledRgPath)) {
      return bundledRgPath;
    }
  }

  throw new Error(
    `ripgrep not found. Please install @lvce-editor/ripgrep or system ripgrep.\n` +
      `Installation options:\n` +
      `- npm install @lvce-editor/ripgrep\n` +
      `- brew install ripgrep (macOS)\n` +
      `- choco install ripgrep (Windows)\n` +
      `- apt install ripgrep (Ubuntu/Debian)`,
  );
}

/**
 * Create Windows-specific symlink or copy if needed
 */
export function ensureWindowsShortcut(source: string, target: string): boolean {
  if (os.platform() !== 'win32') {
    return false;
  }

  try {
    // On Windows, try creating a hard link first
    if (fs.existsSync(source) && !fs.existsSync(target)) {
      // Create target directory if it doesn't exist
      const targetDir = path.dirname(target);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      try {
        fs.linkSync(source, target);
        return true;
      } catch (_linkError) {
        // If hard link fails (common on Windows without admin), copy the binary
        fs.copyFileSync(source, target);
        return true;
      }
    }
  } catch (error) {
    console.warn('Failed to create Windows shortcut for ripgrep:', error);
  }
  return false;
}
