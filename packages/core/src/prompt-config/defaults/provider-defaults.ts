/**
 * Provider and model-specific default prompts
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
    // In the bundle, llxprt.js is in the bundle directory and markdown files are copied there too
    // Try to find the bundle directory by looking for a parent 'bundle' directory
    const pathParts = __dirname.split(sep);
    const bundleIndex = pathParts.lastIndexOf('bundle');
    
    if (bundleIndex !== -1) {
      // Reconstruct path to bundle directory
      const bundleDir = pathParts.slice(0, bundleIndex + 1).join(sep);
      const bundlePath = join(bundleDir, filename);
      if (existsSync(bundlePath)) {
        return readFileSync(bundlePath, 'utf-8');
      }
    }
    
    // As a last resort, check if we're running from a bundle directory
    // This handles the case where __dirname might be the bundle directory itself
    if (process.cwd().includes('bundle')) {
      const cwdPath = join(process.cwd(), filename);
      if (existsSync(cwdPath)) {
        return readFileSync(cwdPath, 'utf-8');
      }
    }
    
    throw new Error(`File not found in any expected location`);
  } catch (error) {
    console.warn(
      `Warning: Could not load ${filename} from ${__dirname}, using empty content. Error:`,
      error,
    );
    return '';
  }
}

export const PROVIDER_DEFAULTS: Record<string, string> = {
  'providers/gemini/models/gemini-2.5-flash/core.md': loadMarkdownFile(
    'providers/gemini/models/gemini-2.5-flash/core.md',
  ),
  // Future provider-specific defaults can be added here
};
