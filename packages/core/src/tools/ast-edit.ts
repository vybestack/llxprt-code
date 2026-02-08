/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * ## Change Log
 * - 2025-01-19: Performance Optimization (Phase 2)
 *   - Disabled eager symbol indexing by default (ENABLE_SYMBOL_INDEXING = false).
 *   - Implemented 'Lazy' on-demand `findInFiles` queries with strict limits.
 *   - Added `prioritizeSymbolsFromDeclarations` for smarter symbol selection.
 *   - Added timeout mechanism and `Promise.allSettled` for fault tolerance.
 *   - Added performance metrics logging (duration, memory delta).
 *   - Added env-based override: LLXPRT_ENABLE_SYMBOL_INDEXING.
 *   - Added MAX_WORKSPACE_FILES guard to prevent OOM in large repos.
 */

import { promises as fsPromises, existsSync, statSync } from 'fs';
import * as path from 'path';
import * as Diff from 'diff';
import {
  BaseDeclarativeTool,
  Kind,
  ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  type ToolEditConfirmationDetails,
  ToolInvocation,
  ToolLocation,
  type ToolResult,
  type FileDiff,
} from './tools.js';
import { ToolErrorType } from './tool-error.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { isNodeError } from '../utils/errors.js';
import { Config, ApprovalMode } from '../config/config.js';
import { DEFAULT_CREATE_PATCH_OPTIONS } from './diffOptions.js';
import { ModifiableDeclarativeTool, ModifyContext } from './modifiable-tool.js';
import { spawnSync } from 'child_process';
import FastGlob from 'fast-glob';
import { DebugLogger } from '../debug/index.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';

const logger = new DebugLogger('llxprt:tools:ast-edit');
import {
  parse,
  Lang,
  findInFiles,
  registerDynamicLanguage,
} from '@ast-grep/napi';

import python from '@ast-grep/lang-python';
import go from '@ast-grep/lang-go';
import rust from '@ast-grep/lang-rust';
import java from '@ast-grep/lang-java';
import cpp from '@ast-grep/lang-cpp';
import c from '@ast-grep/lang-c';
import json from '@ast-grep/lang-json';
import ruby from '@ast-grep/lang-ruby';

registerDynamicLanguage({
  python,
  go,
  rust,
  java,
  cpp,
  c,
  json,
  ruby,
} as any); // eslint-disable-line @typescript-eslint/no-explicit-any -- Required for ast-grep dynamic language registration (third-party API limitation)

// ===== Shared Language Mapping =====
/**
 * Shared language mapping for file extensions to AST language types.
 * This is the single source of truth for language mapping across all tools.
 * Must be kept in sync with ast-grep's supported languages.
 */
export const LANGUAGE_MAP: Record<string, string | Lang> = {
  ts: Lang.TypeScript,
  js: Lang.JavaScript,
  tsx: Lang.Tsx,
  jsx: Lang.Tsx,
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  html: Lang.Html,
  css: Lang.Css,
  json: 'json',
};

// ===== Language Families =====
/**
 * File extensions that belong to JavaScript/TypeScript language family.
 */
export const JAVASCRIPT_FAMILY_EXTENSIONS: readonly string[] = [
  'ts',
  'js',
  'tsx',
  'jsx',
];

// ===== Code Keywords =====
/**
 * Code keywords used for pattern matching and analysis.
 */
export const KEYWORDS = {
  FUNCTION: 'function',
  DEF: 'def',
  CLASS: 'class',
  IF: 'if',
  FOR: 'for',
  WHILE: 'while',
  RETURN: 'return',
  IMPORT: 'import ',
  FROM: 'from ',
} as const;

// ===== Comment Patterns =====
/**
 * Comment prefixes for various languages.
 */
export const COMMENT_PREFIXES = ['//', '#', '*', '/*', '*/'];

// ===== Regex Patterns =====
/**
 * Regex patterns for code analysis.
 */
export const REGEX = {
  IMPORT_MODULE: /(?:import|from)\s+['"]([^'"]+)['"]/,
  IMPORT_ITEMS: /\{([^}]+)\}/,
} as const;

// ===== Core Context Interfaces =====
interface ASTContext {
  filePath: string;
  language: string;
  fileSize: number;
  astNodes: ASTNode[];
  declarations: Declaration[];
  imports: Import[];
  relevantSnippets: CodeSnippet[];
  languageContext: {
    functions: FunctionInfo[];
    classes: ClassInfo[];
    variables: VariableInfo[];
  };
}

interface ASTNode {
  type: string;
  text: string;
  startPosition: Position;
  endPosition: Position;
  children: ASTNode[];
}

interface Declaration {
  name: string;
  type: 'function' | 'class' | 'variable' | 'import';
  line: number;
  column: number;
  signature?: string;
}

interface CodeSnippet {
  text: string;
  relevance: number;
  line: number;
  source: 'declaration' | 'changed_file' | 'recent_file' | 'search' | 'local'; // Source type
  priority: number; // Priority (1=highest, 4=lowest)
  charLength: number; // Character length
}

interface Import {
  module: string;
  items: string[];
  line: number;
}

interface FunctionInfo {
  name: string;
  parameters: string[];
  returnType: string;
  line: number;
}

interface ClassInfo {
  name: string;
  methods: string[];
  properties: string[];
  line: number;
}

interface VariableInfo {
  name: string;
  type: string;
  line: number;
}

interface Position {
  line: number;
  column: number;
}

interface SgNode {
  range(): {
    start: Position;
    end: Position;
  };
}

// ===== Enhanced Context Interfaces (Phase 1-3) =====
interface RepositoryContext {
  gitUrl: string;
  commitSha: string;
  branch: string;
  rootPath: string;
}

interface SymbolReference {
  type: 'definition' | 'reference' | 'import';
  filePath: string;
  line: number;
  column: number;
  sourceModule?: string;
}

interface FileContext {
  filePath: string;
  declarations: EnhancedDeclaration[];
  summary: string;
}

interface CrossFileContext {
  files: FileContext[];
}

interface ConnectedFile {
  filePath: string;
  declarations: EnhancedDeclaration[];
}

export interface EnhancedDeclaration extends Declaration {
  range: {
    start: Position;
    end: Position;
  };
  documentation?: string;
  visibility?: 'public' | 'private' | 'protected';
  signature?: string;
}

interface EnhancedASTContext extends ASTContext {
  declarations: EnhancedDeclaration[];
  repositoryContext?: RepositoryContext;
  relatedFiles?: string[];
  relatedSymbols?: SymbolReference[];
  crossFileContext?: CrossFileContext;
  connectedFiles?: ConnectedFile[];
}

// ===== Simplified Parameter Interfaces =====
export interface ASTEditToolParams {
  /**
   * The absolute path to the file to modify
   */
  file_path: string;

  /**
   * The text to replace
   */
  old_string: string;

  /**
   * The text to replace it with
   */
  new_string: string;

  /**
   * Force execution after preview. Default is false.
   * IMPORTANT: This tool ALWAYS operates in two steps:
   * 1. First call: Preview changes (force: false or omitted)
   * 2. Second call: Apply changes (force: true)
   */
  force?: boolean;

  /**
   * Timestamp (ms) of the file when last read.
   * If provided, the tool will verify the file hasn't been modified since this time.
   */
  last_modified?: number;
}

// ===== ReadFile Parameter Interface =====
export interface ASTReadFileToolParams {
  /**
   * The absolute path to the file to read
   */
  file_path: string;

  /**
   * The line number to start reading from (optional)
   */
  offset?: number;

  /**
   * The number of lines to read (optional)
   */
  limit?: number;
}

// ===== Phase 1: AST Query Extractor =====
class ASTQueryExtractor {
  constructor() {}

  async extractDeclarations(
    filePath: string,
    content: string,
  ): Promise<EnhancedDeclaration[]> {
    const extension = path.extname(filePath).substring(1);
    const lang = LANGUAGE_MAP[extension];
    if (!lang) {
      return this.fallbackExtraction(content, 'unknown');
    }

    try {
      const parseLang = lang;
      const root = parse(parseLang, content);
      const declarations: EnhancedDeclaration[] = [];
      const sgRoot = root.root();

      // Define extraction rules per language grouping
      if (JAVASCRIPT_FAMILY_EXTENSIONS.includes(extension)) {
        // Functions
        sgRoot
          .findAll({ rule: { kind: 'function_declaration' } })
          .forEach((n) => {
            const nameNode = n.field('name');
            const paramsNode = n.field('parameters');
            const returnTypeNode = n.field('return_type'); // Typical TS naming
            if (nameNode) {
              let signature = paramsNode ? paramsNode.text() : '()';
              if (returnTypeNode) {
                signature += returnTypeNode.text();
              }
              declarations.push(
                this.nodeToDeclaration(
                  n,
                  nameNode.text(),
                  'function',
                  signature,
                ),
              );
            }
          });

        // Methods
        sgRoot.findAll({ rule: { kind: 'method_definition' } }).forEach((n) => {
          const nameNode = n.field('name');
          const paramsNode = n.field('parameters');
          const returnTypeNode = n.field('return_type');
          if (nameNode) {
            let signature = paramsNode ? paramsNode.text() : '()';
            if (returnTypeNode) {
              signature += returnTypeNode.text();
            }
            declarations.push(
              this.nodeToDeclaration(n, nameNode.text(), 'function', signature),
            );
          }
        });

        // Classes
        sgRoot.findAll({ rule: { kind: 'class_declaration' } }).forEach((n) => {
          const nameNode = n.field('name');
          if (nameNode) {
            declarations.push(
              this.nodeToDeclaration(n, nameNode.text(), 'class'),
            );
          }
        });

        // Variables
        sgRoot
          .findAll({ rule: { kind: 'variable_declarator' } })
          .forEach((n) => {
            const nameNode = n.field('name');
            if (nameNode) {
              declarations.push(
                this.nodeToDeclaration(n, nameNode.text(), 'variable'),
              );
            }
          });

        // Imports
        sgRoot.findAll({ rule: { kind: 'import_statement' } }).forEach((n) => {
          const sourceNode = n.field('source');
          declarations.push(
            this.nodeToDeclaration(
              n,
              sourceNode ? sourceNode.text() : 'import',
              'import',
            ),
          );
        });
      } else if (extension === 'py') {
        // Python
        sgRoot
          .findAll({ rule: { kind: 'function_definition' } })
          .forEach((n) => {
            const nameNode = n.field('name');
            const paramsNode = n.field('parameters');
            const returnTypeNode = n.field('return_type');
            if (nameNode) {
              let signature = paramsNode ? paramsNode.text() : '()';
              if (returnTypeNode) {
                signature += ` -> ${returnTypeNode.text()}`;
              }
              declarations.push(
                this.nodeToDeclaration(
                  n,
                  nameNode.text(),
                  'function',
                  signature,
                ),
              );
            }
          });

        sgRoot.findAll({ rule: { kind: 'class_definition' } }).forEach((n) => {
          const nameNode = n.field('name');
          if (nameNode) {
            declarations.push(
              this.nodeToDeclaration(n, nameNode.text(), 'class'),
            );
          }
        });
      } else {
        // Fallback for other languages: just find symbols that look like declarations
        return this.fallbackExtraction(content, extension);
      }

      return declarations;
    } catch (_error) {
      return this.fallbackExtraction(content, extension);
    }
  }

  private nodeToDeclaration(
    n: SgNode,
    name: string,
    type: Declaration['type'],
    signature?: string,
  ): EnhancedDeclaration {
    const range = n.range();
    return {
      name,
      type,
      line: range.start.line + 1,
      column: range.start.column,
      range: {
        start: { line: range.start.line + 1, column: range.start.column },
        end: { line: range.end.line + 1, column: range.end.column },
      },
      visibility: 'public',
      signature,
    };
  }

  private fallbackExtraction(
    content: string,
    _language: string,
  ): EnhancedDeclaration[] {
    // Keep the regex-based fallback for robustness
    const declarations: Declaration[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const isComment = COMMENT_PREFIXES.some((prefix) =>
        trimmed.startsWith(prefix),
      );
      if (!trimmed || isComment) return;

      if (
        line.includes(KEYWORDS.FUNCTION) ||
        line.includes(KEYWORDS.DEF) ||
        line.includes(KEYWORDS.CLASS)
      ) {
        const name = this.extractNameBasic(trimmed);
        declarations.push({
          name,
          type: trimmed.includes(KEYWORDS.CLASS) ? 'class' : 'function',
          line: index + 1,
          column: line.indexOf(name),
          signature: this.extractSignatureBasic(trimmed),
        });
      }
    });

    return declarations.map((decl) => ({
      ...decl,
      range: {
        start: { line: decl.line, column: decl.column },
        end: { line: decl.line, column: decl.column + decl.name.length },
      },
      visibility: 'public',
      signature: decl.signature,
    }));
  }

  private extractNameBasic(line: string): string {
    const match = line.match(/(?:function|def|class)\s+(\w+)/);
    return match ? match[1] : 'unknown';
  }

  private extractSignatureBasic(line: string): string {
    // Try to capture parameters: ( ... )
    const match = line.match(/\(([^)]*)\)/);
    if (match) {
      return `(${match[1]})`;
    }
    return '';
  }
}

// ===== Internal Configuration =====
class ASTConfig {
  static readonly CONTEXT_DEPTH = 5;
  static readonly MAX_SNIPPETS = 10;
  static readonly ENABLE_AST_PARSING = true;
  static readonly DEFAULT_DRY_RUN = true;
  static readonly MAX_SNIPPET_CHARS = 1000; // Increased budget
  static readonly CHUNK_SIZE = 500;
  static readonly SNIPPET_TRUNCATE_LENGTH = 200;

  // Section: Performance Optimization Constants
  /**
   * Whether to build a full in-memory symbol index.
   * [CCR] Reason: Disabled by default to prevent memory leaks and CLI crashes in large repos.
   * Can be overridden via environment variable: LLXPRT_ENABLE_SYMBOL_INDEXING=true
   */
  static get ENABLE_SYMBOL_INDEXING(): boolean {
    return process.env.LLXPRT_ENABLE_SYMBOL_INDEXING === 'true';
  }
  /**
   * Maximum symbols to query across the workspace per file.
   */
  static readonly MAX_RELATED_SYMBOLS = 5;
  /**
   * Maximum results to return per symbol query.
   */
  static readonly MAX_RESULTS_PER_SYMBOL = 10;
  /**
   * Timeout for a single symbol relationship lookup.
   */
  static readonly FIND_RELATED_TIMEOUT_MS = 3000;
  /**
   * Minimum length for a symbol to be considered for cross-file lookup.
   */
  static readonly MIN_SYMBOL_LENGTH = 3;
  /**
   * Maximum workspace files to scan. Abort if exceeded to prevent OOM.
   * [CCR] Reason: Safeguard against memory exhaustion in very large monorepos.
   */
  static readonly MAX_WORKSPACE_FILES = 10000;
  /**
   * Maximum display results for related symbols in output.
   */
  static readonly MAX_DISPLAY_RESULTS = 5;

  static readonly SUPPORTED_LANGUAGES = {
    ts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    tsx: 'typescript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    html: 'html',
    css: 'css',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
  };
}

// ===== Phase 3: Repository Context Provider =====
class RepositoryContextProvider {
  async collectRepositoryContext(
    rootPath: string,
  ): Promise<RepositoryContext | null> {
    try {
      const gitUrl = await this.getGitRemoteUrl(rootPath);
      const commitSha = await this.getCurrentCommit(rootPath);
      const branch = await this.getCurrentBranch(rootPath);

      if (!gitUrl && !commitSha) {
        return null; // Not a git repo or failed to get info
      }

      return {
        gitUrl: gitUrl || 'unknown',
        commitSha: commitSha || 'unknown',
        branch: branch || 'unknown',
        rootPath,
      };
    } catch (_error) {
      return null;
    }
  }

  /**
   * Get the "Working Set" of files:
   * 1. Unstaged changes (git diff --name-only)
   * 2. Staged changes (git diff --name-only --cached)
   * 3. Recent commits (git log -n <limit> --name-only)
   */
  async getWorkingSetFiles(
    workspaceRoot: string,
    limit: number = 5,
  ): Promise<string[]> {
    const files = new Set<string>();

    try {
      const execGit = (args: string[]) => {
        const result = spawnSync('git', ['-C', workspaceRoot, ...args], {
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        return result.status === 0 ? result.stdout.trim() : '';
      };

      // 1. Unstaged changes
      execGit(['diff', '--name-only', '-z'])
        .split('\0')
        .forEach((f) => f && files.add(f));

      // 2. Staged changes
      execGit(['diff', '--name-only', '--cached', '-z'])
        .split('\0')
        .forEach((f) => f && files.add(f));

      // 3. Recent commits
      // Note: -z works with --name-only in log but we need to ensure format doesn't break it.
      // Safest is to rely on diffs for working set, but strictly following plan:
      execGit(['log', `-n${limit}`, '--name-only', '--format=', '-z'])
        .split('\0')
        .forEach((f) => f && files.add(f));
    } catch (_error) {
      // Ignore errors, return what we have
    }

    // Filter existing files and convert to absolute paths
    const validFiles: string[] = [];
    for (const file of files) {
      if (!file.trim()) continue;
      const absPath = path.resolve(workspaceRoot, file);
      try {
        await fsPromises.access(absPath);
        validFiles.push(absPath);
      } catch {
        // File might be deleted
      }
    }

    return validFiles;
  }

  private async getGitRemoteUrl(repoPath: string): Promise<string | null> {
    try {
      const result = spawnSync(
        'git',
        ['-C', repoPath, 'remote', 'get-url', 'origin'],
        { encoding: 'utf-8', stdio: 'pipe' },
      );
      return result.status === 0 ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }

  private async getCurrentCommit(repoPath: string): Promise<string | null> {
    try {
      const result = spawnSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      return result.status === 0 ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }

  private async getCurrentBranch(repoPath: string): Promise<string | null> {
    try {
      const result = spawnSync(
        'git',
        ['-C', repoPath, 'branch', '--show-current'],
        { encoding: 'utf-8', stdio: 'pipe' },
      );
      return result.status === 0 ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }
}

// ===== Cross-file Relationship Analyzer =====
class CrossFileRelationshipAnalyzer {
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
        const imports = this.extractImports(
          content,
          this.detectLanguage(filePath),
        );

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
      const imports = this.extractImports(
        content,
        this.detectLanguage(filePath),
      );

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

  private extractImports(content: string, language: string): Import[] {
    const imports: Import[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (language === 'typescript' || language === 'javascript') {
        if (trimmed.startsWith(KEYWORDS.IMPORT)) {
          imports.push({
            module: this.extractImportModule(trimmed),
            items: this.extractImportItems(trimmed),
            line: index + 1,
          });
        }
      } else if (language === 'python') {
        if (
          trimmed.startsWith(KEYWORDS.IMPORT) ||
          trimmed.startsWith(KEYWORDS.FROM)
        ) {
          imports.push({
            module: this.extractImportModule(trimmed),
            items: this.extractImportItems(trimmed),
            line: index + 1,
          });
        }
      }
    });

    return imports;
  }

  private extractImportModule(line: string): string {
    const match = line.match(REGEX.IMPORT_MODULE);
    return match ? match[1] : 'unknown';
  }

  private extractImportItems(line: string): string[] {
    const match = line.match(REGEX.IMPORT_ITEMS);
    if (match) {
      return match[1].split(',').map((item) => item.trim());
    }
    return [];
  }

  private resolveImportPath(module: string, fromFile: string): string | null {
    // Enhanced path resolution supporting multiple extensions
    if (module.startsWith('./') || module.startsWith('../')) {
      const fromDir = path.dirname(fromFile);
      const baseResolve = path.resolve(fromDir, module);

      const extensions = [
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
        '.mjs',
        '.cjs',
        '/index.ts',
        '/index.tsx',
        '/index.js',
        '/index.jsx',
      ];

      for (const ext of extensions) {
        const fullPath = baseResolve + ext;
        if (existsSync(fullPath) && statSync(fullPath).isFile()) {
          return fullPath;
        }
      }
    }
    return null;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fsPromises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private detectLanguage(filePath: string): string {
    const extension = path.extname(filePath).substring(1);
    return (
      ASTConfig.SUPPORTED_LANGUAGES[
        extension as keyof typeof ASTConfig.SUPPORTED_LANGUAGES
      ] || 'unknown'
    );
  }
}

// ===== Context Optimizer =====
class ContextOptimizer {
  /**
   * Clip prompt to fit max length limit (corresponds to AST clip_prompt)
   */
  static clipPrompt(prompt: string, maxLength: number): string {
    if (prompt.length <= maxLength) {
      return prompt;
    }

    // Clip from start, preserve newest content (AST strategy)
    let start = prompt.length - maxLength;
    while (!this.isCharBoundary(prompt, start)) {
      start += 1;
    }

    return prompt.substring(start);
  }

  /**
   * Check UTF-16 character boundary
   */
  private static isCharBoundary(str: string, index: number): boolean {
    if (index <= 0) return true;
    if (index >= str.length) return true;

    // Check for low surrogate (0xDC00–0xDFFF)
    const code = str.charCodeAt(index);
    if (code >= 0xdc00 && code <= 0xdfff) {
      // If previous character is high surrogate (0xD800–0xDBFF), this is not a boundary
      const prevCode = str.charCodeAt(index - 1);
      if (prevCode >= 0xd800 && prevCode <= 0xdbff) {
        return false;
      }
    }
    return true;
  }

  /**
   * Manage snippets by priority and budget (corresponds to AST snippet collection)
   */
  static optimizeSnippets(
    snippets: CodeSnippet[],
    maxChars: number = ASTConfig.MAX_SNIPPET_CHARS,
  ): CodeSnippet[] {
    // 1. Sort by priority and relevance
    const sortedSnippets = [...snippets].sort((a, b) => {
      // Higher priority first
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // Same priority, sort by relevance
      return b.relevance - a.relevance;
    });

    // 2. Select snippets within budget
    const optimizedSnippets: CodeSnippet[] = [];
    let usedChars = 0;

    for (const snippet of sortedSnippets) {
      const truncatedSnippet = this.truncateSnippet(snippet);

      if (usedChars + truncatedSnippet.charLength > maxChars) {
        break; // Budget exhausted
      }

      optimizedSnippets.push(truncatedSnippet);
      usedChars += truncatedSnippet.charLength;
    }

    return optimizedSnippets;
  }

  /**
   * Truncate overly long snippets
   */
  static truncateSnippet(snippet: CodeSnippet): CodeSnippet {
    if (snippet.text.length <= ASTConfig.SNIPPET_TRUNCATE_LENGTH) {
      return snippet;
    }

    return {
      ...snippet,
      text:
        snippet.text.substring(0, ASTConfig.SNIPPET_TRUNCATE_LENGTH) + '...',
      charLength: ASTConfig.SNIPPET_TRUNCATE_LENGTH + 3,
    };
  }
}

// ===== Context Collector =====
class ASTContextCollector {
  private astExtractor: ASTQueryExtractor;
  private repoProvider: RepositoryContextProvider;
  private relationshipAnalyzer: CrossFileRelationshipAnalyzer;

  constructor() {
    this.astExtractor = new ASTQueryExtractor();
    this.repoProvider = new RepositoryContextProvider();
    this.relationshipAnalyzer = new CrossFileRelationshipAnalyzer();
  }

  async collectContext(filePath: string, content: string): Promise<ASTContext> {
    const language = this.detectLanguage(filePath);

    return {
      filePath,
      language,
      fileSize: content.length,
      astNodes: await this.parseAST(content, language),
      declarations: await this.astExtractor.extractDeclarations(
        filePath,
        content,
      ),
      imports: this.extractImports(content, language),
      relevantSnippets: this.collectSnippets(content),
      languageContext: this.buildLanguageContext(content, language),
    };
  }

  async collectEnhancedContext(
    targetFilePath: string,
    content: string,
    workspaceRoot: string,
  ): Promise<EnhancedASTContext> {
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    // Base context
    const baseContext = await this.collectContext(targetFilePath, content);

    const enhancedContext: EnhancedASTContext = {
      ...baseContext,
      declarations: baseContext.declarations as EnhancedDeclaration[],
      connectedFiles: [],
    };

    // Phase 1: AST enhanced parsing
    if (ASTConfig.ENABLE_AST_PARSING) {
      const enhancedDeclarations = await this.astExtractor.extractDeclarations(
        targetFilePath,
        content,
      );
      enhancedContext.declarations = enhancedDeclarations;
    }

    // Context optimization
    enhancedContext.relevantSnippets = this.optimizeContextCollection(
      enhancedContext.declarations,
      content,
      workspaceRoot,
    );

    // Phase 2: Working Set Context (Git-based)
    // Replace BM25 search with working set file declarations
    const workingSetFiles =
      await this.repoProvider.getWorkingSetFiles(workspaceRoot);

    // Filter out current file
    const otherFiles = workingSetFiles.filter((f) => f !== targetFilePath);

    for (const filePath of otherFiles) {
      try {
        const fileContent = await fsPromises.readFile(filePath, 'utf-8');
        // Skeleton View: only extract declarations, not full code
        const declarations = await this.astExtractor.extractDeclarations(
          filePath,
          fileContent,
        );

        enhancedContext.connectedFiles?.push({
          filePath,
          declarations,
        });
      } catch {
        // Ignore read errors
      }
    }

    // Phase 3: Repository context and Cross-file Relationships
    const repoContext =
      await this.repoProvider.collectRepositoryContext(workspaceRoot);
    enhancedContext.repositoryContext = repoContext || undefined;

    // [CCR] Relation: Cross-file relationship analysis segment.
    // Reason: Optimized to use on-demand findInFiles instead of eager indexing.
    if (repoContext) {
      if (ASTConfig.ENABLE_SYMBOL_INDEXING) {
        const workspaceFiles = await this.getWorkspaceFiles(workspaceRoot);
        await this.relationshipAnalyzer.buildSymbolIndex(workspaceFiles);

        const relatedFiles =
          await this.relationshipAnalyzer.findRelatedFiles(targetFilePath);
        enhancedContext.relatedFiles = relatedFiles;
      }

      // Prioritize symbols for Lazy search
      const topSymbols = this.prioritizeSymbolsFromDeclarations(
        enhancedContext.declarations,
      );

      // Execute atomic queries with strict limits and Survivability (Promise.allSettled)
      const relatedSymbolsTasks = topSymbols.map((symbol) =>
        this.relationshipAnalyzer.findRelatedSymbols(symbol, workspaceRoot),
      );

      const relatedSymbolsResults =
        await Promise.allSettled(relatedSymbolsTasks);
      enhancedContext.relatedSymbols = relatedSymbolsResults
        .filter(
          (r): r is PromiseFulfilledResult<SymbolReference[]> =>
            r.status === 'fulfilled',
        )
        .map((r) => r.value)
        .flat();
    }

    const duration = Date.now() - startTime;
    const memoryDelta =
      (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024;
    logger.debug(
      `collectEnhancedContext Metrics: ${duration}ms, Delta: ${memoryDelta.toFixed(2)}MB, Symbols: ${enhancedContext.relatedSymbols?.length || 0}`,
    );

    return enhancedContext;
  }

  /**
   * Prioritize important symbols from declarations for lazy cross-file lookups.
   * [CCR] Reason: Prevents querying low-value symbols (like parameters or local vars) to preserve I/O.
   */
  private prioritizeSymbolsFromDeclarations(
    declarations: EnhancedDeclaration[],
  ): string[] {
    const scores = new Map<string, number>();

    for (const decl of declarations) {
      if (decl.name.length < ASTConfig.MIN_SYMBOL_LENGTH) continue;

      let score = 0;
      if (decl.type === 'class') score += 10;
      if (decl.type === 'function') score += 5;
      if (decl.visibility === 'public') score += 3;

      scores.set(decl.name, (scores.get(decl.name) || 0) + score);
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)
      .slice(0, ASTConfig.MAX_RELATED_SYMBOLS);
  }

  private detectLanguage(filePath: string): string {
    const extension = path.extname(filePath).substring(1);
    return (
      ASTConfig.SUPPORTED_LANGUAGES[
        extension as keyof typeof ASTConfig.SUPPORTED_LANGUAGES
      ] || 'unknown'
    );
  }

  private async parseAST(
    content: string,
    language: string,
  ): Promise<ASTNode[]> {
    if (!ASTConfig.ENABLE_AST_PARSING || language === 'unknown') {
      return [];
    }

    // Use existing validateASTSyntax logic for basic parsing
    return this.extractASTNodes(content, language);
  }

  private extractASTNodes(content: string, language: string): ASTNode[] {
    // Simplified AST node extraction
    const nodes: ASTNode[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      if (this.isSignificantLine(line, language)) {
        nodes.push({
          type: this.inferNodeType(line, language),
          text: line.trim(),
          startPosition: { line: index + 1, column: 0 },
          endPosition: { line: index + 1, column: line.length },
          children: [],
        });
      }
    });

    return nodes;
  }

  private extractImports(content: string, language: string): Import[] {
    const imports: Import[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (language === 'typescript' || language === 'javascript') {
        if (trimmed.startsWith(KEYWORDS.IMPORT)) {
          imports.push({
            module: this.extractImportModule(trimmed),
            items: this.extractImportItems(trimmed),
            line: index + 1,
          });
        }
      } else if (language === 'python') {
        if (
          trimmed.startsWith(KEYWORDS.IMPORT) ||
          trimmed.startsWith(KEYWORDS.FROM)
        ) {
          imports.push({
            module: this.extractImportModule(trimmed),
            items: this.extractImportItems(trimmed),
            line: index + 1,
          });
        }
      }
    });

    return imports;
  }

  private collectSnippets(content: string): CodeSnippet[] {
    const snippets: CodeSnippet[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const isComment = COMMENT_PREFIXES.some((prefix) =>
        trimmed.startsWith(prefix),
      );
      if (trimmed.length > 10 && !isComment) {
        snippets.push({
          text: trimmed,
          relevance: this.calculateRelevance(trimmed),
          line: index + 1,
          source: 'local',
          priority: 3,
          charLength: trimmed.length,
        });
      }
    });

    return snippets
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, ASTConfig.MAX_SNIPPETS);
  }

  private buildLanguageContext(
    content: string,
    language: string,
  ): ASTContext['languageContext'] {
    return {
      functions: this.extractFunctions(content, language),
      classes: this.extractClasses(content, language),
      variables: this.extractVariables(content, language),
    };
  }

  // Helper methods
  private isSignificantLine(line: string, _language: string): boolean {
    const trimmed = line.trim();
    const isComment =
      trimmed.startsWith('//') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*/');
    return trimmed.length > 0 && !isComment;
  }

  private inferNodeType(line: string, _language: string): string {
    const trimmed = line.trim();
    if (trimmed.includes(KEYWORDS.FUNCTION) || trimmed.includes(KEYWORDS.DEF))
      return 'function';
    if (trimmed.includes(KEYWORDS.CLASS)) return 'class';
    if (
      trimmed.includes(KEYWORDS.IF) ||
      trimmed.includes(KEYWORDS.FOR) ||
      trimmed.includes(KEYWORDS.WHILE)
    )
      return 'control';
    if (trimmed.includes(KEYWORDS.RETURN)) return 'return';
    return 'statement';
  }

  private extractImportModule(line: string): string {
    const match = line.match(REGEX.IMPORT_MODULE);
    return match ? match[1] : 'unknown';
  }

  private extractImportItems(line: string): string[] {
    const match = line.match(REGEX.IMPORT_ITEMS);
    if (match) {
      return match[1].split(',').map((item) => item.trim());
    }
    return [];
  }

  private calculateRelevance(line: string): number {
    let relevance = 1;
    if (line.includes(KEYWORDS.FUNCTION) || line.includes(KEYWORDS.DEF))
      relevance += 3;
    if (line.includes(KEYWORDS.CLASS)) relevance += 2;
    if (line.includes(KEYWORDS.RETURN)) relevance += 1;
    if (line.length > 50) relevance += 1;
    return relevance;
  }

  private extractFunctions(content: string, _language: string): FunctionInfo[] {
    const functions: FunctionInfo[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (_language === 'typescript' || _language === 'javascript') {
        const match = trimmed.match(/function\s+(\w+)\s*\(([^)]*)\):\s*(\w+)/);
        if (match) {
          functions.push({
            name: match[1],
            parameters: match[2]
              .split(',')
              .map((p) => p.trim())
              .filter((p) => p),
            returnType: match[3],
            line: index + 1,
          });
        }
      } else if (_language === 'python') {
        const match = trimmed.match(
          /def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\w+))?/,
        );
        if (match) {
          functions.push({
            name: match[1],
            parameters: match[2]
              .split(',')
              .map((p) => p.trim())
              .filter((p) => p),
            returnType: match[3] || 'unknown',
            line: index + 1,
          });
        }
      }
    });

    return functions;
  }

  private extractClasses(content: string, _language: string): ClassInfo[] {
    const classes: ClassInfo[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.includes(KEYWORDS.CLASS)) {
        const match = trimmed.match(/class\s+(\w+)/);
        if (match) {
          classes.push({
            name: match[1],
            methods: [], // Simplified implementation
            properties: [], // Simplified implementation
            line: index + 1,
          });
        }
      }
    });

    return classes;
  }

  private extractVariables(content: string, _language: string): VariableInfo[] {
    const variables: VariableInfo[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (_language === 'typescript' || _language === 'javascript') {
        const match = trimmed.match(/(?:const|let|var)\s+(\w+)\s*:\s*(\w+)/);
        if (match) {
          variables.push({
            name: match[1],
            type: match[2],
            line: index + 1,
          });
        }
      }
    });

    return variables;
  }

  // ===== Enhanced Functionality Helper Methods =====

  private optimizeContextCollection(
    declarations: Declaration[],
    content: string,
    _workspaceRoot: string,
  ): CodeSnippet[] {
    const allSnippets: CodeSnippet[] = [];

    // Collect declaration snippets (highest priority)
    for (const decl of declarations) {
      allSnippets.push({
        text: `${decl.type}: ${decl.name}`,
        relevance: 5,
        line: decl.line,
        source: 'declaration',
        priority: 1,
        charLength: decl.name.length + decl.type.length + 2,
      });
    }

    // Collect local snippets
    const localSnippets = this.collectSnippets(content);
    allSnippets.push(
      ...localSnippets.map((snippet) => ({
        ...snippet,
        source: 'local' as const,
        priority: 2,
        charLength: snippet.text.length,
      })),
    );

    return ContextOptimizer.optimizeSnippets(allSnippets);
  }

  private async getWorkspaceFiles(workspaceRoot: string): Promise<string[]> {
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
}

// ===== ASTEdit Tool Implementation =====
export class ASTEditTool
  extends BaseDeclarativeTool<ASTEditToolParams, ToolResult>
  implements ModifiableDeclarativeTool<ASTEditToolParams>
{
  static readonly Name = 'ast_edit';
  private contextCollector: ASTContextCollector;

  static applyReplacement(
    currentContent: string | null,
    oldString: string,
    newString: string,
    isNewFile: boolean,
  ): string {
    if (isNewFile) {
      return newString;
    }
    if (currentContent === null) {
      return oldString === '' ? newString : '';
    }
    if (oldString === '' && !isNewFile) {
      return currentContent;
    }

    // For single replacement, use replace() instead of replaceAll()
    return currentContent.replace(oldString, newString);
  }

  constructor(private readonly config: Config) {
    super(
      ASTEditTool.Name,
      'ASTEdit',
      `Enhanced edit tool with intelligent context awareness. Performs precise text replacement with validation.

      Replaces exact text matches in files with comprehensive analysis:
      - AST syntax validation and structure analysis
      - Context-aware suggestions and related code
      - File freshness and safety checks
      - Preview before applying changes

      **Parameters:**
      - file_path: Absolute path to the file to modify
      - old_string: Text to replace (must match exactly)
      - new_string: Replacement text`,
      Kind.Edit,
      {
        properties: {
          file_path: {
            description:
              "The absolute path to the file to modify. Must start with '/'.",
            type: 'string',
          },
          old_string: {
            description:
              'The exact literal text to replace. Must match existing content exactly including whitespace and indentation.',
            type: 'string',
          },
          new_string: {
            description:
              'The exact literal text to replace old_string with. Provide the complete replacement text.',
            type: 'string',
          },
          force: {
            type: 'boolean',
            description: 'Internal execution control. Managed automatically.',
            default: false,
          },
          last_modified: {
            type: 'number',
            description:
              'Timestamp of the file when last read. Used for concurrency control.',
          },
        },
        required: ['file_path', 'old_string', 'new_string'],
        type: 'object',
      },
    );

    this.contextCollector = new ASTContextCollector();
  }

  protected override validateToolParamValues(
    params: ASTEditToolParams,
  ): string | null {
    if (!params.file_path) {
      return "The 'file_path' parameter must be non-empty.";
    }

    if (!path.isAbsolute(params.file_path)) {
      return `File path must be absolute: ${params.file_path}`;
    }

    const workspaceContext = this.config.getWorkspaceContext();
    if (!workspaceContext.isPathWithinWorkspace(params.file_path)) {
      const directories = workspaceContext.getDirectories();
      return `File path must be within one of the workspace directories: ${directories.join(', ')}`;
    }

    return null;
  }

  protected createInvocation(
    params: ASTEditToolParams,
  ): ToolInvocation<ASTEditToolParams, ToolResult> {
    return new ASTEditToolInvocation(
      this.config,
      params,
      this.contextCollector,
    );
  }

  getModifyContext(_: AbortSignal): ModifyContext<ASTEditToolParams> {
    return {
      getFilePath: (params: ASTEditToolParams) => params.file_path,
      getCurrentContent: async (params: ASTEditToolParams): Promise<string> => {
        try {
          return await this.config
            .getFileSystemService()
            .readTextFile(params.file_path);
        } catch (err) {
          if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
          return '';
        }
      },
      getProposedContent: async (
        params: ASTEditToolParams,
      ): Promise<string> => {
        try {
          const currentContent = await this.config
            .getFileSystemService()
            .readTextFile(params.file_path);
          return ASTEditTool.applyReplacement(
            currentContent,
            params.old_string,
            params.new_string,
            false,
          );
        } catch (err) {
          if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
          return params.new_string;
        }
      },
      createUpdatedParams: (
        oldContent: string,
        modifiedProposedContent: string,
        originalParams: ASTEditToolParams,
      ): ASTEditToolParams => ({
        ...originalParams,
        old_string: oldContent,
        new_string: modifiedProposedContent,
      }),
    };
  }
}

// ===== ASTReadFile Tool Implementation =====
export class ASTReadFileTool extends BaseDeclarativeTool<
  ASTReadFileToolParams,
  ToolResult
> {
  static readonly Name = 'ast_read_file';
  private contextCollector: ASTContextCollector;

  constructor(private readonly config: Config) {
    super(
      ASTReadFileTool.Name,
      'ASTReadFile',
      `Enhanced file reading with AST-inspired context analysis. Reads file content with intelligent context extraction.

      **Context-Aware Features:**
      - Language detection and AST structure analysis
      - Function/class/variable declaration extraction  
      - Relevant code snippet collection
      - Language-specific context information

      **Parameters:**
      - file_path: Absolute path to the file to read
      - offset: Line number to start reading from (optional)
      - limit: Number of lines to read (optional)`,
      Kind.Read,
      {
        properties: {
          file_path: {
            description:
              "The absolute path to the file to read. Must start with '/'.",
            type: 'string',
          },
          offset: {
            type: 'number',
            description:
              'The line number to start reading from (1-based, optional).',
            minimum: 1,
          },
          limit: {
            type: 'number',
            description: 'The number of lines to read (optional).',
            minimum: 1,
          },
        },
        required: ['file_path'],
        type: 'object',
      },
    );

    this.contextCollector = new ASTContextCollector();
  }

  protected override validateToolParamValues(
    params: ASTReadFileToolParams,
  ): string | null {
    if (!params.file_path) {
      return "The 'file_path' parameter must be non-empty.";
    }

    if (!path.isAbsolute(params.file_path)) {
      return `File path must be absolute: ${params.file_path}`;
    }

    const workspaceContext = this.config.getWorkspaceContext();
    if (!workspaceContext.isPathWithinWorkspace(params.file_path)) {
      const directories = workspaceContext.getDirectories();
      return `File path must be within one of the workspace directories: ${directories.join(', ')}`;
    }

    return null;
  }

  protected createInvocation(
    params: ASTReadFileToolParams,
  ): ToolInvocation<ASTReadFileToolParams, ToolResult> {
    return new ASTReadFileToolInvocation(
      this.config,
      params,
      this.contextCollector,
    );
  }
}

// ===== Tool Invocation Classes =====
class ASTEditToolInvocation
  implements ToolInvocation<ASTEditToolParams, ToolResult>
{
  constructor(
    private readonly config: Config,
    public params: ASTEditToolParams,
    private readonly contextCollector: ASTContextCollector,
  ) {}

  toolLocations(): ToolLocation[] {
    return [{ path: this.params.file_path }];
  }

  async shouldConfirmExecute(
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    // For preview mode, return false to let execute method handle it
    if (!this.params.force) {
      return false;
    }

    // For execution mode, check if confirmation is needed
    const approvalMode = this.config.getApprovalMode();
    if (
      approvalMode === ApprovalMode.AUTO_EDIT ||
      approvalMode === ApprovalMode.YOLO
    ) {
      return false;
    }

    // Confirmation logic for execution mode
    const editData = await this.calculateEdit(this.params, abortSignal);
    if (editData.error) {
      return false;
    }

    const fileName = path.basename(this.params.file_path);
    const fileDiff = Diff.createPatch(
      fileName,
      editData.currentContent ?? '',
      editData.newContent,
      'Current',
      'Proposed',
      DEFAULT_CREATE_PATCH_OPTIONS,
    ) as string;

    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `Confirm Edit: ${shortenPath(makeRelative(this.params.file_path, this.config.getTargetDir()))}`,
      fileName,
      filePath: this.params.file_path,
      fileDiff,
      originalContent: editData.currentContent,
      newContent: editData.newContent,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        }
      },
      metadata: {
        astValidation: editData.astValidation,
        fileFreshness: editData.fileFreshness,
      },
    };

    return confirmationDetails;
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.params.file_path,
      this.config.getTargetDir(),
    );
    if (this.params.old_string === '') {
      return `Create ${shortenPath(relativePath)}`;
    }

    const oldStringSnippet =
      this.params.old_string.split('\n')[0].substring(0, 30) +
      (this.params.old_string.length > 30 ? '...' : '');
    const newStringSnippet =
      this.params.new_string.split('\n')[0].substring(0, 30) +
      (this.params.new_string.length > 30 ? '...' : '');

    if (this.params.old_string === this.params.new_string) {
      return `No file changes to ${shortenPath(relativePath)}`;
    }

    const forceIndicator = this.params.force ? ' [EXECUTE] ' : ' [PREVIEW] ';
    return `${forceIndicator}${shortenPath(relativePath)}: ${oldStringSnippet} => ${newStringSnippet}`;
  }

  async execute(
    signal: AbortSignal,
    _updateOutput?: (output: string | AnsiOutput) => void,
    _terminalColumns?: number,
    _terminalRows?: number,
    _setPidCallback?: (pid: number) => void,
  ): Promise<ToolResult> {
    // Step 1: Preview mode (force: false or unset)
    if (!this.params.force) {
      return this.executePreview(signal);
    }

    // Step 2: Execution mode (force: true)
    return this.executeApply(signal);
  }

  private async executePreview(_signal: AbortSignal): Promise<ToolResult> {
    try {
      // Read file and collect context
      const rawCurrentContent = await this.readFileContent();
      // Normalize line endings to LF to match apply behavior
      const currentContent = rawCurrentContent.replace(/\r\n/g, '\n');
      // Get timestamp for freshness check
      const currentMtime = await this.getFileLastModified(
        this.params.file_path,
      );

      // Detect if this is a new file (same logic as apply path)
      const isNewFile =
        this.params.old_string === '' && rawCurrentContent === '';

      // Freshness Check (must run first to prevent stale edits in concurrent scenarios)
      if (
        this.params.last_modified &&
        currentMtime &&
        currentMtime > this.params.last_modified
      ) {
        const errorMessage = `File ${this.params.file_path} mismatch. Expected mtime <= ${this.params.last_modified}, but found ${currentMtime}.`;
        const displayMessage = `File has been modified since it was last read. Please read the file again to get the latest content.`;
        const rawErrorMessage = JSON.stringify({
          message: errorMessage,
          current_mtime: currentMtime,
          your_mtime: this.params.last_modified,
        });
        return {
          llmContent: rawErrorMessage,
          returnDisplay: `Error: ${displayMessage}`,
          error: {
            message: rawErrorMessage,
            type: ToolErrorType.FILE_MODIFIED_CONFLICT,
          },
        };
      }

      const workspaceRoot = this.config.getTargetDir();
      const enhancedContext =
        await this.contextCollector.collectEnhancedContext(
          this.params.file_path,
          currentContent,
          workspaceRoot,
        );

      // Generate preview (use normalized content and correct isNewFile flag)
      const newContent = ASTEditTool.applyReplacement(
        currentContent,
        this.params.old_string,
        this.params.new_string,
        isNewFile,
      );
      const astValidation = this.validateASTSyntax(
        this.params.file_path,
        newContent,
      );

      // Rich preview information
      const fileName = path.basename(this.params.file_path);
      const fileDiff = Diff.createPatch(
        fileName,
        currentContent ?? '',
        newContent,
        'Current',
        'Proposed',
        DEFAULT_CREATE_PATCH_OPTIONS,
      ) as string;

      const editPreviewLlmContent = [
        `LLXPRT EDIT PREVIEW: ${this.params.file_path}`,
        `- Context: ${enhancedContext.language} file with ${enhancedContext.declarations.length} declarations`,
        `- Functions: ${enhancedContext.languageContext.functions.length}`,
        `- Classes: ${enhancedContext.languageContext.classes.length}`,
        `- AST validation: ${astValidation.valid ? 'PASSED' : 'FAILED'}`,
        `- Relevant snippets: ${enhancedContext.relevantSnippets.length} found`,
        enhancedContext.repositoryContext
          ? `- Repository: ${enhancedContext.repositoryContext.gitUrl}`
          : '',
        enhancedContext.relatedFiles
          ? `- Related files: ${enhancedContext.relatedFiles.length}`
          : '',
        enhancedContext.connectedFiles &&
        enhancedContext.connectedFiles.length > 0
          ? [
              '',
              'WORKING SET CONTEXT:',
              ...enhancedContext.connectedFiles
                .map((file) => {
                  const relPath = makeRelative(file.filePath, workspaceRoot);
                  if (file.declarations.length === 0)
                    return `- ${relPath} (No declarations)`;
                  return [
                    `- ${relPath}:`,
                    ...file.declarations.map(
                      (d) =>
                        `  - ${d.type}: ${d.name}${d.signature ? d.signature : ''}`,
                    ),
                  ];
                })
                .flat(),
            ]
          : [],
        astValidation && !astValidation.valid
          ? `- AST errors: ${astValidation.errors.join(', ')}`
          : '',
        currentMtime ? `- Timestamp: ${currentMtime}` : '',
        '',
        'ENHANCED CONTEXT ANALYSIS:',
        ...enhancedContext.declarations.map(
          (decl) => `- ${decl.type}: ${decl.name} (line ${decl.line})`,
        ),
        enhancedContext.relatedSymbols &&
        enhancedContext.relatedSymbols.length > 0
          ? [
              '',
              'RELATED SYMBOLS:',
              ...enhancedContext.relatedSymbols
                .slice(0, ASTConfig.MAX_DISPLAY_RESULTS)
                .map(
                  (symbol) =>
                    `- ${symbol.type}: ${symbol.filePath}:${symbol.line}`,
                ),
            ]
          : [],
        '',
        'NEXT STEP: Call again with force: true to apply changes',
      ]
        .flat()
        .filter(Boolean)
        .join('\n');

      const returnDisplay: FileDiff = {
        fileDiff,
        fileName,
        originalContent: currentContent,
        newContent,
        metadata: {
          astValidation,
          currentMtime,
        },
      };

      return {
        llmContent: editPreviewLlmContent,
        returnDisplay,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error preparing preview: ${errorMsg}`,
        returnDisplay: `Error preparing preview: ${errorMsg}`,
        error: {
          message: errorMsg,
          type: ToolErrorType.EDIT_PREPARATION_FAILURE,
        },
      };
    }
  }

  private async executeApply(signal: AbortSignal): Promise<ToolResult> {
    let editData: CalculatedEdit;
    try {
      editData = await this.calculateEdit(this.params, signal);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error preparing edit: ${errorMsg}`,
        returnDisplay: `Error preparing edit: ${errorMsg}`,
        error: {
          message: errorMsg,
          type: ToolErrorType.EDIT_PREPARATION_FAILURE,
        },
      };
    }

    if (editData.error) {
      return {
        llmContent: editData.error.raw,
        returnDisplay: `Error: ${editData.error.display}`,
        error: {
          message: editData.error.raw,
          type: editData.error.type,
        },
      };
    }

    // Execute actual file write
    try {
      await this.ensureParentDirectoriesExist(this.params.file_path);
      await this.config
        .getFileSystemService()
        .writeTextFile(this.params.file_path, editData.newContent);

      // Return execution result
      const fileName = path.basename(this.params.file_path);
      const fileDiff = Diff.createPatch(
        fileName,
        editData.currentContent ?? '',
        editData.newContent,
        'Current',
        'Applied',
        DEFAULT_CREATE_PATCH_OPTIONS,
      ) as string;

      const displayResult = {
        fileDiff,
        fileName,
        originalContent: editData.currentContent,
        newContent: editData.newContent,
        applied: true,
        metadata: {
          astValidation: editData.astValidation,
        },
      };

      const llmSuccessMessage = [
        `Successfully applied edit to: ${this.params.file_path}`,
        `- Changes: ${editData.occurrences} replacement(s) applied`,
        `- AST validation: ${editData.astValidation?.valid ? 'PASSED' : 'FAILED'}`,
      ].join('\n');

      return {
        llmContent: llmSuccessMessage,
        returnDisplay: displayResult,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error executing edit: ${errorMsg}`,
        returnDisplay: `Error writing file: ${errorMsg}`,
        error: {
          message: errorMsg,
          type: ToolErrorType.FILE_WRITE_FAILURE,
        },
      };
    }
  }

  protected async calculateEdit(
    params: ASTEditToolParams,
    _abortSignal: AbortSignal,
  ): Promise<CalculatedEdit> {
    // Normalize all string parameters to LF for consistent matching
    const normalizedOldString = params.old_string.replace(/\r\n/g, '\n');
    const normalizedNewString = params.new_string.replace(/\r\n/g, '\n');

    let currentContent: string | null = null;
    let fileExists = false;
    let isNewFile = false;
    let error:
      | { display: string; raw: string; type: ToolErrorType }
      | undefined = undefined;

    try {
      currentContent = await this.config
        .getFileSystemService()
        .readTextFile(params.file_path);
      currentContent = currentContent.replace(/\r\n/g, '\n');
      fileExists = true;
    } catch (err: unknown) {
      if (!isNodeError(err) || err.code !== 'ENOENT') {
        throw err;
      }
      fileExists = false;
    }

    // Freshness Check (moved before old_string validation to ensure it runs first)
    const currentMtime = await this.getFileLastModified(params.file_path);

    if (
      params.last_modified &&
      currentMtime &&
      currentMtime > params.last_modified
    ) {
      error = {
        display: `File has been modified since it was last read. Please read the file again to get the latest content.`,
        raw: JSON.stringify({
          message: `File ${params.file_path} mismatch. Expected mtime <= ${params.last_modified}, but found ${currentMtime}.`,
          current_mtime: currentMtime,
          your_mtime: params.last_modified,
        }),
        type: ToolErrorType.FILE_MODIFIED_CONFLICT,
      };
      return {
        currentContent,
        newContent: currentContent ?? '',
        occurrences: 0,
        error,
        isNewFile,
        astValidation: undefined,
        fileFreshness: currentMtime,
      };
    }

    if (params.old_string === '' && !fileExists) {
      isNewFile = true;
    } else if (!fileExists) {
      error = {
        display: `File not found. Cannot apply edit. Use an empty old_string to create a new file.`,
        raw: `File not found: ${params.file_path}`,
        type: ToolErrorType.FILE_NOT_FOUND,
      };
    } else if (currentContent !== null) {
      const occurrences = this.countOccurrences(
        currentContent,
        normalizedOldString,
      );

      if (occurrences === 0) {
        error = {
          display: `Failed to edit, could not find string to replace.`,
          raw: `Failed to edit, 0 occurrences found for old_string in ${params.file_path}. No edits made.`,
          type: ToolErrorType.EDIT_NO_OCCURRENCE_FOUND,
        };
      } else if (normalizedOldString === normalizedNewString) {
        error = {
          display: `No changes to apply. The old_string and new_string are identical.`,
          raw: `No changes to apply. The old_string and new_string are identical in file: ${params.file_path}`,
          type: ToolErrorType.EDIT_NO_CHANGE,
        };
      }
    }

    const newContent = !error
      ? ASTEditTool.applyReplacement(
          currentContent,
          normalizedOldString,
          normalizedNewString,
          isNewFile,
        )
      : (currentContent ?? '');

    if (!error && fileExists && currentContent === newContent) {
      error = {
        display:
          'No changes to apply. The new content is identical to the current content.',
        raw: `No changes to apply. The new content is identical to the current content in file: ${params.file_path}`,
        type: ToolErrorType.EDIT_NO_CHANGE,
      };
    }

    let astValidation: { valid: boolean; errors: string[] } | undefined;
    if (!error) {
      astValidation = this.validateASTSyntax(params.file_path, newContent);
    }

    return {
      currentContent,
      newContent,
      occurrences: this.countOccurrences(
        currentContent || '',
        normalizedOldString,
      ),
      error,
      isNewFile,
      astValidation,
      fileFreshness: currentMtime,
    };
  }

  private countOccurrences(content: string, searchString: string): number {
    if (!searchString) return 0;

    // Since applyReplacement uses String.replace (single replacement),
    // count occurrences that will actually be replaced (0 or 1)
    return content.includes(searchString) ? 1 : 0;
  }

  private async readFileContent(): Promise<string> {
    try {
      return await this.config
        .getFileSystemService()
        .readTextFile(this.params.file_path);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return '';
      }
      throw error;
    }
  }

  private validateASTSyntax(
    filePath: string,
    content: string,
  ): { valid: boolean; errors: string[] } {
    const extension = path.extname(filePath).substring(1);
    const lang = LANGUAGE_MAP[extension];
    if (!lang) {
      return { valid: true, errors: [] };
    }

    try {
      const parseLang = lang;
      parse(parseLang, content);
      return { valid: true, errors: [] };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  protected async getFileLastModified(
    filePath: string,
  ): Promise<number | null> {
    try {
      const stats = await fsPromises.stat(filePath);
      return stats.mtime.getTime();
    } catch (_error) {
      return null;
    }
  }

  private async ensureParentDirectoriesExist(filePath: string): Promise<void> {
    const dirName = path.dirname(filePath);
    try {
      await fsPromises.access(dirName);
    } catch {
      await fsPromises.mkdir(dirName, { recursive: true });
    }
  }
}

// ===== ASTReadFile 工具調用類別 =====
class ASTReadFileToolInvocation
  implements ToolInvocation<ASTReadFileToolParams, ToolResult>
{
  constructor(
    private readonly config: Config,
    public params: ASTReadFileToolParams,
    private readonly contextCollector: ASTContextCollector,
  ) {}

  toolLocations(): ToolLocation[] {
    return [{ path: this.params.file_path, line: this.params.offset }];
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.params.file_path,
      this.config.getTargetDir(),
    );
    return shortenPath(relativePath);
  }

  async shouldConfirmExecute(): Promise<false> {
    return false; // Read operations don't need confirmation
  }

  async execute(
    _signal?: AbortSignal,
    _updateOutput?: (output: string | AnsiOutput) => void,
    _terminalColumns?: number,
    _terminalRows?: number,
    _setPidCallback?: (pid: number) => void,
  ): Promise<ToolResult> {
    try {
      // Read file content
      const content = await this.config
        .getFileSystemService()
        .readTextFile(this.params.file_path);

      // Process line range
      const lines = content.split('\n');
      const startLine = this.params.offset
        ? Math.max(1, this.params.offset) - 1
        : 0;
      const endLine = this.params.limit
        ? Math.min(lines.length, startLine + this.params.limit)
        : lines.length;
      const selectedContent = lines.slice(startLine, endLine).join('\n');

      // Collect enhanced context (same as ASTEdit)
      const workspaceRoot = this.config.getTargetDir();
      const enhancedContext =
        await this.contextCollector.collectEnhancedContext(
          this.params.file_path,
          content,
          workspaceRoot,
        );

      const readLlmContent = [
        `LLXPRT READ: ${this.params.file_path}`,
        `- Language: ${enhancedContext.language}`,
        `- Lines ${startLine + 1}-${endLine} of ${lines.length}`,
        `- Declarations: ${enhancedContext.declarations.length}`,
        '',
        'CONTEXT ANALYSIS:',
        ...enhancedContext.declarations.map(
          (decl) =>
            `- ${decl.type}: ${decl.name}${decl.signature ? decl.signature : ''} (line ${decl.line})`,
        ),
        '',
        'RELEVANT SNIPPETS:',
        ...enhancedContext.relevantSnippets
          .slice(0, ASTConfig.MAX_DISPLAY_RESULTS)
          .map(
            (snippet) =>
              `- Line ${snippet.line}: ${snippet.text.substring(0, 60)}...`,
          ),
        enhancedContext.connectedFiles &&
        enhancedContext.connectedFiles.length > 0
          ? [
              '',
              'WORKING SET CONTEXT:',
              ...enhancedContext.connectedFiles
                .map((file) => {
                  const relPath = makeRelative(file.filePath, workspaceRoot);
                  if (file.declarations.length === 0)
                    return `- ${relPath} (No declarations)`;
                  return [
                    `- ${relPath}:`,
                    ...file.declarations.map(
                      (d) =>
                        `  - ${d.type}: ${d.name}${d.signature ? d.signature : ''}`,
                    ),
                  ];
                })
                .flat(),
            ]
          : [],
      ]
        .flat()
        .filter(Boolean)
        .join('\n');

      return {
        llmContent: readLlmContent,
        returnDisplay: {
          content: selectedContent,
          fileName: path.basename(this.params.file_path),
          filePath: this.params.file_path,
          metadata: {
            language: enhancedContext.language,
            declarationsCount: enhancedContext.declarations.length,
          },
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      let errorType = ToolErrorType.READ_CONTENT_FAILURE;
      if (isNodeError(error)) {
        switch (error.code) {
          case 'ENOENT':
            errorType = ToolErrorType.FILE_NOT_FOUND;
            break;
          case 'EACCES':
            errorType = ToolErrorType.PERMISSION_DENIED;
            break;
          case 'EISDIR':
            errorType = ToolErrorType.TARGET_IS_DIRECTORY;
            break;
          case 'EMFILE':
          case 'ENFILE':
            // Resource exhaustion, treat as generic read failure or maybe system limit?
            // Using READ_CONTENT_FAILURE as best fit.
            errorType = ToolErrorType.READ_CONTENT_FAILURE;
            break;
          default:
            errorType = ToolErrorType.READ_CONTENT_FAILURE;
        }
      } else {
        errorType = ToolErrorType.UNKNOWN;
      }

      return {
        llmContent: `Error reading file: ${errorMsg}`,
        returnDisplay: `Error reading file: ${errorMsg}`,
        error: {
          message: errorMsg,
          type: errorType,
        },
      };
    }
  }
}

interface CalculatedEdit {
  currentContent: string | null;
  newContent: string;
  occurrences: number;
  error?: { display: string; raw: string; type: ToolErrorType };
  isNewFile: boolean;
  astValidation?: { valid: boolean; errors: string[] };
  fileFreshness?: number | null;
}
