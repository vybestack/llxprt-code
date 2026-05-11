/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import type { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import type { FileFilteringOptions } from '../config/constants.js';
import { DebugLogger } from '../debug/index.js';
import { debugLogger } from './debugLogger.js';

const logger = new DebugLogger('llxprt:core:bfsFileSearch');

interface BfsFileSearchOptions {
  fileName: string;
  ignoreDirs?: string[];
  maxDirs?: number;
  maxDepth?: number;
  debug?: boolean;
  fileService?: FileDiscoveryService;
  fileFilteringOptions?: FileFilteringOptions;
}

async function readDirBatch(
  batch: Array<{ dir: string; depth: number }>,
  debug: boolean,
): Promise<Array<{ currentDir: string; depth: number; entries: Dirent[] }>> {
  const readPromises = batch.map(async ({ dir, depth }) => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return { currentDir: dir, depth, entries };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      debugLogger.warn(
        `[WARN] Skipping unreadable directory: ${dir} (${message})`,
      );
      if (debug) {
        logger.debug(`Full error for ${dir}:`, error);
      }
      return { currentDir: dir, depth, entries: [] };
    }
  });
  return Promise.all(readPromises);
}

function isIgnoredByFileService(
  fullPath: string,
  fileService: BfsFileSearchOptions['fileService'],
  fileFilteringOptions: BfsFileSearchOptions['fileFilteringOptions'],
): boolean {
  return (
    fileService?.shouldIgnoreFile(fullPath, {
      respectGitIgnore: fileFilteringOptions?.respectGitIgnore,
      respectLlxprtIgnore: fileFilteringOptions?.respectLlxprtIgnore,
    }) === true
  );
}

function enqueueDirectory(
  entry: Dirent,
  fullPath: string,
  depth: number,
  ignoreDirsSet: Set<string>,
  maxDepth: number | undefined,
  queue: string[],
  depthQueue: number[],
): void {
  if (ignoreDirsSet.has(entry.name)) return;
  const childDepth = depth + 1;
  if (maxDepth === undefined || childDepth <= maxDepth) {
    queue.push(fullPath);
    depthQueue.push(childDepth);
  }
}

function processBatchEntries(
  results: Array<{ currentDir: string; depth: number; entries: Dirent[] }>,
  fileName: string,
  ignoreDirsSet: Set<string>,
  maxDepth: number | undefined,
  fileService: BfsFileSearchOptions['fileService'],
  fileFilteringOptions: BfsFileSearchOptions['fileFilteringOptions'],
  foundFiles: string[],
  queue: string[],
  depthQueue: number[],
): void {
  for (const { currentDir, depth, entries } of results) {
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (isIgnoredByFileService(fullPath, fileService, fileFilteringOptions)) {
        continue;
      }

      if (entry.isDirectory()) {
        enqueueDirectory(
          entry,
          fullPath,
          depth,
          ignoreDirsSet,
          maxDepth,
          queue,
          depthQueue,
        );
      } else if (entry.isFile() && entry.name === fileName) {
        foundFiles.push(fullPath);
      }
    }
  }
}

/**
 * Performs a breadth-first search for a specific file within a directory structure.
 *
 * @param rootDir The directory to start the search from.
 * @param options Configuration for the search.
 * @returns A promise that resolves to an array of paths where the file was found.
 */
export async function bfsFileSearch(
  rootDir: string,
  options: BfsFileSearchOptions,
): Promise<string[]> {
  const {
    fileName,
    ignoreDirs = [],
    maxDirs = Infinity,
    maxDepth,
    debug = false,
    fileService,
  } = options;
  const foundFiles: string[] = [];
  const queue: string[] = [rootDir];
  const depthQueue: number[] = [0];
  const visited = new Set<string>();
  let scannedDirCount = 0;
  let queueHead = 0;

  const ignoreDirsSet = new Set(ignoreDirs);
  const PARALLEL_BATCH_SIZE = 15;

  while (queueHead < queue.length && scannedDirCount < maxDirs) {
    const batchSize = Math.min(PARALLEL_BATCH_SIZE, maxDirs - scannedDirCount);
    const currentBatch: Array<{ dir: string; depth: number }> = [];
    while (currentBatch.length < batchSize && queueHead < queue.length) {
      const currentDir = queue[queueHead];
      const currentDepth = depthQueue[queueHead];
      queueHead++;
      if (!visited.has(currentDir)) {
        visited.add(currentDir);
        currentBatch.push({ dir: currentDir, depth: currentDepth });
      }
    }
    scannedDirCount += currentBatch.length;

    if (currentBatch.length === 0) continue;

    if (debug) {
      logger.debug(
        `Scanning [${scannedDirCount}/${maxDirs}]: batch of ${currentBatch.length}`,
      );
    }

    const results = await readDirBatch(currentBatch, debug);

    processBatchEntries(
      results,
      fileName,
      ignoreDirsSet,
      maxDepth,
      fileService,
      options.fileFilteringOptions,
      foundFiles,
      queue,
      depthQueue,
    );
  }

  return foundFiles;
}
