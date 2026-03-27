/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'node:os';
import { homedir } from 'node:os';
import * as dotenv from 'dotenv';
import process from 'node:process';
import {
  DebugLogger,
  loadServerHierarchicalMemory,
  type FileDiscoveryService,
  type FileFilteringOptions,
  type GeminiCLIExtension,
} from '@vybestack/llxprt-code-core';
import type { Settings } from './settings.js';
import type { CliArgs } from './cliArgParser.js';
import type { ContextResolutionResult } from './interactiveContext.js';

const logger = new DebugLogger('llxprt:config:environmentLoader');

export const LLXPRT_DIR = '.llxprt';

/**
 * Walk up the directory tree looking for a .env file, preferring the
 * LLXPRT_DIR-specific variant. Falls back to home directory as a last resort.
 */
function findEnvFile(startDir: string): string | null {
  let currentDir = path.resolve(startDir);
  while (true) {
    // prefer gemini-specific .env under LLXPRT_DIR
    const geminiEnvPath = path.join(currentDir, LLXPRT_DIR, '.env');
    if (fs.existsSync(geminiEnvPath)) {
      return geminiEnvPath;
    }
    const envPath = path.join(currentDir, '.env');
    if (fs.existsSync(envPath)) {
      return envPath;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir || !parentDir) {
      // check .env under home as fallback, again preferring gemini-specific .env
      const homeGeminiEnvPath = path.join(os.homedir(), LLXPRT_DIR, '.env');
      if (fs.existsSync(homeGeminiEnvPath)) {
        return homeGeminiEnvPath;
      }
      const homeEnvPath = path.join(os.homedir(), '.env');
      if (fs.existsSync(homeEnvPath)) {
        return homeEnvPath;
      }
      return null;
    }
    currentDir = parentDir;
  }
}

/** Load the nearest .env file into process.env via dotenv. */
export function loadEnvironment(): void {
  const envFilePath = findEnvFile(process.cwd());
  if (envFilePath) {
    dotenv.config({ path: envFilePath, quiet: true });
  }
}

/** Return true when debug mode is active via CLI flag or environment variable. */
export function isDebugMode(argv: CliArgs): boolean {
  return (
    argv.debug ||
    [process.env['DEBUG'], process.env['DEBUG_MODE']].some(
      (v) => v === 'true' || v === '1',
    )
  );
}

export async function resolveMemoryContent(
  cwd: string,
  context: ContextResolutionResult,
  profileMergedSettings: Settings,
): Promise<{ memoryContent: string; fileCount: number; filePaths: string[] }> {
  if (context.jitContextEnabled) {
    return { memoryContent: '', fileCount: 0, filePaths: [] };
  }
  return loadHierarchicalLlxprtMemory(
    cwd,
    context.resolvedLoadMemoryFromIncludeDirectories
      ? (context.includeDirectories as string[])
      : [],
    context.debugMode,
    context.fileService,
    profileMergedSettings,
    context.allExtensions,
    context.trustedFolder,
    context.memoryImportFormat,
    context.memoryFileFiltering,
  );
}

// This function is a thin wrapper around the server's implementation.
// It's kept in the CLI for now as App.tsx directly calls it for memory refresh.
export async function loadHierarchicalLlxprtMemory(
  currentWorkingDirectory: string,
  includeDirectoriesToReadGemini: readonly string[] = [],
  debugMode: boolean,
  fileService: FileDiscoveryService,
  settings: Settings,
  extensions: GeminiCLIExtension[],
  folderTrust: boolean,
  memoryImportFormat: 'flat' | 'tree' = 'tree',
  fileFilteringOptions?: FileFilteringOptions,
): Promise<{ memoryContent: string; fileCount: number; filePaths: string[] }> {
  // FIX: Use real, canonical paths for a reliable comparison to handle symlinks.
  const realCwd = fs.realpathSync(path.resolve(currentWorkingDirectory));
  const realHome = fs.realpathSync(path.resolve(homedir()));
  const isHomeDirectory = realCwd === realHome;

  // If it is the home directory, pass an empty string to the core memory
  // function to signal that it should skip the workspace search.
  const effectiveCwd = isHomeDirectory ? '' : currentWorkingDirectory;

  if (debugMode) {
    logger.debug(
      `CLI: Delegating hierarchical memory load to server for CWD: ${currentWorkingDirectory} (memoryImportFormat: ${memoryImportFormat})`,
    );
  }

  // Directly call the server function with the corrected path.
  return loadServerHierarchicalMemory(
    effectiveCwd,
    includeDirectoriesToReadGemini,
    debugMode,
    fileService,
    extensions,
    folderTrust,
    memoryImportFormat,
    fileFilteringOptions,
    settings.ui?.memoryDiscoveryMaxDirs,
    settings.ui?.memoryDiscoveryMaxDepth,
  );
}
