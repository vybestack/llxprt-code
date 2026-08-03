/**
 * Helper functions for the shell tool.
 *
 * Extracted from shell.ts to keep the main file focused on the tool facade
 * and invocation lifecycle. Contains:
 *   - Host adaptation (execution service → IShellToolHost)
 *   - Output filtering (grep, head/tail)
 *   - Process info collection (pgrep, pgid resolution)
 *   - Command wrapping
 *   - Tool descriptions
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os, { EOL } from 'node:os';
import path from 'node:path';

import type {
  IShellExecutionService,
  ShellResult,
} from '../interfaces/IShellExecutionService.js';
import type {
  IShellToolHost,
  ShellExecutionResult,
} from '../interfaces/IShellToolHost.js';

/** Type for shell tool parameters (used by filter helpers). */
export interface ShellFilterParams {
  grep_pattern?: string;
  grep_flags?: string[];
  head_lines?: number;
  tail_lines?: number;
}

export function isShellToolHost(
  host: IShellToolHost | IShellExecutionService,
): host is IShellToolHost {
  return 'executeShellCommand' in host;
}

const WRAPPED_PREFIX = '{ ';
const WRAPPED_SUFFIX = ' }; __code=$?; pgrep -g 0 >';

/**
 * Wraps a value in single quotes using POSIX-safe escaping so it can be
 * interpolated into a bash command without word-splitting or command
 * substitution. Every embedded single quote is escaped using the standard
 * close-quote, escaped-quote, reopen-quote sequence.
 */
export function singleQuoteForShell(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

function buildShellResultError(result: ShellResult): Error | null {
  const trimmedStderr = result.stderr.trim();
  if (trimmedStderr !== '') {
    return new Error(trimmedStderr);
  }
  if (result.exitCode !== 0) {
    return new Error(`Command failed with exit code ${result.exitCode}`);
  }
  return null;
}

function unwrapCommandForExecutionService(command: string): string {
  if (!command.startsWith(WRAPPED_PREFIX)) {
    return command;
  }
  // The wrapped form is `{ <cmd> }; __code=$?; pgrep -g 0 ><tmpfile> ...`.
  // WRAPPED_SUFFIX marks where the command body ends; it is NOT at the very
  // end of the string (the temp-file path and trailing shell follow it), so
  // locate it by position rather than with endsWith.
  const suffixIndex = command.indexOf(WRAPPED_SUFFIX, WRAPPED_PREFIX.length);
  if (suffixIndex === -1) {
    return command;
  }
  const innerCommand = command.slice(WRAPPED_PREFIX.length, suffixIndex).trim();
  return innerCommand.endsWith(';')
    ? innerCommand.slice(0, -1).trimEnd()
    : innerCommand;
}

const STANDALONE_BACKGROUND_ERROR =
  'Background jobs are not supported in the standalone execution-service adapter. ' +
  'This capability requires a configured ShellJobManager.';

function standaloneValidatePathWithinWorkspace(
  targetDir: string,
  dirPath: string,
): string | null {
  const resolvedPath = path.isAbsolute(dirPath)
    ? dirPath
    : path.resolve(targetDir, dirPath);
  return resolvedPath === targetDir ||
    resolvedPath.startsWith(`${targetDir}${path.sep}`)
    ? null
    : `Directory '${dirPath}' is not a registered workspace directory`;
}

export function createShellToolHostFromExecutionService(
  service: IShellExecutionService,
): IShellToolHost {
  const targetDir = process.cwd();
  return {
    getTargetDir: () => targetDir,
    getWorkspaceContext: () => ({
      getDirectories: () => [targetDir],
      isPathWithinWorkspace: (resolvedPath: string) =>
        resolvedPath === targetDir ||
        resolvedPath.startsWith(`${targetDir}${path.sep}`),
    }),
    isCommandAllowed: (command: string) => {
      const allowed = service.isCommandAllowed(command);
      return allowed
        ? { allowed: true }
        : {
            allowed: false,
            reason: `Command denied by shell policy: ${command}`,
          };
    },
    isShellInvocationAllowlisted: () => false,
    isInteractive: () => true,
    isYoloMode: () => false,
    getDebugMode: () => false,
    getShellExecutionConfig: () => ({
      shouldUseNodePty: false,
      executionOptions: {},
    }),
    getTimeoutConfig: () => ({
      timeoutSeconds: undefined,
      defaultTimeoutSeconds: 60,
    }),
    getOutputLimits: () => ({}),
    executeShellCommand: async (command) => {
      const result: ShellResult = await service.execute(
        unwrapCommandForExecutionService(command),
      );
      const error = buildShellResultError(result);
      return {
        output: result.stdout,
        exitCode: result.exitCode,
        signal: null,
        error,
        aborted: result.aborted,
        pid: undefined,
      };
    },
    getCommandRoots: (command: string) => {
      const root = command.trim().split(/\s+/)[0];
      return root ? [root] : [];
    },
    stripShellWrapper: (command: string) => command,
    validatePathWithinWorkspace: (_workspaceContext, dirPath) =>
      standaloneValidatePathWithinWorkspace(targetDir, dirPath),
    isPtyActive: () => false,
    formatMemoryUsage: (bytes: number) => {
      if (bytes < 1024) return `${bytes} bytes`;
      return `${(bytes / 1024).toFixed(1)} KB`;
    },
    trySummarizeOutput: async (content: string) => content,
    getSummarizeConfig: () => undefined,
    limitOutputTokens: (content: string) => ({ content, wasTruncated: false }),
    launchBackgroundJob: () => {
      throw new Error(STANDALONE_BACKGROUND_ERROR);
    },
    tailBackgroundJob: () => {
      throw new Error(STANDALONE_BACKGROUND_ERROR);
    },
    detectTrailingBackground: (command: string) => ({
      promoted: false,
      command,
    }),
  };
}

export function applyGrepFilter(
  content: string,
  params: ShellFilterParams,
  descriptionParts: string[],
): string {
  const grepPattern =
    typeof params.grep_pattern === 'string' && params.grep_pattern !== ''
      ? params.grep_pattern
      : undefined;
  if (grepPattern === undefined) {
    return content;
  }

  const invertMatch = params.grep_flags?.includes('-v') === true;
  const options = params.grep_flags?.includes('-i') === true ? 'i' : '';
  const regex = new RegExp(grepPattern, options);
  const filteredLines = content
    .split('\n')
    .filter((line) => (invertMatch ? !regex.test(line) : regex.test(line)));

  descriptionParts.push(`grep_pattern filter: "${grepPattern}"`);
  if (params.grep_flags !== undefined && params.grep_flags.length > 0) {
    descriptionParts.push(`flags: [${params.grep_flags.join(', ')}]`);
  }
  return filteredLines.join('\n');
}

export function applyOutputFilters(
  output: string,
  params: ShellFilterParams,
): { content: string; description?: string } {
  let content = output;
  const descriptionParts: string[] = [];

  content = applyGrepFilter(content, params, descriptionParts);

  if (params.head_lines !== undefined && params.head_lines !== 0) {
    validatePositiveInteger(params.head_lines, 'head_lines');
    const lines = content.split('\n');
    const headLines = lines.slice(0, params.head_lines);
    const wasTruncated = lines.length > params.head_lines;

    content = headLines.join('\n');
    descriptionParts.push(
      `head_lines filter: showing first ${params.head_lines} lines${wasTruncated ? ` (of ${lines.length} total)` : ''}`,
    );
  }

  if (params.tail_lines !== undefined && params.tail_lines !== 0) {
    validatePositiveInteger(params.tail_lines, 'tail_lines');
    const lines = content.split('\n');
    const tailLines = lines.slice(-params.tail_lines);
    const wasTruncated = lines.length > params.tail_lines;

    content = tailLines.join('\n');
    descriptionParts.push(
      `tail_lines filter: showing last ${params.tail_lines} lines${wasTruncated ? ` (of ${lines.length} total)` : ''}`,
    );
  }

  return {
    content,
    description:
      descriptionParts.length > 0 ? descriptionParts.join('; ') : undefined,
  };
}

export function validatePositiveInteger(
  value: number,
  paramName: string,
): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${paramName} must be a positive integer, got: ${value}`);
  }
}

export function validateGrepFlags(flags: string[]): void {
  const validFlags = ['-i', '-v', '-E', '-F', '-x', '-w'];
  for (const flag of flags) {
    if (!validFlags.includes(flag)) {
      throw new Error(
        `Invalid grep flag: ${flag}. Valid flags: ${validFlags.join(', ')}`,
      );
    }
  }
}

function isValidBackgroundPid(
  linePid: number,
  mainPid: number | undefined,
): boolean {
  if (mainPid === undefined || mainPid === 0) {
    return false;
  }
  return linePid !== mainPid;
}

export function buildCommandToExecute(
  strippedCommand: string,
  isWindows: boolean,
  tempFilePath: string,
): string {
  if (isWindows) {
    return strippedCommand;
  }
  const body = buildWrappedBody(strippedCommand.trim());
  return `{ ${body} }; __code=$?; pgrep -g 0 >${tempFilePath} 2>&1; exit $__code;`;
}

/**
 * Builds the body that sits between the wrapper's `{ ` prefix and its
 * ` }; __code=$?; ...` suffix. A trailing-`;` is normalised away so the
 * generated `{ cmd; }` is syntactically clean.
 */
function buildWrappedBody(trimmed: string): string {
  const normalised = trimmed.endsWith(';')
    ? trimmed.slice(0, -1).trimEnd()
    : trimmed;
  return `${normalised};`;
}

export function parsePgrepFile(
  tempFilePath: string,
  mainPid: number | undefined,
): number[] {
  const pids: number[] = [];
  if (!fs.existsSync(tempFilePath)) {
    return pids;
  }
  const pgrepLines = fs
    .readFileSync(tempFilePath, 'utf8')
    .split(EOL)
    .filter(Boolean);
  for (const line of pgrepLines) {
    if (!/^\d+$/.test(line)) {
      continue;
    }
    const linePid = Number(line);
    if (isValidBackgroundPid(linePid, mainPid)) {
      pids.push(linePid);
    }
  }
  return pids;
}

export function prepareShellExecution(strippedCommand: string): {
  tempFilePath: string;
  commandToExecute: string;
} {
  const isWindows = os.platform() === 'win32';
  const tempFileName = `shell_pgrep_${crypto
    .randomBytes(6)
    .toString('hex')}.tmp`;
  const tempFilePath = path.join(os.tmpdir(), tempFileName);
  const commandToExecute = buildCommandToExecute(
    strippedCommand,
    isWindows,
    tempFilePath,
  );
  return { tempFilePath, commandToExecute };
}

export function collectProcessInfo(
  result: ShellExecutionResult,
  tempFilePath: string,
  signal: AbortSignal,
): { backgroundPIDs: number[]; pgid: number | null } {
  const backgroundPIDs = result.backgroundPIDs ?? [];
  let pgid = result.pgid ?? null;
  if (os.platform() !== 'win32') {
    backgroundPIDs.push(...parsePgrepFile(tempFilePath, result.pid));
    if (
      pgid === null &&
      result.pid !== undefined &&
      result.pid !== 0 &&
      signal.aborted === false
    ) {
      pgid = tryResolvePgidFromPs(result.pid);
    }
  }
  return { backgroundPIDs, pgid };
}

export function tryResolvePgidFromPs(pid: number): number | null {
  try {
    const psResult = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)]);
    const out = psResult.stdout.toString().trim();
    if (psResult.status === 0 && out) {
      return parseInt(out, 10);
    }
  } catch {
    return null;
  }
  return null;
}

export function getShellToolDescription(): string {
  const returnedInfo = `\n\n      The following information is returned:\n\n      Command: Executed command.\n      Directory: Directory (relative to project root) where command was executed, or \`(root)\`.\n      Stdout: Output on stdout stream. Can be \`(empty)\` or partial on error and for any unwaited background processes.\n      Stderr: Output on stderr stream. Can be \`(empty)\` or partial on error and for any unwaited background processes.\n      Error: Error or \`(none)\` if no error was reported for the subprocess.\n      Exit Code: Exit code or \`(none)\` if terminated by signal.\n      Signal: Signal number or \`(none)\` if no signal was received.\n      Background PIDs: List of background processes started or \`(none)\`.\n      Process Group PGID: Process group started or \`(none)\``;

  if (os.platform() === 'win32') {
    return `This tool executes a given shell command using PowerShell (\`powershell.exe\` or \`pwsh\`) with \`-NoProfile -Command <command>\`. Use PowerShell-compatible syntax: quote paths containing spaces with single quotes (for example, \`New-Item -ItemType Directory -Force -Path 'C:\\My Folder'\`) and represent an apostrophe inside a single-quoted path with two single quotes. Independent background processes can be started with \`Start-Process\`.${returnedInfo}`;
  }
  return `This tool executes a given shell command as \`bash -c <command>\`. Command can start background processes using \`&\`: a trailing \`&\` is detected via AST parsing and the command is launched as a managed background job with a stable job id (use check_async_tasks to inspect or cancel it). Command is executed as a subprocess that leads its own process group. Command process group can be terminated as \`kill -- -PGID\` or signaled as \`kill -s SIGNAL -- -PGID\`. Note: a command that daemonizes (e.g. setsid or double-fork) escapes the process group and cannot be stopped by job cancellation.${returnedInfo}`;
}

export function getCommandDescription(): string {
  const cmd_substitution_warning =
    '\n*** WARNING: Command substitution using $(), `` ` ``, <(), or >() is not allowed for security reasons.';
  if (os.platform() === 'win32') {
    return (
      'Exact PowerShell command to execute with `-NoProfile -Command <command>` using `powershell.exe` or `pwsh`' +
      cmd_substitution_warning
    );
  }
  return (
    'Exact bash command to execute as `bash -c <command>`' +
    cmd_substitution_warning
  );
}

/** Description for the `is_background` schema property (non-Windows only). */
export function getBackgroundParamDescription(): string {
  return 'When true, the command is launched as a managed background job and the tool returns immediately with a job id. The command output is NOT returned inline; use check_async_tasks to inspect output or cancel the job by id. A background job runs until it exits on its own — timeout_seconds bounds only the launch, not the job lifetime.';
}

/** JSON Schema for the run_shell_command tool parameters. */
export function buildShellSchema(): {
  type: 'object';
  properties: Record<string, { type: string; description: string }>;
  required: string[];
} {
  const properties: Record<string, { type: string; description: string }> = {
    command: {
      type: 'string',
      description: getCommandDescription(),
    },
    description: {
      type: 'string',
      description:
        'Brief description of the command for the user. Be specific and concise. Ideally a single sentence. Can be up to 3 sentences for clarity. No line breaks.',
    },
    dir_path: {
      type: 'string',
      description:
        '(OPTIONAL) Directory to run the command in. Provide a workspace directory name (e.g., "packages"), a relative path (e.g., "src/utils"), or an absolute path within the workspace.',
    },
    directory: {
      type: 'string',
      description:
        'Alternative parameter name for dir_path (for backward compatibility).',
    },
    timeout_seconds: {
      type: 'number',
      description:
        '(OPTIONAL) Timeout in seconds for command execution (-1 for unlimited).',
    },
  };
  if (os.platform() !== 'win32') {
    properties['is_background'] = {
      type: 'boolean',
      description: getBackgroundParamDescription(),
    };
  }
  return {
    type: 'object',
    properties,
    required: ['command'],
  };
}
