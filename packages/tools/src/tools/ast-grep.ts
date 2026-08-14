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
import { statFileSizeGate } from '../utils/fileUtils.js';
import { isPathWithinWorkspace } from '../utils/pathValidation.js';
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
const MAX_RESULTS_HARD_CAP = 10_000;

/**
 * Default observed-file discovery budget when no `tool-output-max-items`
 * setting is supplied. The primary directory traversal is hard-bounded so a
 * broad search over a huge tree cannot read/parse unbounded files.
 */
const DEFAULT_MAX_OBSERVED_FILES = 1000;
/** Absolute ceiling on the observed-file discovery budget. */
const MAX_OBSERVED_FILES_HARD_CAP = 10_000;
/**
 * The discovery budget scales with the `tool-output-max-items` setting (a few
 * files scanned per requested item, matching the structural-analysis
 * convention), then is hard-clamped.
 */
const OBSERVED_FILES_PER_ITEM = 4;

/** Resolve a finite, hard-clamped observed-file discovery budget. */
function resolveObservedFileBudget(maxItemsSetting: unknown): number {
  // Scaling applies only to a valid configured item count; absent/invalid
  // settings yield the documented DEFAULT_MAX_OBSERVED_FILES (1000).
  const configured =
    typeof maxItemsSetting === 'number' &&
    Number.isFinite(maxItemsSetting) &&
    maxItemsSetting > 0
      ? maxItemsSetting * OBSERVED_FILES_PER_ITEM
      : DEFAULT_MAX_OBSERVED_FILES;
  return Math.min(
    Math.max(Math.floor(configured), 1),
    MAX_OBSERVED_FILES_HARD_CAP,
  );
}

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

/** Partiality reason surfaced in ast-grep result metadata. */
type AstGrepPartialReason = 'max-results' | 'aborted' | 'file-budget';

/** Mutable accumulator for bounded match collection. */
interface MatchAccumulator {
  matches: AstGrepMatch[];
  truncated: boolean;
  partialReason: AstGrepPartialReason | undefined;
  sentinelObserved: boolean;
  /**
   * Number of candidate matches actually observed during traversal. Equals
   * {@link matches} length for an exact, complete traversal; for a sentinel
   * overflow it is retained+1 (the one-over node observed to prove partiality
   * before stopping), so it is a lower bound when truncated.
   */
  observedCount: number;
  /**
   * Number of files observed (read/attempted) during directory discovery.
   * A lower bound when {@link discoveryTruncated} is true.
   */
  filesObserved: number;
  /** Whether directory discovery hit the observed-file budget one-over. */
  discoveryTruncated: boolean;
}

/**
 * Aggregate outcome of one bounded match collection run: the retained
 * matches plus the truncation/partiality metadata that must travel with
 * them so a bounded result is never presented as exhaustive.
 */
interface CollectedMatches {
  matches: AstGrepMatch[];
  truncated: boolean;
  partialReason: AstGrepPartialReason | undefined;
  skippedFiles: number;
  oversizedFiles: number;
  observedCount: number;
  filesObserved: number;
  discoveryTruncated: boolean;
}

/** Snapshot an accumulator plus file-accounting counters into a result. */
function buildCollectedMatches(
  acc: MatchAccumulator,
  skippedFiles: number,
  oversizedFiles: number,
): CollectedMatches {
  return {
    matches: acc.matches,
    truncated: acc.truncated,
    partialReason: acc.partialReason,
    skippedFiles,
    oversizedFiles,
    observedCount: acc.observedCount,
    filesObserved: acc.filesObserved,
    discoveryTruncated: acc.discoveryTruncated,
  };
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

    const resolved = this.validateAndResolveParams();
    if (resolved instanceof Object && 'llmContent' in resolved) return resolved;
    const { searchPath, isSingleFile, resolvedLang } = resolved as {
      searchPath: string;
      isSingleFile: boolean;
      resolvedLang: string | Lang;
    };

    let limit: number;
    try {
      limit = this.resolveLimit(this.params.maxResults);
    } catch (err) {
      return this.makeError(err instanceof Error ? err.message : String(err));
    }

    try {
      const observedFileBudget = resolveObservedFileBudget(
        this.host.getEphemeralSettings()['tool-output-max-items'],
      );
      const {
        matches,
        truncated,
        partialReason,
        skippedFiles,
        oversizedFiles,
        observedCount,
        filesObserved,
        discoveryTruncated,
      } = await this.collectMatches(
        searchPath,
        isSingleFile,
        resolvedLang,
        pattern,
        rule,
        globs,
        signal,
        limit,
        observedFileBudget,
      );
      return this.formatSearchResults(
        matches,
        truncated,
        partialReason,
        skippedFiles,
        oversizedFiles,
        observedCount,
        filesObserved,
        discoveryTruncated,
        pattern,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.makeError(`Error searching: ${msg}`);
    }
  }

  /**
   * Resolves `maxResults` to a finite positive integer acquisition limit,
   * hard-capped at {@link MAX_RESULTS_HARD_CAP}.
   *
   * - `undefined` -> the documented default.
   * - nonfinite / non-integer / non-positive -> validation error (thrown as
   *   an Error consumed by the execute catch path).
   * - above the hard cap -> validation error.
   */
  private resolveLimit(maxResults: number | undefined): number {
    const value = maxResults ?? DEFAULT_MAX_RESULTS;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value <= 0
    ) {
      throw new Error(
        `maxResults must be a finite positive integer, got: ${String(maxResults)}`,
      );
    }
    if (value > MAX_RESULTS_HARD_CAP) {
      throw new Error(
        `maxResults ${value} exceeds the hard maximum ${MAX_RESULTS_HARD_CAP}`,
      );
    }
    return value;
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
    observedFileBudget: number,
  ): Promise<CollectedMatches> {
    const targetDir = this.host.getTargetDir();
    const acc: MatchAccumulator = {
      matches: [],
      truncated: false,
      partialReason: undefined,
      sentinelObserved: false,
      observedCount: 0,
      filesObserved: 0,
      discoveryTruncated: false,
    };
    let skippedFiles = 0;
    let oversizedFiles = 0;

    // AbortSignal.aborted is a mutable property; reading it through a helper
    // avoids TS narrowing it to `false` after the pre-abort check (the signal
    // can become aborted during an awaited traversal step).
    const isAborted = (): boolean => signal?.aborted === true;

    // A pre-aborted signal must never read/parse a file or present a falsely
    // complete result, for either a single-file or directory target. The
    // directory path re-checks this after its async glob resolution; this
    // top-level check closes the single-file gap and keeps both paths
    // consistent.
    if (isAborted()) {
      acc.truncated = true;
      acc.partialReason = 'aborted';
      return buildCollectedMatches(acc, skippedFiles, oversizedFiles);
    }

    if (isSingleFile) {
      acc.filesObserved = 1;
      // Shared pre-read file-size gate: an oversized file is never read or
      // parsed, so the acquisition stays bounded regardless of file size.
      const sizeError = await statFileSizeGate(searchPath);
      if (sizeError !== null) {
        throw new Error(sizeError.message);
      }
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
      const dirOutcome = await this.collectFromDirectory(
        searchPath,
        resolvedLang,
        globs,
        signal,
        pattern,
        rule,
        targetDir,
        acc,
        limit,
        observedFileBudget,
      );
      skippedFiles = dirOutcome.skippedFiles;
      oversizedFiles = dirOutcome.oversizedFiles;
    }

    // A signal that aborts during an awaited traversal step must never read as
    // a falsely complete result.
    if (isAborted() && !acc.truncated) {
      acc.truncated = true;
      acc.partialReason = 'aborted';
    }

    return buildCollectedMatches(acc, skippedFiles, oversizedFiles);
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
    observedFileBudget: number,
  ): Promise<{ skippedFiles: number; oversizedFiles: number }> {
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
      return { skippedFiles: 0, oversizedFiles: 0 };
    }

    const {
      primaryPatterns,
      ignorePatterns,
      extensionSet,
      acceptsAnyExtension,
    } = this.resolveDirectoryScan(resolvedLang, globs);

    let skippedFiles = 0;
    let oversizedFiles = 0;

    const stream = FastGlob.stream(primaryPatterns, {
      cwd: searchPath,
      absolute: true,
      dot: false,
      ignore: ['**/node_modules/**', '**/.git/**', ...ignorePatterns],
    });

    // Per-entry processing returns whether the traversal should continue
    // (keeps the loop body to a single break/continue-free break).
    const processEntry = async (entry: string): Promise<boolean> => {
      if (acc.sentinelObserved || isAborted() || acc.discoveryTruncated) {
        if (isAborted() && !acc.truncated) {
          acc.truncated = true;
          acc.partialReason = 'aborted';
        }
        return false;
      }
      const file = String(entry);
      // Cheap per-entry language-extension filter (no materialized set). For a
      // language-driven traversal this is a no-op; when include globs drive
      // the primary patterns it constrains them to the requested language.
      if (!acceptsAnyExtension) {
        const ext = path.extname(file);
        if (!extensionSet.has(ext)) return true;
      }
      // Observed-file discovery budget with one-over sentinel: the first file
      // beyond the budget is counted (proving partiality) but not searched,
      // then traversal stops. Every observed file is charged even when no
      // match is ever produced.
      acc.filesObserved++;
      if (acc.filesObserved > observedFileBudget) {
        acc.discoveryTruncated = true;
        acc.truncated = true;
        acc.partialReason = 'file-budget';
        return false;
      }
      // Include globs may be absolute or contain parent traversal. Resolve each
      // discovered entry against the requested target before any stat or read;
      // realpath-aware validation also blocks symlink escapes.
      if (!isPathWithinWorkspace([targetDir], file)) {
        skippedFiles++;
        return true;
      }
      // Shared pre-read file-size gate and search, with per-entry accounting.
      const outcome = await this.gateAndSearchDirectoryFile(
        file,
        resolvedLang,
        targetDir,
        acc,
        limit,
        pattern,
        rule,
      );
      if (outcome === 'oversized') oversizedFiles++;
      if (outcome === 'skipped') skippedFiles++;
      return true;
    };

    for await (const entry of stream) {
      if (!(await processEntry(String(entry)))) break;
    }
    return { skippedFiles, oversizedFiles };
  }

  /**
   * Gate one directory file through the pre-read size check and search it
   * when it fits. Returns the per-entry accounting outcome: 'oversized'
   * (skipped for size), 'skipped' (stat error or read/parse failure), or
   * 'searched'. A non-ENOENT stat error (EACCES, EIO, ELOOP) must not abort
   * the whole traversal — it counts as skipped so traversal continues,
   * matching how read errors are handled.
   */
  private async gateAndSearchDirectoryFile(
    file: string,
    resolvedLang: string | Lang,
    targetDir: string,
    acc: MatchAccumulator,
    limit: number,
    pattern: string | undefined,
    rule: Record<string, unknown> | undefined,
  ): Promise<'oversized' | 'skipped' | 'searched'> {
    try {
      const sizeError = await statFileSizeGate(file);
      if (sizeError !== null) {
        return 'oversized';
      }
    } catch {
      return 'skipped';
    }
    const searched = await this.searchSingleDirectoryFile(
      file,
      resolvedLang,
      targetDir,
      acc,
      limit,
      pattern,
      rule,
    );
    return searched ? 'searched' : 'skipped';
  }

  /**
   * Read one directory file and search its content within bounds. Returns
   * false when the file cannot be read (counted as skipped by the caller).
   */
  private async searchSingleDirectoryFile(
    file: string,
    resolvedLang: string | Lang,
    targetDir: string,
    acc: MatchAccumulator,
    limit: number,
    pattern: string | undefined,
    rule: Record<string, unknown> | undefined,
  ): Promise<boolean> {
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
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve the language extension filter AND the glob traversal patterns in
   * one step, since both derive from the resolved language extensions. The
   * extension filter is applied per-entry during the bounded traversal.
   */
  private resolveDirectoryScan(
    resolvedLang: string | Lang,
    globs: string[] | undefined,
  ): {
    primaryPatterns: string[];
    ignorePatterns: string[];
    extensionSet: Set<string>;
    acceptsAnyExtension: boolean;
  } {
    const extensions = this.getExtensionsForLanguage(resolvedLang);
    const { primaryPatterns, ignorePatterns } = this.resolveGlobTraversal(
      globs,
      extensions,
    );
    return {
      primaryPatterns,
      ignorePatterns,
      acceptsAnyExtension: extensions.includes('*'),
      extensionSet: new Set(
        extensions.filter((ext) => ext !== '*').map((ext) => '.' + ext),
      ),
    };
  }

  /**
   * Resolve the primary traversal patterns and ignore patterns from the
   * user-supplied globs WITHOUT materializing path sets. Include globs (no `!`
   * prefix) drive the primary pattern set; exclude globs (`!`-prefixed) are
   * forwarded to FastGlob's `ignore` option. When no include globs are given,
   * the language extensions drive the primary patterns.
   */
  private resolveGlobTraversal(
    globs: string[] | undefined,
    extensions: string[],
  ): { primaryPatterns: string[]; ignorePatterns: string[] } {
    const extensionPatterns = extensions.map((ext) => `**/*.${ext}`);
    if (!globs || globs.length === 0) {
      return { primaryPatterns: extensionPatterns, ignorePatterns: [] };
    }
    const includePatterns = globs.filter((g) => !g.startsWith('!'));
    const excludePatterns = globs
      .filter((g) => g.startsWith('!'))
      .map((g) => g.slice(1));
    const primaryPatterns =
      includePatterns.length > 0 ? includePatterns : extensionPatterns;
    return { primaryPatterns, ignorePatterns: excludePatterns };
  }

  private formatSearchResults(
    matches: AstGrepMatch[],
    truncated: boolean,
    partialReason: AstGrepPartialReason | undefined,
    skippedFiles: number,
    oversizedFiles: number,
    observedCount: number,
    filesObserved: number,
    discoveryTruncated: boolean,
    pattern?: string,
  ): ToolResult {
    const matchCount = matches.length;
    const searchDesc = pattern ? `pattern "${pattern}"` : 'rule query';
    // A skipped (unreadable/unparseable) or oversized file, or a discovery
    // one-over, means the count cannot be exact: there may be unobserved
    // matches in files the tool never reached.
    const inexact = truncated || skippedFiles > 0 || oversizedFiles > 0;

    let llmContent = `Found ${matchCount} AST match${matchCount !== 1 ? 'es' : ''} for ${searchDesc}`;
    if (truncated) {
      let note = ' (truncated; more matches may exist)';
      if (partialReason === 'aborted') {
        note = ' (aborted; more matches may exist)';
      } else if (partialReason === 'file-budget') {
        note = ' (file discovery truncated; more files may contain matches)';
      }
      llmContent += note;
    }
    if (oversizedFiles > 0) {
      llmContent += ` (${oversizedFiles} oversized file${oversizedFiles !== 1 ? 's' : ''} skipped)`;
    }
    if (!truncated && skippedFiles > 0) {
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
      // AND no file was skipped, oversized, or discovery-truncated; it is
      // intentionally omitted otherwise so no consumer mistakes a lower bound
      // for an exhaustive count.
      metadata: {
        matches,
        truncated,
        matchesRetained: matchCount,
        // Lower bound on observed candidates (exact when complete).
        matchesObserved: observedCount,
        // Lower bound on observed files (exact when discovery not truncated).
        filesObserved,
        ...(inexact ? { countInexact: true } : { totalMatches: matchCount }),
        ...(partialReason !== undefined ? { partialReason } : {}),
        ...(discoveryTruncated ? { discoveryTruncated: true } : {}),
        ...(skippedFiles > 0 ? { skippedFiles } : {}),
        ...(oversizedFiles > 0 ? { oversizedFiles } : {}),
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
