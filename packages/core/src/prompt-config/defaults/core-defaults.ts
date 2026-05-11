/**
 * Core and environment default prompts
 * These constants reference the corresponding .md files for default content
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy core boundary retained while larger decomposition continues. */

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

function logDebugEnvInfo(logger: DebugLogger, filename: string): void {
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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Core prompt default data.
      `[PROMPT_LOADER] process.argv[0]: ${typeof process !== 'undefined' ? process.argv?.[0] : 'N/A'}`,
  );
  logger.debug(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Core prompt default data.
      `[PROMPT_LOADER] process.argv[1]: ${typeof process !== 'undefined' ? process.argv?.[1] : 'N/A'}`,
  );
  logger.debug(
    () =>
      `[PROMPT_LOADER] process.platform: ${typeof process !== 'undefined' ? process.platform : 'N/A'}`,
  );
  logger.debug(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Core prompt default data.
      `[PROMPT_LOADER] NODE_ENV: ${typeof process !== 'undefined' ? process.env?.NODE_ENV : 'N/A'}`,
  );
  logger.debug(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Core prompt default data.
      `[PROMPT_LOADER] CI: ${typeof process !== 'undefined' ? process.env?.CI : 'N/A'}`,
  );
}

function tryLoadFromManifest(
  filename: string,
  logger: DebugLogger,
  debugLog: boolean,
): string | null {
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
  return null;
}

function logBundleDirDebugInfo(
  logger: DebugLogger,
  currentDir: string,
  directPath: string,
): void {
  logger.debug(
    () => `[PROMPT_LOADER] In bundle dir, checking directPath: ${directPath}`,
  );
  logger.debug(
    () => `[PROMPT_LOADER] directPath exists: ${existsSync(directPath)}`,
  );

  // Check for specific files we expect
  try {
    const expectedFiles = [
      'core.md',
      'compression.md',
      'tools',
      'env',
      'providers',
    ];
    const foundFiles = expectedFiles.filter((f) => {
      const fullPath = join(currentDir, f);
      try {
        const exists = existsSync(fullPath);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Core prompt default data.
        if (exists) {
          logger.debug(() => `[PROMPT_LOADER] Found ${f} at ${fullPath}`);
        }
        return exists;
      } catch {
        return false;
      }
    });
    logger.debug(
      () =>
        `[PROMPT_LOADER] Found ${foundFiles.length}/${expectedFiles.length} expected items in bundle dir`,
    );
  } catch (e) {
    logger.debug(
      () =>
        `[PROMPT_LOADER] Could not check bundle dir: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function tryLoadFromBundleDir(
  filename: string,
  logger: DebugLogger,
  debugLog: boolean,
): string | null {
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
      logBundleDirDebugInfo(logger, currentDir, directPath);
    }
    if (existsSync(directPath)) {
      if (debugLog) {
        logger.debug(() => `[PROMPT_LOADER] Found at directPath`);
      }
      return readFileSync(directPath, 'utf-8');
    }
  }
  return null;
}

function tryLoadFromNormalPath(
  filename: string,
  logger: DebugLogger,
  debugLog: boolean,
): string | null {
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
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Core prompt default data.
  if (process?.cwd().includes('bundle')) {
    const cwdPath = join(process.cwd(), filename);
    if (existsSync(cwdPath)) {
      return readFileSync(cwdPath, 'utf-8');
    }
  }
  return null;
}

function tryLoadFromScriptArgv(filename: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Core prompt default data.
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

function logSearchPaths(logger: DebugLogger, searchPaths: string[]): void {
  logger.debug(
    () => `[PROMPT_LOADER] Searching in paths: ${searchPaths.join(', ')}`,
  );

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
      logger.debug(() => `[PROMPT_LOADER] Files in ${dir}:`, files);
    } catch (e) {
      logger.debug(
        () =>
          `[PROMPT_LOADER] Could not list ${dir}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

function tryLoadPath(
  candidatePath: string,
  logger: DebugLogger,
  debugLog: boolean,
): string | null {
  if (existsSync(candidatePath)) {
    if (debugLog) {
      logger.debug(() => `[PROMPT_LOADER] Found at: ${candidatePath}`);
    }
    return readFileSync(candidatePath, 'utf-8');
  }
  return null;
}

function tryLoadFromSearchPaths(
  filename: string,
  logger: DebugLogger,
  debugLog: boolean,
): string | null {
  const searchPaths = buildSearchPaths();

  if (debugLog) {
    logSearchPaths(logger, searchPaths);
  }

  for (const base of searchPaths) {
    const directTry = join(base, filename);
    const directResult = tryLoadPath(directTry, logger, debugLog);
    if (directResult !== null) {
      return directResult;
    }

    const bundleTry = join(base, 'bundle', filename);
    const bundleResult = tryLoadPath(bundleTry, logger, debugLog);
    if (bundleResult !== null) {
      return bundleResult;
    }

    if (basename(base) === 'bundle') {
      const inBundleTry = join(base, filename);
      const inBundleResult = tryLoadPath(inBundleTry, logger, debugLog);
      if (inBundleResult !== null) {
        return inBundleResult;
      }
    }
  }
  return null;
}

function loadMarkdownFile(filename: string): string {
  const debugLog = isDebugLogging();
  const logger = new DebugLogger('llxprt:prompt:loader:core');

  if (debugLog) {
    logDebugEnvInfo(logger, filename);
  }

  const manifestResult = tryLoadFromManifest(filename, logger, debugLog);
  if (manifestResult !== null) {
    return manifestResult;
  }

  try {
    const bundleResult = tryLoadFromBundleDir(filename, logger, debugLog);
    if (bundleResult !== null) {
      return bundleResult;
    }

    const normalResult = tryLoadFromNormalPath(filename, logger, debugLog);
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

    const searchResult = tryLoadFromSearchPaths(filename, logger, debugLog);
    if (searchResult !== null) {
      return searchResult;
    }

    throw new Error(
      `File not found in any expected location. Searched: ${buildSearchPaths().join(', ')}`,
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const warningDetail =
      error instanceof Error && error.stack
        ? error.stack.split('\n')[0]
        : errorMsg;
    reportMissingPrompt(filename, 'core-defaults', warningDetail);
    debugLogger.error(
      `Warning: Could not load ${filename}, using empty content. Error: ${errorMsg}`,
    );
    if (debugLog) {
      logger.debug(
        () =>
          `[PROMPT_LOADER] Full error: ${error instanceof Error ? error.message : String(error)}`,
      );
      logger.debug(
        () =>
          `[PROMPT_LOADER] Stack trace: ${error instanceof Error ? error.stack : 'No stack trace'}`,
      );
    }
    return '';
  }
}

export const CORE_DEFAULTS: Record<string, string> = {
  'core.md': loadMarkdownFile('core.md'),

  'compression.md': loadMarkdownFile('compression.md'),

  'subagent-delegation.md': loadMarkdownFile('subagent-delegation.md'),

  'async-subagent-guidance.md': loadMarkdownFile('async-subagent-guidance.md'),

  'env/git-repository.md': loadMarkdownFile('env/git-repository.md'),
  'env/sandbox.md': loadMarkdownFile('env/sandbox.md'),
  'env/ide-mode.md': loadMarkdownFile('env/ide-mode.md'),
  'env/macos-seatbelt.md': loadMarkdownFile('env/macos-seatbelt.md'),
  'env/outside-of-sandbox.md': loadMarkdownFile('env/outside-of-sandbox.md'),
};
