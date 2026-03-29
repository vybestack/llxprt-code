/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cross-file relationship analyzer for symbol indexing and reference tracking.
 */

import { promises as fsPromises, accessSync } from 'fs';
import * as path from 'path';
import { findInFiles, type Lang } from '@ast-grep/napi';
import FastGlob from 'fast-glob';
import { DebugLogger } from '../../debug/index.js';
import { LANGUAGE_MAP } from '../../utils/ast-grep-utils.js';
import type { SymbolReference } from './types.js';
import { ASTConfig } from './ast-config.js';
import { ASTQueryExtractor } from './ast-query-extractor.js';
import { detectLanguage, extractImports } from './language-analysis.js';

const logger = new DebugLogger('llxprt:tools:ast-edit:cross-file-analyzer');

/**
 * Discovers workspace files for symbol indexing using fast-glob.
 * @param workspaceRoot - The root directory to search
 * @returns Array of absolute file paths
 */
export async function getWorkspaceFiles(
  workspaceRoot: string,
): Promise<string[]> {
  // Cross-platform workspace file collection using fast-glob
  try {
    const patterns = ['**/*.ts', '**/*.js', '**/*.py'];
    const files = await FastGlob(patterns, {
      cwd: workspaceRoot,
      absolute: true,
      onlyFiles: true,
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
    });
    return files.filter((file) => file.length > 0);
  } catch (error) {
    logger.error(`Error discovering workspace files`, error);
    return [];
  }
}

/**
 * Analyzes cross-file relationships for symbol tracking and import graph building.
 */
export class CrossFileRelationshipAnalyzer {
  private symbolIndex: Map<string, SymbolReference[]> = new Map();

  /**
   * @deprecated Symbol indexing is disabled by default due to performance issues.
   * [CCR] Reason: Prefer on-demand queryViaFindInFiles to avoid OOM in large workspaces.
   */
  async buildSymbolIndex(files: string[]): Promise<void> {
    if (!ASTConfig.ENABLE_SYMBOL_INDEXING) {
      return;
    }
    this.symbolIndex.clear();

    for (const filePath of files) {
      try {
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const extractor = new ASTQueryExtractor();
        const declarations = await extractor.extractDeclarations(
          filePath,
          content,
        );
        const imports = extractImports(content, detectLanguage(filePath));

        // Build symbol index
        for (const decl of declarations) {
          if (!this.symbolIndex.has(decl.name)) {
            this.symbolIndex.set(decl.name, []);
          }

          this.symbolIndex.get(decl.name)!.push({
            type: 'definition',
            filePath,
            line: decl.line,
            column: decl.column,
          });
        }

        // Build import relationships
        for (const imp of imports) {
          for (const item of imp.items) {
            if (!this.symbolIndex.has(item)) {
              this.symbolIndex.set(item, []);
            }

            this.symbolIndex.get(item)!.push({
              type: 'import',
              filePath,
              line: imp.line,
              column: 0, // Default column for imports
              sourceModule: imp.module,
            });
          }
        }
      } catch (_error) {
        // Ignore read errors
      }
    }
  }

  /**
   * Find related symbols using ast-grep's findInFiles with strict concurrency and quantity limits.
   * [CCR] Relation: Core logic for 'Lazy' context gathering.
   * Reason: Replaces eager indexing with atomic, timed-out queries to maintain CLI speed.
   */
  async findRelatedSymbols(
    symbolName: string,
    workspacePath: string,
    lang?: Lang | string,
  ): Promise<SymbolReference[]> {
    const references: SymbolReference[] = [];

    // Helper for timeout
    const withTimeout = (promise: Promise<void>, ms: number) => {
      let timeoutId: NodeJS.Timeout;
      const timeoutPromise = new Promise<void>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Timeout after ${ms}ms`));
        }, ms);
      });
      return Promise.race([promise, timeoutPromise]).finally(() => {
        clearTimeout(timeoutId);
      });
    };

    try {
      let workspaceTooLarge = false;

      const queryPromise = (async (): Promise<void> => {
        if (lang) {
          await new Promise<void>((resolve) => {
            findInFiles(
              lang,
              {
                paths: [workspacePath],
                matcher: { rule: { pattern: symbolName } },
              },
              (err, matches) => {
                if (err || !matches) {
                  resolve();
                  return;
                }
                // Limit results per symbol
                matches
                  .slice(0, ASTConfig.MAX_RESULTS_PER_SYMBOL)
                  .forEach((m) => {
                    const range = m.range();
                    references.push({
                      type: 'reference',
                      filePath: m.getRoot().filename(),
                      line: range.start.line + 1,
                      column: range.start.column,
                    });
                  });
                resolve();
              },
            ).catch(() => resolve());
          });
        } else {
          const filesByLanguage = new Map<string | Lang, Set<string>>();

          const files = await FastGlob(
            Object.keys(LANGUAGE_MAP).map((ext) => `**/*.${ext}`),
            {
              cwd: workspacePath,
              absolute: true,
              onlyFiles: true,
              ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
            },
          );

          // [CCR] Relation: Workspace size guard.
          // Reason: Prevent OOM in very large monorepos by aborting if file count exceeds limit.
          if (files.length > ASTConfig.MAX_WORKSPACE_FILES) {
            logger.warn(
              `Workspace has ${files.length} files, exceeding limit of ${ASTConfig.MAX_WORKSPACE_FILES}. Skipping cross-file symbol search for ${symbolName}.`,
            );
            workspaceTooLarge = true;
            return;
          }

          for (const file of files) {
            const extension = path.extname(file).substring(1);
            const fileLang = LANGUAGE_MAP[extension];
            if (fileLang) {
              if (!filesByLanguage.has(fileLang)) {
                filesByLanguage.set(fileLang, new Set());
              }
              filesByLanguage.get(fileLang)!.add(file);
            }
          }

          const promises: Array<Promise<void>> = [];
          for (const [searchLang, searchFiles] of filesByLanguage) {
            const promise = new Promise<void>((resolve) => {
              findInFiles(
                searchLang,
                {
                  paths: Array.from(searchFiles),
                  matcher: { rule: { pattern: symbolName } },
                },
                (err, matches) => {
                  if (err || !matches) {
                    resolve();
                    return;
                  }
                  matches
                    .slice(0, ASTConfig.MAX_RESULTS_PER_SYMBOL)
                    .forEach((m) => {
                      const range = m.range();
                      references.push({
                        type: 'reference',
                        filePath: m.getRoot().filename(),
                        line: range.start.line + 1,
                        column: range.start.column,
                      });
                    });
                  resolve();
                },
              ).catch(() => resolve());
            });
            promises.push(promise);
          }
          await Promise.all(promises);
          if (references.length > ASTConfig.MAX_RESULTS_PER_SYMBOL) {
            references.length = ASTConfig.MAX_RESULTS_PER_SYMBOL;
          }
        }
      })();

      await withTimeout(queryPromise, ASTConfig.FIND_RELATED_TIMEOUT_MS);

      if (workspaceTooLarge) return [];
      if (references.length > 0) return references;
    } catch (error) {
      logger.warn(
        `findRelatedSymbols failed or timed out for symbol '${symbolName}' in workspace '${workspacePath}' (lang: ${lang || 'mixed'})`,
        error,
      );
    }

    // Fallback to in-memory symbol index only if explicitly enabled
    if (ASTConfig.ENABLE_SYMBOL_INDEXING) {
      return this.symbolIndex.get(symbolName) || [];
    }
    return [];
  }

  async findRelatedFiles(filePath: string): Promise<string[]> {
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const imports = extractImports(content, detectLanguage(filePath));

      const relatedFiles = new Set<string>();

      for (const imp of imports) {
        // Resolve relative path
        const resolvedPath = this.resolveImportPath(imp.module, filePath);
        if (resolvedPath && (await this.fileExists(resolvedPath))) {
          relatedFiles.add(resolvedPath);
        }
      }

      return Array.from(relatedFiles);
    } catch {
      return [];
    }
  }

  private resolveImportPath(
    importModule: string,
    currentFilePath: string,
  ): string | null {
    try {
      const dir = path.dirname(currentFilePath);
      const resolved = path.resolve(dir, importModule);

      // If the import already has an extension that exists, use it directly
      if (path.extname(resolved) && this.fileExistsSync(resolved)) {
        return resolved;
      }

      // Try common extensions
      const extensions = ['.ts', '.js', '.tsx', '.jsx'];
      for (const ext of extensions) {
        const withExt = resolved + ext;
        if (this.fileExistsSync(withExt)) {
          return withExt;
        }
      }

      // Try index files
      for (const ext of extensions) {
        const indexPath = path.join(resolved, `index${ext}`);
        if (this.fileExistsSync(indexPath)) {
          return indexPath;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fsPromises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private fileExistsSync(filePath: string): boolean {
    try {
      accessSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
