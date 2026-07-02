/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { glob, escape } from 'glob';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import { ToolErrorType } from '../types/tool-error.js';
import type { IToolHost, IToolMessageBus } from '../interfaces/index.js';
import { shortenPath, makeRelative } from '../utils/paths.js';
import { debugLogger } from '../utils/debugLogger.js';
import { validatePathWithinWorkspace } from '../utils/pathValidation.js';
import { stringOrDefault } from '../utils/stringCoalescing.js';

// Subset of 'Path' interface provided by 'glob' that we can implement for testing
export interface GlobPath {
  fullpath(): string;
  mtimeMs?: number;
}

/**
 * Sorts file entries based on recency and then alphabetically.
 * Recent files (modified within recencyThresholdMs) are listed first, newest to oldest.
 * Older files are listed after recent ones, sorted alphabetically by path.
 */
export function sortFileEntries(
  entries: GlobPath[],
  nowTimestamp: number,
  recencyThresholdMs: number,
): GlobPath[] {
  const sortedEntries = [...entries];
  sortedEntries.sort((a, b) => {
    const mtimeA = a.mtimeMs ?? 0;
    const mtimeB = b.mtimeMs ?? 0;
    const aIsRecent = nowTimestamp - mtimeA < recencyThresholdMs;
    const bIsRecent = nowTimestamp - mtimeB < recencyThresholdMs;

    if (aIsRecent && bIsRecent) {
      return mtimeB - mtimeA;
    } else if (aIsRecent) {
      return -1;
    } else if (bIsRecent) {
      return 1;
    }
    return a.fullpath().localeCompare(b.fullpath());
  });
  return sortedEntries;
}

/**
 * Parameters for the GlobTool
 */
export interface GlobToolParams {
  /**
   * The glob pattern to match files against
   */
  pattern: string;

  /**
   * The directory to search in (optional, defaults to current directory)
   */
  dir_path?: string;

  /**
   * Alternative parameter name for dir_path (for backward compatibility)
   */
  path?: string;

  /**
   * Whether the search should be case-sensitive (optional, defaults to false)
   */
  case_sensitive?: boolean;

  /**
   * @deprecated Use `file_filtering_options.respect_git_ignore` instead. When
   * used without `file_filtering_options`, setting this to false preserves
   * legacy behavior by disabling all ignore filtering; setting it to true uses
   * the host's .llxprtignore default.
   */
  respect_git_ignore?: boolean;

  /**
   * Whether to respect .gitignore and .llxprtignore patterns (optional, defaults to true)
   */
  file_filtering_options?: {
    respect_git_ignore?: boolean;
    respect_llxprt_ignore?: boolean;
  };
}

class GlobToolInvocation extends BaseToolInvocation<
  GlobToolParams,
  ToolResult
> {
  constructor(
    private readonly host: IToolHost,
    params: GlobToolParams,
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
  }

  private getDirPath(): string | undefined {
    const resolved = stringOrDefault(
      this.params.dir_path ?? '',
      this.params.path ?? '',
    );
    return resolved.trim() !== '' ? resolved : undefined;
  }

  getDescription(): string {
    let description = `'${this.params.pattern}'`;
    const dirPath = this.getDirPath();
    if (dirPath) {
      const searchDir = path.resolve(this.host.getTargetDir(), dirPath || '.');
      const relativePath = makeRelative(searchDir, this.host.getTargetDir());
      description += ` within ${shortenPath(relativePath)}`;
    }
    return description;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    try {
      const ephemeralSettings = this.host.getEphemeralSettings();
      const maxItems =
        (ephemeralSettings['tool-output-max-items'] as number | undefined) ??
        50;

      const searchDirectoriesResult = this.resolveSearchDirectories(
        this.host.getWorkspaceRoots(),
      );

      if (searchDirectoriesResult.error) return searchDirectoriesResult.error;
      const searchDirectories = searchDirectoriesResult.directories;

      const defaultFileIgnores = this.host.getFileFilteringOptions();
      const usingLegacyRespectGitIgnore =
        this.params.file_filtering_options === undefined &&
        this.params.respect_git_ignore !== undefined;
      if (this.params.respect_git_ignore !== undefined) {
        debugLogger.warn(
          usingLegacyRespectGitIgnore
            ? 'GlobTool: respect_git_ignore is deprecated; use file_filtering_options.respect_git_ignore instead.'
            : 'GlobTool: both respect_git_ignore and file_filtering_options were provided; using file_filtering_options.',
        );
      }
      const respectGitIgnore = this.resolveRespectGitIgnore(
        defaultFileIgnores.respectGitIgnore,
        usingLegacyRespectGitIgnore,
      );
      const respectLlxprtIgnore = this.resolveRespectLlxprtIgnore(
        defaultFileIgnores.respectLlxprtIgnore,
        usingLegacyRespectGitIgnore,
      );
      const fileFilteringOptions = { respectGitIgnore, respectLlxprtIgnore };
      const fileDiscovery = this.host.getFileService();

      const allEntries = await this.collectGlobEntries(
        searchDirectories,
        signal,
      );
      const { filteredEntries, ignoredCount } = this.applyFileFilters(
        allEntries,
        fileFilteringOptions,
        fileDiscovery,
      );

      if (filteredEntries.length === 0) {
        return this.buildNoFilesResult(searchDirectories, ignoredCount);
      }

      return this.buildFileListResult(
        filteredEntries,
        searchDirectories,
        ignoredCount,
        maxItems,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      debugLogger.error(`GlobLogic execute Error: ${errorMessage}`, error);
      const rawError = `Error during glob search operation: ${errorMessage}`;
      return {
        llmContent: rawError,
        returnDisplay: `Error: An unexpected error occurred.`,
        error: {
          message: rawError,
          type: ToolErrorType.GLOB_EXECUTION_ERROR,
        },
      };
    }
  }

  private resolveRespectGitIgnore(
    defaultRespectGitIgnore: boolean,
    usingLegacyRespectGitIgnore: boolean,
  ): boolean {
    if (usingLegacyRespectGitIgnore) {
      return this.params.respect_git_ignore ?? defaultRespectGitIgnore;
    }
    return (
      this.params.file_filtering_options?.respect_git_ignore ??
      defaultRespectGitIgnore
    );
  }

  private resolveRespectLlxprtIgnore(
    defaultRespectLlxprtIgnore: boolean,
    usingLegacyRespectGitIgnore: boolean,
  ): boolean {
    if (usingLegacyRespectGitIgnore) {
      return this.params.respect_git_ignore === false
        ? false
        : defaultRespectLlxprtIgnore;
    }
    return (
      this.params.file_filtering_options?.respect_llxprt_ignore ??
      defaultRespectLlxprtIgnore
    );
  }

  private resolveSearchDirectories(workspaceRoots: readonly string[]): {
    directories: readonly string[];
    error?: ToolResult;
  } {
    const dirPath = this.getDirPath();
    if (dirPath) {
      const searchDirAbsolute = path.resolve(this.host.getTargetDir(), dirPath);
      const pathError = validatePathWithinWorkspace(
        workspaceRoots,
        searchDirAbsolute,
        'Search path',
      );
      if (pathError) {
        return {
          directories: [],
          error: {
            llmContent: pathError,
            returnDisplay: 'Path is not within workspace',
            error: {
              message: pathError,
              type: ToolErrorType.PATH_NOT_IN_WORKSPACE,
            },
          },
        };
      }
      return { directories: [searchDirAbsolute] };
    }
    return { directories: workspaceRoots };
  }

  private async collectGlobEntries(
    searchDirectories: readonly string[],
    signal: AbortSignal,
  ): Promise<GlobPath[]> {
    let allEntries: GlobPath[] = [];
    for (const searchDir of searchDirectories) {
      let pattern = this.params.pattern;
      const fullPath = path.join(searchDir, pattern);
      if (fs.existsSync(fullPath)) {
        pattern = escape(pattern);
      }
      const entries = (await glob(pattern, {
        cwd: searchDir,
        withFileTypes: true,
        nodir: true,
        stat: true,
        nocase: this.params.case_sensitive !== true,
        dot: true,
        ignore: this.host.getFileExclusions(),
        follow: false,
        signal,
      })) as GlobPath[];
      allEntries = allEntries.concat(entries);
    }
    return allEntries;
  }

  private applyFileFilters(
    entries: GlobPath[],
    fileFilteringOptions: {
      respectGitIgnore: boolean;
      respectLlxprtIgnore: boolean;
    },
    fileDiscovery: {
      filterFiles(
        paths: string[],
        opts: { respectGitIgnore: boolean; respectLlxprtIgnore: boolean },
      ): string[];
    },
  ): { filteredEntries: GlobPath[]; ignoredCount: number } {
    if (
      !fileFilteringOptions.respectGitIgnore &&
      !fileFilteringOptions.respectLlxprtIgnore
    ) {
      return { filteredEntries: entries, ignoredCount: 0 };
    }
    const toCanonicalPath = (filePath: string): string => {
      try {
        return fs.realpathSync(filePath);
      } catch {
        return path.normalize(filePath);
      }
    };
    const canonicalPaths = entries.map((entry) =>
      toCanonicalPath(entry.fullpath()),
    );
    const filteredCanonicalPaths = new Set(
      fileDiscovery
        .filterFiles(canonicalPaths, {
          respectGitIgnore: fileFilteringOptions.respectGitIgnore,
          respectLlxprtIgnore: fileFilteringOptions.respectLlxprtIgnore,
        })
        .map((p) => toCanonicalPath(p)),
    );
    const filteredEntries = entries.filter((entry) =>
      filteredCanonicalPaths.has(toCanonicalPath(entry.fullpath())),
    );
    return {
      filteredEntries,
      ignoredCount: entries.length - filteredEntries.length,
    };
  }

  private buildNoFilesResult(
    searchDirectories: readonly string[],
    ignoredCount: number,
  ): ToolResult {
    let message = `No files found matching pattern "${this.params.pattern}"`;
    if (searchDirectories.length === 1) {
      message += ` within ${searchDirectories[0]}`;
    } else {
      message += ` within ${searchDirectories.length} workspace directories`;
    }
    if (ignoredCount > 0) {
      message += ` (${ignoredCount} files were ignored)`;
    }
    return { llmContent: message, returnDisplay: `No files found` };
  }

  private buildFileListResult(
    filteredEntries: GlobPath[],
    searchDirectories: readonly string[],
    ignoredCount: number,
    maxItems: number,
  ): ToolResult {
    const oneDayInMs = 24 * 60 * 60 * 1000;
    const nowTimestamp = new Date().getTime();
    const sortedEntries = sortFileEntries(
      filteredEntries,
      nowTimestamp,
      oneDayInMs,
    );
    const sortedAbsolutePaths = sortedEntries.map((entry) => entry.fullpath());
    const totalFileCount = sortedAbsolutePaths.length;
    let fileListToShow = sortedAbsolutePaths;
    let truncatedMessage = '';

    if (totalFileCount > maxItems) {
      fileListToShow = sortedAbsolutePaths.slice(0, maxItems);
      truncatedMessage = `\n\n**Note: Output limited to ${maxItems} files out of ${totalFileCount} total matches. Use more specific patterns or adjust 'tool-output-max-items' setting to see more.**`;
    }

    const fileListDescription = fileListToShow.join('\n');
    let resultMessage = `Found ${totalFileCount} file(s) matching "${this.params.pattern}"`;
    if (searchDirectories.length === 1) {
      resultMessage += ` within ${searchDirectories[0]}`;
    } else {
      resultMessage += ` across ${searchDirectories.length} workspace directories`;
    }
    if (ignoredCount > 0) {
      resultMessage += ` (${ignoredCount} additional files were ignored)`;
    }
    if (totalFileCount > 0) {
      resultMessage += `, sorted by modification time (newest first):\n${fileListDescription}`;
    }
    resultMessage += truncatedMessage;
    return {
      llmContent: resultMessage,
      returnDisplay: `Found ${totalFileCount} matching file(s)`,
    };
  }
}

/**
 * Implementation of the Glob tool logic
 */
export class GlobTool extends BaseDeclarativeTool<GlobToolParams, ToolResult> {
  static readonly Name = 'glob';

  constructor(private readonly host: IToolHost) {
    super(
      GlobTool.Name,
      'FindFiles',
      'Efficiently finds files matching specific glob patterns (e.g., `src/**/*.ts`, `**/*.md`), returning absolute paths sorted by modification time (newest first). Ideal for quickly locating files based on their name or path structure, especially in large codebases.',
      Kind.Search,
      {
        properties: {
          pattern: {
            description:
              "The glob pattern to match against (e.g., '**/*.py', 'docs/*.md').",
            type: 'string',
          },
          dir_path: {
            description:
              'Optional: The absolute path to the directory to search within. If omitted, searches the root directory. Relative paths are resolved against the working directory.',
            type: 'string',
          },
          path: {
            description:
              'Alternative parameter name for dir_path (for backward compatibility).',
            type: 'string',
          },
          case_sensitive: {
            description:
              'Optional: Whether the search should be case-sensitive. Defaults to false.',
            type: 'boolean',
          },
          respect_git_ignore: {
            description:
              'Deprecated: use file_filtering_options.respect_git_ignore. If file_filtering_options is provided, it takes precedence over this legacy option. Defaults to true.',
            type: 'boolean',
          },
          file_filtering_options: {
            description:
              'Optional: Whether to respect ignore patterns from .gitignore or .llxprtignore',
            type: 'object',
            properties: {
              respect_git_ignore: {
                description:
                  'Optional: Whether to respect .gitignore patterns when finding files. Only available in git repositories. Defaults to true.',
                type: 'boolean',
              },
              respect_llxprt_ignore: {
                description:
                  'Optional: Whether to respect .llxprtignore patterns when finding files. Defaults to true.',
                type: 'boolean',
              },
            },
            additionalProperties: false,
          },
        },
        required: ['pattern'],
        type: 'object',
      },
    );
  }

  /**
   * Validates the parameters for the tool.
   */
  protected override validateToolParamValues(
    params: GlobToolParams,
  ): string | null {
    const dirPath = stringOrDefault(params.dir_path ?? '', params.path ?? '');
    const searchDirAbsolute = path.resolve(
      this.host.getTargetDir(),
      stringOrDefault(dirPath, '.'),
    );
    const pathError = validatePathWithinWorkspace(
      this.host.getWorkspaceRoots(),
      searchDirAbsolute,
      'Search path',
    );

    if (pathError) {
      return pathError;
    }

    const targetDir = searchDirAbsolute || this.host.getTargetDir();
    try {
      if (!fs.existsSync(targetDir)) {
        return `Search path does not exist ${targetDir}`;
      }
      if (!fs.statSync(targetDir).isDirectory()) {
        return `Search path is not a directory: ${targetDir}`;
      }
    } catch (e: unknown) {
      return `Error accessing search path: ${e}`;
    }

    if (
      !params.pattern ||
      typeof params.pattern !== 'string' ||
      params.pattern.trim() === ''
    ) {
      return "The 'pattern' parameter cannot be empty.";
    }

    return null;
  }

  protected override createInvocation(
    params: GlobToolParams,
    messageBus: IToolMessageBus,
  ): ToolInvocation<GlobToolParams, ToolResult> {
    const normalizedParams = { ...params };
    if (!normalizedParams.dir_path && normalizedParams.path) {
      normalizedParams.dir_path = normalizedParams.path;
    }
    return new GlobToolInvocation(this.host, normalizedParams, messageBus);
  }
}
