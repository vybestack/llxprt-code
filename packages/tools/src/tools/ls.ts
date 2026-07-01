/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import { ToolErrorType } from '../types/tool-error.js';
import type { IToolHost, IToolMessageBus } from '../interfaces/index.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { debugLogger } from '../utils/debugLogger.js';
import { validatePathWithinWorkspace } from '../utils/pathValidation.js';
import { stringOrDefault } from '../utils/stringCoalescing.js';

/**
 * Parameters for the LS tool
 */
export interface LSToolParams {
  /**
   * The absolute path to the directory to list
   */
  dir_path?: string;

  /**
   * Alternative parameter name for dir_path (for backward compatibility)
   */
  path?: string;

  /**
   * Array of glob patterns to ignore (optional)
   */
  ignore?: string[];

  /**
   * Whether to respect .gitignore and .llxprtignore patterns (optional, defaults to true)
   */
  file_filtering_options?: {
    respect_git_ignore?: boolean;
    respect_llxprt_ignore?: boolean;
  };
}

/**
 * File entry returned by LS tool
 */
export interface FileEntry {
  /**
   * Name of the file or directory
   */
  name: string;

  /**
   * Absolute path to the file or directory
   */
  path: string;

  /**
   * Whether this entry is a directory
   */
  isDirectory: boolean;

  /**
   * Size of the file in bytes (0 for directories)
   */
  size: number;

  /**
   * Last modified timestamp
   */
  modifiedTime: Date;
}

class LSToolInvocation extends BaseToolInvocation<LSToolParams, ToolResult> {
  constructor(
    private readonly host: IToolHost,
    params: LSToolParams,
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
  }

  private getDirPath(): string {
    return stringOrDefault(
      this.params.dir_path,
      stringOrDefault(this.params.path, ''),
    );
  }

  /**
   * Checks whether a filename matches any of the ignore patterns.
   * @param filename Filename to check
   * @param patterns Array of glob patterns to check against
   * @returns True when the filename matches an ignore pattern.
   */
  private shouldIgnore(filename: string, patterns?: string[]): boolean {
    if (!patterns || patterns.length === 0) {
      return false;
    }
    for (const pattern of patterns) {
      // Convert glob pattern to RegExp, escaping special characters individually
      const regexPattern = globToRegexPattern(pattern);
      const regex = new RegExp(`^${regexPattern}$`);
      if (regex.test(filename)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Gets a description of the file reading operation
   * @returns A string describing the file being read
   */
  getDescription(): string {
    const dirPath = this.getDirPath();
    const relativePath = makeRelative(dirPath, this.host.getTargetDir());
    return shortenPath(relativePath);
  }

  // Helper for consistent error formatting
  private errorResult(
    llmContent: string,
    returnDisplay: string,
    type: ToolErrorType,
  ): ToolResult {
    return {
      llmContent,
      // Keep returnDisplay simpler in core logic
      returnDisplay: `Error: ${returnDisplay}`,
      error: {
        message: llmContent,
        type,
      },
    };
  }

  /**
   * Executes the LS operation with the given parameters
   * @returns Result of the LS operation
   */
  async execute(_signal: AbortSignal): Promise<ToolResult> {
    try {
      const dirPath = this.getDirPath();
      const stats = fs.statSync(dirPath);
      if (!stats.isDirectory()) {
        return this.errorResult(
          `Error: Path is not a directory: ${dirPath}`,
          `Path is not a directory.`,
          ToolErrorType.PATH_IS_NOT_A_DIRECTORY,
        );
      }

      const files = fs.readdirSync(dirPath);
      if (files.length === 0) {
        return {
          llmContent: `Directory ${dirPath} is empty.`,
          returnDisplay: `Directory is empty.`,
        };
      }

      const { entries, ignoredCount } = this.collectEntries(dirPath, files);
      return this.formatListingResult(dirPath, entries, ignoredCount);
    } catch (error) {
      const errorMsg = `Error listing directory: ${error instanceof Error ? error.message : String(error)}`;
      return this.errorResult(
        errorMsg,
        'Failed to list directory.',
        ToolErrorType.LS_EXECUTION_ERROR,
      );
    }
  }

  private collectEntries(
    dirPath: string,
    files: string[],
  ): { entries: FileEntry[]; ignoredCount: number } {
    const defaultFileIgnores = this.host.getFileFilteringOptions();
    const fileFilteringOptions = {
      respectGitIgnore:
        this.params.file_filtering_options?.respect_git_ignore ??
        defaultFileIgnores.respectGitIgnore,
      respectLlxprtIgnore:
        this.params.file_filtering_options?.respect_llxprt_ignore ??
        defaultFileIgnores.respectLlxprtIgnore,
    };
    const fileDiscovery = this.host.getFileService();

    const entries: FileEntry[] = [];
    let ignoredCount = 0;

    for (const file of files) {
      const result = this.processFile(
        file,
        dirPath,
        fileFilteringOptions,
        fileDiscovery,
      );
      if (result.entry) {
        entries.push(result.entry);
      }
      if (result.ignored) {
        ignoredCount++;
      }
    }
    return { entries, ignoredCount };
  }

  private processFile(
    file: string,
    dirPath: string,
    fileFilteringOptions: {
      respectGitIgnore: boolean;
      respectLlxprtIgnore: boolean;
    },
    fileDiscovery: ReturnType<typeof this.host.getFileService>,
  ): { entry: FileEntry | null; ignored: boolean } {
    if (this.shouldIgnore(file, this.params.ignore)) {
      return { entry: null, ignored: false };
    }

    const fullPath = path.join(dirPath, file);
    const relativePath = path.relative(this.host.getTargetDir(), fullPath);

    // Delegate to the unified decision path so that .llxprtignore negations
    // can un-ignore gitignored files when both flags are true.
    if (fileDiscovery.shouldIgnoreFile(relativePath, fileFilteringOptions)) {
      return { entry: null, ignored: true };
    }

    try {
      const stats = fs.statSync(fullPath);
      const isDir = stats.isDirectory();
      return {
        entry: {
          name: file,
          path: fullPath,
          isDirectory: isDir,
          size: isDir ? 0 : stats.size,
          modifiedTime: stats.mtime,
        },
        ignored: false,
      };
    } catch (error) {
      debugLogger.error(`Error accessing ${fullPath}: ${error}`);
      return { entry: null, ignored: false };
    }
  }

  private formatListingResult(
    dirPath: string,
    entries: FileEntry[],
    ignoredCount: number,
  ): ToolResult {
    entries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    const directoryContent = entries
      .map((entry) => `${entry.isDirectory ? '[DIR] ' : ''}${entry.name}`)
      .join('\n');

    let resultMessage = `Directory listing for ${dirPath}:\n${directoryContent}`;
    if (ignoredCount > 0) {
      resultMessage += `\n\n(${ignoredCount} ignored)`;
    }

    let displayMessage = `Listed ${entries.length} item(s).`;
    if (ignoredCount > 0) {
      displayMessage += ` (${ignoredCount} ignored)`;
    }

    return {
      llmContent: resultMessage,
      returnDisplay: displayMessage,
    };
  }
}

/**
 * Implementation of the LS tool logic
 */
export class LSTool extends BaseDeclarativeTool<LSToolParams, ToolResult> {
  static readonly Name = 'list_directory';

  constructor(
    private host: IToolHost,
    messageBus?: IToolMessageBus,
  ) {
    super(
      LSTool.Name,
      'ReadFolder',
      'Lists the names of files and subdirectories directly within a specified directory path. Can optionally ignore entries matching provided glob patterns.',
      Kind.Search,
      {
        properties: {
          dir_path: {
            description:
              'The absolute path to the directory to list (must be absolute, not relative)',
            type: 'string',
          },
          path: {
            description:
              'Alternative parameter name for dir_path (for backward compatibility).',
            type: 'string',
          },
          ignore: {
            description: 'List of glob patterns to ignore',
            items: {
              type: 'string',
            },
            type: 'array',
          },
          file_filtering_options: {
            description:
              'Optional: Whether to respect ignore patterns from .gitignore or .llxprtignore',
            type: 'object',
            properties: {
              respect_git_ignore: {
                description:
                  'Optional: Whether to respect .gitignore patterns when listing files. Only available in git repositories. Defaults to true.',
                type: 'boolean',
              },
              respect_llxprt_ignore: {
                description:
                  'Optional: Whether to respect .llxprtignore patterns when listing files. Defaults to true.',
                type: 'boolean',
              },
            },
          },
        },
        required: [],
        type: 'object',
      },
      true,
      false,
      messageBus,
    );
  }

  protected override createInvocation(
    params: LSToolParams,
    messageBus: IToolMessageBus,
  ): ToolInvocation<LSToolParams, ToolResult> {
    const normalizedParams = { ...params };
    if (!normalizedParams.dir_path && normalizedParams.path) {
      normalizedParams.dir_path = normalizedParams.path;
    }

    return new LSToolInvocation(this.host, normalizedParams, messageBus);
  }

  /**
   * Validates the parameters for the tool
   * @param params Parameters to validate
   * @returns An error message string if invalid, null otherwise
   */
  protected override validateToolParamValues(
    params: LSToolParams,
  ): string | null {
    const dirPath = stringOrDefault(params.dir_path ?? '', params.path ?? '');
    if (dirPath.trim() === '') {
      return "Either 'dir_path' or 'path' parameter must be provided and non-empty.";
    }

    if (!path.isAbsolute(dirPath)) {
      return `Path must be absolute: ${dirPath}`;
    }

    const pathError = validatePathWithinWorkspace(
      this.host.getWorkspaceRoots(),
      dirPath,
      'Path',
    );
    if (pathError) {
      return pathError;
    }
    const noValidationError = null;
    return noValidationError;
  }
}

/**
 * Converts a glob pattern into a regex source string by escaping
 * special regex characters and replacing glob wildcards.
 * Uses character-by-character scanning to avoid complex regex.
 */
function globToRegexPattern(pattern: string): string {
  const specialChars = new Set([
    '.',
    '+',
    '^',
    '$',
    '{',
    '}',
    '(',
    ')',
    '|',
    '[',
    ']',
    '\\',
  ]);
  let result = '';
  for (const ch of pattern) {
    if (specialChars.has(ch)) {
      result += '\\' + ch;
    } else if (ch === '*') {
      result += '.*';
    } else if (ch === '?') {
      result += '.';
    } else {
      result += ch;
    }
  }
  return result;
}
