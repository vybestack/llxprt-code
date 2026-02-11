/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fsPromises from 'fs/promises';
import path from 'path';
import { EOL } from 'os';
import { spawn } from 'child_process';
// import { rgPath } from '@lvce-editor/ripgrep'; // Now using getRipgrepPath() instead
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { getErrorMessage } from '../utils/errors.js';
import { Config } from '../config/config.js';
import { getRipgrepPath } from '../utils/ripgrepPathResolver.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  resolveTextSearchTarget,
  type ResolvedSearchTarget,
} from '../utils/resolveTextSearchTarget.js';

const DEFAULT_TOTAL_MAX_MATCHES = 20000;

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
}

/**
 * Result object for a single grep match
 */
interface GrepMatch {
  filePath: string;
  lineNumber: number;
  line: string;
}

class GrepToolInvocation extends BaseToolInvocation<
  RipGrepToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: RipGrepToolParams,
  ) {
    super(params);
  }

  private resolveTarget(relativePath?: string): ResolvedSearchTarget {
    return resolveTextSearchTarget(
      this.config.getTargetDir(),
      this.config.getWorkspaceContext(),
      relativePath,
    );
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    try {
      const workspaceContext = this.config.getWorkspaceContext();
      const resolved = this.resolveTarget(this.params.path);
      const searchDirDisplay = this.params.path || '.';

      if (resolved.kind === 'file') {
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

      const searchDirAbs =
        resolved.kind === 'directory' ? resolved.searchDir : null;

      // Determine which directories to search
      let searchDirectories: readonly string[];
      if (searchDirAbs === null) {
        // No path specified - search all workspace directories
        searchDirectories = workspaceContext.getDirectories();
      } else {
        // Specific path provided - search only that directory
        searchDirectories = [searchDirAbs];
      }

      let allMatches: GrepMatch[] = [];
      const totalMaxMatches = DEFAULT_TOTAL_MAX_MATCHES;

      if (this.config.getDebugMode()) {
        console.log(`[GrepTool] Total result limit: ${totalMaxMatches}`);
      }

      for (const searchDir of searchDirectories) {
        const searchResult = await this.performRipgrepSearch({
          pattern: this.params.pattern,
          path: searchDir,
          include: this.params.include,
          signal,
        });

        if (searchDirectories.length > 1) {
          const dirName = path.basename(searchDir);
          searchResult.forEach((match) => {
            match.filePath = path.join(dirName, match.filePath);
          });
        }

        allMatches = allMatches.concat(searchResult);

        if (allMatches.length >= totalMaxMatches) {
          allMatches = allMatches.slice(0, totalMaxMatches);
          break;
        }
      }

      let searchLocationDescription: string;
      if (searchDirAbs === null) {
        const numDirs = workspaceContext.getDirectories().length;
        searchLocationDescription =
          numDirs > 1
            ? `across ${numDirs} workspace directories`
            : `in the workspace directory`;
      } else {
        searchLocationDescription = `in path "${searchDirDisplay}"`;
      }

      if (allMatches.length === 0) {
        const noMatchMsg = `No matches found for pattern "${this.params.pattern}" ${searchLocationDescription}${this.params.include ? ` (filter: "${this.params.include}")` : ''}.`;
        return { llmContent: noMatchMsg, returnDisplay: `No matches found` };
      }

      const wasTruncated = allMatches.length >= totalMaxMatches;

      const matchesByFile = allMatches.reduce(
        (acc, match) => {
          const fileKey = match.filePath;
          if (!acc[fileKey]) {
            acc[fileKey] = [];
          }
          acc[fileKey].push(match);
          acc[fileKey].sort((a, b) => a.lineNumber - b.lineNumber);
          return acc;
        },
        {} as Record<string, GrepMatch[]>,
      );

      const matchCount = allMatches.length;
      const matchTerm = matchCount === 1 ? 'match' : 'matches';

      let llmContent = `Found ${matchCount} ${matchTerm} for pattern "${this.params.pattern}" ${searchLocationDescription}${this.params.include ? ` (filter: "${this.params.include}")` : ''}`;

      if (wasTruncated) {
        llmContent += ` (results limited to ${totalMaxMatches} matches for performance)`;
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

      let displayMessage = `Found ${matchCount} ${matchTerm}`;
      if (wasTruncated) {
        displayMessage += ` (limited)`;
      }

      return {
        llmContent: llmContent.trim(),
        returnDisplay: displayMessage,
      };
    } catch (error) {
      console.error(`Error during GrepLogic execution: ${error}`);
      const errorMessage = getErrorMessage(error);
      return {
        llmContent: `Error during grep search operation: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
      };
    }
  }

  private parseRipgrepOutput(output: string, basePath: string): GrepMatch[] {
    const results: GrepMatch[] = [];
    if (!output) return results;

    const lines = output.split(EOL);

    for (const line of lines) {
      if (!line.trim()) continue;

      const firstColonIndex = line.indexOf(':');
      if (firstColonIndex === -1) continue;

      const secondColonIndex = line.indexOf(':', firstColonIndex + 1);
      if (secondColonIndex === -1) continue;

      const filePathRaw = line.substring(0, firstColonIndex);
      const lineNumberStr = line.substring(
        firstColonIndex + 1,
        secondColonIndex,
      );
      const lineContent = line.substring(secondColonIndex + 1);

      const lineNumber = parseInt(lineNumberStr, 10);

      if (!isNaN(lineNumber)) {
        const absoluteFilePath = path.resolve(basePath, filePathRaw);
        const relativeFilePath = path.relative(basePath, absoluteFilePath);

        results.push({
          filePath: relativeFilePath || path.basename(absoluteFilePath),
          lineNumber,
          line: lineContent,
        });
      }
    }
    return results;
  }

  private async performRipgrepSearch(options: {
    pattern: string;
    path: string;
    include?: string;
    signal: AbortSignal;
  }): Promise<GrepMatch[]> {
    const { pattern, path: absolutePath, include } = options;

    const rgArgs = [
      '--line-number',
      '--no-heading',
      '--with-filename',
      '--ignore-case',
      '--regexp',
      pattern,
    ];

    if (include) {
      rgArgs.push('--glob', include);
    }

    const excludes = [
      '.git',
      'node_modules',
      'bower_components',
      '*.log',
      '*.tmp',
      'build',
      'dist',
      'coverage',
    ];
    excludes.forEach((exclude) => {
      rgArgs.push('--glob', `!${exclude}`);
    });

    rgArgs.push('--threads', '4');
    rgArgs.push(absolutePath);

    try {
      // Use robust cross-platform ripgrep path resolution
      const resolvedRgPath = await getRipgrepPath();

      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(resolvedRgPath, rgArgs, {
          windowsHide: true,
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        const cleanup = () => {
          if (options.signal.aborted) {
            child.kill();
          }
        };

        options.signal.addEventListener('abort', cleanup, { once: true });

        child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
        child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

        child.on('error', (err) => {
          options.signal.removeEventListener('abort', cleanup);
          reject(
            new Error(
              `Failed to start ripgrep: ${err.message}. Please ensure @lvce-editor/ripgrep is properly installed.`,
            ),
          );
        });

        child.on('close', (code) => {
          options.signal.removeEventListener('abort', cleanup);
          const stdoutData = Buffer.concat(stdoutChunks).toString('utf8');
          const stderrData = Buffer.concat(stderrChunks).toString('utf8');

          if (code === 0) {
            resolve(stdoutData);
          } else if (code === 1) {
            resolve(''); // No matches found
          } else {
            reject(
              new Error(`ripgrep exited with code ${code}: ${stderrData}`),
            );
          }
        });
      });

      return this.parseRipgrepOutput(output, absolutePath);
    } catch (error: unknown) {
      console.error(`GrepLogic: ripgrep failed: ${getErrorMessage(error)}`);
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
            this.config.getTargetDir(),
          );
          description += ` in file ${shortenPath(relativePath)}`;
          return description;
        }
      } catch {
        // Fall through to default path display on validation errors
      }
      const resolvedPath = path.resolve(
        this.config.getTargetDir(),
        this.params.path,
      );
      if (
        resolvedPath === this.config.getTargetDir() ||
        this.params.path === '.'
      ) {
        description += ` within ./`;
      } else {
        const relativePath = makeRelative(
          resolvedPath,
          this.config.getTargetDir(),
        );
        description += ` within ${shortenPath(relativePath)}`;
      }
    } else {
      const workspaceContext = this.config.getWorkspaceContext();
      const directories = workspaceContext.getDirectories();
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

  constructor(
    private readonly config: Config,
    _messageBus?: MessageBus,
  ) {
    super(
      RipGrepTool.Name,
      'SearchText',
      'Searches for a regular expression pattern within the content of files in a specified directory (or current working directory). Can filter files by a glob pattern. Returns the lines containing matches, along with their file paths and line numbers. Total results limited to 20,000 matches like VSCode.',
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
          this.config.getTargetDir(),
          this.config.getWorkspaceContext(),
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
    _messageBus?: MessageBus,
  ): ToolInvocation<RipGrepToolParams, ToolResult> {
    return new GrepToolInvocation(this.config, params);
  }
}
