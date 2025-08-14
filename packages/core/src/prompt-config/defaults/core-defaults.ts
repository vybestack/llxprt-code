/**
 * Core and environment default prompts
 * These constants reference the corresponding .md files for default content
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
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

    // If that doesn't work, we might be in a bundled environment
    // Try to find the bundle directory by looking for a parent 'bundle' directory
    // Normalize the path to use consistent separators (important for Windows)
    const normalizedDir = __dirname.replace(/\\/g, '/');
    const pathParts = normalizedDir.split('/');
    const bundleIndex = pathParts.lastIndexOf('bundle');

    if (bundleIndex !== -1) {
      // Reconstruct path to bundle directory using native separators
      const bundleDir = pathParts.slice(0, bundleIndex + 1).join(sep);
      const bundlePath = join(bundleDir, filename);
      if (existsSync(bundlePath)) {
        return readFileSync(bundlePath, 'utf-8');
      }
    }

    // As a last resort, check if we're running from a bundle directory
    if (process.cwd().includes('bundle')) {
      const cwdPath = join(process.cwd(), filename);
      if (existsSync(cwdPath)) {
        return readFileSync(cwdPath, 'utf-8');
      }
    }

    throw new Error(`File not found in any expected location`);
  } catch (_error) {
    console.warn(`Warning: Could not load ${filename}, using empty content`);
    return '';
  }
}

export const CORE_DEFAULTS: Record<string, string> = {
  'core.md': loadMarkdownFile('core.md'),

  'compression.md': loadMarkdownFile('compression.md'),

  'env/git-repository.md': loadMarkdownFile('env/git-repository.md'),
  'env/sandbox.md': loadMarkdownFile('env/sandbox.md'),
  'env/ide-mode.md': loadMarkdownFile('env/ide-mode.md'),
  'env/macos-seatbelt.md': loadMarkdownFile('env/macos-seatbelt.md'),
  'env/outside-of-sandbox.md': loadMarkdownFile('env/outside-of-sandbox.md'),
};
