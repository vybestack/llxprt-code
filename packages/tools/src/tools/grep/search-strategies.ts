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
import { spawn } from 'child_process';

import { getErrorMessage } from '../../utils/errors.js';
import { isGitRepository } from '../../utils/gitUtils.js';
import { debugLogger } from '../../utils/debugLogger.js';
import type { GrepMatch, SearchResults, SearchOptions } from './types.js';
import { javascriptGrepFallback } from './javascriptFallback.js';
import {
  BoundedCombinedCollector,
  createDefaultByteBudget,
} from '../../acquisition/index.js';
import { BoundedLineFramer } from '../../utils/lineFramer.js';
import { terminateProcessTree } from '../../utils/processTermination.js';
import {
  createSettleFn,
  type SubprocessSettlement,
  type AbortHandlerRef,
} from '../../utils/subprocessSettle.js';
import {
  type SemanticBudget,
  type GrepLimits,
  type GrepRetainState,
  createAggregateSemanticBudget,
  createGrepRetainState,
  retainGrepMatch,
} from './grepBudget.js';

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
export function isCommandAvailable(
  command: string,
  abortSignal?: AbortSignal,
): Promise<boolean> {
  if (abortSignal?.aborted === true) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const checkCommand = process.platform === 'win32' ? 'where' : 'command';
    const checkArgs =
      process.platform === 'win32' ? [command] : ['-v', command];
    try {
      const child = spawn(checkCommand, checkArgs, {
        stdio: 'ignore',
        shell: true,
        windowsHide: true,
      });
      const onAbort = () => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* best-effort */
        }
        resolve(false);
      };
      abortSignal?.addEventListener('abort', onAbort, { once: true });
      child.on('close', (code) => {
        abortSignal?.removeEventListener('abort', onAbort);
        resolve(code === 0);
      });
      child.on('error', () => {
        abortSignal?.removeEventListener('abort', onAbort);
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

  const lines = output.split(new RegExp('\\r?\\n'));

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
 * Error thrown when a search subprocess is aborted via its AbortSignal.
 *
 * Has `name = 'AbortError'` so upstream callers can recognise it. Must never
 * be caught as a strategy-unavailable failure or trigger grep fallback.
 */
export class SearchAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbortError';
  }
}

export class ProcessLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessLifecycleError';
  }
}

function isLifecycleError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'ProcessLifecycleError')
  );
}

interface BoundedGrepResult {
  matches: GrepMatch[];
  observedCount: number;
  earlyStopped: boolean;
  budgetTruncated: boolean;
  lineDropped: boolean;
}

interface BoundedGrepSubprocessOptions {
  filterStderr?: (text: string) => string;
  tolerateNonZeroExitWithoutStderr?: boolean;
}

function buildSearchResults(
  matches: GrepMatch[],
  observedCount: number,
  incomplete: boolean,
  maxResults: number,
  maxFiles: number,
  maxPerFile: number,
): SearchResults {
  const limited = applyLimits(matches, maxResults, maxFiles, maxPerFile);
  const wasLimited = limited.wasLimited === true || incomplete;
  const totalFound = incomplete
    ? undefined
    : Math.max(observedCount, limited.results.length);
  return {
    results: limited.results,
    wasLimited,
    totalFound,
    incomplete,
    observedCount,
  };
}

/**
 * Acquisition state for a grep subprocess. Extends the shared bounded
 * retention state with subprocess-specific collection/framing fields.
 */
interface GrepAcquisitionState extends GrepRetainState {
  collector: BoundedCombinedCollector;
  framer: BoundedLineFramer;
  terminated: boolean;
  readonly limits: GrepLimits;
}

function createGrepAcquisitionState(
  limits: GrepLimits,
  semanticBudget: SemanticBudget,
): GrepAcquisitionState {
  return {
    ...createGrepRetainState(semanticBudget),
    collector: new BoundedCombinedCollector({
      budget: createDefaultByteBudget(),
    }),
    framer: new BoundedLineFramer(),
    terminated: false,
    limits,
  };
}

/**
 * Feed a stdout chunk into the collector and framer, consuming each complete
 * bounded line record-at-a-time via callback. Returns true if early stop
 * or budget exhaustion was triggered.
 */
function processGrepStdoutChunk(
  state: GrepAcquisitionState,
  chunk: Buffer,
  cwd: string,
): boolean {
  state.collector.append(chunk, 'stdout');
  if (state.terminated) return false;

  state.framer.feedChunk(chunk, (line) => {
    if (state.earlyStopped) return;
    const match = parseGrepLine(line, cwd);
    if (!match) return;
    retainGrepMatch(state, match, state.limits);
  });

  return state.earlyStopped;
}

/** Flush remaining lines from the framer and retain bounded matches. */
function flushGrepLines(state: GrepAcquisitionState, cwd: string): void {
  state.framer.flushRemaining((line) => {
    if (state.earlyStopped) return;
    const match = parseGrepLine(line, cwd);
    if (!match) return;
    retainGrepMatch(state, match, state.limits);
  });
}

/**
 * Check the exit code and return an Error if the subprocess genuinely failed.
 * Returns null for success, no-match (code 1), early stop, or abort.
 * An unexpected signal kill (code null with a non-intentional signal) is
 * treated as genuine failure, not successful exhaustive output.
 */
function checkGrepExitCode(
  code: number | null,
  signal: NodeJS.Signals | null,
  earlyStopped: boolean,
  aborted: boolean,
  terminated: boolean,
  stderrText: string,
  command: string,
  options: BoundedGrepSubprocessOptions | undefined,
): Error | null {
  if (earlyStopped || aborted || terminated) return null;
  if (code === 0 || code === 1) return null;
  if (signal !== null) {
    return new Error(`${command} was killed by signal ${signal}`);
  }
  if (code !== null) {
    if (
      options?.tolerateNonZeroExitWithoutStderr === true &&
      stderrText.length === 0
    ) {
      return null;
    }
    return new Error(`${command} exited with code ${code}: ${stderrText}`);
  }
  return new Error(`${command} closed unexpectedly`);
}

/** Resolution of a grep subprocess close event. */
interface GrepCloseResolution {
  readonly result?: BoundedGrepResult;
  readonly error?: Error;
}

/** Resolve a grep subprocess close into a result or error. */
function resolveGrepClose(
  code: number | null,
  signal: NodeJS.Signals | null,
  state: GrepAcquisitionState,
  aborted: boolean,
  cwd: string,
  command: string,
  options: BoundedGrepSubprocessOptions | undefined,
): GrepCloseResolution {
  if (!state.terminated) {
    flushGrepLines(state, cwd);
  }
  const rawStderr = state.collector.getStderrText().trim();
  const stderrText = options?.filterStderr
    ? options.filterStderr(rawStderr).trim()
    : rawStderr;
  const exitError = checkGrepExitCode(
    code,
    signal,
    state.earlyStopped,
    aborted,
    state.terminated,
    stderrText,
    command,
    options,
  );
  if (exitError !== null) {
    return { error: exitError };
  }
  const acquisition = state.collector.getResult();
  return {
    result: {
      matches: state.matches,
      observedCount: state.observedCount,
      earlyStopped: state.earlyStopped,
      budgetTruncated: acquisition.metadata.truncated || state.budgetExhausted,
      lineDropped: state.framer.wasLineDropped,
    },
  };
}

async function runBoundedGrepSubprocess(
  command: string,
  args: string[],
  cwd: string,
  abortSignal: AbortSignal,
  maxResults: number,
  maxFiles: number,
  maxPerFile: number,
  semanticBudget: SemanticBudget,
  options?: BoundedGrepSubprocessOptions,
): Promise<BoundedGrepResult> {
  if (abortSignal.aborted) {
    throw new SearchAbortedError(`${command} aborted`);
  }
  const limits: GrepLimits = { maxResults, maxFiles, maxPerFile };
  const state = createGrepAcquisitionState(limits, semanticBudget);
  return new Promise<BoundedGrepResult>((resolve, reject) => {
    const settlement: SubprocessSettlement = {
      settled: false,
      terminationPromise: null,
    };
    const abortRef: AbortHandlerRef = { handler: () => {} };

    const child = spawn(command, args, {
      cwd,
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
      abortSignal,
      abortRef,
      reject,
      ProcessLifecycleError,
      command,
    );

    abortRef.handler = () => {
      stopProcess();
      settle(() => reject(new SearchAbortedError(`${command} aborted`)));
    };
    abortSignal.addEventListener('abort', abortRef.handler);

    child.stdout.on('data', (chunk: Buffer) => {
      if (processGrepStdoutChunk(state, chunk, cwd)) stopProcess();
    });
    child.stderr.on('data', (chunk: Buffer) =>
      state.collector.append(chunk, 'stderr'),
    );
    child.on('error', (err: Error) => {
      settle(() => {
        reject(
          abortSignal.aborted
            ? new SearchAbortedError(`${command} aborted`)
            : new Error(`Failed to start ${command}: ${err.message}`),
        );
      });
    });
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      settle(() => {
        const resolution = resolveGrepClose(
          code,
          signal,
          state,
          abortSignal.aborted,
          cwd,
          command,
          options,
        );
        if (resolution.error !== undefined) reject(resolution.error);
        else if (resolution.result !== undefined) resolve(resolution.result);
      });
    });
  });
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
  semanticBudget: SemanticBudget,
): Promise<SearchResults | null> {
  const isGit = !hasBracePattern && isGitRepository(absolutePath);
  const gitAvailable = isGit && (await isCommandAvailable('git', abortSignal));

  if (abortSignal.aborted) {
    throw new SearchAbortedError('git grep aborted');
  }

  if (!gitAvailable) return null;

  const gitArgs = ['grep', '--untracked', '-n', '-E', '--ignore-case', pattern];
  if (include) {
    gitArgs.push('--', include);
  }

  try {
    const {
      matches,
      observedCount,
      earlyStopped,
      budgetTruncated,
      lineDropped,
    } = await runBoundedGrepSubprocess(
      'git',
      gitArgs,
      absolutePath,
      abortSignal,
      maxResults,
      maxFiles,
      maxPerFile,
      semanticBudget,
    );
    const incomplete = earlyStopped || budgetTruncated || lineDropped;
    return buildSearchResults(
      matches,
      observedCount,
      incomplete,
      maxResults,
      maxFiles,
      maxPerFile,
    );
  } catch (gitError: unknown) {
    if (isLifecycleError(gitError)) {
      throw gitError;
    }
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
 * Filters system grep stderr, removing non-fatal noise like permission
 * denied or "Is a directory" messages.
 */
function filterSystemGrepStderr(text: string): string {
  const crlf = new RegExp('\\r?\\n');
  return text
    .split(crlf)
    .filter(
      (line) =>
        !line.includes('Permission denied') &&
        !/grep:.*: Is a directory/i.test(line),
    )
    .join('\n');
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
  semanticBudget: SemanticBudget,
): Promise<SearchResults | null> {
  try {
    const {
      matches,
      observedCount,
      earlyStopped,
      budgetTruncated,
      lineDropped,
    } = await runBoundedGrepSubprocess(
      'grep',
      grepArgs,
      absolutePath,
      abortSignal,
      maxResults,
      maxFiles,
      maxPerFile,
      semanticBudget,
      {
        filterStderr: filterSystemGrepStderr,
        tolerateNonZeroExitWithoutStderr: true,
      },
    );
    const incomplete = earlyStopped || budgetTruncated || lineDropped;
    return buildSearchResults(
      matches,
      observedCount,
      incomplete,
      maxResults,
      maxFiles,
      maxPerFile,
    );
  } catch (grepError: unknown) {
    if (isLifecycleError(grepError)) {
      throw grepError;
    }
    debugLogger.debug(
      `GrepLogic: System grep failed: ${getErrorMessage(
        grepError,
      )}. Falling back...`,
    );
    return null;
  }
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
  semanticBudget: SemanticBudget,
): Promise<SearchResults | null> {
  debugLogger.debug(
    'GrepLogic: System grep is being considered as fallback strategy.',
  );

  const grepArgs = buildSystemGrepArgs(pattern, include, fileExclusions);
  return trySystemGrep(
    grepArgs,
    absolutePath,
    signal,
    maxResults,
    maxFiles,
    maxPerFile,
    semanticBudget,
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

function snapshotBudget(budget: SemanticBudget): {
  remainingBytes: number;
  remainingObjects: number;
} {
  return {
    remainingBytes: budget.remainingBytes,
    remainingObjects: budget.remainingObjects,
  };
}

function restoreBudget(
  budget: SemanticBudget,
  snapshot: { remainingBytes: number; remainingObjects: number },
): void {
  budget.remainingBytes = snapshot.remainingBytes;
  budget.remainingObjects = snapshot.remainingObjects;
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
    semanticBudget = createAggregateSemanticBudget(),
  } = options;
  let strategyUsed = 'none';

  try {
    const hasBracePattern =
      typeof include === 'string' &&
      include.length > 0 &&
      hasBraceExpansion(include);

    const gitSnapshot = snapshotBudget(semanticBudget);
    const gitResult = await tryGitGrep(
      pattern,
      absolutePath,
      include,
      options.signal,
      maxResults,
      maxFiles,
      maxPerFile,
      hasBracePattern,
      semanticBudget,
    );
    if (gitResult !== null) return gitResult;
    restoreBudget(semanticBudget, gitSnapshot);

    strategyUsed = 'system grep';
    const sysSnapshot = snapshotBudget(semanticBudget);
    const sysResult = await trySystemGrepStrategy(
      pattern,
      absolutePath,
      include,
      options.signal,
      maxResults,
      maxFiles,
      maxPerFile,
      fileExclusions,
      semanticBudget,
    );
    if (sysResult !== null) return sysResult;
    restoreBudget(semanticBudget, sysSnapshot);

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
      semanticBudget,
    );
  } catch (error: unknown) {
    debugLogger.error(
      `GrepLogic: Error in performGrepSearch (Strategy: ${strategyUsed}): ${getErrorMessage(
        error,
      )}`,
    );
    throw error;
  }
}
