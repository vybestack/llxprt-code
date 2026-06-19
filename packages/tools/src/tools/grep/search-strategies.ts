/**
 * Search strategy implementations for the grep tool.
 *
 * Contains the three-tier search strategy:
 *   1. git grep (fastest, respects .gitignore)
 *   2. system grep (fallback when git is unavailable)
 *   3. pure JavaScript fallback (always available)
 *
 * Extracted from grep.ts to keep the main file focused on the tool facade.
 */

import fsPromises from 'fs/promises';
import path from 'path';
import { EOL } from 'os';
import { spawn } from 'child_process';
import { globStream } from 'glob';

import { getErrorMessage, isNodeError } from '../../utils/errors.js';
import { isGitRepository } from '../../utils/gitUtils.js';
import { debugLogger } from '../../utils/debugLogger.js';
import type { GrepMatch, SearchResults, SearchOptions } from './types.js';

/**
 * Checks if a glob pattern contains brace expansion syntax that git grep doesn't support.
 * Git grep pathspecs don't support shell-style brace expansion like {ts,tsx,js}.
 * Uses indexOf for O(n) complexity instead of regex to avoid ReDoS vulnerability.
 */
export function hasBraceExpansion(pattern: string): boolean {
  const braceStart = pattern.indexOf('{');
  if (braceStart === -1) return false;
  const braceEnd = pattern.indexOf('}', braceStart);
  if (braceEnd === -1) return false;
  const commaPos = pattern.indexOf(',', braceStart);
  return commaPos !== -1 && commaPos < braceEnd;
}

/**
 * Checks if a command is available in the system's PATH.
 */
export function isCommandAvailable(command: string): Promise<boolean> {
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
        debugLogger.debug(
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
 * Parses the standard output of grep-like commands (git grep, system grep).
 * Expects format: filePath:lineNumber:lineContent
 */
/**
 * Parses a single grep output line into a GrepMatch, or null if malformed.
 */
function parseGrepLine(line: string, basePath: string): GrepMatch | null {
  if (!line.trim()) return null;

  const firstColonIndex = line.indexOf(':');
  if (firstColonIndex === -1) return null;

  const secondColonIndex = line.indexOf(':', firstColonIndex + 1);
  if (secondColonIndex === -1) return null;

  const filePathRaw = line.substring(0, firstColonIndex);
  const lineNumberStr = line.substring(firstColonIndex + 1, secondColonIndex);
  const lineContent = line.substring(secondColonIndex + 1);

  const lineNumber = parseInt(lineNumberStr, 10);
  if (isNaN(lineNumber)) return null;

  const absoluteFilePath = path.resolve(basePath, filePathRaw);
  const relativeFilePath = path.relative(basePath, absoluteFilePath);

  return {
    filePath: relativeFilePath || path.basename(absoluteFilePath),
    lineNumber,
    line: lineContent,
  };
}

export function parseGrepOutput(output: string, basePath: string): GrepMatch[] {
  const results: GrepMatch[] = [];
  if (!output) return results;

  const lines = output.split(EOL);

  for (const line of lines) {
    const match = parseGrepLine(line, basePath);
    if (match) {
      results.push(match);
    }
  }
  return results;
}

/**
 * Flatten the grouped matches into a flat list, respecting maxResults.
 * Uses a guard clause instead of nested break statements.
 */
function flattenGroupedMatches(
  limitedFiles: Array<[string, GrepMatch[]]>,
  maxResults: number,
): GrepMatch[] {
  const results: GrepMatch[] = [];
  const limitReached = () => results.length >= maxResults;

  for (const [, fileMatches] of limitedFiles) {
    if (limitReached()) break;
    for (const match of fileMatches) {
      if (limitReached()) break;
      results.push(match);
    }
  }
  return results;
}

/**
 * Apply limits to search results (max results, max files, max per file).
 */
export function applyLimits(
  matches: GrepMatch[],
  maxResults: number,
  maxFiles: number,
  maxPerFile: number,
): SearchResults {
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

  const results = flattenGroupedMatches(limitedFiles, maxResults);

  return {
    results,
    wasLimited: results.length < totalFound || filesWithMatches.size > maxFiles,
    totalFound: totalFound > results.length ? totalFound : undefined,
  };
}

/**
 * Runs git grep as Strategy 1.
 */
export async function tryGitGrep(
  pattern: string,
  absolutePath: string,
  include: string | undefined,
  abortSignal: AbortSignal,
  maxResults: number,
  maxFiles: number,
  maxPerFile: number,
  hasBracePattern: boolean,
): Promise<SearchResults | null> {
  const isGit = !hasBracePattern && isGitRepository(absolutePath);
  const gitAvailable = isGit && (await isCommandAvailable('git'));

  if (!gitAvailable) return null;

  const gitArgs = ['grep', '--untracked', '-n', '-E', '--ignore-case', pattern];
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

      const abortHandler = () => {
        if (!child.killed) {
          child.kill('SIGTERM');
        }
        reject(new Error('git grep aborted'));
      };
      abortSignal.addEventListener('abort', abortHandler);

      child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
      child.on('error', (err) => {
        abortSignal.removeEventListener('abort', abortHandler);
        reject(new Error(`Failed to start git grep: ${err.message}`));
      });
      child.on('close', (code) => {
        abortSignal.removeEventListener('abort', abortHandler);
        const stdoutData = Buffer.concat(stdoutChunks).toString('utf8');
        const stderrData = Buffer.concat(stderrChunks).toString('utf8');
        if (code === 0) resolve(stdoutData);
        else if (code === 1)
          resolve(''); // No matches
        else
          reject(new Error(`git grep exited with code ${code}: ${stderrData}`));
      });
    });
    const matches = parseGrepOutput(output, absolutePath);
    return applyLimits(matches, maxResults, maxFiles, maxPerFile);
  } catch (gitError: unknown) {
    debugLogger.debug(
      `GrepLogic: git grep failed: ${getErrorMessage(
        gitError,
      )}. Falling back...`,
    );
    return null;
  }
}

/**
 * Builds the grep args for system grep, including exclusion patterns.
 */
export function buildSystemGrepArgs(
  pattern: string,
  include: string | undefined,
  fileExclusions: readonly string[],
): string[] {
  const grepArgs = ['-r', '-n', '-H', '-E', '-I'];
  const globExcludes = fileExclusions;
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

      // Only consider patterns that are likely directories
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
  return grepArgs;
}

/**
 * Sets up event handlers for a spawned grep child process.
 */
function setupSystemGrepHandlers(
  child: ReturnType<typeof spawn>,
  abortSignal: AbortSignal,
  stdoutChunks: Buffer[],
  stderrChunks: Buffer[],
  resolve: (value: string) => void,
  reject: (reason: Error) => void,
): () => void {
  const abortHandler = () => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
    cleanup();
    reject(new Error('system grep aborted'));
  };
  abortSignal.addEventListener('abort', abortHandler);

  const onData = (chunk: Buffer) => stdoutChunks.push(chunk);
  const onStderr = (chunk: Buffer) => {
    const stderrStr = chunk.toString();
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
    const stderrData = Buffer.concat(stderrChunks).toString('utf8').trim();
    cleanup();
    if (code === 0) resolve(stdoutData);
    else if (code === 1)
      resolve(''); // No matches
    else if (stderrData)
      reject(new Error(`System grep exited with code ${code}: ${stderrData}`));
    else resolve(''); // Exit code > 1 but no stderr, likely just suppressed errors
  };

  const cleanup = () => {
    abortSignal.removeEventListener('abort', abortHandler);
    child.stdout!.removeListener('data', onData);
    child.stderr!.removeListener('data', onStderr);
    child.removeListener('error', onError);
    child.removeListener('close', onClose);
    if (child.connected) {
      child.disconnect();
    }
  };

  child.stdout!.on('data', onData);
  child.stderr!.on('data', onStderr);
  child.on('error', onError);
  child.on('close', onClose);

  return cleanup;
}

/**
 * Runs system grep as Strategy 2.
 */
export async function trySystemGrep(
  grepArgs: string[],
  absolutePath: string,
  abortSignal: AbortSignal,
  maxResults: number,
  maxFiles: number,
  maxPerFile: number,
): Promise<SearchResults | null> {
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn('grep', grepArgs, {
        cwd: absolutePath,
        windowsHide: true,
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      setupSystemGrepHandlers(
        child,
        abortSignal,
        stdoutChunks,
        stderrChunks,
        resolve,
        reject,
      );
    });
    const matches = parseGrepOutput(output, absolutePath);
    return applyLimits(matches, maxResults, maxFiles, maxPerFile);
  } catch (grepError: unknown) {
    debugLogger.debug(
      `GrepLogic: System grep failed: ${getErrorMessage(
        grepError,
      )}. Falling back...`,
    );
    return null;
  }
}

/**
 * Extracts matches from a single file's content lines.
 */
function extractMatchesFromFile(
  lines: string[],
  fileAbsolutePath: string,
  absolutePath: string,
  regex: RegExp,
  maxPerFile: number,
  maxResults: number,
  allMatches: GrepMatch[],
  filesWithMatches: Set<string>,
): number {
  let matchesInFile = 0;
  let totalFound = 0;

  lines.forEach((line, index) => {
    if (regex.test(line)) {
      totalFound++;
      if (matchesInFile < maxPerFile && allMatches.length < maxResults) {
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

  return totalFound;
}

/**
 * Determines whether the JS fallback loop should continue to the next file.
 * Returns false if the results limit is reached (caller should stop the loop)
 * or if the file limit is reached for a new file.
 */
function shouldProcessFile(
  allMatchesLength: number,
  maxResults: number,
  filesWithMatchesSize: number,
  maxFiles: number,
  isKnownFile: boolean,
): boolean {
  if (allMatchesLength >= maxResults) {
    return false;
  }
  if (filesWithMatchesSize >= maxFiles && !isKnownFile) {
    return false;
  }
  return true;
}

/**
 * Processes a single file for matches during the JS fallback, accumulating
 * into the shared collections.
 */
async function processFallbackFile(
  filePath: string,
  absolutePath: string,
  regex: RegExp,
  maxPerFile: number,
  maxResults: number,
  allMatches: GrepMatch[],
  filesWithMatches: Set<string>,
): Promise<number> {
  const fileAbsolutePath = filePath;
  try {
    const content = await fsPromises.readFile(fileAbsolutePath, 'utf8');
    const lines = content.split(/\r?\n/);

    return extractMatchesFromFile(
      lines,
      fileAbsolutePath,
      absolutePath,
      regex,
      maxPerFile,
      maxResults,
      allMatches,
      filesWithMatches,
    );
  } catch (readError: unknown) {
    // Ignore errors like permission denied or file gone during read
    if (!isNodeError(readError) || readError.code !== 'ENOENT') {
      debugLogger.debug(
        `GrepLogic: Could not read/process ${fileAbsolutePath}: ${getErrorMessage(
          readError,
        )}`,
      );
    }
    return 0;
  }
}

/**
 * Pure JavaScript fallback for grep (Strategy 3).
 */
export async function javascriptGrepFallback(
  pattern: string,
  absolutePath: string,
  include: string | undefined,
  abortSignal: AbortSignal,
  maxResults: number,
  maxFiles: number,
  maxPerFile: number,
  fileExclusions: readonly string[],
): Promise<SearchResults> {
  const globPattern = include ?? '**/*';
  const ignorePatterns = [...fileExclusions];

  const filesStream = globStream(globPattern, {
    cwd: absolutePath,
    dot: true,
    ignore: ignorePatterns,
    absolute: true,
    nodir: true,
    signal: abortSignal,
  });

  const regex = new RegExp(pattern, 'i');
  const allMatches: GrepMatch[] = [];
  const filesWithMatches = new Set<string>();
  let totalFound = 0;

  for await (const filePath of filesStream) {
    if (
      !shouldProcessFile(
        allMatches.length,
        maxResults,
        filesWithMatches.size,
        maxFiles,
        filesWithMatches.has(filePath),
      )
    ) {
      // Stop entirely if we've hit the results limit; otherwise just skip
      if (allMatches.length >= maxResults) {
        break;
      }
    } else {
      totalFound += await processFallbackFile(
        filePath,
        absolutePath,
        regex,
        maxPerFile,
        maxResults,
        allMatches,
        filesWithMatches,
      );
    }
  }

  return {
    results: allMatches,
    wasLimited: totalFound > allMatches.length,
    totalFound: totalFound > allMatches.length ? totalFound : undefined,
  };
}

/**
 * Attempts system grep (Strategy 2), returning null to fall through.
 */
async function trySystemGrepStrategy(
  pattern: string,
  absolutePath: string,
  include: string | undefined,
  signal: AbortSignal,
  maxResults: number,
  maxFiles: number,
  maxPerFile: number,
  fileExclusions: readonly string[],
): Promise<SearchResults | null> {
  debugLogger.debug(
    'GrepLogic: System grep is being considered as fallback strategy.',
  );

  const grepAvailable = await isCommandAvailable('grep');
  if (!grepAvailable) return null;

  const grepArgs = buildSystemGrepArgs(pattern, include, fileExclusions);
  return trySystemGrep(
    grepArgs,
    absolutePath,
    signal,
    maxResults,
    maxFiles,
    maxPerFile,
  );
}

/**
 * Executes a single-file search and returns matches.
 */
export async function performSingleFileSearch(
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

/**
 * Performs the actual search using the prioritized strategies:
 * git grep → system grep → JavaScript fallback.
 */
export async function performGrepSearch(
  options: SearchOptions,
  fileExclusions: readonly string[],
): Promise<SearchResults> {
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
    const hasBracePattern =
      typeof include === 'string' &&
      include.length > 0 &&
      hasBraceExpansion(include);

    const gitResult = await tryGitGrep(
      pattern,
      absolutePath,
      include,
      options.signal,
      maxResults,
      maxFiles,
      maxPerFile,
      hasBracePattern,
    );
    if (gitResult !== null) {
      return gitResult;
    }

    // --- Strategy 2: System grep ---
    strategyUsed = 'system grep';
    const sysResult = await trySystemGrepStrategy(
      pattern,
      absolutePath,
      include,
      options.signal,
      maxResults,
      maxFiles,
      maxPerFile,
      fileExclusions,
    );
    if (sysResult !== null) {
      return sysResult;
    }

    // --- Strategy 3: Pure JavaScript Fallback ---
    debugLogger.debug(
      'GrepLogic: Falling back to JavaScript grep implementation.',
    );
    strategyUsed = 'javascript fallback';
    return await javascriptGrepFallback(
      pattern,
      absolutePath,
      include,
      options.signal,
      maxResults,
      maxFiles,
      maxPerFile,
      fileExclusions,
    );
  } catch (error: unknown) {
    debugLogger.error(
      `GrepLogic: Error in performGrepSearch (Strategy: ${strategyUsed}): ${getErrorMessage(
        error,
      )}`,
    );
    throw error; // Re-throw
  }
}
