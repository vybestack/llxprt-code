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

export interface FilterReport {
  filteredPaths: string[];
  ignoredCount: number;
}

export class FileDiscoveryService {
  private gitIgnoreFilter: GitIgnoreFilter | null = null;
  private llxprtIgnoreFilter: GitIgnoreFilter | null = null;
  private combinedIgnoreFilter: GitIgnoreFilter | null = null;
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

    if (this.gitIgnoreFilter && resolvedGitRoot) {
      const llxprtPatterns = this.llxprtIgnoreFilter.getPatterns();
      // Create combined parser: .gitignore + .llxprtignore
      // Use gitRoot so .gitignore at repo root is found
      this.combinedIgnoreFilter = new GitIgnoreParser(
        resolvedGitRoot,
        llxprtPatterns,
      );
      // Load git repo patterns so isGitRepo is set correctly
      this.combinedIgnoreFilter.loadGitRepoPatterns();
    }
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
    const { respectGitIgnore = true, respectLlxprtIgnore = true } = options;
    return filePaths.filter((filePath) => {
      if (
        respectGitIgnore &&
        respectLlxprtIgnore &&
        this.combinedIgnoreFilter
      ) {
        return !this.combinedIgnoreFilter.isIgnored(filePath);
      }

      const absolutePath = this.resolveAbsolutePath(filePath);
      if (respectGitIgnore && this.shouldGitIgnoreFile(absolutePath)) {
        return false;
      }
      if (respectLlxprtIgnore && this.shouldLlxprtIgnoreFile(absolutePath)) {
        return false;
      }
      return true;
    });
  }

  /**
   * Filters a list of file paths based on git ignore rules and returns a report
   * with counts of ignored files.
   */
  filterFilesWithReport(
    filePaths: string[],
    opts: FilterFilesOptions = {
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    },
  ): FilterReport {
    const filteredPaths = this.filterFiles(filePaths, opts);
    const ignoredCount = filePaths.length - filteredPaths.length;

    return {
      filteredPaths,
      ignoredCount,
    };
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
