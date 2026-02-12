/**
 * AST-aware structural code search tool using @ast-grep/napi.
 * Finds code patterns by AST structure rather than text matching.
 *
 * @plan PLAN-20260211-ASTGREP.P05
 */

import * as path from 'node:path';
import { promises as fs, statSync, existsSync } from 'node:fs';
import FastGlob from 'fast-glob';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import { makeRelative } from '../utils/paths.js';
import type { SgNode, NapiConfig } from '@ast-grep/napi';
import {
  parse,
  Lang,
  getAstLanguage,
  resolveLanguageFromPath,
  LANGUAGE_MAP,
} from '../utils/ast-grep-utils.js';
import type { Config } from '../config/config.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

const DEFAULT_MAX_RESULTS = 100;

export interface AstGrepToolParams {
  pattern?: string;
  rule?: Record<string, unknown>;
  language?: string;
  path?: string;
  globs?: string[];
  maxResults?: number;
}

interface AstGrepMatch {
  file: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  text: string;
  nodeKind: string;
  metaVariables: Record<string, string>;
}

interface AstGrepResult {
  matches: AstGrepMatch[];
  truncated: boolean;
  totalMatches?: number;
  skippedFiles?: number;
}

class AstGrepToolInvocation extends BaseToolInvocation<
  AstGrepToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: AstGrepToolParams,
  ) {
    super(params);
  }

  getDescription(): string {
    const { pattern, rule } = this.params;
    if (pattern) return `AST pattern: '${pattern}'`;
    if (rule) return `AST rule query`;
    return 'AST search';
  }

  private makeError(message: string): ToolResult {
    return { llmContent: message, returnDisplay: message };
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const { pattern, rule, language, globs, maxResults } = this.params;
    const limit = maxResults ?? DEFAULT_MAX_RESULTS;

    // REQ-ASTGREP-004: exactly one of pattern or rule
    if ((pattern && rule) || (!pattern && !rule)) {
      return this.makeError(
        'Error: Provide exactly one of `pattern` or `rule`, not both and not neither.',
      );
    }

    // Resolve search path
    const targetDir = this.config.getTargetDir();
    let searchPath = this.params.path || targetDir;

    // Handle relative paths
    if (!path.isAbsolute(searchPath)) {
      searchPath = path.resolve(targetDir, searchPath);
    }

    // REQ-ASTGREP-006: workspace boundary (path.sep-aware to prevent sibling bypass)
    const normalizedTarget = targetDir.endsWith(path.sep)
      ? targetDir
      : targetDir + path.sep;
    if (searchPath !== targetDir && !searchPath.startsWith(normalizedTarget)) {
      return this.makeError(
        `Error: Path "${this.params.path}" resolves outside the workspace root.`,
      );
    }

    // Determine if single file or directory
    let isSingleFile = false;
    try {
      const stats = statSync(searchPath);
      isSingleFile = stats.isFile();
    } catch {
      if (!existsSync(searchPath)) {
        return this.makeError(`Error: Path does not exist: ${searchPath}`);
      }
    }

    // REQ-ASTGREP-013: language detection
    let resolvedLang: string | Lang | undefined;
    if (language) {
      resolvedLang = getAstLanguage(language);
      if (!resolvedLang) {
        return this.makeError(
          `Error: Unrecognized language "${language}". Supported: ${Object.keys(LANGUAGE_MAP).join(', ')}`,
        );
      }
    } else if (isSingleFile) {
      resolvedLang = resolveLanguageFromPath(searchPath);
      if (!resolvedLang) {
        return this.makeError(
          'Error: Could not detect language from file extension. Please provide a `language` parameter.',
        );
      }
    } else {
      return this.makeError(
        'Error: `language` parameter is required when searching a directory.',
      );
    }

    try {
      const allMatches: AstGrepMatch[] = [];
      let skippedFiles = 0;

      if (isSingleFile) {
        // Single file: use parse + findAll
        const content = await fs.readFile(searchPath, 'utf-8');
        const matches = this.searchContent(
          content,
          resolvedLang,
          searchPath,
          targetDir,
          pattern,
          rule,
        );
        allMatches.push(...matches);
      } else {
        // Directory: find files, then search each
        const extensions = this.getExtensionsForLanguage(resolvedLang);
        let files = await FastGlob(
          extensions.map((ext) => `**/*.${ext}`),
          {
            cwd: searchPath,
            absolute: true,
            dot: false,
            ignore: ['**/node_modules/**', '**/.git/**'],
          },
        );

        // Apply glob filters
        if (globs && globs.length > 0) {
          const includePatterns = globs.filter((g) => !g.startsWith('!'));
          const excludePatterns = globs
            .filter((g) => g.startsWith('!'))
            .map((g) => g.slice(1));

          if (includePatterns.length > 0) {
            const includeSet = new Set(
              await FastGlob(includePatterns, {
                cwd: searchPath,
                absolute: true,
              }),
            );
            files = files.filter((f) => includeSet.has(f));
          }
          if (excludePatterns.length > 0) {
            const excludeSet = new Set(
              await FastGlob(excludePatterns, {
                cwd: searchPath,
                absolute: true,
              }),
            );
            files = files.filter((f) => !excludeSet.has(f));
          }
        }

        for (const file of files) {
          if (signal.aborted) break;
          try {
            const content = await fs.readFile(file, 'utf-8');
            const matches = this.searchContent(
              content,
              resolvedLang,
              file,
              targetDir,
              pattern,
              rule,
            );
            allMatches.push(...matches);
          } catch {
            skippedFiles++;
          }
        }
      }

      // REQ-ASTGREP-008: result limit
      const truncated = allMatches.length > limit;
      const result: AstGrepResult = {
        matches: allMatches.slice(0, limit),
        truncated,
        skippedFiles: skippedFiles > 0 ? skippedFiles : undefined,
      };
      if (truncated) {
        result.totalMatches = allMatches.length;
      }

      // Format output for LLM
      const matchCount = result.matches.length;
      const searchDesc = pattern ? `pattern "${pattern}"` : 'rule query';
      let llmContent = `Found ${matchCount} AST match${matchCount !== 1 ? 'es' : ''} for ${searchDesc}`;
      if (truncated) {
        llmContent += ` (showing ${matchCount} of ${result.totalMatches})`;
      }
      llmContent += ':\n---\n';

      for (const m of result.matches) {
        llmContent += `${m.file}:${m.startLine} [${m.nodeKind}] ${m.text}\n`;
        if (Object.keys(m.metaVariables).length > 0) {
          for (const [k, v] of Object.entries(m.metaVariables)) {
            llmContent += `  $${k} = ${v}\n`;
          }
        }
      }

      const displayMessage = `Found ${matchCount} AST match${matchCount !== 1 ? 'es' : ''}${truncated ? ' (truncated)' : ''}`;

      return {
        llmContent: llmContent.trim(),
        returnDisplay: displayMessage,
        metadata: result as unknown as Record<string, unknown>,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.makeError(`Error searching: ${msg}`);
    }
  }

  private searchContent(
    content: string,
    language: string | Lang,
    filePath: string,
    workspaceRoot: string,
    pattern?: string,
    rule?: Record<string, unknown>,
  ): AstGrepMatch[] {
    const root = parse(language as Lang, content);
    const sgRoot = root.root();
    const relativePath = makeRelative(filePath, workspaceRoot);

    let nodes: SgNode[];
    if (pattern) {
      nodes = sgRoot.findAll(pattern);
    } else if (rule) {
      nodes = sgRoot.findAll({ rule } as NapiConfig);
    } else {
      return [];
    }

    return nodes.map((node) => {
      const range = node.range();
      const metaVariables: Record<string, string> = {};

      // Extract single metavariables ($NAME patterns, excluding $$$ multi-vars)
      if (pattern) {
        const metaVarNames =
          pattern.match(/(?<!\$)\$(?!\$)([A-Z_][A-Z0-9_]*)/g) || [];
        for (const raw of metaVarNames) {
          const name = raw.slice(1); // remove $
          const match = node.getMatch(name);
          if (match) {
            metaVariables[name] = match.text();
          }
        }
        // Extract multi metavariables ($$$NAME patterns)
        const multiVarNames = pattern.match(/\$\$\$([A-Z_][A-Z0-9_]*)/g) || [];
        for (const raw of multiVarNames) {
          const name = raw.slice(3); // remove $$$
          const matches = node.getMultipleMatches(name);
          if (matches && matches.length > 0) {
            metaVariables[name] = matches
              .map((m: SgNode) => m.text())
              .join(', ');
          }
        }
      }

      return {
        file: relativePath,
        startLine: range.start.line + 1,
        startCol: range.start.column,
        endLine: range.end.line + 1,
        endCol: range.end.column,
        text: node.text(),
        nodeKind: String(node.kind()),
        metaVariables,
      };
    });
  }

  private getExtensionsForLanguage(lang: string | Lang): string[] {
    const extensions: string[] = [];
    for (const [ext, mappedLang] of Object.entries(LANGUAGE_MAP)) {
      if (mappedLang === lang) {
        extensions.push(ext);
      }
    }
    return extensions.length > 0 ? extensions : ['*'];
  }
}

export class AstGrepTool extends BaseDeclarativeTool<
  AstGrepToolParams,
  ToolResult
> {
  static readonly Name = 'ast_grep';

  constructor(
    private readonly config: Config,
    _messageBus?: MessageBus,
  ) {
    super(
      AstGrepTool.Name,
      'AstGrep',
      'Searches for code patterns using AST (Abstract Syntax Tree) structural matching, not text matching. ' +
        'Use this for finding specific code structures: method calls, class declarations, import patterns, try/catch blocks, etc. ' +
        'Supports metavariable capture ($VAR for single node, $$$VAR for multiple). ' +
        'Unlike search_file_content (ripgrep), this tool understands code structure and ignores comments/strings.',
      Kind.Search,
      {
        properties: {
          pattern: {
            description:
              'AST pattern to search for. Use $VAR for single-node metavariables, $$$VAR for multi-node. ' +
              'Examples: "$OBJ.foo()", "class $NAME extends $PARENT { $$$BODY }", "try { $$$T } catch ($E) { $$$C }"',
            type: 'string',
          },
          rule: {
            description:
              'YAML rule object for complex queries. Fields: kind, has, inside, stopBy, regex. ' +
              'Use when pattern syntax is insufficient (e.g., matching by AST node kind).',
            type: 'object',
          },
          language: {
            description:
              'Programming language: typescript, javascript, python, ruby, go, rust, java, cpp, c, html, css, json. ' +
              'Required for directory searches. Auto-detected for single files.',
            type: 'string',
          },
          path: {
            description:
              'File or directory to search. Defaults to workspace root.',
            type: 'string',
          },
          globs: {
            description:
              'Glob patterns to include/exclude files. Prefix with ! to exclude. Example: ["*.ts", "!*.test.ts"]',
            type: 'array',
            items: { type: 'string' },
          },
          maxResults: {
            description: 'Maximum matches to return. Default 100.',
            type: 'number',
          },
        },
        required: [],
        type: 'object',
      },
    );
  }

  protected override createInvocation(
    params: AstGrepToolParams,
    _messageBus?: MessageBus,
  ): ToolInvocation<AstGrepToolParams, ToolResult> {
    return new AstGrepToolInvocation(this.config, params);
  }
}
