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
import type { Lang } from '../utils/ast-grep-utils.js';
import {
  parse,
  getAstLanguage,
  resolveLanguageFromPath,
  LANGUAGE_MAP,
} from '../utils/ast-grep-utils.js';
import type { IToolHost, IToolMessageBus } from '../interfaces/index.js';

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

/** Mutable accumulator for bounded match collection. */
interface MatchAccumulator {
  matches: AstGrepMatch[];
  truncated: boolean;
  partialReason: 'max-results' | 'aborted' | undefined;
  sentinelObserved: boolean;
  /**
   * Number of candidate matches actually observed during traversal. Equals
   * {@link matches} length for an exact, complete traversal; for a sentinel
   * overflow it is retained+1 (the one-over node observed to prove partiality
   * before stopping), so it is a lower bound when truncated.
   */
  observedCount: number;
}

class AstGrepToolInvocation extends BaseToolInvocation<
  AstGrepToolParams,
  ToolResult
> {
  constructor(
    private readonly host: IToolHost,
    params: AstGrepToolParams,
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
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
    const { pattern, rule, globs } = this.params;
    const limit = this.resolveLimit(this.params.maxResults);

    const resolved = this.validateAndResolveParams();
    if (resolved instanceof Object && 'llmContent' in resolved) return resolved;
    const { searchPath, isSingleFile, resolvedLang } = resolved as {
      searchPath: string;
      isSingleFile: boolean;
      resolvedLang: string | Lang;
    };

    try {
      const { matches, truncated, partialReason, skippedFiles, observedCount } =
        await this.collectMatches(
          searchPath,
          isSingleFile,
          resolvedLang,
          pattern,
          rule,
          globs,
          signal,
          limit,
        );
      return this.formatSearchResults(
        matches,
        truncated,
        partialReason,
        skippedFiles,
        observedCount,
        pattern,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.makeError(`Error searching: ${msg}`);
    }
  }

  /**
   * Resolves `maxResults` to a finite, nonnegative integer acquisition limit.
   *
   * - `undefined` -> the documented default.
   * - fractional -> floored (consistent with prior slice semantics).
   * - zero / negative -> 0 (acquire nothing; a negative slice is empty).
   * - nonfinite -> default (defensive: the JSON-Schema `type: number` already
   *   rejects Infinity/NaN at validation, preserving the public contract).
   */
  private resolveLimit(maxResults: number | undefined): number {
    const value = maxResults ?? DEFAULT_MAX_RESULTS;
    if (!Number.isFinite(value)) return DEFAULT_MAX_RESULTS;
    return Math.max(0, Math.floor(value));
  }

  private validateAndResolveParams():
    | ToolResult
    | {
        searchPath: string;
        isSingleFile: boolean;
        resolvedLang: string | Lang;
      } {
    const { pattern, rule, language } = this.params;

    // REQ-ASTGREP-004: exactly one of pattern or rule
    if ((pattern && rule) || (!pattern && !rule)) {
      return this.makeError(
        'Error: Provide exactly one of `pattern` or `rule`, not both and not neither.',
      );
    }

    const targetDir = this.host.getTargetDir();
    let searchPath = this.params.path ?? targetDir;
    if (!path.isAbsolute(searchPath)) {
      searchPath = path.resolve(targetDir, searchPath);
    }

    // REQ-ASTGREP-006: workspace boundary
    const normalizedTarget = targetDir.endsWith(path.sep)
      ? targetDir
      : targetDir + path.sep;
    if (searchPath !== targetDir && !searchPath.startsWith(normalizedTarget)) {
      return this.makeError(
        `Error: Path "${this.params.path}" resolves outside the workspace root.`,
      );
    }

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

    return { searchPath, isSingleFile, resolvedLang };
  }

  private async collectMatches(
    searchPath: string,
    isSingleFile: boolean,
    resolvedLang: string | Lang,
    pattern: string | undefined,
    rule: Record<string, unknown> | undefined,
    globs: string[] | undefined,
    signal: AbortSignal | undefined,
    limit: number,
  ): Promise<{
    matches: AstGrepMatch[];
    truncated: boolean;
    partialReason: 'max-results' | 'aborted' | undefined;
    skippedFiles: number;
    observedCount: number;
  }> {
    const targetDir = this.host.getTargetDir();
    const acc: MatchAccumulator = {
      matches: [],
      truncated: false,
      partialReason: undefined,
      sentinelObserved: false,
      observedCount: 0,
    };
    let skippedFiles = 0;

    if (isSingleFile) {
      const content = await fs.readFile(searchPath, 'utf-8');
      this.searchContentBounded(
        content,
        resolvedLang,
        searchPath,
        targetDir,
        acc,
        limit,
        pattern,
        rule,
      );
    } else {
      skippedFiles = await this.collectFromDirectory(
        searchPath,
        resolvedLang,
        globs,
        signal,
        pattern,
        rule,
        targetDir,
        acc,
        limit,
      );
    }

    // A pre-aborted signal must never read as a falsely complete result.
    if (signal?.aborted === true && !acc.truncated) {
      acc.truncated = true;
      acc.partialReason = 'aborted';
    }

    return {
      matches: acc.matches,
      truncated: acc.truncated,
      partialReason: acc.partialReason,
      skippedFiles,
      observedCount: acc.observedCount,
    };
  }

  /**
   * Searches one file's content and accumulates matches INLINE against the
   * retention limit. At most `limit` match records are ever materialized: once
   * the limit is reached, the FIRST additional node is observed as a sentinel
   * (proving truncation) but never turned into a record, and iteration stops.
   * This avoids building an unbounded mapped match-record array before the
   * limit is applied. The AST parser may still return its full node array —
   * no unbounded match-record aggregate is created from it.
   */
  private searchContentBounded(
    content: string,
    language: string | Lang,
    filePath: string,
    workspaceRoot: string,
    acc: MatchAccumulator,
    limit: number,
    pattern?: string,
    rule?: Record<string, unknown>,
  ): void {
    const root = parse(language as Lang, content);
    const sgRoot = root.root();
    const relativePath = makeRelative(filePath, workspaceRoot);

    let nodes: SgNode[];
    if (pattern) {
      nodes = sgRoot.findAll(pattern);
    } else if (rule) {
      nodes = sgRoot.findAll({ rule } as NapiConfig);
    } else {
      return;
    }

    for (const node of nodes) {
      // Count every observed candidate so the metadata can distinguish an
      // exact exhausted traversal (observed == retained) from a one-over
      // sentinel (observed == retained + 1, a lower bound).
      acc.observedCount++;
      if (acc.matches.length < limit) {
        acc.matches.push(this.materializeMatch(node, relativePath, pattern));
        continue;
      }
      if (!acc.sentinelObserved) {
        acc.sentinelObserved = true;
        acc.truncated = true;
        acc.partialReason = 'max-results';
      }
      return;
    }
  }

  /**
   * Materializes a single AST node into an {@link AstGrepMatch} record,
   * including metavariable extraction (single `$NAME` and multi `$$$NAME`).
   */
  private materializeMatch(
    node: SgNode,
    relativePath: string,
    pattern?: string,
  ): AstGrepMatch {
    const range = node.range();
    const metaVariables: Record<string, string> = {};

    if (pattern) {
      const { single, multi } = this.extractMetaVarNames(pattern);
      for (const name of single) {
        const match = node.getMatch(name);
        if (match) {
          metaVariables[name] = match.text();
        }
      }
      for (const name of multi) {
        const matches = node.getMultipleMatches(name);
        if (matches.length > 0) {
          metaVariables[name] = matches.map((m: SgNode) => m.text()).join(', ');
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
  }

  /**
   * Extracts single ($NAME) and multi ($$$NAME) metavariable names from an
   * ast-grep pattern by scanning dollar-sign runs directly. A manual scan is
   * used instead of a regex because a literal dollar in a JS regex requires an
   * escaped dollar that is easily confused with the end-of-input anchor;
   * scanning the runs guarantees the literal-dollar semantics for both $NAME
   * and $$$NAME.
   *
   * A run of exactly one dollar followed by NAME is a single metavar; a run of
   * three dollars followed by NAME is a multi metavar; other runs are not
   * valid metavariables and are ignored.
   */
  private extractMetaVarNames(pattern: string): {
    single: string[];
    multi: string[];
  } {
    const isNameStart = (ch: string): boolean =>
      (ch >= 'A' && ch <= 'Z') || ch === '_';
    const isNamePart = (ch: string): boolean =>
      isNameStart(ch) || (ch >= '0' && ch <= '9');

    const single: string[] = [];
    const multi: string[] = [];
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] !== '$') continue;
      let dollars = 0;
      let j = i;
      while (j < pattern.length && pattern[j] === '$') {
        dollars++;
        j++;
      }
      if (j < pattern.length && isNameStart(pattern[j])) {
        let k = j;
        while (k < pattern.length && isNamePart(pattern[k])) k++;
        const name = pattern.slice(j, k);
        if (dollars === 1) {
          single.push(name);
        } else if (dollars === 3) {
          multi.push(name);
        }
        i = k - 1;
      } else {
        i = j - 1;
      }
    }
    return { single, multi };
  }

  private async collectFromDirectory(
    searchPath: string,
    resolvedLang: string | Lang,
    globs: string[] | undefined,
    signal: AbortSignal | undefined,
    pattern: string | undefined,
    rule: Record<string, unknown> | undefined,
    targetDir: string,
    acc: MatchAccumulator,
    limit: number,
  ): Promise<number> {
    // AbortSignal.aborted is a mutable property; reading it through a helper
    // avoids TS narrowing it to `false` after the pre-abort check (the signal
    // can become aborted during an awaited traversal step).
    const isAborted = (): boolean => signal?.aborted === true;
    // Pre-abort before discovery: a signal already aborted must never read as
    // a falsely complete result, and must not materialize a file list.
    if (isAborted()) {
      if (!acc.truncated) {
        acc.truncated = true;
        acc.partialReason = 'aborted';
      }
      return 0;
    }

    const extensions = this.getExtensionsForLanguage(resolvedLang);
    // Include/exclude sets are resolved via streaming so the only full
    // path-array materialization is the user-provided glob subset (not every
    // language file in the tree). Preserves FastGlob's glob/workspace
    // semantics and source order.
    const { includeSet, excludeSet } = await this.resolveGlobSets(
      globs,
      searchPath,
    );
    let skippedFiles = 0;

    const stream = FastGlob.stream(
      extensions.map((ext) => `**/*.${ext}`),
      {
        cwd: searchPath,
        absolute: true,
        dot: false,
        ignore: ['**/node_modules/**', '**/.git/**'],
      },
    );

    // Per-entry processing returns whether the traversal should continue
    // (keeps the loop body to a single break/continue-free break).
    const processEntry = async (entry: string): Promise<boolean> => {
      if (acc.sentinelObserved || isAborted()) {
        if (isAborted() && !acc.truncated) {
          acc.truncated = true;
          acc.partialReason = 'aborted';
        }
        return false;
      }
      const file = String(entry);
      if (includeSet !== null && !includeSet.has(file)) return true;
      if (excludeSet?.has(file) === true) return true;
      try {
        const content = await fs.readFile(file, 'utf-8');
        this.searchContentBounded(
          content,
          resolvedLang,
          file,
          targetDir,
          acc,
          limit,
          pattern,
          rule,
        );
      } catch {
        skippedFiles++;
      }
      return true;
    };

    for await (const entry of stream) {
      if (!(await processEntry(String(entry)))) break;
    }
    return skippedFiles;
  }

  /**
   * Resolves include/exclude glob sets lazily via FastGlob's streaming API so
   * glob filtering does not materialize full path arrays for the primary
   * language discovery. Returns null sets when no globs are supplied (the
   * common case stays fully streaming).
   */
  private async resolveGlobSets(
    globs: string[] | undefined,
    searchPath: string,
  ): Promise<{
    includeSet: Set<string> | null;
    excludeSet: Set<string> | null;
  }> {
    if (!globs || globs.length === 0) {
      return { includeSet: null, excludeSet: null };
    }
    const includePatterns = globs.filter((g) => !g.startsWith('!'));
    const excludePatterns = globs
      .filter((g) => g.startsWith('!'))
      .map((g) => g.slice(1));

    let includeSet: Set<string> | null = null;
    let excludeSet: Set<string> | null = null;

    if (includePatterns.length > 0) {
      includeSet = new Set<string>();
      for await (const f of FastGlob.stream(includePatterns, {
        cwd: searchPath,
        absolute: true,
      })) {
        includeSet.add(String(f));
      }
    }
    if (excludePatterns.length > 0) {
      excludeSet = new Set<string>();
      for await (const f of FastGlob.stream(excludePatterns, {
        cwd: searchPath,
        absolute: true,
      })) {
        excludeSet.add(String(f));
      }
    }
    return { includeSet, excludeSet };
  }

  private formatSearchResults(
    matches: AstGrepMatch[],
    truncated: boolean,
    partialReason: 'max-results' | 'aborted' | undefined,
    skippedFiles: number,
    observedCount: number,
    pattern?: string,
  ): ToolResult {
    const matchCount = matches.length;
    const searchDesc = pattern ? `pattern "${pattern}"` : 'rule query';
    // A skipped (unreadable/unparseable) file means the count cannot be exact:
    // there may be unobserved matches in files the tool never fully searched.
    const inexact = truncated || skippedFiles > 0;

    let llmContent = `Found ${matchCount} AST match${matchCount !== 1 ? 'es' : ''} for ${searchDesc}`;
    if (truncated) {
      const note =
        partialReason === 'aborted'
          ? ' (aborted; more matches may exist)'
          : ' (truncated; more matches exist)';
      llmContent += note;
    } else if (skippedFiles > 0) {
      llmContent += ` (${skippedFiles} file${skippedFiles !== 1 ? 's' : ''} skipped; count is a lower bound)`;
    }
    llmContent += ':\n---\n';

    for (const m of matches) {
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
      // totalMatches is only the exact total when traversal completed fully
      // AND no file was skipped; it is intentionally omitted after an early
      // stop or skip so no consumer mistakes a lower bound for an exhaustive
      // count.
      metadata: {
        matches,
        truncated,
        matchesRetained: matchCount,
        // Lower bound on observed candidates (exact when complete).
        matchesObserved: observedCount,
        ...(inexact ? { countInexact: true } : { totalMatches: matchCount }),
        ...(partialReason !== undefined ? { partialReason } : {}),
        ...(skippedFiles > 0 ? { skippedFiles } : {}),
      },
    };
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
    private readonly host: IToolHost,
    _messageBus?: IToolMessageBus,
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
    messageBus: IToolMessageBus,
  ): ToolInvocation<AstGrepToolParams, ToolResult> {
    return new AstGrepToolInvocation(this.host, params, messageBus);
  }
}
