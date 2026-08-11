/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fsPromises from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import type { IToolHost, IToolMessageBus } from '../interfaces/index.js';
import { SchemaValidator } from '../utils/schemaValidator.js';
import {
  BoundedCombinedCollector,
  createDefaultByteBudget,
  DEFAULT_ACQUISITION_BUDGET_BYTES,
} from '../acquisition/index.js';
import { BoundedLineFramer } from '../utils/lineFramer.js';
import { terminateProcessTree } from '../utils/processTermination.js';
import {
  createSettleFn,
  type SubprocessSettlement,
  type AbortHandlerRef,
} from '../utils/subprocessSettle.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { stringOrDefault } from '../utils/stringCoalescing.js';
import { getErrorMessage } from '../utils/errors.js';
import { getRipgrepPath } from '../utils/ripgrepPathResolver.js';
import {
  formatRipgrepDiagnostic,
  parseRipgrepLine,
} from './grep/ripgrepParse.js';
export { parseRipgrepLine };
import {
  resolveTextSearchTarget,
  type ResolvedSearchTarget,
} from '../utils/resolveTextSearchTarget.js';
import { debugLogger } from '../utils/debugLogger.js';

export const ripGrepDebugLogger = debugLogger;

const DEFAULT_TOTAL_MAX_MATCHES = 20000;
const MATCH_OVERHEAD_BYTES = 256;
const HARD_RETAINED_MATCH_CAP = 100_000;

export interface RipgrepSemanticBudget {
  remainingBytes: number;
  remainingObjects: number;
}

export function createAggregateSemanticBudget(): RipgrepSemanticBudget {
  return {
    remainingBytes: DEFAULT_ACQUISITION_BUDGET_BYTES,
    remainingObjects: HARD_RETAINED_MATCH_CAP,
  };
}

/**
 * Parameters for the GrepTool
 */
export interface RipGrepToolParams {
  /**
   * The regular expression pattern to search for in file contents
   */
  pattern: string;

  /**
   * The directory to search in (optional, defaults to current directory relative to root)
   */
  path?: string;

  /**
   * File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")
   */
  include?: string;

  /**
   * Whether to respect .gitignore and .llxprtignore patterns (optional, defaults to true)
   */
  file_filtering_options?: {
    respect_git_ignore?: boolean;
    respect_llxprt_ignore?: boolean;
  };
}

export interface RipgrepIgnoreOptions {
  respectGitIgnore: boolean;
  respectLlxprtIgnore: boolean;
  llxprtIgnoreFilePath: string | null;
}

const BASELINE_EXCLUDES: readonly string[] = Object.freeze([
  '.git',
  'node_modules',
  'bower_components',
  '*.log',
  '*.tmp',
  'build',
  'dist',
  'coverage',
]);

export function buildRipgrepArgs(
  pattern: string,
  absolutePath: string,
  include: string | undefined,
  ignoreOptions: RipgrepIgnoreOptions,
): string[] {
  const rgArgs = [
    '--line-number',
    '--no-heading',
    '--with-filename',
    '--null',
    '--ignore-case',
    '--regexp',
    pattern,
  ];

  if (include) {
    rgArgs.push('--glob', include);
  }

  BASELINE_EXCLUDES.forEach((exclude) => {
    rgArgs.push('--glob', `!${exclude}`);
  });

  if (ignoreOptions.respectGitIgnore === false) {
    rgArgs.push('--no-ignore');
  }

  if (ignoreOptions.respectLlxprtIgnore && ignoreOptions.llxprtIgnoreFilePath) {
    rgArgs.push('--ignore-file', ignoreOptions.llxprtIgnoreFilePath);
  }

  rgArgs.push('--threads', '4');
  rgArgs.push(absolutePath);
  return rgArgs;
}

/**
 * Result object for a single grep match
 */
interface GrepMatch {
  filePath: string;
  lineNumber: number;
  line: string;
}

/**
 * Acquisition state for a ripgrep subprocess. Uses record-at-a-time line
 * consumption and bounded semantic retention.
 */
export interface RipgrepAcquisitionState {
  collector: BoundedCombinedCollector;
  framer: BoundedLineFramer;
  matches: GrepMatch[];
  retainedBytes: number;
  semanticBudget: RipgrepSemanticBudget;
  earlyStopped: boolean;
  capReached: boolean;
  budgetExhausted: boolean;
  terminated: boolean;
}

export function createRipgrepAcquisitionState(
  semanticBudget: RipgrepSemanticBudget,
): RipgrepAcquisitionState {
  return {
    collector: new BoundedCombinedCollector({
      budget: createDefaultByteBudget(),
    }),
    framer: new BoundedLineFramer(),
    matches: [],
    retainedBytes: 0,
    semanticBudget,
    earlyStopped: false,
    capReached: false,
    budgetExhausted: false,
    terminated: false,
  };
}

/**
 * Attempt to retain a parsed ripgrep match in bounded semantic storage.
 * Stops when the match count reaches maxMatches or the semantic byte budget
 * is exhausted.
 */
function tryRetainRipgrepMatch(
  state: RipgrepAcquisitionState,
  match: GrepMatch,
  maxMatches: number,
): void {
  if (state.capReached) {
    state.earlyStopped = true;
    return;
  }
  const matchBytes =
    Buffer.byteLength(match.line, 'utf8') +
    Buffer.byteLength(match.filePath, 'utf8') +
    MATCH_OVERHEAD_BYTES;
  if (
    state.semanticBudget.remainingBytes < matchBytes ||
    state.semanticBudget.remainingObjects <= 0
  ) {
    state.budgetExhausted = true;
    state.earlyStopped = true;
    return;
  }
  state.matches.push(match);
  state.retainedBytes += matchBytes;
  state.semanticBudget.remainingBytes -= matchBytes;
  state.semanticBudget.remainingObjects--;
  if (state.matches.length >= maxMatches) {
    state.capReached = true;
  }
}

/**
 * Feed a stdout chunk into the collector and framer, consuming each complete
 * bounded line record-at-a-time via callback. Returns true if early stop
 * or budget exhaustion was triggered.
 */
export function processRipgrepStdoutChunk(
  state: RipgrepAcquisitionState,
  chunk: Buffer,
  basePath: string,
  maxMatches: number,
): boolean {
  state.collector.append(chunk, 'stdout');
  if (state.terminated) return false;

  state.framer.feedChunk(chunk, (line) => {
    if (state.earlyStopped) return;
    const match = parseRipgrepLine(line, basePath);
    if (!match) return;
    tryRetainRipgrepMatch(state, match, maxMatches);
  });

  return state.earlyStopped;
}

/** Flush remaining lines from the framer and retain bounded matches. */
function flushRipgrepLines(
  state: RipgrepAcquisitionState,
  basePath: string,
  maxMatches: number,
): void {
  state.framer.flushRemaining((line) => {
    if (state.earlyStopped) return;
    const match = parseRipgrepLine(line, basePath);
    if (!match) return;
    tryRetainRipgrepMatch(state, match, maxMatches);
  });
}

/**
 * Resolve a ripgrep close event into a result or error. An unexpected signal
 * kill (code null with a non-intentional signal) is treated as genuine failure.
 */
export function resolveRipgrepClose(
  code: number | null,
  signal: NodeJS.Signals | null,
  state: RipgrepAcquisitionState,
  basePath: string,
  maxMatches: number,
  aborted: boolean,
): {
  readonly result?: {
    matches: GrepMatch[];
    earlyStopped: boolean;
    budgetTruncated: boolean;
    lineDropped: boolean;
    rawTruncated: boolean;
  };
  readonly error?: Error;
} {
  if (!state.terminated) {
    flushRipgrepLines(state, basePath, maxMatches);
  }
  const acquisition = state.collector.getResult();
  const diagnostic = formatRipgrepDiagnostic(acquisition);
  const diagnosticSuffix = diagnostic === '' ? '' : `: ${diagnostic}`;
  const result = {
    matches: state.matches,
    earlyStopped: state.earlyStopped,
    budgetTruncated: state.budgetExhausted,
    lineDropped: state.framer.wasLineDropped,
    rawTruncated: acquisition.metadata.truncated,
  };
  if (state.earlyStopped || aborted || state.terminated) {
    return { result };
  }
  if (signal !== null) {
    return {
      error: new Error(
        `ripgrep was killed by signal ${signal}${diagnosticSuffix}`,
      ),
    };
  }
  if (code !== null && code !== 0 && code !== 1) {
    return {
      error: new Error(`ripgrep exited with code ${code}${diagnosticSuffix}`),
    };
  }
  if (code === null) {
    return {
      error: new Error(`ripgrep closed unexpectedly${diagnosticSuffix}`),
    };
  }
  return { result };
}

/** Build the standard ripgrep spawn-failure error. */
function ripgrepSpawnError(err: Error): Error {
  return new Error(
    `Failed to start ripgrep: ${err.message}. Please ensure @lvce-editor/ripgrep is properly installed.`,
  );
}

/** Result of a ripgrep subprocess. */
interface RipgrepSubprocessResult {
  matches: GrepMatch[];
  earlyStopped: boolean;
  budgetTruncated: boolean;
  lineDropped: boolean;
  rawTruncated: boolean;
}

/** Create a ripgrep AbortError recognised by upstream callers. */
function ripgrepAbortError(): Error {
  const err = new Error('ripgrep aborted');
  err.name = 'AbortError';
  return err;
}

/** Spawn and manage a ripgrep child process with bounded acquisition. */
function runRipgrepChild(
  resolvedRgPath: string,
  rgArgs: string[],
  signal: AbortSignal,
  state: RipgrepAcquisitionState,
  basePath: string,
  maxMatches: number,
): Promise<RipgrepSubprocessResult> {
  return new Promise((resolve, reject) => {
    const settlement: SubprocessSettlement = {
      settled: false,
      terminationPromise: null,
    };
    const abortRef: AbortHandlerRef = { handler: () => {} };

    const child = spawn(resolvedRgPath, rgArgs, {
      windowsHide: true,
      detached: process.platform !== 'win32',
    });

    const stopProcess = () => {
      if (state.terminated) return;
      state.terminated = true;
      settlement.terminationPromise = terminateProcessTree(child, {
        ownsProcessGroup: process.platform !== 'win32',
      });
    };

    const settle = createSettleFn(
      settlement,
      signal,
      abortRef,
      reject,
      Error,
      'ripgrep',
    );

    abortRef.handler = () => {
      stopProcess();
      settle(() => reject(ripgrepAbortError()));
    };
    signal.addEventListener('abort', abortRef.handler);

    child.stdout.on('data', (chunk: Buffer) => {
      if (processRipgrepStdoutChunk(state, chunk, basePath, maxMatches)) {
        stopProcess();
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      state.collector.append(chunk, 'stderr');
    });
    child.on('error', (err: Error) => {
      settle(() => {
        reject(signal.aborted ? ripgrepAbortError() : ripgrepSpawnError(err));
      });
    });
    child.on('close', (code: number | null, sig: NodeJS.Signals | null) => {
      settle(() => {
        const outcome = resolveRipgrepClose(
          code,
          sig,
          state,
          basePath,
          maxMatches,
          signal.aborted,
        );
        if (outcome.error !== undefined) reject(outcome.error);
        else if (outcome.result !== undefined) resolve(outcome.result);
      });
    });
  });
}

class GrepToolInvocation extends BaseToolInvocation<
  RipGrepToolParams,
  ToolResult
> {
  constructor(
    private readonly host: IToolHost,
    params: RipGrepToolParams,
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
  }

  private resolveTarget(relativePath?: string): ResolvedSearchTarget {
    return resolveTextSearchTarget(
      this.host.getTargetDir(),
      this.host.getWorkspaceRoots(),
      relativePath,
    );
  }

  private async handleFileSearch(
    resolved: ResolvedSearchTarget & { kind: 'file' },
    searchDirDisplay: string,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const fileResult = await this.performSingleFileSearch(
      this.params.pattern,
      resolved.filePath,
      signal,
    );

    let includeNote = '';
    if (this.params.include) {
      includeNote =
        '\nNote: include filter ignored because a specific file path was provided.';
    }

    if (fileResult.length === 0) {
      const noMatchMsg = `No matches found for pattern "${this.params.pattern}" in file "${searchDirDisplay}".${includeNote}`;
      return { llmContent: noMatchMsg, returnDisplay: 'No matches found' };
    }

    const matchTerm = fileResult.length === 1 ? 'match' : 'matches';
    let llmContent = `Found ${fileResult.length} ${matchTerm} for pattern "${this.params.pattern}" in file "${searchDirDisplay}":${includeNote}
---
File: ${resolved.basename}
`;
    for (const match of fileResult) {
      llmContent += `L${match.lineNumber}: ${match.line.trim()}
`;
    }
    llmContent += '---';

    return {
      llmContent: llmContent.trim(),
      returnDisplay: `Found ${fileResult.length} ${matchTerm}`,
    };
  }

  private resolveSearchDirectories(
    searchDirAbs: string | null,
    workspaceContext: { getDirectories: () => readonly string[] },
  ): readonly string[] {
    if (searchDirAbs === null) {
      return workspaceContext.getDirectories();
    }
    return [searchDirAbs];
  }

  private resolveIgnoreOptions(): RipgrepIgnoreOptions {
    const defaults = this.host.getFileFilteringOptions();
    const respectGitIgnore =
      this.params.file_filtering_options?.respect_git_ignore ??
      defaults.respectGitIgnore;
    const respectLlxprtIgnore =
      this.params.file_filtering_options?.respect_llxprt_ignore ??
      defaults.respectLlxprtIgnore;
    const llxprtIgnoreFilePath = respectLlxprtIgnore
      ? this.host.getLlxprtIgnoreFilePath()
      : null;
    return {
      respectGitIgnore,
      respectLlxprtIgnore,
      llxprtIgnoreFilePath,
    };
  }

  private collectDirectoryMatches(
    searchDirectories: readonly string[],
    signal: AbortSignal,
  ): Promise<{ matches: GrepMatch[]; wasTruncated: boolean }> {
    return this.collectDirectoryMatchesImpl(
      searchDirectories,
      signal,
      DEFAULT_TOTAL_MAX_MATCHES,
      this.resolveIgnoreOptions(),
    );
  }

  private async collectDirectoryMatchesImpl(
    searchDirectories: readonly string[],
    signal: AbortSignal,
    totalMaxMatches: number,
    ignoreOptions: RipgrepIgnoreOptions,
  ): Promise<{ matches: GrepMatch[]; wasTruncated: boolean }> {
    let allMatches: GrepMatch[] = [];
    let wasTruncated = false;
    const aggregateBudget = createAggregateSemanticBudget();

    if (this.host.getDebugMode()) {
      debugLogger.debug(`[GrepTool] Total result limit: ${totalMaxMatches}`);
    }

    let stop = false;
    for (let di = 0; di < searchDirectories.length && !stop; di++) {
      const searchDir = searchDirectories[di];
      const remaining = totalMaxMatches - allMatches.length;
      if (remaining <= 0) {
        allMatches = allMatches.slice(0, totalMaxMatches);
        stop = true;
        continue;
      }

      const searchResult = await this.performRipgrepSearch({
        pattern: this.params.pattern,
        path: searchDir,
        include: this.params.include,
        signal,
        ignoreOptions,
        maxMatches: remaining,
        semanticBudget: aggregateBudget,
      });

      if (
        searchResult.earlyStopped ||
        searchResult.budgetTruncated ||
        searchResult.lineDropped
      ) {
        wasTruncated = true;
      }
      if (searchResult.rawTruncated && this.host.getDebugMode()) {
        debugLogger.debug(
          `[GrepTool] Raw acquisition truncated for root ${searchDir} (diagnostic only, parsed results unaffected)`,
        );
      }

      if (searchDirectories.length > 1) {
        const dirName = path.basename(searchDir);
        searchResult.matches.forEach((match) => {
          match.filePath = path.join(dirName, match.filePath);
        });
      }

      allMatches = allMatches.concat(searchResult.matches);

      if (allMatches.length >= totalMaxMatches) {
        allMatches = allMatches.slice(0, totalMaxMatches);
      }
      stop =
        allMatches.length >= totalMaxMatches || searchResult.budgetTruncated;
    }

    return { matches: allMatches, wasTruncated };
  }

  private buildSearchLocationDescription(
    searchDirAbs: string | null,
    searchDirDisplay: string,
    workspaceContext: { getDirectories: () => readonly string[] },
  ): string {
    if (searchDirAbs === null) {
      const numDirs = workspaceContext.getDirectories().length;
      return numDirs > 1
        ? `across ${numDirs} workspace directories`
        : `in the workspace directory`;
    }
    return `in path "${searchDirDisplay}"`;
  }

  private formatDirectoryResults(
    allMatches: GrepMatch[],
    searchLocationDescription: string,
    dirWasTruncated: boolean,
  ): ToolResult {
    const includeNote = this.params.include
      ? ` (filter: "${this.params.include}")`
      : '';

    if (allMatches.length === 0) {
      if (dirWasTruncated) {
        const msg = `No matches retained for pattern "${this.params.pattern}" ${searchLocationDescription}${includeNote}. Results may be incomplete.`;
        return {
          llmContent: msg,
          returnDisplay: 'No matches shown (incomplete)',
        };
      }
      const noMatchMsg = `No matches found for pattern "${this.params.pattern}" ${searchLocationDescription}${includeNote}.`;
      return { llmContent: noMatchMsg, returnDisplay: `No matches found` };
    }

    const wasTruncated = dirWasTruncated;

    const matchesByFile = allMatches.reduce(
      (acc, match) => {
        const fileKey = match.filePath;
        acc[fileKey] ??= [];
        const fileMatches = acc[fileKey];
        fileMatches.push(match);
        fileMatches.sort((a, b) => a.lineNumber - b.lineNumber);
        return acc;
      },
      {} as Record<string, GrepMatch[]>,
    );

    const matchCount = allMatches.length;

    let llmContent: string;
    let displayMessage: string;
    if (wasTruncated) {
      llmContent = `Showing ${matchCount} matches for pattern "${this.params.pattern}" ${searchLocationDescription}${includeNote} (results may be incomplete)`;
      displayMessage = `Showing ${matchCount} matches (results may be incomplete)`;
    } else {
      const matchTerm = matchCount === 1 ? 'match' : 'matches';
      llmContent = `Found ${matchCount} ${matchTerm} for pattern "${this.params.pattern}" ${searchLocationDescription}${includeNote}`;
      displayMessage = `Found ${matchCount} ${matchTerm}`;
    }

    llmContent += `:\n---\n`;

    for (const filePath in matchesByFile) {
      llmContent += `File: ${filePath}\n`;
      matchesByFile[filePath].forEach((match) => {
        const trimmedLine = match.line.trim();
        llmContent += `L${match.lineNumber}: ${trimmedLine}\n`;
      });
      llmContent += '---\n';
    }

    return {
      llmContent: llmContent.trim(),
      returnDisplay: displayMessage,
    };
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    try {
      const workspaceContext = {
        getDirectories: () => this.host.getWorkspaceRoots(),
      };
      const resolved = this.resolveTarget(this.params.path);
      const searchDirDisplay = stringOrDefault(this.params.path, '.');

      if (resolved.kind === 'file') {
        return await this.handleFileSearch(resolved, searchDirDisplay, signal);
      }

      const searchDirAbs =
        resolved.kind === 'directory' ? resolved.searchDir : null;

      const searchDirectories = this.resolveSearchDirectories(
        searchDirAbs,
        workspaceContext,
      );
      const { matches: allMatches, wasTruncated: dirWasTruncated } =
        await this.collectDirectoryMatches(searchDirectories, signal);

      const searchLocationDescription = this.buildSearchLocationDescription(
        searchDirAbs,
        searchDirDisplay,
        workspaceContext,
      );

      return this.formatDirectoryResults(
        allMatches,
        searchLocationDescription,
        dirWasTruncated,
      );
    } catch (error) {
      debugLogger.warn(`Error during GrepLogic execution: ${error}`);
      const errorMessage = getErrorMessage(error);
      return {
        llmContent: `Error during grep search operation: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
      };
    }
  }

  private async runRipgrepProcess(
    rgArgs: string[],
    signal: AbortSignal,
    maxMatches: number,
    semanticBudget: RipgrepSemanticBudget,
  ): Promise<RipgrepSubprocessResult> {
    const resolvedRgPath = await getRipgrepPath();
    if (signal.aborted) throw ripgrepAbortError();
    const basePath = rgArgs[rgArgs.length - 1] ?? '';
    const state = createRipgrepAcquisitionState(semanticBudget);
    return runRipgrepChild(
      resolvedRgPath,
      rgArgs,
      signal,
      state,
      basePath,
      maxMatches,
    );
  }

  private async performRipgrepSearch(options: {
    pattern: string;
    path: string;
    include?: string;
    signal: AbortSignal;
    ignoreOptions: RipgrepIgnoreOptions;
    maxMatches: number;
    semanticBudget: RipgrepSemanticBudget;
  }): Promise<{
    matches: GrepMatch[];
    earlyStopped: boolean;
    budgetTruncated: boolean;
    lineDropped: boolean;
    rawTruncated: boolean;
  }> {
    const {
      pattern,
      path: absolutePath,
      include,
      signal,
      ignoreOptions,
      maxMatches,
      semanticBudget,
    } = options;

    const rgArgs = buildRipgrepArgs(
      pattern,
      absolutePath,
      include,
      ignoreOptions,
    );

    try {
      return await this.runRipgrepProcess(
        rgArgs,
        signal,
        maxMatches,
        semanticBudget,
      );
    } catch (error: unknown) {
      debugLogger.debug(`GrepLogic: ripgrep failed: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Gets a description of the grep operation
   * @param params Parameters for the grep operation
   * @returns A string describing the grep
   */
  getDescription(): string {
    let description = `'${this.params.pattern}'`;
    if (this.params.include) {
      description += ` in ${this.params.include}`;
    }
    if (this.params.path) {
      try {
        const resolved = this.resolveTarget(this.params.path);
        if (resolved.kind === 'file') {
          const relativePath = makeRelative(
            resolved.filePath,
            this.host.getTargetDir(),
          );
          description += ` in file ${shortenPath(relativePath)}`;
          return description;
        }
      } catch {
        // Fall through to default path display on validation errors
      }
      const resolvedPath = path.resolve(
        this.host.getTargetDir(),
        this.params.path,
      );
      if (
        resolvedPath === this.host.getTargetDir() ||
        this.params.path === '.'
      ) {
        description += ` within ./`;
      } else {
        const relativePath = makeRelative(
          resolvedPath,
          this.host.getTargetDir(),
        );
        description += ` within ${shortenPath(relativePath)}`;
      }
    } else {
      const directories = this.host.getWorkspaceRoots();
      if (directories.length > 1) {
        description += ` across all workspace directories`;
      }
    }
    return description;
  }

  private async performSingleFileSearch(
    pattern: string,
    filePath: string,
    signal: AbortSignal,
  ): Promise<GrepMatch[]> {
    if (signal.aborted) {
      return [];
    }

    const regex = new RegExp(pattern, 'i');
    const content = await fsPromises.readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    const matches: GrepMatch[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        matches.push({
          filePath: path.basename(filePath),
          lineNumber: i + 1,
          line: lines[i],
        });
      }
    }

    return matches;
  }
}

/**
 * Implementation of the Grep tool logic (moved from CLI)
 */
export class RipGrepTool extends BaseDeclarativeTool<
  RipGrepToolParams,
  ToolResult
> {
  static readonly Name = 'search_file_content';

  constructor(private readonly host: IToolHost) {
    super(
      RipGrepTool.Name,
      'SearchText',
      'Searches for a regular expression pattern within the content of files in a specified directory (or current working directory). Can filter files by a glob pattern. Returns the lines containing matches, along with their file paths and line numbers. Total results limited to 20,000 matches like VSCode. Ignore patterns from .gitignore and .llxprtignore are respected by default and can be overridden via file_filtering_options.',
      Kind.Search,
      {
        properties: {
          pattern: {
            description:
              "The regular expression (regex) pattern to search for within file contents (e.g., 'function\\s+myFunction', 'import\\s+\\{.*\\}\\s+from\\s+.*').",
            type: 'string',
          },
          path: {
            description:
              'Optional: The absolute path to the directory to search within. If omitted, searches the current working directory. Can also be a path to a specific file (will search only that file).',
            type: 'string',
          },
          include: {
            description:
              "Optional: A glob pattern to filter which files are searched (e.g., '*.js', '*.{ts,tsx}', 'src/**'). If omitted, searches all files (respecting potential global ignores).",
            type: 'string',
          },
          file_filtering_options: {
            description:
              'Optional: Whether to respect ignore patterns from .gitignore or .llxprtignore',
            type: 'object',
            properties: {
              respect_git_ignore: {
                description:
                  'Optional: Whether to respect .gitignore patterns when searching files. Only available in git repositories. Defaults to true.',
                type: 'boolean',
              },
              respect_llxprt_ignore: {
                description:
                  'Optional: Whether to respect .llxprtignore patterns when searching files. Defaults to true.',
                type: 'boolean',
              },
            },
          },
        },
        required: ['pattern'],
        type: 'object',
      },
    );
  }

  override validateToolParams(params: RipGrepToolParams): string | null {
    const errors = SchemaValidator.validate(
      this.schema.parametersJsonSchema,
      params,
    );
    if (errors) {
      return errors;
    }

    if (params.path) {
      try {
        resolveTextSearchTarget(
          this.host.getTargetDir(),
          this.host.getWorkspaceRoots(),
          params.path,
        );
      } catch (error) {
        return getErrorMessage(error);
      }
    }

    return null;
  }

  protected override createInvocation(
    params: RipGrepToolParams,
    messageBus: IToolMessageBus,
  ): ToolInvocation<RipGrepToolParams, ToolResult> {
    return new GrepToolInvocation(this.host, params, messageBus);
  }

  async execute(
    params: RipGrepToolParams,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<ToolResult> {
    return this.build(params).execute(signal);
  }
}
