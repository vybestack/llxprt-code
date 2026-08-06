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
import {
  describeTimeoutClamp,
  type TimeoutResolution,
} from '../utils/timeoutResolution.js';
import type { ToolResult } from './tools.js';

/** Type for shell tool parameters (used by filter helpers). */
export interface ShellFilterParams {
  grep_pattern?: string;
  grep_flags?: string[];
  head_lines?: number;
  tail_lines?: number;
}

/** Ephemeral setting name for the shell tool's default timeout (seconds). */
export const SHELL_TIMEOUT_DEFAULT_SETTING = 'shell-default-timeout-seconds';

/** Ephemeral setting name for the shell tool's maximum timeout ceiling (seconds). */
export const SHELL_TIMEOUT_MAX_SETTING = 'shell-max-timeout-seconds';

/**
 * Shipped default shell timeout (seconds). Both the legacy execution-service
 * host adapter and the core `CoreShellToolHostAdapter` share these so the
 * ceiling numbers cannot drift between the two host implementations
 * (Issue #3031).
 */
export const DEFAULT_SHELL_TIMEOUT_SECONDS = 300;

/**
 * Shipped maximum shell timeout ceiling (seconds). `-1` would mean the operator
 * declined a ceiling, but the shipped configuration is a finite ceiling so that
 * a runaway command is bounded.
 */
export const MAX_SHELL_TIMEOUT_SECONDS = 900;

/**
 * Appends the timeout-clamp notice to `content` when the requested/default
 * timeout was reduced to the ceiling, otherwise returns `content` unchanged.
 * Used so a caller that ignores metadata still learns its request was not
 * honoured (Issue #3031).
 */
export function appendShellClampNotice(
  content: string,
  resolution: TimeoutResolution,
): string {
  const clamp = describeTimeoutClamp(resolution, {
    defaultSetting: SHELL_TIMEOUT_DEFAULT_SETTING,
    maxSetting: SHELL_TIMEOUT_MAX_SETTING,
  });
  return clamp === undefined
    ? content
    : `${content}

${clamp}`;
}

/**
 * Builds the timeout message naming the termination reason, the effective
 * timeout that was applied, and the parameter + settings that would raise it
 * (Issue #3031).
 */
export function formatShellTimeoutMessage(
  resolution: TimeoutResolution,
): string {
  const effective = resolution.effectiveTimeoutSeconds;
  return (
    `Command timed out after ${effective}s. ` +
    `The effective timeout is bounded by the timeout_seconds parameter and the ` +
    `${SHELL_TIMEOUT_MAX_SETTING} / ${SHELL_TIMEOUT_DEFAULT_SETTING} settings; ` +
    `raise them to allow a longer run.`
  );
}

/**
 * A `ToolResult` whose `llmContent` and `returnDisplay` are both plain strings.
 * The only caller of {@link appendClampNoticeToResult} is the foreground shell
 * path, where `buildToolResult` always constructs both as strings, so the
 * string-ness is a type-level guarantee rather than something to re-check at
 * runtime (Issue #3031).
 */
export type StringContentToolResult = ToolResult & {
  readonly llmContent: string;
  readonly returnDisplay: string;
};

/**
 * Appends the durable clamp notice to BOTH `llmContent` and `returnDisplay`
 * of a foreground shell `ToolResult`. This is applied AFTER all lossy
 * processing (summarization and token limiting) so the notice survives even
 * when the underlying content is replaced or truncated (Issue #3031).
 *
 * The input is a {@link StringContentToolResult}: the foreground path always
 * constructs both fields as strings, so the notice is appended unconditionally
 * rather than silently dropped by a `typeof` guard that could never be false.
 */
export function appendClampNoticeToResult(
  result: StringContentToolResult,
  resolution: TimeoutResolution,
): ToolResult {
  const clamp = describeTimeoutClamp(resolution, {
    defaultSetting: SHELL_TIMEOUT_DEFAULT_SETTING,
    maxSetting: SHELL_TIMEOUT_MAX_SETTING,
  });
  if (clamp === undefined) {
    return result;
  }
  const suffix = `

${clamp}`;
  return {
    ...result,
    llmContent: `${result.llmContent}${suffix}`,
    returnDisplay: `${result.returnDisplay}${suffix}`,
  };
}

export function isShellToolHost(
  host: IShellToolHost | IShellExecutionService,
): host is IShellToolHost {
  return 'executeShellCommand' in host;
}

const TRAP_LINE_PREFIX = 'trap ';
// Suffix following the canonical action token on the trap line: ` EXIT`. The
// action token's own closing quote is consumed by matchCanonicalSingleQuoted,
// so this is the text that must remain after it.
const TRAP_LINE_SUFFIX = ' EXIT';
const TRAP_ACTION_PREFIX = '__code=$?; pgrep -g 0 >';
const TRAP_ACTION_SUFFIX = ' 2>&1; exit $__code';

/**
 * Wraps a value in single quotes using POSIX-safe escaping so it can be
 * interpolated into a bash command without word-splitting or command
 * substitution. Every embedded single quote is escaped using the standard
 * close-quote, escaped-quote, reopen-quote sequence.
 */
export function singleQuoteForShell(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

/**
 * Recognizes a canonical singleQuoteForShell token at the start of `input` and
 * returns its decoded value plus the unconsumed remainder. Decoding walks the
 * escaped-quote sequence (`'\''`) exactly as singleQuoteForShell emits it, then
 * requires that re-encoding the decoded value reproduces the exact token. This
 * rejects any input that merely resembles a quoted string without being a
 * canonically generated wrapper argument.
 */
function matchCanonicalSingleQuoted(
  input: string,
): { decoded: string; rest: string } | null {
  if (!input.startsWith("'")) {
    return null;
  }
  let i = 1;
  let decoded = '';
  let closed = false;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "'") {
      if (input.slice(i, i + 4) === "'\\''") {
        decoded += "'";
        i += 4;
      } else {
        closed = true;
        break;
      }
    } else {
      decoded += ch;
      i += 1;
    }
  }
  if (!closed) {
    return null;
  }
  const token = input.slice(0, i + 1);
  return singleQuoteForShell(decoded) === token
    ? { decoded, rest: input.slice(i + 1) }
    : null;
}

/**
 * Confirms a decoded trap action is exactly the generated form:
 * TRAP_ACTION_PREFIX + one canonical singleQuoteForShell path token +
 * TRAP_ACTION_SUFFIX. Only such an action is treated as a generated wrapper.
 */
function isCanonicalTrapAction(action: string): boolean {
  if (
    !action.startsWith(TRAP_ACTION_PREFIX) ||
    !action.endsWith(TRAP_ACTION_SUFFIX)
  ) {
    return false;
  }
  const pathToken = action.slice(
    TRAP_ACTION_PREFIX.length,
    action.length - TRAP_ACTION_SUFFIX.length,
  );
  const matched = matchCanonicalSingleQuoted(pathToken);
  // The path slot must be EXACTLY one canonical token: no trailing content may
  // remain after it, so a same-prefix/suffix trap with extra action content is
  // treated as non-canonical and passed through unchanged.
  return matched !== null && matched.rest === '';
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
  if (!command.startsWith(TRAP_LINE_PREFIX)) {
    return command;
  }
  // The wrapped form is `trap '<quotedAction>' EXIT` followed by a newline and
  // the trimmed body. The action token may itself contain a literal newline
  // (e.g. a temp path with a line break), so it is decoded from the entire
  // suffix after `trap ` rather than truncated at the first newline. After the
  // canonical action is validated, the remainder must begin exactly with
  // TRAP_LINE_SUFFIX plus a newline; the body is everything after that
  // delimiter. The action token is validated strictly so only a canonically
  // generated wrapper is unwrapped; anything else passes through unchanged.
  const afterPrefix = command.slice(TRAP_LINE_PREFIX.length);
  const actionToken = matchCanonicalSingleQuoted(afterPrefix);
  if (actionToken === null) {
    return command;
  }
  const bodyDelimiter = TRAP_LINE_SUFFIX + String.fromCharCode(10);
  if (!actionToken.rest.startsWith(bodyDelimiter)) {
    return command;
  }
  if (!isCanonicalTrapAction(actionToken.decoded)) {
    return command;
  }
  return actionToken.rest.slice(bodyDelimiter.length);
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
      timeoutSeconds: MAX_SHELL_TIMEOUT_SECONDS,
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
  // Emit an EXIT trap on its own line so a body comment, heredoc, or terminal
  // operator cannot consume the appended pgrep/exit epilogue. The trap action
  // captures $? before running pgrep and re-exits with it, preserving the
  // body's exit status. Both the path and the whole action are single-quoted
  // via singleQuoteForShell so hostile paths stay literal shell data.
  // Known boundary: a body that removes (`trap - EXIT`) or replaces the EXIT
  // trap intentionally opts out — our pgrep temp file is not written and the
  // epilogue does not re-emit the exit status. The trap is still the right
  // choice because, unlike an appended epilogue, it survives trailing
  // comments, heredocs, and terminal operators, and still fires when the body
  // calls `exit`.
  const trapAction = `${TRAP_ACTION_PREFIX}${singleQuoteForShell(tempFilePath)}${TRAP_ACTION_SUFFIX}`;
  const newline = String.fromCharCode(10);
  return `trap ${singleQuoteForShell(trapAction)} EXIT${newline}${strippedCommand.trim()}`;
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
    return `This tool executes a given shell command using PowerShell (\`powershell.exe\` or \`pwsh\`) with \`-NoProfile -Command <command>\`. Use PowerShell-compatible syntax: quote paths containing spaces with single quotes (for example, \`New-Item -ItemType Directory -Force -Path 'C:\\My Folder'\`) and represent an apostrophe inside a single-quoted path with two single quotes. Independent background processes can be started with \`Start-Process\`. When \`is_background\` is true the command is launched as a managed background job via \`Start-Process\` and the tool returns immediately with a stable job id; use \`check_async_tasks\` to inspect output or cancel the job. A managed background job can also be terminated with \`taskkill /T /F /PID <pid>\` where \`<pid>\` is the job's process id (available from \`check_async_tasks\` with \`action: 'peek'\`).${returnedInfo}`;
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

/** Description for the `is_background` schema property. */
export function getBackgroundParamDescription(): string {
  if (os.platform() === 'win32') {
    return `When true, the command is launched as a managed background job via Start-Process and the tool returns immediately with a job id. The command output is NOT returned inline; use check_async_tasks to inspect output or cancel the job by id. timeout_seconds is NOT applied to background jobs (neither to the launch nor to the job lifetime): a background job may run indefinitely, but may be cancelled (via check_async_tasks) or forcibly terminated by lifecycle management or log-cap enforcement. On Windows a job can be terminated with taskkill /T /F /PID <pid> where <pid> is available from check_async_tasks with action: 'peek'.`;
  }
  return 'When true, the command is launched as a managed background job and the tool returns immediately with a job id. The command output is NOT returned inline; use check_async_tasks to inspect output or cancel the job by id. A background job runs until it exits on its own — timeout_seconds is NOT applied to background jobs (neither to the launch nor to the job lifetime).';
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
        '(OPTIONAL) Maximum time the command may run, in seconds. ' +
        'Allowed values are -1 or a finite number of seconds greater than ' +
        'zero (0 and any other non-positive value is rejected). ' +
        'Precedence: this explicit value, then the shell-default-timeout-seconds ' +
        'setting, bounded upward by the shell-max-timeout-seconds setting (both are ' +
        'overridable ephemeral settings, so do not assume fixed numbers). A short ' +
        'positive request is honoured exactly. -1 means "as long as the configured ' +
        'maximum allows" — it resolves to the maximum and is NOT unbounded unless ' +
        'the maximum itself is -1. A request above the maximum (or a request of -1 ' +
        'under a finite maximum) is clamped to the maximum, and the result will ' +
        'state that clamping occurred. Give long-running work (full test suites, ' +
        'builds, installs) an explicit timeout rather than relying on the ' +
        'default. For background jobs (is_background or a trailing &), ' +
        'timeout_seconds is NOT applied — the job runs until it exits on its own.',
    },
  };
  properties['is_background'] = {
    type: 'boolean',
    description: getBackgroundParamDescription(),
  };
  return {
    type: 'object',
    properties,
    required: ['command'],
  };
}
