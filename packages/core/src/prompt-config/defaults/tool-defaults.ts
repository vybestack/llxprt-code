/**
 * Tool-specific default prompts
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

    // If that doesn't work, we might be in a bundled environment
    // Try to find the bundle directory by traversing up the directory tree
    let currentDir = resolve(__dirname);
    let attempts = 0;
    const maxAttempts = 10; // Prevent infinite loops

    while (attempts < maxAttempts) {
      // Check if we find a 'bundle' directory at this level
      const bundleDir = join(currentDir, 'bundle');
      const bundlePath = join(bundleDir, filename);
      if (existsSync(bundlePath)) {
        return readFileSync(bundlePath, 'utf-8');
      }

      // Also check if current directory itself is named 'bundle'
      if (basename(currentDir) === 'bundle') {
        const directPath = join(currentDir, filename);
        if (existsSync(directPath)) {
          return readFileSync(directPath, 'utf-8');
        }
      }

      // Move up one directory
      const parentDir = dirname(currentDir);
      if (parentDir === currentDir) {
        // We've reached the root
        break;
      }
      currentDir = parentDir;
      attempts++;
    }

    // As a last resort, check if we're running from a bundle directory
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

export const TOOL_DEFAULTS: Record<string, string> = {
  'tools/shell.md': loadMarkdownFile('tools/shell.md'),
  'tools/read-file.md': loadMarkdownFile('tools/read-file.md'),
  'tools/edit.md': loadMarkdownFile('tools/edit.md'),
  'tools/write-file.md': loadMarkdownFile('tools/write-file.md'),
  'tools/grep.md': loadMarkdownFile('tools/grep.md'),
  'tools/glob.md': loadMarkdownFile('tools/glob.md'),
  'tools/ls.md': loadMarkdownFile('tools/ls.md'),
  'tools/memory.md': loadMarkdownFile('tools/memory.md'),
  'tools/read-many-files.md': loadMarkdownFile('tools/read-many-files.md'),
  'tools/todo-read.md': loadMarkdownFile('tools/todo-read.md'),
  'tools/todo-write.md': loadMarkdownFile('tools/todo-write.md'),
  'tools/web-fetch.md': loadMarkdownFile('tools/web-fetch.md'),
  'tools/web-search.md': loadMarkdownFile('tools/web-search.md'),
};
