/**
 * Provider and model-specific default prompts
 * These constants reference the corresponding .md files for default content
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadMarkdownFile(filename: string): string {
  try {
    const fullPath = join(__dirname, filename);
    return readFileSync(fullPath, 'utf-8');
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
