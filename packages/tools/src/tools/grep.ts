/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { getErrorMessage } from '../utils/errors.js';
import {
  resolveTextSearchTarget,
  type ResolvedSearchTarget,
} from '../utils/resolveTextSearchTarget.js';
import type { IToolHost, IToolMessageBus } from '../interfaces/index.js';

import { ToolErrorType } from '../types/tool-error.js';
import {
  limitOutputTokens,
  formatLimitedOutput,
} from '../utils/toolOutputLimiter.js';

import { debugLogger } from '../utils/debugLogger.js';
import { stringOrDefault } from '../utils/stringCoalescing.js';
import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  type GrepMatch,
  type GrepToolParams,
} from './grep/types.js';
import {
  performGrepSearch,
  performSingleFileSearch,
} from './grep/search-strategies.js';

export { type GrepToolParams } from './grep/types.js';

class GrepToolInvocation extends BaseToolInvocation<
  GrepToolParams,
  ToolResult
> {
  private readonly fileExclusions: string[];

  constructor(
    private readonly host: IToolHost,
    params: GrepToolParams,
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
    this.fileExclusions = host.getFileExclusions();
  }

  private getDirPath(): string | undefined {
    const resolved = stringOrDefault(
      this.params.dir_path ?? '',
      this.params.path ?? '',
    );
    return resolved.trim() !== '' ? resolved : undefined;
  }

  private resolveTarget(relativePath?: string): ResolvedSearchTarget {
    return resolveTextSearchTarget(
      this.host.getTargetDir(),
      this.host.getWorkspaceRoots(),
      relativePath,
    );
  }

  /**
   * Executes a single-file search and returns a formatted ToolResult.
   */
  private async executeSingleFileSearch(
    resolved: ResolvedSearchTarget & { kind: 'file' },
    combinedSignal: AbortSignal,
    searchDirDisplay: string,
  ): Promise<ToolResult> {
    const fileResult = await performSingleFileSearch(
      this.params.pattern,
      resolved.filePath,
      combinedSignal,
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

    const limited = limitOutputTokens(
      llmContent.trim(),
      this.host,
      'SearchText',
    );

    if (limited.wasTruncated) {
      const formatted = formatLimitedOutput(limited);
      return {
        llmContent: formatted.llmContent,
        returnDisplay: formatted.returnDisplay,
      };
    }

    return {
      llmContent: llmContent.trim(),
      returnDisplay: `Found ${fileResult.length} ${matchTerm}`,
    };
  }

  /**
   * Collects matches across multiple search directories.
   */
  private async collectDirectoryMatches(
    searchDirectories: readonly string[],
    combinedSignal: AbortSignal,
    maxResults: number,
    maxFiles: number,
    maxPerFile: number,
    filesWithMatches: Set<string>,
  ): Promise<{
    allMatches: GrepMatch[];
    totalMatchesFound: number;
    wasLimited: boolean;
  }> {
    let allMatches: GrepMatch[] = [];
    let totalMatchesFound = 0;
    let wasLimited = false;

    for (const searchDir of searchDirectories) {
      if (allMatches.length >= maxResults) {
        wasLimited = true;
        break;
      }

      const matches = await performGrepSearch(
        {
          pattern: this.params.pattern,
          path: searchDir,
          include: this.params.include,
          signal: combinedSignal,
          maxResults: maxResults - allMatches.length,
          maxFiles: maxFiles - filesWithMatches.size,
          maxPerFile,
        },
        this.fileExclusions,
      );

      if (matches.wasLimited === true) {
        wasLimited = true;
      }

      if (searchDirectories.length > 1) {
        const dirName = path.basename(searchDir);
        matches.results.forEach((match) => {
          match.filePath = path.join(dirName, match.filePath);
        });
      }

      matches.results.forEach((match) => {
        filesWithMatches.add(match.filePath);
      });
      totalMatchesFound += matches.totalFound ?? matches.results.length;

      allMatches = allMatches.concat(matches.results);
    }

    return { allMatches, totalMatchesFound, wasLimited };
  }

  /**
   * Applies max_files and max_per_file limits, returning grouped matches,
   * match count, and any limit message.
   */
  private applyFileLimits(
    allMatches: GrepMatch[],
    filesWithMatches: Set<string>,
    maxFiles: number,
    maxPerFile: number,
  ): {
    matchesByFile: Record<string, GrepMatch[]>;
    matchCount: number;
    limitedMatches: GrepMatch[];
    limitMessage: string;
    wasLimited: boolean;
  } {
    let limitedMatches = allMatches;
    let limitMessage = '';
    let wasLimited = false;

    if (filesWithMatches.size > maxFiles) {
      const filesToKeep = Array.from(filesWithMatches).slice(0, maxFiles);
      limitedMatches = allMatches.filter((match) =>
        filesToKeep.includes(match.filePath),
      );
      limitMessage = `

**Note: Results limited to ${maxFiles} files out of ${filesWithMatches.size} files with matches.**`;
      wasLimited = true;
    }

    const matchesByFile = limitedMatches.reduce(
      (acc, match) => {
        const fileKey = match.filePath;
        if (!(fileKey in acc)) {
          acc[fileKey] = [];
        }
        if (acc[fileKey].length < maxPerFile) {
          acc[fileKey].push(match);
        }
        acc[fileKey].sort((a, b) => a.lineNumber - b.lineNumber);
        return acc;
      },
      {} as Record<string, GrepMatch[]>,
    );

    const matchCount = Object.values(matchesByFile).reduce(
      (sum, matches) => sum + matches.length,
      0,
    );

    return {
      matchesByFile,
      matchCount,
      limitedMatches,
      limitMessage,
      wasLimited,
    };
  }

  /**
   * Builds the formatted LLM content string from grouped matches.
   */
  private formatMatchOutput(
    matchesByFile: Record<string, GrepMatch[]>,
    limitMessage: string,
    totalMatchesFound: number,
    matchCount: number,
    wasLimited: boolean,
    searchLocationDescription: string,
  ): string {
    let llmContent = '';
    if (wasLimited || totalMatchesFound > matchCount) {
      llmContent = `Found ${totalMatchesFound} total matches, showing ${matchCount} for pattern "${this.params.pattern}" ${searchLocationDescription}${this.params.include ? ` (filter: "${this.params.include}")` : ''}:
---
`;
    } else {
      const matchTerm = matchCount === 1 ? 'match' : 'matches';
      llmContent = `Found ${matchCount} ${matchTerm} for pattern "${this.params.pattern}" ${searchLocationDescription}${this.params.include ? ` (filter: "${this.params.include}")` : ''}:
---
`;
    }

    for (const filePath in matchesByFile) {
      llmContent += `File: ${filePath}
`;
      matchesByFile[filePath].forEach((match) => {
        const trimmedLine = match.line.trim();
        llmContent += `L${match.lineNumber}: ${trimmedLine}
`;
      });
      llmContent += '---\n';
    }

    if (limitMessage) {
      llmContent += limitMessage;
    }

    return llmContent;
  }

  /**
   * Builds the display count string, flattening the previously nested ternary.
   */
  private buildDisplayCount(
    effectiveWasLimited: boolean,
    totalMatchesFound: number,
    matchCount: number,
  ): string {
    if (effectiveWasLimited || totalMatchesFound > matchCount) {
      return `Found ${totalMatchesFound} matches (showing ${matchCount})`;
    }
    const matchTerm = matchCount === 1 ? 'match' : 'matches';
    return `Found ${matchCount} ${matchTerm}`;
  }

  /**
   * Applies file and per-file limits to matches and builds the output content.
   */
  private buildDirectorySearchResult(
    allMatches: GrepMatch[],
    totalMatchesFound: number,
    wasLimited: boolean,
    filesWithMatches: Set<string>,
    searchLocationDescription: string,
    maxFiles: number,
    maxPerFile: number,
  ): ToolResult {
    if (allMatches.length === 0) {
      const noMatchMsg = `No matches found for pattern "${this.params.pattern}" ${searchLocationDescription}${this.params.include ? ` (filter: "${this.params.include}")` : ''}.`;
      return { llmContent: noMatchMsg, returnDisplay: `No matches found` };
    }

    const {
      matchesByFile,
      matchCount,
      limitMessage,
      wasLimited: limited,
    } = this.applyFileLimits(
      allMatches,
      filesWithMatches,
      maxFiles,
      maxPerFile,
    );

    const effectiveWasLimited = wasLimited || limited;

    const llmContent = this.formatMatchOutput(
      matchesByFile,
      limitMessage,
      totalMatchesFound,
      matchCount,
      effectiveWasLimited,
      searchLocationDescription,
    );

    // Apply token limiting as final safety check
    const limitedOutput = limitOutputTokens(
      llmContent.trim(),
      this.host,
      'SearchText',
    );

    if (limitedOutput.wasTruncated) {
      const formatted = formatLimitedOutput(limitedOutput);
      return {
        llmContent: formatted.llmContent,
        returnDisplay: formatted.returnDisplay,
      };
    }

    const displayCount = this.buildDisplayCount(
      effectiveWasLimited,
      totalMatchesFound,
      matchCount,
    );

    return {
      llmContent: llmContent.trim(),
      returnDisplay: displayCount,
    };
  }

  /**
   * Handles abort/timeout errors from execute, returning appropriate ToolResult.
   */
  private handleExecuteError(
    error: unknown,
    timeoutController: AbortController,
    timeoutMs: number,
    signal: AbortSignal,
  ): ToolResult {
    const isAbortError =
      error instanceof Error &&
      (error.name === 'AbortError' ||
        error.message.includes('aborted') ||
        error.message.includes('This operation was aborted'));

    if (isAbortError) {
      // Check if it was a timeout (our controller aborted but user's didn't)
      if (timeoutController.signal.aborted && !signal.aborted) {
        const timeoutMessage =
          `Search operation timed out after ${timeoutMs}ms. To resolve this, you can either:
` +
          `1. Increase the timeout (max ${MAX_TIMEOUT_MS}ms) by adding timeout_ms parameter
` +
          `2. Use a more specific pattern to reduce search scope
` +
          `3. Use a narrower path or include filter`;
        return {
          llmContent: timeoutMessage,
          returnDisplay: `Timed out after ${timeoutMs}ms`,
          error: {
            message: timeoutMessage,
            type: ToolErrorType.TIMEOUT,
          },
        };
      }
      return {
        llmContent: 'Search operation was cancelled by user.',
        returnDisplay: 'Cancelled',
        error: {
          message: 'Search operation was cancelled by user.',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    debugLogger.error(`Error during GrepLogic execution: ${error}`);
    const errorMessage = getErrorMessage(error);
    return {
      llmContent: `Error during grep search operation: ${errorMessage}`,
      returnDisplay: `Error: ${errorMessage}`,
      error: {
        message: errorMessage,
        type: ToolErrorType.GREP_EXECUTION_ERROR,
      },
    };
  }

  /**
   * Executes the directory search after resolving the target.
   */
  private async executeDirectorySearch(
    resolved: ResolvedSearchTarget,
    workspaceContext: readonly string[],
    combinedSignal: AbortSignal,
    searchDirDisplay: string,
  ): Promise<ToolResult> {
    const ephemeralSettings = this.host.getEphemeralSettings();
    const maxResults =
      this.params.max_results ??
      (ephemeralSettings['tool-output-max-items'] as number | undefined) ??
      1000;
    const maxFiles = this.params.max_files ?? 100;
    const maxPerFile = this.params.max_per_file ?? 50;

    if (resolved.kind === 'file') {
      return this.executeSingleFileSearch(
        resolved as ResolvedSearchTarget & { kind: 'file' },
        combinedSignal,
        searchDirDisplay,
      );
    }

    // Determine which directories to search
    let searchDirectories: readonly string[];
    if (resolved.kind === 'all-workspaces') {
      searchDirectories = workspaceContext;
    } else {
      searchDirectories = [resolved.searchDir];
    }

    const filesWithMatches = new Set<string>();
    const { allMatches, totalMatchesFound, wasLimited } =
      await this.collectDirectoryMatches(
        searchDirectories,
        combinedSignal,
        maxResults,
        maxFiles,
        maxPerFile,
        filesWithMatches,
      );

    let searchLocationDescription: string;
    if (resolved.kind === 'all-workspaces') {
      const numDirs = workspaceContext.length;
      searchLocationDescription =
        numDirs > 1
          ? `across ${numDirs} workspace directories`
          : `in the workspace directory`;
    } else {
      searchLocationDescription = `in path "${searchDirDisplay}"`;
    }

    return this.buildDirectorySearchResult(
      allMatches,
      totalMatchesFound,
      wasLimited,
      filesWithMatches,
      searchLocationDescription,
      maxFiles,
      maxPerFile,
    );
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    // Set up timeout handling
    const timeoutMs = Math.min(
      this.params.timeout_ms ?? DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    );
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

    // Combine user abort with timeout abort
    const onUserAbort = () => {
      clearTimeout(timeoutId);
      timeoutController.abort();
    };
    if (signal.aborted) {
      clearTimeout(timeoutId);
      timeoutController.abort();
      return {
        llmContent: 'Search operation was cancelled by user.',
        returnDisplay: 'Cancelled',
        error: {
          message: 'Search operation was cancelled by user.',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
    signal.addEventListener('abort', onUserAbort, { once: true });

    const combinedSignal = timeoutController.signal;

    try {
      const workspaceContext = this.host.getWorkspaceRoots();
      const dirPath = this.getDirPath();
      const resolved = this.resolveTarget(dirPath);
      const searchDirDisplay = stringOrDefault(dirPath, '.');

      return await this.executeDirectorySearch(
        resolved,
        workspaceContext,
        combinedSignal,
        searchDirDisplay,
      );
    } catch (error) {
      return this.handleExecuteError(
        error,
        timeoutController,
        timeoutMs,
        signal,
      );
    } finally {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onUserAbort);
    }
  }

  /**
   * Gets a description of the grep operation
   * @returns A string describing the grep
   */
  getDescription(): string {
    let description = `'${this.params.pattern}'`;
    if (this.params.include) {
      description += ` in ${this.params.include}`;
    }
    const dirPath = this.getDirPath();
    if (dirPath) {
      try {
        const resolved = this.resolveTarget(dirPath);
        if (resolved.kind === 'file') {
          const relativePath = makeRelative(
            resolved.filePath,
            this.host.getTargetDir(),
          );
          description += ` in ${shortenPath(relativePath)}`;
          return description;
        }
      } catch {
        // Fall through to default path display on validation errors
      }
      const resolvedPath = path.resolve(this.host.getTargetDir(), dirPath);
      if (resolvedPath === this.host.getTargetDir() || dirPath === '.') {
        description += ` within ./`;
      } else {
        const relativePath = makeRelative(
          resolvedPath,
          this.host.getTargetDir(),
        );
        description += ` within ${shortenPath(relativePath)}`;
      }
    } else {
      const workspaceContext = this.host.getWorkspaceRoots();
      const directories = workspaceContext;
      if (directories.length > 1) {
        description += ` across all workspace directories`;
      }
    }
    return description;
  }
}

/**
 * Implementation of the Grep tool logic (moved from CLI)
 */
export class GrepTool extends BaseDeclarativeTool<GrepToolParams, ToolResult> {
  static readonly Name = 'search_file_content'; // Keep static name

  constructor(private readonly host: IToolHost) {
    super(
      GrepTool.Name,
      'SearchText',
      'Searches for a regular expression pattern within the content of files in a specified directory (or current working directory). Can filter files by a glob pattern. Returns the lines containing matches, along with their file paths and line numbers.',
      Kind.Search,
      {
        properties: {
          pattern: {
            description:
              "The regular expression (regex) pattern to search for within file contents (e.g., 'function\\s+myFunction', 'import\\s+\\{.*\\}\\s+from\\s+.*').",
            type: 'string',
          },
          dir_path: {
            description:
              'Optional: The absolute path to the directory to search within. If omitted, searches the current working directory. Can also be a path to a specific file (will search only that file).',
            type: 'string',
          },
          path: {
            description:
              'Alternative parameter name for dir_path (for backward compatibility).',
            type: 'string',
          },
          include: {
            description:
              "Optional: A glob pattern to filter which files are searched (e.g., '*.js', '*.{ts,tsx}', 'src/**'). If omitted, searches all files (respecting potential global ignores).",
            type: 'string',
          },
          max_results: {
            description:
              'Optional: Maximum number of total matches to return. Defaults to tool-output-max-items setting or 1000.',
            type: 'number',
          },
          max_files: {
            description:
              'Optional: Maximum number of files to include in results. Defaults to 100.',
            type: 'number',
          },
          max_per_file: {
            description:
              'Optional: Maximum number of matches per file to return. Defaults to 50.',
            type: 'number',
          },
          timeout_ms: {
            description:
              'Optional: Timeout in milliseconds (default: 60000ms = 1 minute, max: 300000ms = 5 minutes). If the operation times out, an error is returned with suggestions.',
            type: 'number',
          },
        },
        required: ['pattern'],
        type: 'object',
      },
    );
  }

  protected override validateToolParamValues(
    params: GrepToolParams,
  ): string | null {
    try {
      new RegExp(params.pattern);
    } catch (error) {
      return `Invalid regular expression pattern provided: ${params.pattern}. Error: ${getErrorMessage(error)}`;
    }

    const dirPath = stringOrDefault(params.dir_path ?? '', params.path ?? '');
    if (dirPath.trim() !== '') {
      try {
        resolveTextSearchTarget(
          this.host.getTargetDir(),
          this.host.getWorkspaceRoots(),
          dirPath,
        );
      } catch (error) {
        return getErrorMessage(error);
      }
    }

    return null;
  }

  protected override createInvocation(
    params: GrepToolParams,
    messageBus: IToolMessageBus,
  ): ToolInvocation<GrepToolParams, ToolResult> {
    const normalizedParams = { ...params };
    if (!normalizedParams.dir_path && normalizedParams.path) {
      normalizedParams.dir_path = normalizedParams.path;
    }
    return new GrepToolInvocation(this.host, normalizedParams, messageBus);
  }
}
