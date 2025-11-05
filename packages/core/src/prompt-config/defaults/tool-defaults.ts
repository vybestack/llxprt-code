/**
 * Tool-specific default prompts
 * These constants reference the corresponding .md files for default content
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
  getManifestOrigin,
  loadPromptFromManifest,
} from './manifest-loader.js';
import { reportMissingPrompt } from './prompt-warnings.js';

// In bundled environment, use global __dirname if available
const __dirname =
  ((globalThis as Record<string, unknown>).__dirname as string) ||
  dirname(fileURLToPath(import.meta.url));

function loadMarkdownFile(filename: string): string {
  // Skip debug logging if process or process.env is unavailable (test environment)
  let debugLog = false;
  try {
    debugLog =
      typeof process !== 'undefined' &&
      process.env &&
      (process.env.DEBUG === '1' || process.env.DEBUG === 'true');
  } catch {
    debugLog = false;
  }

  if (debugLog) {
    console.log(`\n[PROMPT_LOADER] ========== Loading ${filename} ==========`);
    console.log(`[PROMPT_LOADER] __dirname: ${__dirname}`);
    console.log(
      `[PROMPT_LOADER] process.cwd(): ${typeof process !== 'undefined' ? process.cwd() : 'N/A'}`,
    );
    console.log(
      `[PROMPT_LOADER] process.argv[0]: ${typeof process !== 'undefined' ? process.argv?.[0] : 'N/A'}`,
    );
    console.log(
      `[PROMPT_LOADER] process.argv[1]: ${typeof process !== 'undefined' ? process.argv?.[1] : 'N/A'}`,
    );
    console.log(
      `[PROMPT_LOADER] process.platform: ${typeof process !== 'undefined' ? process.platform : 'N/A'}`,
    );
    console.log(
      `[PROMPT_LOADER] NODE_ENV: ${typeof process !== 'undefined' ? process.env?.NODE_ENV : 'N/A'}`,
    );
    console.log(
      `[PROMPT_LOADER] CI: ${typeof process !== 'undefined' ? process.env?.CI : 'N/A'}`,
    );
  }

  const manifestContent = loadPromptFromManifest(filename);
  if (manifestContent !== null) {
    if (debugLog) {
      const origin = getManifestOrigin();
      console.log(
        `[PROMPT_LOADER] Loaded ${filename} from manifest${
          origin ? ` (${origin})` : ''
        }`,
      );
    }
    return manifestContent;
  }

  try {
    // Check if we're already in a bundle directory FIRST
    // This fixes the Windows CI issue where __dirname is already bundle
    const currentDir = resolve(__dirname);
    if (debugLog) {
      console.log(`[PROMPT_LOADER] currentDir: ${currentDir}`);
      console.log(
        `[PROMPT_LOADER] basename(currentDir): ${basename(currentDir)}`,
      );
    }

    if (basename(currentDir) === 'bundle') {
      const directPath = join(currentDir, filename);
      if (debugLog) {
        console.log(
          `[PROMPT_LOADER] In bundle dir, checking directPath: ${directPath}`,
        );
        console.log(
          `[PROMPT_LOADER] directPath exists: ${existsSync(directPath)}`,
        );
      }
      if (existsSync(directPath)) {
        if (debugLog) console.log(`[PROMPT_LOADER] Found at directPath`);
        return readFileSync(directPath, 'utf-8');
      }
    }

    // Then try the normal path (works in development and non-bundled builds)
    const normalPath = join(__dirname, filename);
    if (debugLog) {
      console.log(`[PROMPT_LOADER] Checking normalPath: ${normalPath}`);
      console.log(
        `[PROMPT_LOADER] normalPath exists: ${existsSync(normalPath)}`,
      );
    }
    if (existsSync(normalPath)) {
      if (debugLog) console.log(`[PROMPT_LOADER] Found at normalPath`);
      return readFileSync(normalPath, 'utf-8');
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

    // As a last resort, check if we're running from a bundle directory
    if (typeof process !== 'undefined' && process.cwd().includes('bundle')) {
      const cwdPath = join(process.cwd(), filename);
      if (existsSync(cwdPath)) {
        return readFileSync(cwdPath, 'utf-8');
      }
    }

    // Additional check for Windows CI where files might be in a different location
    // Check if the file exists relative to the executing script location
    if (typeof process !== 'undefined' && process.argv[1]) {
      const scriptDir = dirname(process.argv[1]);
      const scriptPath = join(scriptDir, filename);
      if (existsSync(scriptPath)) {
        return readFileSync(scriptPath, 'utf-8');
      }
    }

    // Last resort: Do a broader search for the bundle directory
    // This handles edge cases like Windows CI where paths might be unusual
    const searchPaths = [
      typeof process !== 'undefined' ? process.cwd() : '',
      typeof process !== 'undefined' ? dirname(process.argv[1] || '') : '',
      typeof process !== 'undefined'
        ? dirname(dirname(process.argv[1] || ''))
        : '',
      typeof process !== 'undefined'
        ? dirname(dirname(dirname(process.argv[1] || '')))
        : '',
      __dirname,
      dirname(__dirname),
      dirname(dirname(__dirname)),
    ].filter((p) => p && p !== '');

    if (debugLog) {
      console.log(`[PROMPT_LOADER] Searching in paths:`, searchPaths);

      // List files in key directories to debug CI issue
      const checkDirs = [
        __dirname,
        typeof process !== 'undefined' ? process.cwd() : '',
        typeof process !== 'undefined' ? dirname(process.argv[1] || '') : '',
      ].filter((dir) => dir !== '');
      for (const dir of checkDirs) {
        try {
          const files = readdirSync(dir).filter(
            (f) =>
              f.endsWith('.md') ||
              f === 'tools' ||
              f === 'providers' ||
              f === 'env',
          );
          console.log(`[PROMPT_LOADER] Files in ${dir}:`, files);
        } catch (e) {
          console.log(
            `[PROMPT_LOADER] Could not list ${dir}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    for (const base of searchPaths) {
      // Try direct path
      const directTry = join(base, filename);
      if (existsSync(directTry)) {
        if (debugLog) console.log(`[PROMPT_LOADER] Found at: ${directTry}`);
        return readFileSync(directTry, 'utf-8');
      }

      // Try with bundle subdirectory
      const bundleTry = join(base, 'bundle', filename);
      if (existsSync(bundleTry)) {
        if (debugLog) console.log(`[PROMPT_LOADER] Found at: ${bundleTry}`);
        return readFileSync(bundleTry, 'utf-8');
      }

      // Try if base itself is named bundle
      if (basename(base) === 'bundle') {
        const inBundleTry = join(base, filename);
        if (existsSync(inBundleTry)) {
          if (debugLog) console.log(`[PROMPT_LOADER] Found at: ${inBundleTry}`);
          return readFileSync(inBundleTry, 'utf-8');
        }
      }
    }

    throw new Error(
      `File not found in any expected location. Searched: ${searchPaths.join(', ')}`,
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    reportMissingPrompt(filename, 'tool-defaults', errorMsg);
    console.error(
      `Warning: Could not load ${filename}, using empty content. Error: ${errorMsg}`,
    );
    if (debugLog) {
      console.warn(`[PROMPT_LOADER] Full error:`, error);
      console.warn(
        `[PROMPT_LOADER] Stack trace:`,
        error instanceof Error ? error.stack : 'No stack trace',
      );
    }
    return '';
  }
}

export const TOOL_DEFAULTS: Record<string, string> = {
  'tools/shell.md': loadMarkdownFile('tools/shell.md'),
  'tools/read-file.md': loadMarkdownFile('tools/read-file.md'),
  'tools/delete_line_range.md': loadMarkdownFile('tools/delete_line_range.md'),
  'tools/edit.md': loadMarkdownFile('tools/edit.md'),
  'tools/insert_at_line.md': loadMarkdownFile('tools/insert_at_line.md'),
  'tools/read_line_range.md': loadMarkdownFile('tools/read_line_range.md'),
  'tools/write-file.md': loadMarkdownFile('tools/write-file.md'),
  'tools/grep.md': loadMarkdownFile('tools/grep.md'),
  'tools/glob.md': loadMarkdownFile('tools/glob.md'),
  'tools/ls.md': loadMarkdownFile('tools/ls.md'),
  'tools/memory.md': loadMarkdownFile('tools/memory.md'),
  'tools/save-memory.md': loadMarkdownFile('tools/save-memory.md'),
  'tools/read-many-files.md': loadMarkdownFile('tools/read-many-files.md'),
  'tools/todo-read.md': loadMarkdownFile('tools/todo-read.md'),
  'tools/todo-write.md': loadMarkdownFile('tools/todo-write.md'),
  'tools/todo-pause.md': loadMarkdownFile('tools/todo-pause.md'),
  'tools/web-fetch.md': loadMarkdownFile('tools/web-fetch.md'),
  'tools/web-search.md': loadMarkdownFile('tools/web-search.md'),
  'tools/list-subagents.md': loadMarkdownFile('tools/list-subagents.md'),
  'tools/task.md': loadMarkdownFile('tools/task.md'),
};
