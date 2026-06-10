/**
 * @plan:PLAN-20260608-ISSUE1585.P11
 * @requirement:REQ-INTERFACE-OWNERSHIP, REQ-API-001
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, max-lines -- Shell tool delegated through IShellToolHost. */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os, { EOL } from 'node:os';
import path from 'node:path';

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolResult,
  type ToolInvocation,
  ToolConfirmationOutcome,
  type ToolCallConfirmationDetails,
  type ToolExecuteConfirmationDetails,
  type PolicyUpdateOptions,
} from './tools.js';
import { ToolErrorType } from '../types/tool-error.js';
import type { IToolMessageBus } from '../interfaces/IToolMessageBus.js';
import type {
  IShellExecutionService,
  ShellResult,
} from '../interfaces/IShellExecutionService.js';

import type {
  IShellToolHost,
  ShellExecutionResult,
  ShellOutputEvent,
} from '../interfaces/IShellToolHost.js';

/** Throttle interval for shell output updates. */
export const OUTPUT_UPDATE_INTERVAL_MS = 100;

function isShellToolHost(
  host: IShellToolHost | IShellExecutionService,
): host is IShellToolHost {
  return 'executeShellCommand' in host;
}

function unwrapCommandForExecutionService(command: string): string {
  const match = /^\{ ([\s\S]*) \}; __code=\$\?; pgrep -g 0 >/.exec(command);
  if (!match) {
    return command;
  }
  const innerCommand = match[1].trim();
  return innerCommand.endsWith(';')
    ? innerCommand.slice(0, -1).trimEnd()
    : innerCommand;
}

function createShellToolHostFromExecutionService(
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
      const error =
        result.stderr.trim() !== '' || result.exitCode !== 0
          ? new Error(
              result.stderr.trim() !== ''
                ? result.stderr.trim()
                : `Command failed with exit code ${result.exitCode}`,
            )
          : null;
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
    validatePathWithinWorkspace: (_workspaceContext, dirPath) => {
      const resolvedPath = path.isAbsolute(dirPath)
        ? dirPath
        : path.resolve(targetDir, dirPath);
      return resolvedPath === targetDir ||
        resolvedPath.startsWith(`${targetDir}${path.sep}`)
        ? null
        : `Directory '${dirPath}' is not a registered workspace directory`;
    },
    isPtyActive: () => false,
    formatMemoryUsage: (bytes: number) => {
      if (bytes < 1024) return `${bytes} bytes`;
      return `${(bytes / 1024).toFixed(1)} KB`;
    },
    trySummarizeOutput: async (content: string) => content,
    getSummarizeConfig: () => undefined,
    limitOutputTokens: (content: string) => ({ content, wasTruncated: false }),
  };
}

export interface ShellToolParams {
  /** The shell command to execute. */
  command: string;
  /** Optional description of what this command does. */
  description?: string;
  /** Optional directory to execute the command in. */
  dir_path?: string;
  /** @deprecated Use dir_path instead. */
  directory?: string;
  /** Optional number of lines to show from the beginning of output. */
  head_lines?: number;
  /** Optional number of lines to show from the end of output. */
  tail_lines?: number;
  /** Optional grep pattern to filter output lines. */
  grep_pattern?: string;
  /** Optional grep flags (e.g., -i for case-insensitive, -v for inverted). */
  grep_flags?: string[];
  /** Optional timeout in seconds (-1 for unlimited). */
  timeout_seconds?: number;
}

function applyGrepFilter(
  content: string,
  params: ShellToolParams,
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

function applyOutputFilters(
  output: string,
  params: ShellToolParams,
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

function validatePositiveInteger(value: number, paramName: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${paramName} must be a positive integer, got: ${value}`);
  }
}

function validateGrepFlags(flags: string[]): void {
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

function buildCommandToExecute(
  strippedCommand: string,
  isWindows: boolean,
  tempFilePath: string,
): string {
  if (isWindows) {
    return strippedCommand;
  }
  let command = strippedCommand.trim();
  if (!command.endsWith('&')) {
    command += ';';
  }
  return `{ ${command} }; __code=$?; pgrep -g 0 >${tempFilePath} 2>&1; exit $__code;`;
}

function parsePgrepFile(
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

function collectProcessInfo(
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
      try {
        const psResult = spawnSync('ps', [
          '-o',
          'pgid=',
          '-p',
          String(result.pid),
        ]);
        if (psResult.status === 0 && psResult.stdout.toString().trim()) {
          pgid = parseInt(psResult.stdout.toString().trim(), 10);
        }
      } catch {
        pgid = null;
      }
    }
  }
  return { backgroundPIDs, pgid };
}

export class ShellToolInvocation extends BaseToolInvocation<
  ShellToolParams,
  ToolResult
> {
  private allowlist: Set<string> = new Set();

  constructor(
    private readonly host: IShellToolHost,
    params: ShellToolParams,
    allowlist: Set<string>,
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
    this.allowlist = allowlist;
  }

  override getToolName(): string {
    return ShellTool.Name;
  }

  private getDirPath(): string | undefined {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing
    return this.params.dir_path || this.params.directory;
  }

  override getDescription(): string {
    let description = `${this.params.command}`;
    const dirPath = this.getDirPath();
    if (dirPath) {
      description += ` [in ${dirPath}]`;
    } else {
      description += ` [current working directory ${process.cwd()}]`;
    }
    if (this.params.description) {
      description += ` (${this.params.description.replace(/\n/g, ' ')})`;
    }
    return description;
  }

  protected override getPolicyUpdateOptions(
    outcome: ToolConfirmationOutcome,
  ): PolicyUpdateOptions | undefined {
    if (
      outcome === ToolConfirmationOutcome.ProceedAlwaysAndSave ||
      outcome === ToolConfirmationOutcome.ProceedAlways
    ) {
      const command = this.host.stripShellWrapper(this.params.command);
      const rootCommands = [...new Set(this.host.getCommandRoots(command))];
      if (rootCommands.length > 0) {
        return { commandPrefix: rootCommands };
      }
      return { commandPrefix: this.params.command };
    }
    return undefined;
  }

  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    const command = this.host.stripShellWrapper(this.params.command);
    const rootCommands = [...new Set(this.host.getCommandRoots(command))];

    if (!this.host.isInteractive() && !this.host.isYoloMode()) {
      if (this.isInvocationAllowlisted(command)) {
        return false;
      }
      throw new Error(
        `Command "${command}" is not in the list of allowed tools for non-interactive mode.`,
      );
    }

    const commandsToConfirm = rootCommands.filter(
      (cmd) => !this.allowlist.has(cmd),
    );

    if (commandsToConfirm.length === 0) {
      return false;
    }

    const confirmationDetails: ToolExecuteConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Shell Command',
      command: this.params.command,
      rootCommand: commandsToConfirm.join(', '),
      rootCommands: commandsToConfirm,
      onConfirm: async (outcome: ToolConfirmationOutcome, payload) => {
        if (
          outcome === ToolConfirmationOutcome.ProceedAlways ||
          outcome === ToolConfirmationOutcome.ProceedAlwaysAndSave
        ) {
          commandsToConfirm.forEach((cmd) => {
            this.allowlist.add(cmd);
          });
        }
        await this.publishPolicyUpdate(outcome);

        if (outcome === ToolConfirmationOutcome.SuggestEdit) {
          const editedCommand = payload?.editedCommand?.trim();
          if (!editedCommand) {
            return;
          }
          this.params.command = editedCommand;
        }
      },
    };

    return confirmationDetails;
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    this.validateFilterParams();

    const strippedCommand = this.host.stripShellWrapper(this.params.command);

    const timeoutConfig = this.host.getTimeoutConfig();
    const timeoutSeconds = this.resolveTimeoutSeconds(
      this.params.timeout_seconds,
      timeoutConfig.defaultTimeoutSeconds,
      timeoutConfig.timeoutSeconds,
    );
    const timeoutMs =
      timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000;
    const timeoutController = new AbortController();
    const timeoutId =
      timeoutMs === undefined
        ? null
        : setTimeout(() => timeoutController.abort(), timeoutMs);

    const onUserAbort = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutController.abort();
    };

    signal.addEventListener('abort', onUserAbort, { once: true });

    if (signal.aborted) {
      onUserAbort();
      return this.createPreCancelledResult();
    }

    try {
      return await this.executeShell(
        strippedCommand,
        signal,
        timeoutController,
        timeoutSeconds,
        timeoutConfig.defaultTimeoutSeconds,
        timeoutId,
        updateOutput,
      );
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      signal.removeEventListener('abort', onUserAbort);
    }
  }

  private async executeShell(
    strippedCommand: string,
    signal: AbortSignal,
    timeoutController: AbortController,
    timeoutSeconds: number | undefined,
    defaultTimeoutSeconds: number,
    _timeoutId: ReturnType<typeof setTimeout> | null,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const combinedSignal = timeoutController.signal;
    const cwd = this.resolveCwd();
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

    try {
      let cumulativeOutput: string = '';
      let lastUpdateTime = 0;
      let isBinaryStream = false;

      const executionResult = await this.host.executeShellCommand(
        commandToExecute,
        cwd,
        (event: ShellOutputEvent) => {
          if (!updateOutput) return;

          let shouldUpdate = false;

          switch (event.type) {
            case 'data': {
              if (isBinaryStream) break;
              cumulativeOutput = event.chunk ?? '';
              shouldUpdate = true;
              break;
            }
            case 'binary_detected':
              isBinaryStream = true;
              cumulativeOutput = '[Binary output detected. Halting stream...]';
              shouldUpdate = true;
              break;
            case 'binary_progress':
              isBinaryStream = true;
              cumulativeOutput = `[Receiving binary output... ${this.host.formatMemoryUsage(event.bytesReceived ?? 0)} received]`;
              if (Date.now() - lastUpdateTime > OUTPUT_UPDATE_INTERVAL_MS) {
                shouldUpdate = true;
              }
              break;
            default: {
              throw new Error('An unhandled ShellOutputEvent was found.');
            }
          }

          if (shouldUpdate) {
            updateOutput(cumulativeOutput);
            lastUpdateTime = Date.now();
          }
        },
        combinedSignal,
      );

      const result = executionResult;
      const { backgroundPIDs, pgid } = collectProcessInfo(
        result,
        tempFilePath,
        signal,
      );

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive boundary
      const rawOutput = result?.output ?? '';
      const filterInfo = applyOutputFilters(rawOutput, this.params);
      const filteredOutput = filterInfo.content;

      const timeoutTriggered =
        timeoutController.signal.aborted === true &&
        (signal.aborted as boolean | undefined) === false;

      const { llmContent, returnDisplayMessage } = this.formatOutputContent(
        result,
        rawOutput,
        filteredOutput,
        commandToExecute,
        backgroundPIDs,
        pgid,
        timeoutTriggered,
        timeoutSeconds,
        defaultTimeoutSeconds,
      );

      const displayWithFilter = this.applyFilterDescription(
        returnDisplayMessage,
        filterInfo,
      );

      const executionError = this.buildExecutionError(
        result,
        llmContent,
        timeoutTriggered,
      );

      let llmPayload = llmContent;
      const shellToolConfig = this.host.getSummarizeConfig();
      if (shellToolConfig !== undefined && result.aborted !== true) {
        llmPayload = await this.host.trySummarizeOutput(
          llmContent,
          signal,
          shellToolConfig.tokenBudget,
        );
      }

      const limitedResult = this.host.limitOutputTokens(llmPayload);
      if (limitedResult.wasTruncated) {
        return {
          llmContent: `${limitedResult.content}\n\n(output exceeded token limit)`,
          returnDisplay: displayWithFilter,
          ...executionError,
        };
      }

      return {
        llmContent: limitedResult.content,
        returnDisplay: displayWithFilter,
        ...executionError,
      };
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  }

  private validateFilterParams(): void {
    if (this.params.head_lines !== undefined && this.params.head_lines !== 0) {
      validatePositiveInteger(this.params.head_lines, 'head_lines');
    }
    if (this.params.tail_lines !== undefined && this.params.tail_lines !== 0) {
      validatePositiveInteger(this.params.tail_lines, 'tail_lines');
    }
    const grepPattern =
      typeof this.params.grep_pattern === 'string' &&
      this.params.grep_pattern !== ''
        ? this.params.grep_pattern
        : undefined;
    if (grepPattern !== undefined && grepPattern.trim() === '') {
      throw new Error('grep_pattern cannot be empty');
    }
    if (this.params.grep_flags) {
      validateGrepFlags(this.params.grep_flags);
    }
  }

  private resolveCwd(): string {
    const dirPath = this.getDirPath();
    if (!dirPath) {
      return this.host.getTargetDir();
    }

    const targetDir = this.host.getTargetDir();
    const resolved = this.resolveDirPath(dirPath, targetDir);
    const pathError = this.host.validatePathWithinWorkspace(
      this.host.getWorkspaceContext(),
      resolved,
      'Directory',
    );
    if (pathError) {
      throw new Error(pathError);
    }
    return resolved;
  }

  private resolveDirPath(dirPath: string, targetDir: string): string {
    if (path.isAbsolute(dirPath)) {
      return dirPath;
    }
    return path.resolve(targetDir, dirPath);
  }
  private formatOutputContent(
    result: ShellExecutionResult,
    rawOutput: string,
    filteredOutput: string,
    commandToExecute: string,
    backgroundPIDs: number[],
    pgid: number | null,
    timeoutTriggered: boolean,
    timeoutSeconds: number | undefined,
    defaultTimeoutSeconds: number,
  ): { llmContent: string; returnDisplayMessage: string } {
    let llmContent = '';
    let returnDisplayMessage = '';

    if (result.aborted === true) {
      if (timeoutTriggered) {
        llmContent = `Command timed out after ${timeoutSeconds ?? defaultTimeoutSeconds}s (timeout_seconds).`;

        if (rawOutput.trim() !== '') {
          llmContent += ` Partial output:\n${rawOutput}`;
        } else {
          llmContent += ' There was no output before timeout.';
        }
        returnDisplayMessage = llmContent;
      } else {
        llmContent = 'Command was cancelled by user before it could complete.';

        if (rawOutput.trim() !== '') {
          llmContent += ` Below is the output before it was cancelled:\n${rawOutput}`;
        } else {
          llmContent += ' There was no output before it was cancelled.';
        }

        if (this.host.getDebugMode()) {
          returnDisplayMessage = llmContent;
        } else if (filteredOutput.trim() !== '') {
          returnDisplayMessage = filteredOutput;
        } else {
          returnDisplayMessage = 'Command cancelled by user.';
        }
      }
    } else {
      const finalError = result.error
        ? result.error.message.replace(commandToExecute, this.params.command)
        : '(none)';

      llmContent = [
        `Command: ${this.params.command}`,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing
        `Directory: ${this.getDirPath() || '(root)'}`,
        `Stdout: ${filteredOutput || '(empty)'}`,
        `Stderr: (empty)`,
        `Error: ${finalError}`,
        `Exit Code: ${result.exitCode ?? '(none)'}`,
        `Signal: ${result.signal ?? '(none)'}`,
        `Background PIDs: ${
          backgroundPIDs.length > 0 ? backgroundPIDs.join(', ') : '(none)'
        }`,
        `Process Group PGID: ${pgid ?? result.pid ?? '(none)'}`,
      ].join('\n');

      if (this.host.getDebugMode()) {
        returnDisplayMessage = llmContent;
      } else if (filteredOutput.trim() !== '') {
        returnDisplayMessage = filteredOutput;
      } else if (result.signal !== null) {
        returnDisplayMessage = `Command terminated by signal: ${result.signal}`;
      } else if (result.error !== null) {
        returnDisplayMessage = `Command failed: ${result.error.message}`;
      } else if (result.exitCode !== null && result.exitCode !== 0) {
        returnDisplayMessage = `Command exited with code: ${result.exitCode}`;
      }
    }

    return { llmContent, returnDisplayMessage };
  }

  private applyFilterDescription(
    returnDisplayMessage: string,
    filterInfo: { content: string; description?: string },
  ): string {
    if (
      filterInfo.description !== undefined &&
      filterInfo.description !== '' &&
      !this.host.getDebugMode()
    ) {
      return returnDisplayMessage !== ''
        ? `[${filterInfo.description}]\n${returnDisplayMessage}`
        : `[${filterInfo.description}]`;
    }
    return returnDisplayMessage;
  }

  private buildExecutionError(
    result: ShellExecutionResult,
    llmContent: string,
    timeoutTriggered: boolean,
  ):
    | { error: { message: string; type: ToolErrorType } }
    | Record<string, never> {
    const commandError = result.error as typeof result.error | null | undefined;
    if (commandError !== undefined && commandError !== null) {
      return {
        error: {
          message: commandError.message,
          type: ToolErrorType.SHELL_EXECUTE_ERROR,
        },
      };
    } else if (result.aborted === true && timeoutTriggered) {
      return {
        error: {
          message: llmContent,
          type: ToolErrorType.TIMEOUT,
        },
      };
    } else if (result.aborted === true) {
      return {
        error: {
          message: llmContent,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
    return {};
  }

  private createPreCancelledResult(): ToolResult {
    return {
      llmContent: 'Command was cancelled by user before it could start.',
      returnDisplay: 'Command cancelled by user.',
      error: {
        message: 'Command was cancelled by user before it could start.',
        type: ToolErrorType.EXECUTION_FAILED,
      },
    };
  }

  private resolveTimeoutSeconds(
    requestedTimeoutSeconds: number | undefined,
    defaultTimeoutSeconds: number,
    maxTimeoutSeconds: number | undefined,
  ): number | undefined {
    if (requestedTimeoutSeconds === -1 || defaultTimeoutSeconds === -1) {
      return undefined;
    }

    const effectiveTimeout = requestedTimeoutSeconds ?? defaultTimeoutSeconds;
    if (maxTimeoutSeconds === undefined || maxTimeoutSeconds === -1) {
      return effectiveTimeout;
    }

    if (effectiveTimeout > maxTimeoutSeconds) {
      return maxTimeoutSeconds;
    }

    return effectiveTimeout;
  }

  private isInvocationAllowlisted(command: string): boolean {
    return this.host.isShellInvocationAllowlisted(command, ShellTool.Name);
  }
}

function getShellToolDescription(): string {
  const returnedInfo = `\n\n      The following information is returned:\n\n      Command: Executed command.\n      Directory: Directory (relative to project root) where command was executed, or \`(root)\`.\n      Stdout: Output on stdout stream. Can be \`(empty)\` or partial on error and for any unwaited background processes.\n      Stderr: Output on stderr stream. Can be \`(empty)\` or partial on error and for any unwaited background processes.\n      Error: Error or \`(none)\` if no error was reported for the subprocess.\n      Exit Code: Exit code or \`(none)\` if terminated by signal.\n      Signal: Signal number or \`(none)\` if no signal was received.\n      Background PIDs: List of background processes started or \`(none)\`.\n      Process Group PGID: Process group started or \`(none)\``;

  if (os.platform() === 'win32') {
    return `This tool executes a given shell command as \`cmd.exe /c <command>\`. Command can start background processes using \`start /b\`.${returnedInfo}`;
  }
  return `This tool executes a given shell command as \`bash -c <command>\`. Command can start background processes using \`&\`. Command is executed as a subprocess that leads its own process group. Command process group can be terminated as \`kill -- -PGID\` or signaled as \`kill -s SIGNAL -- -PGID\`.${returnedInfo}`;
}

function getCommandDescription(): string {
  const cmd_substitution_warning =
    '\n*** WARNING: Command substitution using $(), `` ` ``, <(), or >() is not allowed for security reasons.';
  if (os.platform() === 'win32') {
    return (
      'Exact command to execute as `cmd.exe /c <command>`' +
      cmd_substitution_warning
    );
  }
  return (
    'Exact bash command to execute as `bash -c <command>`' +
    cmd_substitution_warning
  );
}

export class ShellTool extends BaseDeclarativeTool<
  ShellToolParams,
  ToolResult
> {
  static readonly Name: string = 'run_shell_command';
  private allowlist: Set<string> = new Set();
  private readonly host: IShellToolHost;

  constructor(
    host: IShellToolHost | IShellExecutionService,
    messageBus?: IToolMessageBus,
  ) {
    super(
      ShellTool.Name,
      'Shell',
      getShellToolDescription(),
      Kind.Execute,
      {
        type: 'object',
        properties: {
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
        },
        required: ['command'],
      },
      false,
      true,
      messageBus,
    );
    this.host = isShellToolHost(host)
      ? host
      : createShellToolHostFromExecutionService(host);
  }

  protected override validateToolParamValues(
    params: ShellToolParams,
  ): string | null {
    if (!params.command.trim()) {
      return 'Command cannot be empty.';
    }
    const commandCheck = this.host.isCommandAllowed(params.command);
    if (!commandCheck.allowed) {
      if (!commandCheck.reason) {
        return `Command is not allowed: ${params.command}`;
      }
      return commandCheck.reason;
    }

    if (this.host.getCommandRoots(params.command).length === 0) {
      return 'Could not identify command root to obtain permission from user.';
    }
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing
    const dirPath = params.dir_path || params.directory;
    if (dirPath) {
      const workspaceContext = this.host.getWorkspaceContext();
      if (path.isAbsolute(dirPath)) {
        const pathError = this.host.validatePathWithinWorkspace(
          workspaceContext,
          dirPath,
          'Directory',
        );
        if (pathError) {
          return pathError;
        }
        return null;
      }

      // Multi-segment relative paths resolve against targetDir
      if (dirPath.includes(path.sep) || dirPath.includes('/')) {
        const resolvedPath = path.resolve(this.host.getTargetDir(), dirPath);
        const pathError = this.host.validatePathWithinWorkspace(
          workspaceContext,
          resolvedPath,
          'Directory',
        );
        if (pathError) {
          return pathError;
        }
        return null;
      }

      // Single-segment: try workspace basename matching first
      const workspaceDirs = workspaceContext.getDirectories();
      const matchingDirs = workspaceDirs.filter(
        (dir) => path.basename(dir) === dirPath,
      );

      if (matchingDirs.length === 1) {
        return null;
      }

      if (matchingDirs.length > 1) {
        return `Directory name '${dirPath}' is ambiguous as it matches multiple workspace directories.`;
      }

      // No basename match — try resolving as relative path within workspace
      const resolvedPath = path.resolve(this.host.getTargetDir(), dirPath);
      if (workspaceContext.isPathWithinWorkspace(resolvedPath)) {
        return null;
      }

      return `Directory '${dirPath}' is not a registered workspace directory. Provide a workspace directory name, a relative path, or an absolute path within the workspace.`;
    }
    return null;
  }

  async execute(
    params: ShellToolParams,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<ToolResult> {
    let invocation: ToolInvocation<ShellToolParams, ToolResult>;
    try {
      invocation = this.build(params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Shell command blocked: ${params.command}\n${message}`,
        returnDisplay: `Command blocked: ${message}`,
        error: {
          message,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    const confirmation = await invocation.shouldConfirmExecute(signal);
    if (confirmation !== false) {
      const outcome = this.messageBus
        ? ((await this.messageBus.requestConfirmation(
            confirmation,
            signal,
          )) as ToolConfirmationOutcome)
        : ToolConfirmationOutcome.ProceedOnce;
      if (outcome === ToolConfirmationOutcome.Cancel) {
        return {
          llmContent: `Shell command cancelled: ${params.command}`,
          returnDisplay: 'Command cancelled by user.',
          error: {
            message: 'Shell command cancelled by user.',
            type: ToolErrorType.EXECUTION_FAILED,
          },
        };
      }
      if ('onConfirm' in confirmation) {
        await confirmation.onConfirm(outcome);
      }
    }

    return invocation.execute(signal);
  }

  protected createInvocation(
    params: ShellToolParams,
    messageBus: IToolMessageBus,
  ): ToolInvocation<ShellToolParams, ToolResult> {
    const normalizedParams = { ...params };
    if (!normalizedParams.dir_path && normalizedParams.directory) {
      normalizedParams.dir_path = normalizedParams.directory;
    }
    return new ShellToolInvocation(
      this.host,
      normalizedParams,
      this.allowlist,
      messageBus,
    );
  }
}
/* eslint-enable complexity, max-lines -- Shell tool delegated through IShellToolHost. */
