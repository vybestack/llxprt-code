/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { glob, escape } from 'glob';
import type { ToolInvocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import { shortenPath, makeRelative } from '../utils/paths.js';
import { type Config } from '../config/config.js';
import { ToolErrorType } from './tool-error.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';

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
    } else {
      return a.fullpath().localeCompare(b.fullpath());
    }
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
   * Whether to respect .gitignore patterns (optional, defaults to true)
   */
  respect_git_ignore?: boolean;
}

class GlobToolInvocation extends BaseToolInvocation<
  GlobToolParams,
  ToolResult
> {
  constructor(
    private config: Config,
    params: GlobToolParams,
  ) {
    super(params);
  }

  private getDirPath(): string | undefined {
    return this.params.dir_path || this.params.path;
  }

  getDescription(): string {
    let description = `'${this.params.pattern}'`;
    const dirPath = this.getDirPath();
    if (dirPath) {
      const searchDir = path.resolve(
        this.config.getTargetDir(),
        dirPath || '.',
      );
      const relativePath = makeRelative(searchDir, this.config.getTargetDir());
      description += ` within ${shortenPath(relativePath)}`;
    }
    return description;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    try {
      // Get ephemeral settings for output limits
      const ephemeralSettings = this.config.getEphemeralSettings();
      const maxItems =
        (ephemeralSettings['tool-output-max-items'] as number | undefined) ??
        50;

      const workspaceContext = this.config.getWorkspaceContext();
      const workspaceDirectories = workspaceContext.getDirectories();

      // If a specific path is provided, resolve it and check if it's within workspace
      let searchDirectories: readonly string[];
      const dirPath = this.getDirPath();
      if (dirPath) {
        const searchDirAbsolute = path.resolve(
          this.config.getTargetDir(),
          dirPath,
        );
        if (!workspaceContext.isPathWithinWorkspace(searchDirAbsolute)) {
          const rawError = `Error: Path "${dirPath}" is not within any workspace directory`;
          return {
            llmContent: rawError,
            returnDisplay: `Path is not within workspace`,
            error: {
              message: rawError,
              type: ToolErrorType.PATH_NOT_IN_WORKSPACE,
            },
          };
        }
        searchDirectories = [searchDirAbsolute];
      } else {
        // Search across all workspace directories
        searchDirectories = workspaceDirectories;
      }

      // Get centralized file discovery service
      const respectGitIgnore =
        this.params.respect_git_ignore ??
        this.config.getFileFilteringRespectGitIgnore();
      const fileDiscovery = this.config.getFileService();

      // Collect entries from all search directories
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
          nocase: !this.params.case_sensitive,
          dot: true,
          ignore: this.config.getFileExclusions().getGlobExcludes(),
          follow: false,
          signal,
        })) as GlobPath[];

        allEntries = allEntries.concat(entries);
      }

      const entries = allEntries;

      // Apply git-aware filtering if enabled and in git repository
      let filteredEntries = entries;
      let ignoredCount = 0;

      if (respectGitIgnore) {
        const toCanonicalPath = (filePath: string): string => {
          try {
            return fs.realpathSync(filePath);
          } catch (_error) {
            return path.normalize(filePath);
          }
        };

        const canonicalPaths = entries.map((entry) =>
          toCanonicalPath(entry.fullpath()),
        );
        const filteredCanonicalPaths = new Set(
          fileDiscovery
            .filterFiles(canonicalPaths, {
              respectGitIgnore,
              respectLlxprtIgnore: false,
            })
            .map((p) => toCanonicalPath(p)),
        );

        filteredEntries = entries.filter((entry) =>
          filteredCanonicalPaths.has(toCanonicalPath(entry.fullpath())),
        );
        ignoredCount = entries.length - filteredEntries.length;
      }

      if (!filteredEntries || filteredEntries.length === 0) {
        let message = `No files found matching pattern "${this.params.pattern}"`;
        if (searchDirectories.length === 1) {
          message += ` within ${searchDirectories[0]}`;
        } else {
          message += ` within ${searchDirectories.length} workspace directories`;
        }
        if (ignoredCount > 0) {
          message += ` (${ignoredCount} files were ignored)`;
        }
        return {
          llmContent: message,
          returnDisplay: `No files found`,
        };
      }

      // Set filtering such that we first show the most recent files
      const oneDayInMs = 24 * 60 * 60 * 1000;
      const nowTimestamp = new Date().getTime();

      // Sort the filtered entries using the new helper function
      const sortedEntries = sortFileEntries(
        filteredEntries,
        nowTimestamp,
        oneDayInMs,
      );

      const sortedAbsolutePaths = sortedEntries.map((entry) =>
        entry.fullpath(),
      );

      const totalFileCount = sortedAbsolutePaths.length;
      let fileListToShow = sortedAbsolutePaths;
      let truncatedMessage = '';

      // Apply max items limit
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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`GlobLogic execute Error: ${errorMessage}`, error);
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
}

/**
 * Implementation of the Glob tool logic
 */
export class GlobTool extends BaseDeclarativeTool<GlobToolParams, ToolResult> {
  static readonly Name = 'glob';

  constructor(
    private config: Config,
    _messageBus?: MessageBus,
  ) {
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
              'Optional: Whether to respect .gitignore patterns when finding files. Only available in git repositories. Defaults to true.',
            type: 'boolean',
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
    const dirPath = params.dir_path || params.path;
    const searchDirAbsolute = path.resolve(
      this.config.getTargetDir(),
      dirPath || '.',
    );

    const workspaceContext = this.config.getWorkspaceContext();
    if (!workspaceContext.isPathWithinWorkspace(searchDirAbsolute)) {
      const directories = workspaceContext.getDirectories();
      return `Search path ("${searchDirAbsolute}") resolves outside the allowed workspace directories: ${directories.join(', ')}`;
    }

    const targetDir = searchDirAbsolute || this.config.getTargetDir();
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
    _messageBus?: MessageBus,
  ): ToolInvocation<GlobToolParams, ToolResult> {
    const normalizedParams = { ...params };
    if (!normalizedParams.dir_path && normalizedParams.path) {
      normalizedParams.dir_path = normalizedParams.path;
    }
    return new GlobToolInvocation(this.config, normalizedParams);
  }
}
