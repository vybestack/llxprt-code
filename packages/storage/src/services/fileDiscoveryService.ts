/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GitIgnoreParser } from '../utils/gitIgnoreParser.js';
import type {
  GitIgnoreFilter,
  IgnoreMatchState,
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
  private llxprtIgnoreFilter: GitIgnoreFilter;
  private projectRoot: string;

  constructor(projectRoot: string) {
    const absoluteRoot = path.resolve(projectRoot);
    this.projectRoot = this.tryRealpath(absoluteRoot);
    const gitRootCandidate = findGitRoot(this.projectRoot);
    const resolvedGitRoot = gitRootCandidate
      ? this.tryRealpath(gitRootCandidate)
      : null;

    // Read .llxprtignore patterns for the dedicated LLxprt ignore filter.
    const llxprtPatterns = this.readIgnorePatterns(
      path.join(this.projectRoot, LLXPRT_IGNORE_FILE_NAME),
    );

    if (resolvedGitRoot) {
      // GitIgnoreParser lazily discovers .gitignore patterns on isIgnored()
      this.gitIgnoreFilter = new GitIgnoreParser(resolvedGitRoot);
    }

    // Dedicated .llxprtignore filter. Only consults .llxprtignore patterns
    // (loadGitSources: false) so it is independent of .gitignore rules.
    this.llxprtIgnoreFilter = new GitIgnoreParser(
      this.projectRoot,
      llxprtPatterns,
      { loadGitSources: false },
    );
  }

  /**
   * Filters a list of file paths based on the requested ignore sources.
   */
  filterFiles(
    filePaths: string[],
    options: FilterFilesOptions = {
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    },
  ): string[] {
    return filePaths.filter(
      (filePath) => !this.isFileIgnored(filePath, options),
    );
  }

  /**
   * Filters a list of file paths based on the requested ignore sources and
   * returns a report with counts of ignored files.
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
    const absolutePath = this.resolveAbsolutePath(filePath);
    return this.llxprtIgnoreFilter.isIgnored(absolutePath);
  }

  /**
   * Unified method to check if a file should be ignored based on filtering
   * options. This is the single central decision path used by both
   * {@link filterFiles} and {@link shouldIgnoreFile}.
   *
   * When both `respectGitIgnore` and `respectLlxprtIgnore` are true, the
   * `.llxprtignore` and `.gitignore` filters are evaluated together so that
   * `.llxprtignore` negations can un-ignore files that `.gitignore` would
   * exclude. When only one flag is true, only that filter source is consulted,
   * preserving independence.
   */
  shouldIgnoreFile(
    filePath: string,
    options: FilterFilesOptions = {},
  ): boolean {
    return this.isFileIgnored(filePath, options);
  }

  /**
   * Central ignore decision shared by {@link filterFiles} and
   * {@link shouldIgnoreFile}. Ensures both code paths apply identical
   * semantics for every combination of respect flags.
   */
  private isFileIgnored(
    filePath: string,
    options: FilterFilesOptions,
  ): boolean {
    const { respectGitIgnore = true, respectLlxprtIgnore = true } = options;

    if (!respectGitIgnore && !respectLlxprtIgnore) {
      return false;
    }

    const absolutePath = this.resolveAbsolutePath(filePath);

    if (respectGitIgnore && respectLlxprtIgnore) {
      return this.isIgnoredByCombinedFilters(absolutePath);
    }

    if (respectGitIgnore && this.isGitIgnored(absolutePath)) {
      return true;
    }
    if (
      respectLlxprtIgnore &&
      this.llxprtIgnoreFilter.isIgnored(absolutePath)
    ) {
      return true;
    }
    return false;
  }

  private isIgnoredByCombinedFilters(absolutePath: string): boolean {
    const llxprtState = this.llxprtIgnoreFilter.getIgnoreState(absolutePath);
    const gitIgnored = this.isGitIgnored(absolutePath);
    return this.resolveCombinedIgnoreState(llxprtState, gitIgnored);
  }

  private isGitIgnored(absolutePath: string): boolean {
    return this.gitIgnoreFilter?.isIgnored(absolutePath) ?? false;
  }

  private resolveCombinedIgnoreState(
    llxprtState: IgnoreMatchState,
    gitIgnored: boolean,
  ): boolean {
    if (llxprtState === 'ignored') {
      return true;
    }
    if (llxprtState === 'unignored') {
      return false;
    }
    return gitIgnored;
  }

  /**
   * Returns loaded patterns from .llxprtignore
   */
  getLlxprtIgnorePatterns(): string[] {
    return this.llxprtIgnoreFilter.getPatterns();
  }

  private resolveAbsolutePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      try {
        return fs.realpathSync(filePath);
      } catch {
        // Path doesn't exist; return normalized path.
        return path.normalize(filePath);
      }
    }

    const resolved = path.resolve(this.projectRoot, filePath);
    try {
      return fs.realpathSync(resolved);
    } catch {
      // Path doesn't exist; return normalized path.
      return path.normalize(resolved);
    }
  }

  private readIgnorePatterns(filePath: string): string[] {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim() !== '' && !line.startsWith('#'));
    } catch {
      // File doesn't exist or can't be read; return empty patterns.
      return [];
    }
  }

  private tryRealpath(p: string): string {
    try {
      return fs.realpathSync(p);
    } catch {
      // Path doesn't exist; return normalized path.
      return path.normalize(p);
    }
  }
}
