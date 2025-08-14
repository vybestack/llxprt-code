/**
 * Provider and model-specific default prompts
 * These constants reference the corresponding .md files for default content
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadMarkdownFile(filename: string): string {
  try {
    // First try the normal path (works in development and non-bundled builds)
    const normalPath = join(__dirname, filename);
    if (existsSync(normalPath)) {
      return readFileSync(normalPath, 'utf-8');
    }

    // Check if we're already in a bundle directory FIRST
    // This fixes the Windows CI issue where __dirname is already bundle
    const currentDir = resolve(__dirname);
    if (basename(currentDir) === 'bundle') {
      const directPath = join(currentDir, filename);
      if (existsSync(directPath)) {
        return readFileSync(directPath, 'utf-8');
      }
    }

    // If that doesn't work, we might be in a bundled environment
    // Try to find the bundle directory by traversing up the directory tree
    let searchDir = currentDir;
    let attempts = 0;
    const maxAttempts = 10; // Prevent infinite loops

    while (attempts < maxAttempts) {
      // Check if we find a 'bundle' directory at this level
      const bundleDir = join(searchDir, 'bundle');
      const bundlePath = join(bundleDir, filename);
      if (existsSync(bundlePath)) {
        return readFileSync(bundlePath, 'utf-8');
      }

      // Move up one directory
      const parentDir = dirname(searchDir);
      if (parentDir === searchDir) {
        // We've reached the root
        break;
      }
      searchDir = parentDir;
      attempts++;
    }

    // As a last resort, check if we're running from a bundle directory using process.cwd()
    if (process.cwd().includes('bundle')) {
      const cwdPath = join(process.cwd(), filename);
      if (existsSync(cwdPath)) {
        return readFileSync(cwdPath, 'utf-8');
      }
    }

    // Additional check for Windows CI where files might be in a different location
    // Check if the file exists relative to the executing script location
    if (process.argv[1]) {
      const scriptDir = dirname(process.argv[1]);
      const scriptPath = join(scriptDir, filename);
      if (existsSync(scriptPath)) {
        return readFileSync(scriptPath, 'utf-8');
      }
    }

    throw new Error(`File not found in any expected location`);
  } catch (_error) {
    console.warn(`Warning: Could not load ${filename}, using empty content`);
    return '';
  }
}

export const PROVIDER_DEFAULTS: Record<string, string> = {
  'providers/gemini/models/gemini-2.5-flash/core.md': loadMarkdownFile(
    'providers/gemini/models/gemini-2.5-flash/core.md',
  ),
  // Future provider-specific defaults can be added here
};
