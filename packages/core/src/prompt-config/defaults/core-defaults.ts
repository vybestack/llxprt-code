/**
 * Core and environment default prompts
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

export const CORE_DEFAULTS: Record<string, string> = {
  'core.md': loadMarkdownFile('core.md'),

  'compression.md': loadMarkdownFile('compression.md'),

  'env/git-repository.md': loadMarkdownFile('env/git-repository.md'),
  'env/sandbox.md': loadMarkdownFile('env/sandbox.md'),
  'env/ide-mode.md': loadMarkdownFile('env/ide-mode.md'),
  'env/macos-seatbelt.md': loadMarkdownFile('env/macos-seatbelt.md'),
  'env/outside-of-sandbox.md': loadMarkdownFile('env/outside-of-sandbox.md'),
};
