/**
 * Provider and model-specific default prompts
 * These constants reference the corresponding .md files for default content
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { DebugLogger } from '../../debug/index.js';
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

  const logger = new DebugLogger('llxprt:prompt:loader:provider');

  if (debugLog) {
    logger.debug(
      () => `\n[PROMPT_LOADER] ========== Loading ${filename} ==========`,
    );
    logger.debug(() => `[PROMPT_LOADER] __dirname: ${__dirname}`);
    logger.debug(
      () =>
        `[PROMPT_LOADER] process.cwd(): ${typeof process !== 'undefined' ? process.cwd() : 'N/A'}`,
    );
    logger.debug(
      () =>
        `[PROMPT_LOADER] process.argv[0]: ${typeof process !== 'undefined' ? process.argv?.[0] : 'N/A'}`,
    );
    logger.debug(
      () =>
        `[PROMPT_LOADER] process.argv[1]: ${typeof process !== 'undefined' ? process.argv?.[1] : 'N/A'}`,
    );
    logger.debug(
      () =>
        `[PROMPT_LOADER] process.platform: ${typeof process !== 'undefined' ? process.platform : 'N/A'}`,
    );
    logger.debug(
      () =>
        `[PROMPT_LOADER] NODE_ENV: ${typeof process !== 'undefined' ? process.env?.NODE_ENV : 'N/A'}`,
    );
    logger.debug(
      () =>
        `[PROMPT_LOADER] CI: ${typeof process !== 'undefined' ? process.env?.CI : 'N/A'}`,
    );
  }

  const manifestEnv =
    typeof process !== 'undefined' ? process.env?.LLXPRT_PROMPT_MANIFEST : '';
  const isTestMode =
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
  const shouldUseManifest = !isTestMode || Boolean(manifestEnv);

  if (shouldUseManifest) {
    const manifestContent = loadPromptFromManifest(filename);
    if (manifestContent !== null) {
      if (debugLog) {
        const origin = getManifestOrigin();
        logger.debug(
          () =>
            `[PROMPT_LOADER] Loaded ${filename} from manifest${origin ? ` (${origin})` : ''}`,
        );
      }
      return manifestContent;
    }
  }

  try {
    // Check if we're already in a bundle directory FIRST
    // This fixes the Windows CI issue where __dirname is already bundle
    const currentDir = resolve(__dirname);
    if (debugLog) {
      logger.debug(() => `[PROMPT_LOADER] currentDir: ${currentDir}`);
      logger.debug(
        () => `[PROMPT_LOADER] basename(currentDir): ${basename(currentDir)}`,
      );
    }

    if (basename(currentDir) === 'bundle') {
      const directPath = join(currentDir, filename);
      if (debugLog) {
        logger.debug(
          () =>
            `[PROMPT_LOADER] In bundle dir, checking directPath: ${directPath}`,
        );
        logger.debug(
          () => `[PROMPT_LOADER] directPath exists: ${existsSync(directPath)}`,
        );
      }
      if (existsSync(directPath)) {
        if (debugLog) {
          logger.debug(() => `[PROMPT_LOADER] Found at directPath`);
        }
        return readFileSync(directPath, 'utf-8');
      }
    }

    // Then try the normal path (works in development and non-bundled builds)
    const normalPath = join(__dirname, filename);
    if (debugLog) {
      logger.debug(() => `[PROMPT_LOADER] Checking normalPath: ${normalPath}`);
      logger.debug(
        () => `[PROMPT_LOADER] normalPath exists: ${existsSync(normalPath)}`,
      );
    }
    if (existsSync(normalPath)) {
      if (debugLog) {
        logger.debug(() => `[PROMPT_LOADER] Found at normalPath`);
      }
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

    // As a last resort, check if we're running from a bundle directory using process.cwd()
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
      logger.debug(
        () => `[PROMPT_LOADER] Searching in paths: ${searchPaths.join(', ')}`,
      );

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
          logger.debug(() => `[PROMPT_LOADER] Files in ${dir}:`, files);
        } catch (e) {
          logger.debug(
            () =>
              `[PROMPT_LOADER] Could not list ${dir}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    for (const base of searchPaths) {
      // Try direct path
      const directTry = join(base, filename);
      if (existsSync(directTry)) {
        if (debugLog) {
          logger.debug(() => `[PROMPT_LOADER] Found at: ${directTry}`);
        }
        return readFileSync(directTry, 'utf-8');
      }

      // Try with bundle subdirectory
      const bundleTry = join(base, 'bundle', filename);
      if (existsSync(bundleTry)) {
        if (debugLog) {
          logger.debug(() => `[PROMPT_LOADER] Found at: ${bundleTry}`);
        }
        return readFileSync(bundleTry, 'utf-8');
      }

      // Try if base itself is named bundle
      if (basename(base) === 'bundle') {
        const inBundleTry = join(base, filename);
        if (existsSync(inBundleTry)) {
          if (debugLog) {
            logger.debug(() => `[PROMPT_LOADER] Found at: ${inBundleTry}`);
          }
          return readFileSync(inBundleTry, 'utf-8');
        }
      }
    }

    throw new Error(
      `File not found in any expected location. Searched: ${searchPaths.join(', ')}`,
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const warningDetail =
      error instanceof Error && error.stack
        ? error.stack.split('\n')[0]
        : errorMsg;
    reportMissingPrompt(filename, 'provider-defaults', warningDetail);
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

export const PROVIDER_DEFAULTS: Record<string, string> = {
  'providers/gemini/models/gemini-2.5-flash/core.md': loadMarkdownFile(
    'providers/gemini/models/gemini-2.5-flash/core.md',
  ),
  'providers/gemini/models/gemini-3-pro-preview/core.md': loadMarkdownFile(
    'providers/gemini/models/gemini-3-pro-preview/core.md',
  ),
  // Future provider-specific defaults can be added here
};
