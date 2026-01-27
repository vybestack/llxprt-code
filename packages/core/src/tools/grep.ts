/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { EOL } from 'os';
import { spawn } from 'child_process';
import { globStream } from 'glob';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { getErrorMessage, isNodeError } from '../utils/errors.js';
import { isGitRepository } from '../utils/gitUtils.js';
import { Config } from '../config/config.js';
import { FileExclusions } from '../utils/ignorePatterns.js';
import { ToolErrorType } from './tool-error.js';
import {
  limitOutputTokens,
  formatLimitedOutput,
} from '../utils/toolOutputLimiter.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';

/**
 * Checks if a glob pattern contains brace expansion syntax that git grep doesn't support.
 * Git grep pathspecs don't support shell-style brace expansion like {ts,tsx,js}.
 * Uses indexOf for O(n) complexity instead of regex to avoid ReDoS vulnerability.
 */
function hasBraceExpansion(pattern: string): boolean {
  const braceStart = pattern.indexOf('{');
  if (braceStart === -1) return false;
  const braceEnd = pattern.indexOf('}', braceStart);
  if (braceEnd === -1) return false;
  const commaPos = pattern.indexOf(',', braceStart);
  return commaPos !== -1 && commaPos < braceEnd;
}

// --- Interfaces ---

/**
 * Default timeout for grep operations in milliseconds (1 minute)
 */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Maximum allowed timeout for grep operations in milliseconds (5 minutes)
 */
const MAX_TIMEOUT_MS = 300_000;

/**
 * Parameters for the GrepTool
 */
export interface GrepToolParams {
  /**
   * The regular expression pattern to search for in file contents
   */
  pattern: string;

  /**
   * The directory to search in (optional, defaults to current directory relative to root)
   */
  dir_path?: string;

  /**
   * Alternative parameter name for dir_path (for backward compatibility)
   */
  path?: string;

  /**
   * File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")
   */
  include?: string;

  /**
   * Maximum number of total matches to return (optional)
   */
  max_results?: number;

  /**
   * Maximum number of files to include in results (optional)
   */
  max_files?: number;

  /**
   * Maximum number of matches per file to return (optional)
   */
  max_per_file?: number;

  /**
   * Timeout in milliseconds (default: 60000ms = 1 minute, max: 300000ms = 5 minutes).
   * If the operation times out, an error is returned with suggestions to use a
   * longer timeout or a more specific pattern.
   */
  timeout_ms?: number;
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
  GrepToolParams,
  ToolResult
> {
  private readonly fileExclusions: FileExclusions;

  constructor(
    private readonly config: Config,
    params: GrepToolParams,
  ) {
    super(params);
    this.fileExclusions = config.getFileExclusions();
  }

  private getDirPath(): string | undefined {
    return this.params.dir_path || this.params.path;
  }

  /**
   * Checks if a path is within the root directory and resolves it.
   * @param relativePath Path relative to the root directory (or undefined for root).
   * @returns The absolute path if valid and exists, or null if no path specified (to search all directories).
   * @throws {Error} If path is outside root, doesn't exist, or isn't a directory.
   */
  private resolveAndValidatePath(relativePath?: string): string | null {
    // If no path specified, return null to indicate searching all workspace directories
    if (!relativePath) {
      return null;
    }

    const targetPath = path.resolve(this.config.getTargetDir(), relativePath);

    // Security Check: Ensure the resolved path is within workspace boundaries
    const workspaceContext = this.config.getWorkspaceContext();
    if (!workspaceContext.isPathWithinWorkspace(targetPath)) {
      const directories = workspaceContext.getDirectories();
      throw new Error(
        `Path validation failed: Attempted path "${relativePath}" resolves outside the allowed workspace directories: ${directories.join(', ')}`,
      );
    }

    // Check existence and type after resolving
    try {
      const stats = fs.statSync(targetPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${targetPath}`);
      }
    } catch (error: unknown) {
      if (isNodeError(error) && error.code !== 'ENOENT') {
        throw new Error(`Path does not exist: ${targetPath}`);
      }
      throw new Error(
        `Failed to access path stats for ${targetPath}: ${error}`,
      );
    }

    return targetPath;
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
      // Early return for already-aborted signal
      return {
        llmContent: 'Search operation was cancelled by user.',
        returnDisplay: 'Cancelled',
        error: {
          message: 'Search operation was cancelled by user.',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    } else {
      signal.addEventListener('abort', onUserAbort);
    }

    // Use the combined signal for all operations
    const combinedSignal = timeoutController.signal;

    try {
      const workspaceContext = this.config.getWorkspaceContext();
      const dirPath = this.getDirPath();
      const searchDirAbs = this.resolveAndValidatePath(dirPath);
      const searchDirDisplay = dirPath || '.';

      // Get limits from parameters or ephemeral settings
      const ephemeralSettings = this.config.getEphemeralSettings();
      const maxResults =
        this.params.max_results ??
        (ephemeralSettings['tool-output-max-items'] as number | undefined) ??
        1000; // Higher default for grep than glob
      const maxFiles = this.params.max_files ?? 100;
      const maxPerFile = this.params.max_per_file ?? 50;

      // Determine which directories to search
      let searchDirectories: readonly string[];
      if (searchDirAbs === null) {
        // No path specified - search all workspace directories
        searchDirectories = workspaceContext.getDirectories();
      } else {
        // Specific path provided - search only that directory
        searchDirectories = [searchDirAbs];
      }

      // Collect matches from all search directories
      let allMatches: GrepMatch[] = [];
      let totalMatchesFound = 0;
      const filesWithMatches = new Set<string>();
      let wasLimited = false;

      for (const searchDir of searchDirectories) {
        if (allMatches.length >= maxResults) {
          wasLimited = true;
          break;
        }

        const matches = await this.performGrepSearch({
          pattern: this.params.pattern,
          path: searchDir,
          include: this.params.include,
          signal: combinedSignal,
          maxResults: maxResults - allMatches.length,
          maxFiles: maxFiles - filesWithMatches.size,
          maxPerFile,
        });

        // Track if we hit limits
        if (matches.wasLimited) {
          wasLimited = true;
        }

        // Add directory prefix if searching multiple directories
        if (searchDirectories.length > 1) {
          const dirName = path.basename(searchDir);
          matches.results.forEach((match) => {
            match.filePath = path.join(dirName, match.filePath);
          });
        }

        // Track files and total matches
        matches.results.forEach((match) => {
          filesWithMatches.add(match.filePath);
        });
        totalMatchesFound += matches.totalFound ?? matches.results.length;

        allMatches = allMatches.concat(matches.results);
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

      // Apply max_files limit if needed
      let limitedMatches = allMatches;
      let limitMessage = '';

      if (filesWithMatches.size > maxFiles) {
        const filesToKeep = Array.from(filesWithMatches).slice(0, maxFiles);
        limitedMatches = allMatches.filter((match) =>
          filesToKeep.includes(match.filePath),
        );
        limitMessage = `\n\n**Note: Results limited to ${maxFiles} files out of ${filesWithMatches.size} files with matches.**`;
        wasLimited = true;
      }

      // Apply max_per_file limit if needed
      const matchesByFile = limitedMatches.reduce(
        (acc, match) => {
          const fileKey = match.filePath;
          if (!acc[fileKey]) {
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

      // Count actual matches shown
      const matchCount = Object.values(matchesByFile).reduce(
        (sum, matches) => sum + matches.length,
        0,
      );

      // Build output content
      let llmContent = '';
      if (wasLimited || totalMatchesFound > matchCount) {
        llmContent = `Found ${totalMatchesFound} total matches, showing ${matchCount} for pattern "${this.params.pattern}" ${searchLocationDescription}${this.params.include ? ` (filter: "${this.params.include}")` : ''}:\n---\n`;
      } else {
        const matchTerm = matchCount === 1 ? 'match' : 'matches';
        llmContent = `Found ${matchCount} ${matchTerm} for pattern "${this.params.pattern}" ${searchLocationDescription}${this.params.include ? ` (filter: "${this.params.include}")` : ''}:\n---\n`;
      }

      for (const filePath in matchesByFile) {
        llmContent += `File: ${filePath}\n`;
        matchesByFile[filePath].forEach((match) => {
          const trimmedLine = match.line.trim();
          llmContent += `L${match.lineNumber}: ${trimmedLine}\n`;
        });
        llmContent += '---\n';
      }

      if (limitMessage) {
        llmContent += limitMessage;
      }

      // Apply token limiting as final safety check
      const limited = limitOutputTokens(
        llmContent.trim(),
        this.config,
        'SearchText',
      );

      if (limited.wasTruncated) {
        const formatted = formatLimitedOutput(limited);
        return {
          llmContent: formatted.llmContent,
          returnDisplay: formatted.returnDisplay,
        };
      }

      const displayCount =
        wasLimited || totalMatchesFound > matchCount
          ? `Found ${totalMatchesFound} matches (showing ${matchCount})`
          : `Found ${matchCount} ${matchCount === 1 ? 'match' : 'matches'}`;

      return {
        llmContent: llmContent.trim(),
        returnDisplay: displayCount,
      };
    } catch (error) {
      // Check if this was a timeout vs user abort
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
        // User cancelled - return cancellation result rather than throwing
        return {
          llmContent: 'Search operation was cancelled by user.',
          returnDisplay: 'Cancelled',
          error: {
            message: 'Search operation was cancelled by user.',
            type: ToolErrorType.EXECUTION_FAILED,
          },
        };
      }

      console.error(`Error during GrepLogic execution: ${error}`);
      const errorMessage = getErrorMessage(error);
      return {
        llmContent: `Error during grep search operation: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.GREP_EXECUTION_ERROR,
        },
      };
    } finally {
      // Clean up timeout
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onUserAbort);
    }
  }

  /**
   * Checks if a command is available in the system's PATH.
   * @param {string} command The command name (e.g., 'git', 'grep').
   * @returns {Promise<boolean>} True if the command is available, false otherwise.
   */
  private isCommandAvailable(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const checkCommand = process.platform === 'win32' ? 'where' : 'command';
      const checkArgs =
        process.platform === 'win32' ? [command] : ['-v', command];
      try {
        const child = spawn(checkCommand, checkArgs, {
          stdio: 'ignore',
          shell: true,
        });
        child.on('close', (code) => resolve(code === 0));
        child.on('error', (err) => {
          console.debug(
            `[GrepTool] Failed to start process for '${command}':`,
            err.message,
          );
          resolve(false);
        });
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Apply limits to search results
   */
  private applyLimits(
    matches: GrepMatch[],
    maxResults: number,
    maxFiles: number,
    maxPerFile: number,
  ): { results: GrepMatch[]; wasLimited?: boolean; totalFound?: number } {
    const filesWithMatches = new Map<string, GrepMatch[]>();
    const totalFound = matches.length;

    // Group by file and apply per-file limits
    for (const match of matches) {
      if (!filesWithMatches.has(match.filePath)) {
        filesWithMatches.set(match.filePath, []);
      }
      const fileMatches = filesWithMatches.get(match.filePath)!;
      if (fileMatches.length < maxPerFile) {
        fileMatches.push(match);
      }
    }

    // Apply file limit
    const limitedFiles = Array.from(filesWithMatches.entries()).slice(
      0,
      maxFiles,
    );

    // Flatten and apply total results limit
    const results: GrepMatch[] = [];
    for (const [, fileMatches] of limitedFiles) {
      for (const match of fileMatches) {
        if (results.length >= maxResults) {
          break;
        }
        results.push(match);
      }
      if (results.length >= maxResults) {
        break;
      }
    }

    return {
      results,
      wasLimited:
        results.length < totalFound || filesWithMatches.size > maxFiles,
      totalFound: totalFound > results.length ? totalFound : undefined,
    };
  }

  /**
   * Parses the standard output of grep-like commands (git grep, system grep).
   * Expects format: filePath:lineNumber:lineContent
   * Handles colons within file paths and line content correctly.
   * @param {string} output The raw stdout string.
   * @param {string} basePath The absolute directory the search was run from, for relative paths.
   * @returns {GrepMatch[]} Array of match objects.
   */
  private parseGrepOutput(output: string, basePath: string): GrepMatch[] {
    const results: GrepMatch[] = [];
    if (!output) return results;

    const lines = output.split(EOL); // Use OS-specific end-of-line

    for (const line of lines) {
      if (!line.trim()) continue;

      // Find the index of the first colon.
      const firstColonIndex = line.indexOf(':');
      if (firstColonIndex === -1) continue; // Malformed

      // Find the index of the second colon, searching *after* the first one.
      const secondColonIndex = line.indexOf(':', firstColonIndex + 1);
      if (secondColonIndex === -1) continue; // Malformed

      // Extract parts based on the found colon indices
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
      const resolvedPath = path.resolve(this.config.getTargetDir(), dirPath);
      if (resolvedPath === this.config.getTargetDir() || dirPath === '.') {
        description += ` within ./`;
      } else {
        const relativePath = makeRelative(
          resolvedPath,
          this.config.getTargetDir(),
        );
        description += ` within ${shortenPath(relativePath)}`;
      }
    } else {
      // When no path is specified, indicate searching all workspace directories
      const workspaceContext = this.config.getWorkspaceContext();
      const directories = workspaceContext.getDirectories();
      if (directories.length > 1) {
        description += ` across all workspace directories`;
      }
    }
    return description;
  }

  /**
   * Performs the actual search using the prioritized strategies.
   * @param options Search options including pattern, absolute path, and include glob.
   * @returns A promise resolving to search results with limit information.
   */
  private async performGrepSearch(options: {
    pattern: string;
    path: string; // Expects absolute path
    include?: string;
    signal: AbortSignal;
    maxResults?: number;
    maxFiles?: number;
    maxPerFile?: number;
  }): Promise<{
    results: GrepMatch[];
    wasLimited?: boolean;
    totalFound?: number;
  }> {
    const {
      pattern,
      path: absolutePath,
      include,
      maxResults = 1000,
      maxFiles = 100,
      maxPerFile = 50,
    } = options;
    let strategyUsed = 'none';

    try {
      // --- Strategy 1: git grep ---
      // Skip git grep if include pattern has brace expansion (e.g., *.{ts,tsx})
      // because git grep pathspecs don't support shell-style brace expansion.
      const hasBracePattern = include && hasBraceExpansion(include);
      const isGit = !hasBracePattern && isGitRepository(absolutePath);
      const gitAvailable = isGit && (await this.isCommandAvailable('git'));

      if (gitAvailable) {
        strategyUsed = 'git grep';
        const gitArgs = [
          'grep',
          '--untracked',
          '-n',
          '-E',
          '--ignore-case',
          pattern,
        ];
        if (include) {
          gitArgs.push('--', include);
        }

        try {
          const output = await new Promise<string>((resolve, reject) => {
            const child = spawn('git', gitArgs, {
              cwd: absolutePath,
              windowsHide: true,
            });
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];

            // Handle abort signal to kill child process
            const abortHandler = () => {
              if (!child.killed) {
                child.kill('SIGTERM');
              }
              reject(new Error('git grep aborted'));
            };
            options.signal.addEventListener('abort', abortHandler);

            child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
            child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
            child.on('error', (err) => {
              options.signal.removeEventListener('abort', abortHandler);
              reject(new Error(`Failed to start git grep: ${err.message}`));
            });
            child.on('close', (code) => {
              options.signal.removeEventListener('abort', abortHandler);
              const stdoutData = Buffer.concat(stdoutChunks).toString('utf8');
              const stderrData = Buffer.concat(stderrChunks).toString('utf8');
              if (code === 0) resolve(stdoutData);
              else if (code === 1)
                resolve(''); // No matches
              else
                reject(
                  new Error(`git grep exited with code ${code}: ${stderrData}`),
                );
            });
          });
          const matches = this.parseGrepOutput(output, absolutePath);
          return this.applyLimits(matches, maxResults, maxFiles, maxPerFile);
        } catch (gitError: unknown) {
          console.debug(
            `GrepLogic: git grep failed: ${getErrorMessage(
              gitError,
            )}. Falling back...`,
          );
        }
      }

      // --- Strategy 2: System grep ---
      console.debug(
        'GrepLogic: System grep is being considered as fallback strategy.',
      );

      const grepAvailable = await this.isCommandAvailable('grep');
      if (grepAvailable) {
        strategyUsed = 'system grep';
        const grepArgs = ['-r', '-n', '-H', '-E', '-I'];
        // Extract directory names from exclusion patterns for grep --exclude-dir
        const globExcludes = this.fileExclusions.getGlobExcludes();
        const commonExcludes = globExcludes
          .map((pattern) => {
            let dir = pattern;
            if (dir.startsWith('**/')) {
              dir = dir.substring(3);
            }
            if (dir.endsWith('/**')) {
              dir = dir.slice(0, -3);
            } else if (dir.endsWith('/')) {
              dir = dir.slice(0, -1);
            }

            // Only consider patterns that are likely directories. This filters out file patterns.
            if (dir && !dir.includes('/') && !dir.includes('*')) {
              return dir;
            }
            return null;
          })
          .filter((dir): dir is string => !!dir);
        commonExcludes.forEach((dir) => grepArgs.push(`--exclude-dir=${dir}`));
        if (include) {
          grepArgs.push(`--include=${include}`);
        }
        grepArgs.push(pattern);
        grepArgs.push('.');

        try {
          const output = await new Promise<string>((resolve, reject) => {
            const child = spawn('grep', grepArgs, {
              cwd: absolutePath,
              windowsHide: true,
            });
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];

            // Handle abort signal to kill child process
            const abortHandler = () => {
              if (!child.killed) {
                child.kill('SIGTERM');
              }
              cleanup();
              reject(new Error('system grep aborted'));
            };
            options.signal.addEventListener('abort', abortHandler);

            const onData = (chunk: Buffer) => stdoutChunks.push(chunk);
            const onStderr = (chunk: Buffer) => {
              const stderrStr = chunk.toString();
              // Suppress common harmless stderr messages
              if (
                !stderrStr.includes('Permission denied') &&
                !/grep:.*: Is a directory/i.test(stderrStr)
              ) {
                stderrChunks.push(chunk);
              }
            };
            const onError = (err: Error) => {
              cleanup();
              reject(new Error(`Failed to start system grep: ${err.message}`));
            };
            const onClose = (code: number | null) => {
              const stdoutData = Buffer.concat(stdoutChunks).toString('utf8');
              const stderrData = Buffer.concat(stderrChunks)
                .toString('utf8')
                .trim();
              cleanup();
              if (code === 0) resolve(stdoutData);
              else if (code === 1)
                resolve(''); // No matches
              else {
                if (stderrData)
                  reject(
                    new Error(
                      `System grep exited with code ${code}: ${stderrData}`,
                    ),
                  );
                else resolve(''); // Exit code > 1 but no stderr, likely just suppressed errors
              }
            };

            const cleanup = () => {
              options.signal.removeEventListener('abort', abortHandler);
              child.stdout.removeListener('data', onData);
              child.stderr.removeListener('data', onStderr);
              child.removeListener('error', onError);
              child.removeListener('close', onClose);
              if (child.connected) {
                child.disconnect();
              }
            };

            child.stdout.on('data', onData);
            child.stderr.on('data', onStderr);
            child.on('error', onError);
            child.on('close', onClose);
          });
          const matches = this.parseGrepOutput(output, absolutePath);
          return this.applyLimits(matches, maxResults, maxFiles, maxPerFile);
        } catch (grepError: unknown) {
          console.debug(
            `GrepLogic: System grep failed: ${getErrorMessage(
              grepError,
            )}. Falling back...`,
          );
        }
      }

      // --- Strategy 3: Pure JavaScript Fallback ---
      console.debug(
        'GrepLogic: Falling back to JavaScript grep implementation.',
      );
      strategyUsed = 'javascript fallback';
      const globPattern = include ? include : '**/*';
      const ignorePatterns = this.fileExclusions.getGlobExcludes();

      const filesStream = globStream(globPattern, {
        cwd: absolutePath,
        dot: true,
        ignore: ignorePatterns,
        absolute: true,
        nodir: true,
        signal: options.signal,
      });

      const regex = new RegExp(pattern, 'i');
      const allMatches: GrepMatch[] = [];
      const filesWithMatches = new Set<string>();
      let totalFound = 0;

      for await (const filePath of filesStream) {
        // Check if we've hit file limit
        if (
          filesWithMatches.size >= maxFiles &&
          !filesWithMatches.has(filePath as string)
        ) {
          continue;
        }

        // Check if we've hit total results limit
        if (allMatches.length >= maxResults) {
          break;
        }

        const fileAbsolutePath = filePath as string;
        try {
          const content = await fsPromises.readFile(fileAbsolutePath, 'utf8');
          const lines = content.split(/\r?\n/);
          let matchesInFile = 0;

          lines.forEach((line, index) => {
            if (regex.test(line)) {
              totalFound++;
              if (
                matchesInFile < maxPerFile &&
                allMatches.length < maxResults
              ) {
                allMatches.push({
                  filePath:
                    path.relative(absolutePath, fileAbsolutePath) ||
                    path.basename(fileAbsolutePath),
                  lineNumber: index + 1,
                  line,
                });
                matchesInFile++;
                filesWithMatches.add(fileAbsolutePath);
              }
            }
          });
        } catch (readError: unknown) {
          // Ignore errors like permission denied or file gone during read
          if (!isNodeError(readError) || readError.code !== 'ENOENT') {
            console.debug(
              `GrepLogic: Could not read/process ${fileAbsolutePath}: ${getErrorMessage(
                readError,
              )}`,
            );
          }
        }
      }

      return {
        results: allMatches,
        wasLimited: totalFound > allMatches.length,
        totalFound: totalFound > allMatches.length ? totalFound : undefined,
      };
    } catch (error: unknown) {
      console.error(
        `GrepLogic: Error in performGrepSearch (Strategy: ${strategyUsed}): ${getErrorMessage(
          error,
        )}`,
      );
      throw error; // Re-throw
    }
  }
}

// --- GrepLogic Class ---

/**
 * Implementation of the Grep tool logic (moved from CLI)
 */
export class GrepTool extends BaseDeclarativeTool<GrepToolParams, ToolResult> {
  static readonly Name = 'search_file_content'; // Keep static name

  constructor(
    private readonly config: Config,
    _messageBus?: MessageBus,
  ) {
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
              'Optional: The absolute path to the directory to search within. If omitted, searches the current working directory.',
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

  /**
   * Checks if a path is within the root directory and resolves it.
   * @param relativePath Path relative to the root directory (or undefined for root).
   * @returns The absolute path if valid and exists, or null if no path specified (to search all directories).
   * @throws {Error} If path is outside root, doesn't exist, or isn't a directory.
   */
  private resolveAndValidatePath(relativePath?: string): string | null {
    // If no path specified, return null to indicate searching all workspace directories
    if (!relativePath) {
      return null;
    }

    const targetPath = path.resolve(this.config.getTargetDir(), relativePath);

    // Security Check: Ensure the resolved path is within workspace boundaries
    const workspaceContext = this.config.getWorkspaceContext();
    if (!workspaceContext.isPathWithinWorkspace(targetPath)) {
      const directories = workspaceContext.getDirectories();
      throw new Error(
        `Path validation failed: Attempted path "${relativePath}" resolves outside the allowed workspace directories: ${directories.join(', ')}`,
      );
    }

    // Check existence and type after resolving
    try {
      const stats = fs.statSync(targetPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${targetPath}`);
      }
    } catch (error: unknown) {
      if (isNodeError(error) && error.code !== 'ENOENT') {
        throw new Error(`Path does not exist: ${targetPath}`);
      }
      throw new Error(
        `Failed to access path stats for ${targetPath}: ${error}`,
      );
    }

    return targetPath;
  }

  /**
   * Validates the parameters for the tool
   * @param params Parameters to validate
   * @returns An error message string if invalid, null otherwise
   */
  protected override validateToolParamValues(
    params: GrepToolParams,
  ): string | null {
    try {
      new RegExp(params.pattern);
    } catch (error) {
      return `Invalid regular expression pattern provided: ${params.pattern}. Error: ${getErrorMessage(error)}`;
    }

    // Only validate path if one is provided
    const dirPath = params.dir_path || params.path;
    if (dirPath) {
      try {
        this.resolveAndValidatePath(dirPath);
      } catch (error) {
        return getErrorMessage(error);
      }
    }

    return null; // Parameters are valid
  }

  protected override createInvocation(
    params: GrepToolParams,
    _messageBus?: MessageBus,
  ): ToolInvocation<GrepToolParams, ToolResult> {
    const normalizedParams = { ...params };
    if (!normalizedParams.dir_path && normalizedParams.path) {
      normalizedParams.dir_path = normalizedParams.path;
    }
    return new GrepToolInvocation(this.config, normalizedParams);
  }
}
