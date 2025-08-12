/**
 * Tool-specific default prompts
 * These constants reference the corresponding .md files for default content
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadMarkdownFile(filename: string): string {
  try {
    return readFileSync(join(__dirname, filename), 'utf-8');
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
