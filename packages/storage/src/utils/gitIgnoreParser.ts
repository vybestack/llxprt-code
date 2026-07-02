/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import ignore, { type Ignore } from 'ignore';

export type IgnoreMatchState = 'ignored' | 'unignored' | 'neutral';

export interface GitIgnoreFilter {
  isIgnored(filePath: string): boolean;
  getIgnoreState(filePath: string): IgnoreMatchState;
  getPatterns(): string[];
}

/**
 * Options controlling which ignore sources a {@link GitIgnoreParser} consults.
 *
 * `loadGitSources` controls whether Git-native ignore files are read:
 * - `true` (default): reads `.gitignore` files (including nested ones),
 *   `.git/info/exclude`, and always ignores the `.git` directory. Used for
 *   Git-based filtering.
 * - `false`: only applies the `extraPatterns` supplied to the constructor.
 *   Used for independent `.llxprtignore` filtering so it is not contaminated
 *   by Git ignore rules.
 *
 */
export interface GitIgnoreParserOptions {
  loadGitSources?: boolean;
}

/**
 * Parses Git-style ignore patterns for either Git-native sources plus optional
 * later extra patterns, or for extra patterns alone. Extra patterns can override
 * Git matches for final file decisions, but Git-native directory traversal is
 * intentionally based only on Git-native sources when discovering nested
 * `.gitignore` files.
 */
export class GitIgnoreParser implements GitIgnoreFilter {
  private projectRoot: string;
  private cache: Map<string, Ignore> = new Map();
  private globalPatterns: Ignore | undefined;
  private processedExtraPatterns: Ignore;
  private readonly loadGitSources: boolean;
  private readonly extraPatterns?: string[];

  constructor(
    projectRoot: string,
    extraPatterns?: string[],
    options: GitIgnoreParserOptions = {},
  ) {
    this.projectRoot = path.resolve(projectRoot);
    this.processedExtraPatterns = ignore();
    this.loadGitSources = options.loadGitSources ?? true;
    this.extraPatterns = extraPatterns ? [...extraPatterns] : undefined;
    if (this.extraPatterns) {
      this.processedExtraPatterns.add(
        this.processPatterns(this.extraPatterns, '.'),
      );
    }
  }

  private loadPatternsForFile(patternsFilePath: string): Ignore {
    let content: string;
    try {
      content = fs.readFileSync(patternsFilePath, 'utf-8');
    } catch {
      // File not readable; return empty ignore.
      return ignore();
    }

    // .git/info/exclude file patterns are relative to project root and not file directory
    const isExcludeFile = patternsFilePath.endsWith(
      path.join('.git', 'info', 'exclude'),
    );
    // Use posix path for patterns to preserve escaped characters (e.g., \#, \!)
    const relativeBaseDir = isExcludeFile
      ? '.'
      : path
          .dirname(path.relative(this.projectRoot, patternsFilePath))
          .split(path.sep)
          .join(path.posix.sep);

    const rawPatterns = content.split('\n');
    return ignore().add(this.processPatterns(rawPatterns, relativeBaseDir));
  }

  private processPatterns(
    rawPatterns: string[],
    relativeBaseDir: string,
  ): string[] {
    return rawPatterns
      .map((p) => p.trimStart())
      .filter((p) => p !== '' && !p.startsWith('#'))
      .flatMap((p) => {
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
        const isDirectoryPattern = p.endsWith('/');

        // An empty pattern can result from a negated pattern like `!`,
        // which we can ignore.
        if (p === '') {
          return [];
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
          if (isDirectoryPattern) {
            const directoryPatternBase = newPattern.endsWith('/')
              ? newPattern.slice(0, -1)
              : newPattern;
            const directoryPattern = `!${directoryPatternBase}/`;
            return [directoryPattern, `${directoryPattern}**`];
          }
          newPattern = '!' + newPattern;
        }

        return [newPattern];
      });
  }

  isIgnored(filePath: string): boolean {
    const context = this.resolveIgnoreContext(filePath);
    if (!context) {
      return false;
    }
    return context.ignore.ignores(context.normalizedPath);
  }

  getIgnoreState(filePath: string): IgnoreMatchState {
    const context = this.resolveIgnoreContext(filePath);
    if (!context) {
      return 'neutral';
    }

    const testResult = context.ignore.test(context.normalizedPath);
    if (testResult.ignored) return 'ignored';
    if (testResult.unignored) return 'unignored';
    return 'neutral';
  }

  private resolveIgnoreContext(
    filePath: string,
  ): { ignore: Ignore; normalizedPath: string } | null {
    if (!filePath || typeof filePath !== 'string') {
      return null;
    }

    if (
      filePath.startsWith('\\') ||
      filePath === '/' ||
      filePath.includes('\0')
    ) {
      return null;
    }

    try {
      const resolved = path.resolve(this.projectRoot, filePath);
      const relativePath = path.relative(this.projectRoot, resolved);

      if (relativePath === '' || relativePath.startsWith('..')) {
        return null;
      }

      const normalizedPath = this.toNormalizedRelativePath(relativePath);
      if (!normalizedPath) {
        return null;
      }

      return {
        ignore: this.buildIgnoreForRelativePath(relativePath),
        normalizedPath,
      };
    } catch {
      // Path resolution failed; cannot determine ignore state.
      return null;
    }
  }

  private toNormalizedRelativePath(relativePath: string): string | null {
    const normalizedPath = relativePath.replace(/\\/g, '/');
    if (normalizedPath.startsWith('/')) {
      return null;
    }
    return normalizedPath;
  }

  private buildIgnoreForRelativePath(relativePath: string): Ignore {
    const ig = ignore();

    if (this.loadGitSources) {
      this.loadGitIgnoreSources(ig, relativePath);
    }

    // Apply extra patterns (e.g. from .llxprtignore) last for precedence
    ig.add(this.processedExtraPatterns);
    return ig;
  }

  /**
   * Loads Git-native ignore sources into the provided Ignore instance:
   * the `.git` directory rule, `.git/info/exclude`, and all `.gitignore`
   * files along the path's ancestor directories.
   */
  private loadGitIgnoreSources(ig: Ignore, relativePath: string): void {
    ig.add('.git');

    if (this.globalPatterns === undefined) {
      const excludeFile = path.join(
        this.projectRoot,
        '.git',
        'info',
        'exclude',
      );
      this.globalPatterns = fs.existsSync(excludeFile)
        ? this.loadPatternsForFile(excludeFile)
        : ignore();
    }
    ig.add(this.globalPatterns);

    const pathParts = relativePath.split(path.sep);

    const dirsToVisit = [this.projectRoot];
    let currentAbsDir = this.projectRoot;
    for (let i = 0; i < pathParts.length - 1; i++) {
      currentAbsDir = path.join(currentAbsDir, pathParts[i]);
      dirsToVisit.push(currentAbsDir);
    }

    for (const dir of dirsToVisit) {
      const relativeDir = path.relative(this.projectRoot, dir);
      if (relativeDir && this.isDirIgnoredByAncestor(relativeDir, ig)) {
        break;
      }
      this.applyDirGitignore(dir, ig);
    }
  }

  private isDirIgnoredByAncestor(relativeDir: string, ig: Ignore): boolean {
    const normalizedRelativeDir = relativeDir.replace(/\\/g, '/');
    // This check intentionally uses Git-native rules only. Extra patterns are
    // applied after traversal so .llxprtignore cannot change nested .gitignore
    // discovery while still taking precedence in the final match decision.
    return ig.ignores(normalizedRelativeDir);
  }

  private applyDirGitignore(dir: string, ig: Ignore): void {
    const cached = this.cache.get(dir);
    if (cached) {
      ig.add(cached);
      return;
    }

    const gitignorePath = path.join(dir, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const patterns = this.loadPatternsForFile(gitignorePath);
      this.cache.set(dir, patterns);
      ig.add(patterns);
    } else {
      this.cache.set(dir, ignore());
    }
  }

  /**
   * Returns the explicitly added ("extra") ignore patterns.
   *
   * NOTE: Despite the generic name, this does NOT return globally loaded
   * patterns. The underlying `ignore` library does not expose its compiled
   * patterns, so global patterns cannot be enumerated here. Only the
   * `extraPatterns` supplied to the constructor are returned.
   */
  getPatterns(): string[] {
    const allPatterns: string[] = [];

    // Global patterns cannot be enumerated: the `ignore` library does not
    // expose its compiled pattern set. Intentionally omitted.

    if (this.extraPatterns) {
      allPatterns.push(...this.extraPatterns);
    }

    return allPatterns;
  }
}
