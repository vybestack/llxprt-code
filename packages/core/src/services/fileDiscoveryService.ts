/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GitIgnoreParser,
  type GitIgnoreFilter,
} from '../utils/gitIgnoreParser.js';
import { findGitRoot } from '../utils/gitUtils.js';
import * as fs from 'fs';
import * as path from 'path';

const LLXPRT_IGNORE_FILE_NAME = '.llxprtignore';

export interface FilterFilesOptions {
  respectGitIgnore?: boolean;
  respectLlxprtIgnore?: boolean;
}

export class FileDiscoveryService {
  private gitIgnoreFilter: GitIgnoreFilter | null = null;
  private llxprtIgnoreFilter: GitIgnoreFilter | null = null;
  private projectRoot: string;

  constructor(projectRoot: string) {
    const absoluteRoot = path.resolve(projectRoot);
    this.projectRoot = this.tryRealpath(absoluteRoot);
    const gitRootCandidate = findGitRoot(this.projectRoot);
    const resolvedGitRoot = gitRootCandidate
      ? this.tryRealpath(gitRootCandidate)
      : null;

    if (resolvedGitRoot) {
      const parser = new GitIgnoreParser(resolvedGitRoot);
      try {
        parser.loadGitRepoPatterns();
      } catch (_error) {
        // ignore file not found
      }
      this.gitIgnoreFilter = parser;
    }

    const gParser = new GitIgnoreParser(this.projectRoot);
    try {
      gParser.loadPatterns(LLXPRT_IGNORE_FILE_NAME);
    } catch (_error) {
      // ignore file not found
    }
    this.llxprtIgnoreFilter = gParser;
  }

  /**
   * Filters a list of file paths based on git ignore rules
   */
  filterFiles(
    filePaths: string[],
    options: FilterFilesOptions = {
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    },
  ): string[] {
    const respectGitIgnore = options.respectGitIgnore ?? true;
    const respectLlxprtIgnore = options.respectLlxprtIgnore ?? true;

    const filtered: string[] = [];
    for (const filePath of filePaths) {
      const absolutePath = this.resolveAbsolutePath(filePath);

      if (respectGitIgnore && this.shouldGitIgnoreFile(absolutePath)) {
        continue;
      }
      if (respectLlxprtIgnore && this.shouldLlxprtIgnoreFile(absolutePath)) {
        continue;
      }
      filtered.push(absolutePath);
    }

    return filtered;
  }

  /**
   * Checks if a single file should be git-ignored
   */
  shouldGitIgnoreFile(filePath: string): boolean {
    if (!this.gitIgnoreFilter) {
      return false;
    }

    const absolutePath = this.resolveAbsolutePath(filePath);
    return this.gitIgnoreFilter.isIgnored(absolutePath);
  }

  /**
   * Checks if a single file should be llxprt-ignored
   */
  shouldLlxprtIgnoreFile(filePath: string): boolean {
    if (!this.llxprtIgnoreFilter) {
      return false;
    }

    const absolutePath = this.resolveAbsolutePath(filePath);
    return this.llxprtIgnoreFilter.isIgnored(absolutePath);
  }

  /**
   * Unified method to check if a file should be ignored based on filtering options
   */
  shouldIgnoreFile(
    filePath: string,
    options: FilterFilesOptions = {},
  ): boolean {
    const { respectGitIgnore = true, respectLlxprtIgnore = true } = options;
    const absolutePath = this.resolveAbsolutePath(filePath);

    if (respectGitIgnore && this.shouldGitIgnoreFile(absolutePath)) {
      return true;
    }
    if (respectLlxprtIgnore && this.shouldLlxprtIgnoreFile(absolutePath)) {
      return true;
    }
    return false;
  }

  /**
   * Returns loaded patterns from .llxprtignore
   */
  getLlxprtIgnorePatterns(): string[] {
    return this.llxprtIgnoreFilter?.getPatterns() ?? [];
  }

  private resolveAbsolutePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      try {
        return fs.realpathSync(filePath);
      } catch (_error) {
        return path.normalize(filePath);
      }
    }

    const resolved = path.resolve(this.projectRoot, filePath);
    try {
      return fs.realpathSync(resolved);
    } catch (_error) {
      return path.normalize(resolved);
    }
  }

  private tryRealpath(p: string): string {
    try {
      return fs.realpathSync(p);
    } catch (_error) {
      return path.normalize(p);
    }
  }
}
