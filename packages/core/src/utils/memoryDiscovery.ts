/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { bfsFileSearch } from './bfsFileSearch.js';
import {
  getAllLlxprtMdFilenames,
  getGlobalCoreMemoryFilePath,
  getProjectCoreMemoryFilePath,
} from '@vybestack/llxprt-code-tools';
import type { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import { processImports } from './memoryImportProcessor.js';
import type { FileFilteringOptions } from '../config/constants.js';
import { DEFAULT_MEMORY_FILE_FILTERING_OPTIONS } from '../config/constants.js';
import { LLXPRT_DIR } from './paths.js';
import type { LlxprtExtension } from '../config/config.js';
import { debugLogger } from './debugLogger.js';

// Simple console logger, similar to the one previously in CLI's config.ts
// Follow-up (#1569): Integrate with a more robust server-side logger if available/appropriate.
const logger = {
  debug: (...args: unknown[]) =>
    debugLogger.debug('[DEBUG] [MemoryDiscovery]', ...args),
  warn: (...args: unknown[]) =>
    debugLogger.warn('[WARN] [MemoryDiscovery]', ...args),
  error: (...args: unknown[]) =>
    debugLogger.error('[ERROR] [MemoryDiscovery]', ...args),
};

interface LlxprtFileContent {
  filePath: string;
  content: string | null;
}

async function findProjectRoot(startDir: string): Promise<string | null> {
  let currentDir = path.resolve(startDir);
  // Walk up the directory tree until we reach the filesystem root.
  for (;;) {
    const gitPath = path.join(currentDir, '.git');
    try {
      const stats = await fs.lstat(gitPath);
      if (stats.isDirectory()) {
        return currentDir;
      }
    } catch (error: unknown) {
      // Don't log ENOENT errors as they're expected when .git doesn't exist
      // Also don't log errors in test environments, which often have mocked fs
      const isENOENT =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === 'ENOENT';

      // Only log unexpected errors in non-test environments
      // process.env['NODE_ENV'] === 'test' or VITEST are common test indicators
      const isTestEnv =
        process.env['NODE_ENV'] === 'test' ||
        process.env['VITEST'] !== undefined;

      if (isENOENT === false && isTestEnv === false) {
        logGitDirectoryError(error, gitPath);
      }
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

async function getLlxprtMdFilePathsInternal(
  currentWorkingDirectory: string,
  includeDirectoriesToReadLlxprt: readonly string[],
  userHomePath: string,
  debugMode: boolean,
  fileService: FileDiscoveryService,
  folderTrust: boolean,
  fileFilteringOptions: FileFilteringOptions,
  maxDirs: number,
  maxDepth?: number,
): Promise<string[]> {
  const dirs = new Set<string>([
    ...includeDirectoriesToReadLlxprt,
    currentWorkingDirectory,
  ]);

  // Process directories in parallel with concurrency limit to prevent EMFILE errors
  const CONCURRENT_LIMIT = 10;
  const dirsArray = Array.from(dirs);
  const pathsArrays: string[][] = [];

  for (let i = 0; i < dirsArray.length; i += CONCURRENT_LIMIT) {
    const batch = dirsArray.slice(i, i + CONCURRENT_LIMIT);
    const batchPromises = batch.map((dir) =>
      getLlxprtMdFilePathsInternalForEachDir(
        dir,
        userHomePath,
        debugMode,
        fileService,
        folderTrust,
        fileFilteringOptions,
        maxDirs,
        maxDepth,
      ),
    );

    const batchResults = await Promise.allSettled(batchPromises);

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        pathsArrays.push(result.value);
      } else {
        const error = result.reason;
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Error discovering files in directory: ${message}`);
        // Continue processing other directories
      }
    }
  }

  const paths = pathsArrays.flat();
  return Array.from(new Set<string>(paths));
}

async function searchUpwardForLlxprtMd(
  llxprtMdFilename: string,
  resolvedCwd: string,
  globalMemoryPath: string,
  resolvedHome: string,
  debugMode: boolean,
): Promise<string[]> {
  const projectRoot = await findProjectRoot(resolvedCwd);
  if (debugMode)
    logger.debug(`Determined project root: ${projectRoot ?? 'None'}`);

  const upwardPaths: string[] = [];
  let currentDir = resolvedCwd;
  const ultimateStopDir = projectRoot
    ? path.dirname(projectRoot)
    : path.dirname(resolvedHome);

  while (
    currentDir &&
    currentDir !== path.dirname(currentDir) &&
    currentDir !== path.join(resolvedHome, LLXPRT_DIR)
  ) {
    const potentialPath = path.join(currentDir, llxprtMdFilename);
    try {
      await fs.access(potentialPath, fsSync.constants.R_OK);
      if (potentialPath !== globalMemoryPath) {
        upwardPaths.unshift(potentialPath);
      }
    } catch {
      // Not found, continue.
    }

    const llxprtDirPath = path.join(currentDir, LLXPRT_DIR, llxprtMdFilename);
    try {
      await fs.access(llxprtDirPath, fsSync.constants.R_OK);
      if (llxprtDirPath !== globalMemoryPath) {
        upwardPaths.unshift(llxprtDirPath);
      }
    } catch {
      // Not found, continue.
    }

    if (currentDir === ultimateStopDir) {
      break;
    }

    currentDir = path.dirname(currentDir);
  }
  return upwardPaths;
}

async function findGlobalAndWorkspacePaths(
  llxprtMdFilename: string,
  dir: string,
  userHomePath: string,
  debugMode: boolean,
  fileService: FileDiscoveryService,
  folderTrust: boolean,
  fileFilteringOptions: FileFilteringOptions,
  maxDirs: number,
  maxDepth: number | undefined,
): Promise<Set<string>> {
  const allPaths = new Set<string>();
  const resolvedHome = path.resolve(userHomePath);
  const globalMemoryPath = path.join(
    resolvedHome,
    LLXPRT_DIR,
    llxprtMdFilename,
  );

  try {
    await fs.access(globalMemoryPath, fsSync.constants.R_OK);
    allPaths.add(globalMemoryPath);
    if (debugMode)
      logger.debug(
        `Found readable global ${llxprtMdFilename}: ${globalMemoryPath}`,
      );
  } catch {
    // It's okay if it's not found.
  }

  if (dir && folderTrust) {
    const resolvedCwd = path.resolve(dir);
    if (debugMode)
      logger.debug(
        `Searching for ${llxprtMdFilename} starting from CWD: ${resolvedCwd}`,
      );

    const upwardPaths = await searchUpwardForLlxprtMd(
      llxprtMdFilename,
      resolvedCwd,
      globalMemoryPath,
      resolvedHome,
      debugMode,
    );
    upwardPaths.forEach((p) => allPaths.add(p));

    const mergedOptions: FileFilteringOptions = {
      ...DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
      ...fileFilteringOptions,
    };

    const downwardPaths = await bfsFileSearch(resolvedCwd, {
      fileName: llxprtMdFilename,
      maxDirs,
      maxDepth,
      debug: debugMode,
      fileService,
      fileFilteringOptions: mergedOptions,
    });
    downwardPaths.sort();
    for (const dPath of downwardPaths) {
      allPaths.add(dPath);
    }
  }
  return allPaths;
}

async function getLlxprtMdFilePathsInternalForEachDir(
  dir: string,
  userHomePath: string,
  debugMode: boolean,
  fileService: FileDiscoveryService,
  folderTrust: boolean,
  fileFilteringOptions: FileFilteringOptions,
  maxDirs: number,
  maxDepth?: number,
): Promise<string[]> {
  const allPaths = new Set<string>();
  const llxprtMdFilenames = getAllLlxprtMdFilenames();

  for (const llxprtMdFilename of llxprtMdFilenames) {
    const pathSet = await findGlobalAndWorkspacePaths(
      llxprtMdFilename,
      dir,
      userHomePath,
      debugMode,
      fileService,
      folderTrust,
      fileFilteringOptions,
      maxDirs,
      maxDepth,
    );
    pathSet.forEach((p) => allPaths.add(p));
  }

  const finalPaths = Array.from(allPaths);

  if (debugMode)
    logger.debug(
      `Final ordered ${getAllLlxprtMdFilenames()} paths to read: ${JSON.stringify(
        finalPaths,
      )}`,
    );
  return finalPaths;
}

async function readLlxprtMdFiles(
  filePaths: string[],
  debugMode: boolean,
  importFormat: 'flat' | 'tree' = 'tree',
): Promise<LlxprtFileContent[]> {
  // Process files in parallel with concurrency limit to prevent EMFILE errors
  const CONCURRENT_LIMIT = 20; // Higher limit for file reads as they're typically faster
  const results: LlxprtFileContent[] = [];

  for (let i = 0; i < filePaths.length; i += CONCURRENT_LIMIT) {
    const batch = filePaths.slice(i, i + CONCURRENT_LIMIT);
    const batchPromises = batch.map(
      async (filePath): Promise<LlxprtFileContent> => {
        try {
          const content = await fs.readFile(filePath, 'utf-8');

          // Process imports in the content
          const processedResult = await processImports(
            content,
            path.dirname(filePath),
            debugMode,
            undefined,
            undefined,
            importFormat,
          );
          if (debugMode)
            logger.debug(
              `Successfully read and processed imports: ${filePath} (Length: ${processedResult.content.length})`,
            );

          return { filePath, content: processedResult.content };
        } catch (error: unknown) {
          const isTestEnv =
            process.env['NODE_ENV'] === 'test' ||
            process.env['VITEST'] !== undefined;
          if (isTestEnv === false) {
            const message =
              error instanceof Error ? error.message : String(error);
            logger.warn(
              `Warning: Could not read ${getAllLlxprtMdFilenames()} file at ${filePath}. Error: ${message}`,
            );
          }
          if (debugMode) logger.debug(`Failed to read: ${filePath}`);
          return { filePath, content: null }; // Still include it with null content
        }
      },
    );

    const batchResults = await Promise.allSettled(batchPromises);

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        // This case shouldn't happen since we catch all errors above,
        // but handle it for completeness
        const error = result.reason;
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Unexpected error processing file: ${message}`);
      }
    }
  }

  return results;
}

export function concatenateInstructions(
  instructionContents: LlxprtFileContent[],
  // CWD is needed to resolve relative paths for display markers
  currentWorkingDirectoryForDisplay: string,
): string {
  return instructionContents
    .filter((item) => typeof item.content === 'string')
    .map((item) => {
      const trimmedContent = (item.content as string).trim();
      if (trimmedContent.length === 0) {
        return null;
      }
      const displayPath = path.isAbsolute(item.filePath)
        ? path.relative(currentWorkingDirectoryForDisplay, item.filePath)
        : item.filePath;
      return `--- Context from: ${displayPath} ---\n${trimmedContent}\n--- End of Context from: ${displayPath} ---`;
    })
    .filter((block): block is string => block !== null)
    .join('\n\n');
}

export interface MemoryLoadResult {
  files: Array<{ path: string; content: string }>;
}

export async function loadGlobalMemory(
  debugMode: boolean = false,
): Promise<MemoryLoadResult> {
  const userHome = homedir();
  const llxprtMdFilenames = getAllLlxprtMdFilenames();

  const accessChecks = llxprtMdFilenames.map(async (filename) => {
    const globalPath = path.join(userHome, LLXPRT_DIR, filename);
    try {
      await fs.access(globalPath, fsSync.constants.R_OK);
      if (debugMode) {
        logger.debug(`Found global memory file: ${globalPath}`);
      }
      return globalPath;
    } catch {
      logger.debug('A global memory file was not found.');
      return null;
    }
  });

  const foundPaths = (await Promise.all(accessChecks)).filter(
    (p): p is string => p !== null,
  );

  const contents = await readLlxprtMdFiles(foundPaths, debugMode, 'tree');

  return {
    files: contents
      .filter((item) => item.content !== null)
      .map((item) => ({
        path: item.filePath,
        content: item.content as string,
      })),
  };
}

/**
 * Traverses upward from startDir to stopDir, finding all LLXPRT.md variants.
 *
 * Files are ordered by directory level (root to leaf), with all filename
 * variants grouped together per directory.
 */
async function findUpwardLlxprtFiles(
  startDir: string,
  stopDir: string,
  debugMode: boolean,
): Promise<string[]> {
  const upwardPaths: string[] = [];
  let currentDir = path.resolve(startDir);
  const resolvedStopDir = path.resolve(stopDir);
  const llxprtMdFilenames = getAllLlxprtMdFilenames();
  const globalLlxprtDir = path.resolve(path.join(homedir(), LLXPRT_DIR));

  if (debugMode) {
    logger.debug(
      `Starting upward search from ${currentDir} stopping at ${resolvedStopDir}`,
    );
  }

  let done = false;
  while (!done && currentDir !== globalLlxprtDir) {
    const accessChecks = llxprtMdFilenames.map(async (filename) => {
      const checks: Array<Promise<string | null>> = [];

      const directPath = path.join(currentDir, filename);
      checks.push(
        (async () => {
          try {
            await fs.access(directPath, fsSync.constants.R_OK);
            return directPath;
          } catch {
            return null;
          }
        })(),
      );

      const llxprtDirPath = path.join(currentDir, LLXPRT_DIR, filename);
      checks.push(
        (async () => {
          try {
            await fs.access(llxprtDirPath, fsSync.constants.R_OK);
            if (llxprtDirPath !== path.join(globalLlxprtDir, filename)) {
              return llxprtDirPath;
            }
            return null;
          } catch {
            return null;
          }
        })(),
      );

      return Promise.all(checks);
    });

    const pathArrays = await Promise.all(accessChecks);
    const foundPathsInDir = pathArrays
      .flat()
      .filter((p): p is string => p !== null);

    upwardPaths.unshift(...foundPathsInDir);

    if (
      currentDir === resolvedStopDir ||
      currentDir === path.dirname(currentDir)
    ) {
      done = true;
    } else {
      currentDir = path.dirname(currentDir);
    }
  }
  return upwardPaths;
}

interface ExtensionLoader {
  getExtensions(): LlxprtExtension[];
}

export async function loadEnvironmentMemory(
  trustedRoots: string[],
  extensionLoader: ExtensionLoader,
  debugMode: boolean = false,
): Promise<MemoryLoadResult> {
  const allPaths = new Set<string>();

  // Trusted Roots Upward Traversal (Parallelized)
  const traversalPromises = trustedRoots.map(async (root) => {
    const resolvedRoot = path.resolve(root);
    if (debugMode) {
      logger.debug(
        `Loading environment memory for trusted root: ${resolvedRoot} (Stopping exactly here)`,
      );
    }
    return findUpwardLlxprtFiles(resolvedRoot, resolvedRoot, debugMode);
  });

  const pathArrays = await Promise.all(traversalPromises);
  pathArrays.flat().forEach((p) => allPaths.add(p));

  // Extensions
  const extensionPaths = extensionLoader
    .getExtensions()
    .filter((ext: LlxprtExtension) => ext.isActive)
    .flatMap((ext: LlxprtExtension) => ext.contextFiles);
  extensionPaths.forEach((p: string) => allPaths.add(p));

  const sortedPaths = Array.from(allPaths).sort();
  const contents = await readLlxprtMdFiles(sortedPaths, debugMode, 'tree');

  return {
    files: contents
      .filter((item) => item.content !== null)
      .map((item) => ({
        path: item.filePath,
        content: item.content as string,
      })),
  };
}

export async function loadCoreMemory(
  trustedRoots: string[],
  debugMode: boolean = false,
): Promise<MemoryLoadResult> {
  const allPaths = new Set<string>();

  const globalCoreMemoryPath = getGlobalCoreMemoryFilePath();
  try {
    await fs.access(globalCoreMemoryPath, fsSync.constants.R_OK);
    allPaths.add(globalCoreMemoryPath);
    if (debugMode) {
      logger.debug(`Found global core memory: ${globalCoreMemoryPath}`);
    }
  } catch {
    if (debugMode) {
      logger.debug('Global core memory file not found.');
    }
  }

  for (const root of trustedRoots) {
    const projectCoreMemoryPath = getProjectCoreMemoryFilePath(root);
    try {
      await fs.access(projectCoreMemoryPath, fsSync.constants.R_OK);
      allPaths.add(projectCoreMemoryPath);
      if (debugMode) {
        logger.debug(`Found project core memory: ${projectCoreMemoryPath}`);
      }
    } catch {
      if (debugMode) {
        logger.debug(
          `Project core memory file not found at ${projectCoreMemoryPath}`,
        );
      }
    }
  }

  const sortedPaths = Array.from(allPaths).sort();
  const results: Array<{ path: string; content: string }> = [];

  for (const filePath of sortedPaths) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      if (debugMode) {
        logger.debug(
          `Successfully read core memory: ${filePath} (Length: ${content.length})`,
        );
      }
      results.push({ path: filePath, content });
    } catch (error: unknown) {
      const isTestEnv =
        process.env['NODE_ENV'] === 'test' ||
        process.env['VITEST'] !== undefined;
      if (isTestEnv === false) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          `Warning: Could not read core memory file at ${filePath}. Error: ${message}`,
        );
      }
      if (debugMode) {
        logger.debug(`Failed to read core memory: ${filePath}`);
      }
    }
  }

  return { files: results };
}

export interface LoadServerHierarchicalMemoryResponse {
  memoryContent: string;
  fileCount: number;
  filePaths: string[];
}

/**
 * Loads hierarchical LLXPRT.md files and concatenates their content.
 * This function is intended for use by the server.
 */
export async function loadServerHierarchicalMemory(
  currentWorkingDirectory: string,
  includeDirectoriesToReadLlxprt: readonly string[],
  debugMode: boolean,
  fileService: FileDiscoveryService,
  extensions: LlxprtExtension[],
  folderTrust: boolean,
  importFormat: 'flat' | 'tree' = 'tree',
  fileFilteringOptions?: FileFilteringOptions,
  maxDirs: number = 200,
  maxDepth?: number,
): Promise<LoadServerHierarchicalMemoryResponse> {
  if (debugMode)
    logger.debug(
      `Loading server hierarchical memory for CWD: ${currentWorkingDirectory} (importFormat: ${importFormat})`,
    );

  // For the server, homedir() refers to the server process's home.
  // This is consistent with how MemoryTool already finds the global path.
  const userHomePath = homedir();
  const filePaths = await getLlxprtMdFilePathsInternal(
    currentWorkingDirectory,
    includeDirectoriesToReadLlxprt,
    userHomePath,
    debugMode,
    fileService,
    folderTrust,
    fileFilteringOptions ?? DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
    maxDirs,
    maxDepth,
  );

  // Add extension file paths separately since they may be conditionally enabled.
  filePaths.push(
    ...extensions
      .filter((ext) => ext.isActive)
      .flatMap((ext) => ext.contextFiles),
  );

  if (filePaths.length === 0) {
    if (debugMode)
      logger.debug('No LLXPRT.md files found in hierarchy of the workspace.');
    return { memoryContent: '', fileCount: 0, filePaths: [] };
  }
  const contentsWithPaths = await readLlxprtMdFiles(
    filePaths,
    debugMode,
    importFormat,
  );
  // Pass CWD for relative path display in concatenated content
  const combinedInstructions = concatenateInstructions(
    contentsWithPaths,
    currentWorkingDirectory,
  );
  if (debugMode)
    logger.debug(
      `Combined instructions length: ${combinedInstructions.length}`,
    );
  if (debugMode && combinedInstructions.length > 0)
    logger.debug(
      `Combined instructions (snippet): ${combinedInstructions.substring(0, 500)}...`,
    );
  return {
    memoryContent: combinedInstructions,
    fileCount: contentsWithPaths.length,
    filePaths,
  };
}

export async function loadJitSubdirectoryMemory(
  targetPath: string,
  trustedRoots: string[],
  alreadyLoadedPaths: Set<string>,
  debugMode: boolean = false,
  jitContextEnabled: boolean = true,
): Promise<MemoryLoadResult> {
  if (!jitContextEnabled) {
    if (debugMode) {
      logger.debug('JIT context loading is disabled by configuration.');
    }
    return { files: [] };
  }

  const resolvedTarget = path.resolve(targetPath);
  let bestRoot: string | null = null;

  // Find the deepest trusted root that contains the target path
  for (const root of trustedRoots) {
    const resolvedRoot = path.resolve(root);
    if (
      resolvedTarget.startsWith(resolvedRoot) &&
      (!bestRoot || resolvedRoot.length > bestRoot.length)
    ) {
      bestRoot = resolvedRoot;
    }
  }

  if (!bestRoot) {
    if (debugMode) {
      logger.debug(
        `JIT memory skipped: ${resolvedTarget} is not in any trusted root.`,
      );
    }
    return { files: [] };
  }

  if (debugMode) {
    logger.debug(
      `Loading JIT memory for ${resolvedTarget} (Trusted root: ${bestRoot})`,
    );
  }

  // Traverse from target up to the trusted root
  const potentialPaths = await findUpwardLlxprtFiles(
    resolvedTarget,
    bestRoot,
    debugMode,
  );

  // Filter out already loaded paths
  const newPaths = potentialPaths.filter((p) => !alreadyLoadedPaths.has(p));

  if (newPaths.length === 0) {
    return { files: [] };
  }

  if (debugMode) {
    logger.debug(`Found new JIT memory files: ${JSON.stringify(newPaths)}`);
  }

  const contents = await readLlxprtMdFiles(newPaths, debugMode, 'tree');

  return {
    files: contents
      .filter((item) => item.content !== null)
      .map((item) => ({
        path: item.filePath,
        content: item.content as string,
      })),
  };
}

function logGitDirectoryError(error: unknown, gitPath: string): void {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const fsError = error as { code: string; message: string };
    logger.warn(
      `Error checking for .git directory at ${gitPath}: ${fsError.message}`,
    );
  } else {
    logger.warn(
      `Non-standard error checking for .git directory at ${gitPath}: ${String(error)}`,
    );
  }
}
