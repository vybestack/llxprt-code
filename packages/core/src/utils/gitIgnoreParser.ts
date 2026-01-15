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
  loadGitRepoPatterns(): void;
}

// Type assertion for the ignore library
type CreateIgnoreFn = (options?: IgnoreOptions) => IgnoreResult;
const _createIgnore: CreateIgnoreFn = ignore as unknown as CreateIgnoreFn;
void _createIgnore; // Suppress unused warning - kept for type documentation

export class GitIgnoreParser implements GitIgnoreFilter {
  private projectRoot: string;
  private cache: Map<string, string[]> = new Map();
  private globalPatterns: string[] | undefined;
  private processedExtraPatterns: string[] = [];
  private patterns: string[] = [];
  private isGitRepo: boolean = false;

  constructor(
    projectRoot: string,
    private readonly extraPatterns?: string[],
  ) {
    this.projectRoot = path.resolve(projectRoot);
    if (this.extraPatterns) {
      // extraPatterns are assumed to be from project root (like .geminiignore)
      this.processedExtraPatterns = this.processPatterns(
        this.extraPatterns,
        '.',
      );
    }
  }

  loadGitRepoPatterns(): void {
    if (!isGitRepository(this.projectRoot)) return;

    this.isGitRepo = true;

    // Always ignore .git directory regardless of .gitignore content
    this.patterns.push('.git');

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

    const rawPatterns = content.split('\n');
    const patterns = this.processPatterns(rawPatterns, relativeBaseDir);
    this.patterns.push(...patterns);
  }

  private processPatterns(
    rawPatterns: string[],
    relativeBaseDir: string,
  ): string[] {
    return rawPatterns
      .map((p) => p.trimStart())
      .filter((p) => p !== '' && !p.startsWith('#'))
      .map((p) => {
        // Handle escaped special chars at the start: \! or \#
        // These mean the pattern literally starts with ! or #
        // We need to KEEP the backslash for the ignore library to interpret correctly
        // Note: Do NOT strip the backslash - ignore library needs it
        const isEscapedBang = p.startsWith('\\!');

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

      const ig = ignore();

      // Only load .gitignore patterns dynamically if this is a git repo
      if (this.isGitRepo) {
        // Always ignore .git directory when in git mode
        ig.add('.git');
        // Load global patterns from .git/info/exclude on first call
        if (this.globalPatterns === undefined) {
          const excludeFile = path.join(
            this.projectRoot,
            '.git',
            'info',
            'exclude',
          );
          this.globalPatterns = fs.existsSync(excludeFile)
            ? this.loadPatternsForFile(excludeFile)
            : [];
        }
        ig.add(this.globalPatterns);

        const pathParts = relativePath.split(path.sep);

        const dirsToVisit = [this.projectRoot];
        let currentAbsDir = this.projectRoot;
        // Collect all directories in the path
        for (let i = 0; i < pathParts.length - 1; i++) {
          currentAbsDir = path.join(currentAbsDir, pathParts[i]);
          dirsToVisit.push(currentAbsDir);
        }

        for (const dir of dirsToVisit) {
          const relativeDir = path.relative(this.projectRoot, dir);
          if (relativeDir) {
            const normalizedRelativeDir = relativeDir.replace(/\\/g, '/');
            const igPlusExtras = ignore()
              .add(ig)
              .add(this.processedExtraPatterns);
            if (igPlusExtras.ignores(normalizedRelativeDir)) {
              // This directory is ignored by an ancestor's .gitignore.
              // According to git behavior, we don't need to process this
              // directory's .gitignore, as nothing inside it can be
              // un-ignored.
              break;
            }
          }

          if (this.cache.has(dir)) {
            const patterns = this.cache.get(dir);
            if (patterns) {
              ig.add(patterns);
            }
          } else {
            const gitignorePath = path.join(dir, '.gitignore');
            if (fs.existsSync(gitignorePath)) {
              const patterns = this.loadPatternsForFile(gitignorePath);

              this.cache.set(dir, patterns);
              ig.add(patterns);
            } else {
              this.cache.set(dir, []); // Cache miss
            }
          }
        }
      }

      // Apply patterns loaded via loadPatterns() (e.g. standalone .llxprtignore)
      // These are used when this parser is for a single ignore file, not combined
      if (this.patterns.length > 0) {
        ig.add(this.patterns);
      }

      // Apply extra patterns (e.g. from .llxprtignore) LAST for precedence
      // This allows .llxprtignore to override .gitignore rules
      if (this.processedExtraPatterns.length > 0) {
        ig.add(this.processedExtraPatterns);
      }

      return ig.ignores(normalizedPath);
    } catch (_error) {
      return false;
    }
  }

  getPatterns(): string[] {
    return this.patterns;
  }

  private loadPatternsForFile(patternsFilePath: string): string[] {
    let content: string;
    try {
      content = fs.readFileSync(patternsFilePath, 'utf-8');
    } catch (_error) {
      return [];
    }

    const isExcludeFile = patternsFilePath.endsWith(
      path.join('.git', 'info', 'exclude'),
    );

    const relativeBaseDir = isExcludeFile
      ? '.'
      : path
          .dirname(path.relative(this.projectRoot, patternsFilePath))
          .split(path.sep)
          .join(path.posix.sep);

    const rawPatterns = content.split('\n');
    return this.processPatterns(rawPatterns, relativeBaseDir);
  }
}
