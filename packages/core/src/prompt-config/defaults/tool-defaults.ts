/**
 * Tool-specific default prompts
 * These constants reference the corresponding .md files for default content
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy core boundary retained while larger decomposition continues. */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
  getManifestOrigin,
  loadPromptFromManifest,
} from './manifest-loader.js';
import { reportMissingPrompt } from './prompt-warnings.js';
import { debugLogger } from '../../utils/debugLogger.js';

// In bundled environment, use global __dirname if available
const __dirname =
  ((globalThis as Record<string, unknown>).__dirname as string) ||
  dirname(fileURLToPath(import.meta.url));

function isDebugLogging(): boolean {
  try {
    return process.env.DEBUG === '1' || process.env.DEBUG === 'true';
  } catch {
    return false;
  }
}

function logDebugEnvInfo(filename: string): void {
  debugLogger.log(
    `\n[PROMPT_LOADER] ========== Loading ${filename} ==========`,
  );
  debugLogger.log(`[PROMPT_LOADER] __dirname: ${__dirname}`);
  debugLogger.log(
    `[PROMPT_LOADER] process.cwd(): ${typeof process !== 'undefined' ? process.cwd() : 'N/A'}`,
  );
  debugLogger.log(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Tool prompt default data.
    `[PROMPT_LOADER] process.argv[0]: ${typeof process !== 'undefined' ? process.argv?.[0] : 'N/A'}`,
  );
  debugLogger.log(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Tool prompt default data.
    `[PROMPT_LOADER] process.argv[1]: ${typeof process !== 'undefined' ? process.argv?.[1] : 'N/A'}`,
  );
  debugLogger.log(
    `[PROMPT_LOADER] process.platform: ${typeof process !== 'undefined' ? process.platform : 'N/A'}`,
  );
  debugLogger.log(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Tool prompt default data.
    `[PROMPT_LOADER] NODE_ENV: ${typeof process !== 'undefined' ? process.env?.NODE_ENV : 'N/A'}`,
  );
  debugLogger.log(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Tool prompt default data.
    `[PROMPT_LOADER] CI: ${typeof process !== 'undefined' ? process.env?.CI : 'N/A'}`,
  );
}

function tryLoadFromManifest(filename: string): string | null {
  const manifestContent = loadPromptFromManifest(filename);
  if (manifestContent !== null) {
    const debugLog = isDebugLogging();
    if (debugLog) {
      const origin = getManifestOrigin();
      debugLogger.log(
        `[PROMPT_LOADER] Loaded ${filename} from manifest${
          origin ? ` (${origin})` : ''
        }`,
      );
    }
    return manifestContent;
  }
  return null;
}

function tryLoadFromBundleDir(filename: string): string | null {
  const debugLog = isDebugLogging();
  const currentDir = resolve(__dirname);
  if (debugLog) {
    debugLogger.log(`[PROMPT_LOADER] currentDir: ${currentDir}`);
    debugLogger.log(
      `[PROMPT_LOADER] basename(currentDir): ${basename(currentDir)}`,
    );
  }

  if (basename(currentDir) === 'bundle') {
    const directPath = join(currentDir, filename);
    if (debugLog) {
      debugLogger.log(
        `[PROMPT_LOADER] In bundle dir, checking directPath: ${directPath}`,
      );
      debugLogger.log(
        `[PROMPT_LOADER] directPath exists: ${existsSync(directPath)}`,
      );
    }
    if (existsSync(directPath)) {
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      if (debugLog) debugLogger.log(`[PROMPT_LOADER] Found at directPath`);
      return readFileSync(directPath, 'utf-8');
    }
  }
  return null;
}

function tryLoadFromNormalPath(filename: string): string | null {
  const debugLog = isDebugLogging();
  const normalPath = join(__dirname, filename);
  if (debugLog) {
    debugLogger.log(`[PROMPT_LOADER] Checking normalPath: ${normalPath}`);
    debugLogger.log(
      `[PROMPT_LOADER] normalPath exists: ${existsSync(normalPath)}`,
    );
  }
  if (existsSync(normalPath)) {
    if (debugLog) debugLogger.log(`[PROMPT_LOADER] Found at normalPath`);
    return readFileSync(normalPath, 'utf-8');
  }
  return null;
}

function tryLoadByTraversingUp(filename: string): string | null {
  const currentDir = resolve(__dirname);
  let searchDir = currentDir;
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const bundleDir = join(searchDir, 'bundle');
    const bundlePath = join(bundleDir, filename);
    if (existsSync(bundlePath)) {
      return readFileSync(bundlePath, 'utf-8');
    }

    const parentDir = dirname(searchDir);
    if (parentDir === searchDir) {
      break;
    }
    searchDir = parentDir;
    attempts++;
  }
  return null;
}

function tryLoadFromCwdBundle(filename: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Tool prompt default data.
  if (process?.cwd().includes('bundle')) {
    const cwdPath = join(process.cwd(), filename);
    if (existsSync(cwdPath)) {
      return readFileSync(cwdPath, 'utf-8');
    }
  }
  return null;
}

function tryLoadFromScriptArgv(filename: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Tool prompt default data.
  if (process?.argv[1]) {
    const scriptDir = dirname(process.argv[1]);
    const scriptPath = join(scriptDir, filename);
    if (existsSync(scriptPath)) {
      return readFileSync(scriptPath, 'utf-8');
    }
  }
  return null;
}

function buildSearchPaths(): string[] {
  return [
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
  ].filter((p): p is string => typeof p === 'string' && p !== '');
}

function logSearchPaths(searchPaths: string[]): void {
  debugLogger.log(`[PROMPT_LOADER] Searching in paths:`, searchPaths);

  const checkDirs = [
    __dirname,
    typeof process !== 'undefined' ? process.cwd() : '',
    typeof process !== 'undefined' ? dirname(process.argv[1] || '') : '',
  ].filter((dir) => dir !== '');
  for (const dir of checkDirs) {
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    try {
      const files = readdirSync(dir).filter(
        (f) =>
          f.endsWith('.md') ||
          f === 'tools' ||
          f === 'providers' ||
          f === 'env',
      );
      debugLogger.log(`[PROMPT_LOADER] Files in ${dir}:`, files);
    } catch (e) {
      debugLogger.log(
        `[PROMPT_LOADER] Could not list ${dir}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

function tryLoadPath(candidatePath: string, debugLog: boolean): string | null {
  if (existsSync(candidatePath)) {
    if (debugLog) debugLogger.log(`[PROMPT_LOADER] Found at: ${candidatePath}`);
    return readFileSync(candidatePath, 'utf-8');
  }
  return null;
}

function tryLoadFromSearchPaths(filename: string): string | null {
  const debugLog = isDebugLogging();
  const searchPaths = buildSearchPaths();

  if (debugLog) {
    logSearchPaths(searchPaths);
  }

  for (const base of searchPaths) {
    const directTry = join(base, filename);
    const directResult = tryLoadPath(directTry, debugLog);
    if (directResult !== null) {
      return directResult;
    }

    const bundleTry = join(base, 'bundle', filename);
    const bundleResult = tryLoadPath(bundleTry, debugLog);
    if (bundleResult !== null) {
      return bundleResult;
    }

    if (basename(base) === 'bundle') {
      const inBundleTry = join(base, filename);
      const inBundleResult = tryLoadPath(inBundleTry, debugLog);
      if (inBundleResult !== null) {
        return inBundleResult;
      }
    }
  }
  return null;
}

function loadMarkdownFile(filename: string): string {
  const debugLog = isDebugLogging();

  if (debugLog) {
    logDebugEnvInfo(filename);
  }

  const manifestResult = tryLoadFromManifest(filename);
  if (manifestResult !== null) {
    return manifestResult;
  }

  try {
    const bundleResult = tryLoadFromBundleDir(filename);
    if (bundleResult !== null) {
      return bundleResult;
    }

    const normalResult = tryLoadFromNormalPath(filename);
    if (normalResult !== null) {
      return normalResult;
    }

    const traverseResult = tryLoadByTraversingUp(filename);
    if (traverseResult !== null) {
      return traverseResult;
    }

    const cwdResult = tryLoadFromCwdBundle(filename);
    if (cwdResult !== null) {
      return cwdResult;
    }

    const scriptResult = tryLoadFromScriptArgv(filename);
    if (scriptResult !== null) {
      return scriptResult;
    }

    const searchResult = tryLoadFromSearchPaths(filename);
    if (searchResult !== null) {
      return searchResult;
    }

    throw new Error(
      `File not found in any expected location. Searched: ${buildSearchPaths().join(', ')}`,
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    reportMissingPrompt(filename, 'tool-defaults', errorMsg);
    debugLogger.error(
      `Warning: Could not load ${filename}, using empty content. Error: ${errorMsg}`,
    );
    if (debugLog) {
      debugLogger.warn(`[PROMPT_LOADER] Full error:`, error);
      debugLogger.warn(
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
  'tools/google-web-fetch.md': loadMarkdownFile('tools/google-web-fetch.md'),
  'tools/direct-web-fetch.md': loadMarkdownFile('tools/direct-web-fetch.md'),
  'tools/code-search.md': loadMarkdownFile('tools/code-search.md'),
  'tools/google-web-search.md': loadMarkdownFile('tools/google-web-search.md'),
  'tools/exa-web-search.md': loadMarkdownFile('tools/exa-web-search.md'),
  'tools/list-subagents.md': loadMarkdownFile('tools/list-subagents.md'),
  'tools/task.md': loadMarkdownFile('tools/task.md'),
  'tools/apply-patch.md': loadMarkdownFile('tools/apply-patch.md'),
};
