/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import ignore, {
  type Ignore as IgnoreResult,
  type Options as IgnoreOptions,
} from 'ignore';
import { isGitRepository } from './gitUtils.js';

export interface GitIgnoreFilter {
  isIgnored(filePath: string): boolean;
  getPatterns(): string[];
}

const createIgnore = ignore as unknown as (
  options?: IgnoreOptions,
) => IgnoreResult;

export class GitIgnoreParser implements GitIgnoreFilter {
  private projectRoot: string;
  private ig: IgnoreResult = createIgnore();
  private patterns: string[] = [];

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  loadGitRepoPatterns(): void {
    if (!isGitRepository(this.projectRoot)) return;

    // Always ignore .git directory regardless of .gitignore content
    this.addPatterns(['.git']);

    this.loadPatterns(path.join('.git', 'info', 'exclude'));
    const visitedPaths = new Set<string>();
    this.findAndLoadGitignoreFiles(this.projectRoot, visitedPaths);
  }

  private findAndLoadGitignoreFiles(
    dir: string,
    visitedPaths: Set<string>,
  ): void {
    let resolvedDir: string;
    try {
      resolvedDir = fs.realpathSync(dir);
    } catch (_error) {
      return;
    }

    if (visitedPaths.has(resolvedDir)) {
      return;
    }
    visitedPaths.add(resolvedDir);

    const relativeDir = path.relative(this.projectRoot, dir);

    // For sub-directories, check if they are ignored before proceeding.
    // The root directory (relativeDir === '') should not be checked.
    if (relativeDir && this.isIgnored(relativeDir)) {
      return;
    }

    // Load patterns from .gitignore in the current directory
    const gitignorePath = path.join(dir, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      this.loadPatterns(path.relative(this.projectRoot, gitignorePath));
    }

    // Recurse into subdirectories
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.git') {
          continue;
        }
        if (entry.isDirectory()) {
          this.findAndLoadGitignoreFiles(
            path.join(dir, entry.name),
            visitedPaths,
          );
        }
      }
    } catch (_error) {
      // ignore readdir errors
    }
  }

  loadPatterns(patternsFileName: string): void {
    const patternsFilePath = path.join(this.projectRoot, patternsFileName);
    let content: string;
    try {
      content = fs.readFileSync(patternsFilePath, 'utf-8');
    } catch (_error) {
      // ignore file not found
      return;
    }

    // .git/info/exclude file patterns are relative to project root and not file directory
    const isExcludeFile =
      patternsFileName.replace(/\\/g, '/') === '.git/info/exclude';
    // Use posix path for patterns to preserve escaped characters (e.g., \#, \!)
    const relativeBaseDir = isExcludeFile
      ? '.'
      : path.dirname(patternsFileName).split(path.sep).join(path.posix.sep);

    const patterns = (content ?? '')
      .split('\n')
      .map((p) => p.trimStart())
      .filter((p) => p !== '' && !p.startsWith('#'))
      .map((p) => {
        // Handle escaped special chars at the start: \! or \#
        // These mean the pattern literally starts with ! or #
        const isEscapedHash = p.startsWith('\\#');
        const isEscapedBang = p.startsWith('\\!');
        if (isEscapedHash || isEscapedBang) {
          p = p.substring(1); // Remove the backslash, keep the special char
        }

        const isNegative = !isEscapedBang && p.startsWith('!');
        if (isNegative) {
          p = p.substring(1);
        }

        const isAnchoredInFile = p.startsWith('/');
        if (isAnchoredInFile) {
          p = p.substring(1);
        }

        // An empty pattern can result from a negated pattern like `!`,
        // which we can ignore.
        if (p === '') {
          return '';
        }

        let newPattern = p;
        if (relativeBaseDir && relativeBaseDir !== '.') {
          // Only in nested .gitignore files, the patterns need to be modified according to:
          // - If `a/b/.gitignore` defines `/c` then it needs to be changed to `/a/b/c`
          // - If `a/b/.gitignore` defines `c` then it needs to be changed to `/a/b/**/c`
          // - If `a/b/.gitignore` defines `c/d` then it needs to be changed to `/a/b/c/d`

          if (!isAnchoredInFile && !p.includes('/')) {
            // If no slash and not anchored in file, it matches files in any
            // subdirectory.
            newPattern = path.posix.join('**', p);
          }

          // Prepend the .gitignore file's directory.
          newPattern = path.posix.join(relativeBaseDir, newPattern);

          // Anchor the pattern to a nested gitignore directory.
          if (!newPattern.startsWith('/')) {
            newPattern = '/' + newPattern;
          }
        }

        // Anchor the pattern if originally anchored
        if (isAnchoredInFile && !newPattern.startsWith('/')) {
          newPattern = '/' + newPattern;
        }

        if (isNegative) {
          newPattern = '!' + newPattern;
        }

        return newPattern;
      })
      .filter((p) => p !== '');
    this.addPatterns(patterns);
  }

  private addPatterns(patterns: string[]) {
    this.ig.add(patterns);
    this.patterns.push(...patterns);
  }

  isIgnored(filePath: string): boolean {
    if (!filePath || typeof filePath !== 'string') {
      return false;
    }

    if (
      filePath.startsWith('\\') ||
      filePath === '/' ||
      filePath.includes('\0')
    ) {
      return false;
    }

    try {
      const resolved = path.resolve(this.projectRoot, filePath);
      const relativePath = path.relative(this.projectRoot, resolved);

      if (relativePath === '' || relativePath.startsWith('..')) {
        return false;
      }

      // Even in windows, Ignore expects forward slashes.
      const normalizedPath = relativePath.replace(/\\/g, '/');

      if (normalizedPath.startsWith('/') || normalizedPath === '') {
        return false;
      }

      return this.ig.ignores(normalizedPath);
    } catch (_error) {
      return false;
    }
  }

  getPatterns(): string[] {
    return this.patterns;
  }
}
