/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { fdir } from 'fdir';
import type { Ignore } from './ignore.js';
import * as cache from './crawlCache.js';

export interface CrawlOptions {
  // The directory to start the crawl from.
  crawlDirectory: string;
  // The project's root directory, for path relativity.
  cwd: string;
  // The fdir maxDepth option.
  maxDepth?: number;
  // Maximum number of files to return.
  maxFiles?: number;
  // A pre-configured Ignore instance.
  ignore: Ignore;
  // Caching options.
  cache: boolean;
  cacheTtl: number;
  signal?: AbortSignal;
}

function toPosixPath(p: string) {
  return p.split(path.sep).join(path.posix.sep);
}

class CrawlAbortError extends Error {
  constructor() {
    super('Crawl aborted');
    this.name = 'AbortError';
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new CrawlAbortError();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export async function crawl(options: CrawlOptions): Promise<string[]> {
  throwIfAborted(options.signal);

  if (options.cache) {
    const cacheKey = cache.getCacheKey(
      options.crawlDirectory,
      options.ignore.getFingerprint(),
      options.maxDepth,
      options.maxFiles,
    );
    const cachedResults = cache.read(cacheKey);

    if (cachedResults) {
      throwIfAborted(options.signal);
      return cachedResults;
    }
  }

  const posixCwd = toPosixPath(options.cwd);
  const posixCrawlDirectory = toPosixPath(options.crawlDirectory);
  const maxFiles = options.maxFiles ?? Infinity;
  let fileCount = 0;
  // Boxed so TypeScript does not narrow the flag across the callback closures
  // below (the closures set it, but TS control-flow analysis cannot see that).
  const state = { truncated: false };

  let results: string[];
  try {
    const dirFilter = options.ignore.getDirectoryFilter();
    const api = new fdir()
      .withRelativePaths()
      .withDirs()
      .withPathSeparator('/') // Always use unix style paths
      .filter((_entryPath, isDirectory) => {
        throwIfAborted(options.signal);

        if (!isDirectory) {
          fileCount++;
          if (fileCount > maxFiles) {
            state.truncated = true;
            return false;
          }
        }
        return true;
      })
      .exclude((_dirName, dirPath) => {
        throwIfAborted(options.signal);

        if (fileCount > maxFiles) {
          state.truncated = true;
          return true;
        }
        const relativePath = path.posix.relative(posixCrawlDirectory, dirPath);
        return dirFilter(`${relativePath}/`);
      });

    if (options.maxDepth !== undefined) {
      api.withMaxDepth(options.maxDepth + 1);
    }

    results = await api.crawl(options.crawlDirectory).withPromise();
    throwIfAborted(options.signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    // Directory probably doesn't exist
    return [];
  }

  const relativeToCrawlDir = path.posix.relative(posixCwd, posixCrawlDirectory);

  const relativeToCwdResults = results.map((p) =>
    path.posix.join(relativeToCrawlDir, p),
  );

  if (options.cache && !state.truncated) {
    const cacheKey = cache.getCacheKey(
      options.crawlDirectory,
      options.ignore.getFingerprint(),
      options.maxDepth,
      options.maxFiles,
    );
    cache.write(cacheKey, relativeToCwdResults, options.cacheTtl * 1000);
  }

  throwIfAborted(options.signal);
  return relativeToCwdResults;
}
