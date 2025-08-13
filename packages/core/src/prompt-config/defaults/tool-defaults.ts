/**
 * Tool-specific default prompts
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
