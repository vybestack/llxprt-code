/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, max-lines -- Phase 5: legacy core boundary retained while larger decomposition continues. */

import fs from 'fs';
import path from 'path';
import os, { EOL } from 'os';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import type { Config } from '../config/config.js';
import type { AnyToolInvocation } from '../index.js';
import { initializeParser } from '../utils/shell-parser.js';

// Initialize tree-sitter parser (async, non-blocking)
// Failures are handled gracefully with fallback to regex
initializeParser().catch(() => {
  // Initialization errors are already handled in shell-parser.ts
});
import { ToolErrorType } from './tool-error.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  type ToolInvocation,
  type ToolResult,
  type ToolExecuteConfirmationDetails,
  ToolConfirmationOutcome,
  type ToolCallConfirmationDetails,
  Kind,
  type PolicyUpdateOptions,
} from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { ApprovalMode } from '../config/config.js';
import { getErrorMessage } from '../utils/errors.js';
import {
  limitOutputTokens,
  formatLimitedOutput,
  getOutputLimits,
  getEffectiveTokenLimit,
  clipMiddle,
} from '../utils/toolOutputLimiter.js';
import { summarizeToolOutput } from '../utils/summarizer.js';
import {
  ShellExecutionService,
  type ShellOutputEvent,
  type ShellExecutionResult,
} from '../services/shellExecutionService.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';
import { formatMemoryUsage } from '../utils/formatters.js';
import {
  getCommandRoots,
  isCommandAllowed,
  stripShellWrapper,
} from '../utils/shell-utils.js';
import { isShellInvocationAllowlisted } from '../utils/tool-utils.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import { debugLogger } from '../utils/debugLogger.js';
import { validatePathWithinWorkspace } from '../safety/index.js';

// Throttle interval for shell output updates to avoid excessive UI updates.
// Using 100ms provides responsive feedback without overwhelming the system.
export const OUTPUT_UPDATE_INTERVAL_MS = 100;

// Tool timeout settings (Issue #1049)
const DEFAULT_SHELL_TIMEOUT_SECONDS = 300;
const MAX_SHELL_TIMEOUT_SECONDS = 900;

/**
 * Check if a PID should be propagated to the UI for interactive shell focus.
 * Preserves old falsy semantics: pid 0 is skipped (invalid process ID).
 */
function getPropagatablePid(
  pid: number | undefined,
  setPidCallback: ((pid: number) => void) | undefined,
  shouldUseNodePty: boolean,
): number | undefined {
  // Preserve old truthiness semantics: skip pid 0 (invalid process ID)
  if (pid === undefined || pid === 0) {
    return undefined;
  }
  if (setPidCallback === undefined) {
    return undefined;
  }
  if (!shouldUseNodePty || !ShellExecutionService.isActivePty(pid)) {
    return undefined;
  }
  return pid;
}

/**
 * Check if a line from pgrep output is a valid background PID.
 * Preserves old falsy semantics: result.pid 0 is skipped.
 */
function isValidBackgroundPid(
  linePid: number,
  mainPid: number | undefined,
): boolean {
  // Preserve old falsy semantics: main pid 0 means we can't identify background PIDs
  if (mainPid === undefined || mainPid === 0) {
    return false;
  }
  return linePid !== mainPid;
}

export interface ShellToolParams {
  /**
   * The shell command to execute
   */
  command: string;

  /**
   * Optional description of what this command does, used for confirmation prompts
   */
  description?: string;

  /**
   * Optional directory to execute the command in, relative to the target directory
   */
  dir_path?: string;

  /**
   * Optional directory to execute the command in, relative to the target directory
   * @deprecated Use dir_path instead. Kept for backward compatibility.
   */
  directory?: string;

  /**
   * Optional number of lines to show from the beginning of output
   */
  head_lines?: number;

  /**
   * Optional number of lines to show from the end of output
   */
  tail_lines?: number;

  /**
   * Optional grep pattern to filter output lines
   */
  grep_pattern?: string;

  /**
   * Optional grep flags (e.g., -i for case-insensitive, -v for inverted)
   */
  grep_flags?: string[];

  /**
   * Optional timeout in seconds (-1 for unlimited).
   */
  timeout_seconds?: number;
}

export class ShellToolInvocation extends BaseToolInvocation<
  ShellToolParams,
  ToolResult
> {
  private readonly logger = DebugLogger.getLogger('llxprt:shell');

  constructor(
    private readonly config: Config,
    params: ShellToolParams,
    private readonly allowlist: Set<string>,
    messageBus: MessageBus,
  ) {
    super(params, messageBus);
  }

  override getToolName(): string {
    return ShellTool.Name;
  }

  private getDirPath(): string | undefined {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string dir_path should fall through to directory
    return this.params.dir_path || this.params.directory;
  }

  override getDescription(): string {
    let description = `${this.params.command}`;
    // append optional [in directory]
    // note description is needed even if validation fails due to absolute path
    const dirPath = this.getDirPath();
    if (dirPath) {
      description += ` [in ${dirPath}]`;
    } else {
      description += ` [current working directory ${process.cwd()}]`;
    }
    // append optional (description), replacing any line breaks with spaces
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
      const command = stripShellWrapper(this.params.command);
      const rootCommands = [...new Set(getCommandRoots(command))];
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
    const command = stripShellWrapper(this.params.command);
    const rootCommands = [...new Set(getCommandRoots(command))];

    // In non-interactive mode, we need to prevent the tool from hanging while
    // waiting for user input. If a tool is not fully allowed (e.g. via
    // --allowed-tools="ShellTool(wc)"), we should throw an error instead of
    // prompting for confirmation. This check is skipped in YOLO mode.
    if (
      !this.config.isInteractive() &&
      this.config.getApprovalMode() !== ApprovalMode.YOLO
    ) {
      if (this.isInvocationAllowlisted(command)) {
        // If it's an allowed shell command, we don't need to confirm execution.
        return false;
      }

      throw new Error(
        `Command "${command}" is not in the list of allowed tools for non-interactive mode.`,
      );
    }

    const commandsToConfirm = rootCommands.filter(
      (command) => !this.allowlist.has(command),
    );

    if (commandsToConfirm.length === 0) {
      return false; // already approved and allowlisted
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
          commandsToConfirm.forEach((command) => {
            this.allowlist.add(command);
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
    updateOutput?: (output: string | AnsiOutput) => void,
    terminalColumns?: number,
    terminalRows?: number,
    setPidCallback?: (pid: number) => void,
  ): Promise<ToolResult> {
    this.validateFilterParams();

    const strippedCommand = stripShellWrapper(this.params.command);

    const {
      timeoutSeconds,
      defaultTimeoutSeconds,
      timeoutController,
      timeoutId,
      onUserAbort,
    } = this.createTimeoutControllers(signal);

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
        defaultTimeoutSeconds,
        onUserAbort,
        timeoutId,
        updateOutput,
        terminalColumns,
        terminalRows,
        setPidCallback,
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
    onUserAbort: () => void,
    timeoutId: ReturnType<typeof setTimeout> | null,
    updateOutput?: (output: string | AnsiOutput) => void,
    terminalColumns?: number,
    terminalRows?: number,
    setPidCallback?: (pid: number) => void,
  ): Promise<ToolResult> {
    const combinedSignal = timeoutController.signal;

    const isWindows = os.platform() === 'win32';
    const tempFileName = `shell_pgrep_${crypto
      .randomBytes(6)
      .toString('hex')}.tmp`;
    const tempFilePath = path.join(os.tmpdir(), tempFileName);

    try {
      const commandToExecute = this.buildCommandToExecute(
        strippedCommand,
        isWindows,
        tempFilePath,
      );

      const cwd = path.resolve(
        this.config.getTargetDir(),
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string dir_path should fall through to empty string for resolve
        this.getDirPath() || '',
      );

      const executionResult = await this.runShellCommand(
        commandToExecute,
        cwd,
        combinedSignal,
        updateOutput,
        terminalColumns,
        terminalRows,
      );

      this.propagatePid(executionResult, setPidCallback);
      const result = await executionResult.result;

      const { backgroundPIDs, pgid } = this.collectProcessInfo(
        result,
        tempFilePath,
        signal,
      );

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      const rawOutput = result?.output ?? '';
      const filterInfo = applyOutputFilters(rawOutput, this.params);
      const filteredOutput = filterInfo.content;

      const timeoutTriggered =
        timeoutController.signal.aborted === true &&
        (signal.aborted as boolean | undefined) === false;

      return await this.buildAndApplyOutput(
        result,
        rawOutput,
        filteredOutput,
        commandToExecute,
        backgroundPIDs,
        pgid,
        timeoutTriggered,
        timeoutSeconds,
        defaultTimeoutSeconds,
        signal,
        filterInfo,
      );
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  }

  private async buildAndApplyOutput(
    result: ShellExecutionResult,
    rawOutput: string,
    filteredOutput: string,
    commandToExecute: string,
    backgroundPIDs: number[],
    pgid: number | null,
    timeoutTriggered: boolean,
    timeoutSeconds: number | undefined,
    defaultTimeoutSeconds: number,
    signal: AbortSignal,
    filterInfo: { content: string; description?: string },
  ): Promise<ToolResult> {
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
    const shellToolConfig =
      this.config.getSummarizeToolOutputConfig()?.[ShellTool.Name];
    if (shellToolConfig !== undefined && result.aborted !== true) {
      llmPayload = await this.trySummarizeOutput(
        llmContent,
        shellToolConfig,
        signal,
      );
    }

    return this.applyOutputLimits(
      llmPayload,
      displayWithFilter,
      executionError,
    );
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

  private createTimeoutControllers(signal: AbortSignal): {
    timeoutSeconds: number | undefined;
    defaultTimeoutSeconds: number;
    timeoutController: AbortController;
    timeoutId: ReturnType<typeof setTimeout> | null;
    onUserAbort: () => void;
  } {
    const ephemeralSettings = this.config.getEphemeralSettings();
    const defaultTimeoutSeconds =
      (ephemeralSettings['shell-default-timeout-seconds'] as
        | number
        | undefined) ?? DEFAULT_SHELL_TIMEOUT_SECONDS;
    const maxTimeoutSeconds =
      (ephemeralSettings['shell-max-timeout-seconds'] as number | undefined) ??
      MAX_SHELL_TIMEOUT_SECONDS;
    const timeoutSeconds = this.resolveTimeoutSeconds(
      this.params.timeout_seconds,
      defaultTimeoutSeconds,
      maxTimeoutSeconds,
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

    return {
      timeoutSeconds,
      defaultTimeoutSeconds,
      timeoutController,
      timeoutId,
      onUserAbort,
    };
  }

  private buildCommandToExecute(
    strippedCommand: string,
    isWindows: boolean,
    tempFilePath: string,
  ): string {
    if (isWindows) {
      return strippedCommand;
    }
    let command = strippedCommand.trim();
    if (!command.endsWith('&')) command += ';';
    return `{ ${command} }; __code=$?; pgrep -g 0 >${tempFilePath} 2>&1; exit $__code;`;
  }

  private async runShellCommand(
    commandToExecute: string,
    cwd: string,
    combinedSignal: AbortSignal,
    updateOutput?: (output: string | AnsiOutput) => void,
    terminalColumns?: number,
    terminalRows?: number,
  ) {
    let cumulativeOutput: string | AnsiOutput = '';
    let lastUpdateTime = 0;
    let isBinaryStream = false;

    return ShellExecutionService.execute(
      commandToExecute,
      cwd,
      (event: ShellOutputEvent) => {
        if (!updateOutput) return;

        let shouldUpdate = false;

        switch (event.type) {
          case 'data': {
            if (isBinaryStream) break;
            cumulativeOutput = event.chunk;
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
            cumulativeOutput = `[Receiving binary output... ${formatMemoryUsage(
              event.bytesReceived,
            )} received]`;
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
      this.config.getShouldUseNodePtyShell(),
      {
        ...this.config.getShellExecutionConfig(),
        terminalWidth: terminalColumns ?? this.config.getPtyTerminalWidth(),
        terminalHeight: terminalRows ?? this.config.getPtyTerminalHeight(),
      },
    );
  }

  private propagatePid(
    executionResult: Awaited<ReturnType<typeof ShellExecutionService.execute>>,
    setPidCallback?: (pid: number) => void,
  ): void {
    const pid = executionResult.pid;
    const propagatablePid = getPropagatablePid(
      pid,
      setPidCallback,
      this.config.getShouldUseNodePtyShell(),
    );
    if (propagatablePid !== undefined) {
      setPidCallback?.(propagatablePid);
    }
  }

  private parsePgrepFile(
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
        this.logger.debug(() => `pgrep: ${line}`);
        continue;
      }
      const linePid = Number(line);
      if (isValidBackgroundPid(linePid, mainPid)) {
        pids.push(linePid);
      }
    }
    return pids;
  }

  private collectProcessInfo(
    result: ShellExecutionResult,
    tempFilePath: string,
    signal: AbortSignal,
  ): { backgroundPIDs: number[]; pgid: number | null } {
    const backgroundPIDs: number[] = [];
    let pgid: number | null = null;
    if (os.platform() !== 'win32') {
      const pgrepResult = this.parsePgrepFile(tempFilePath, result.pid);
      backgroundPIDs.push(...pgrepResult);

      if (
        backgroundPIDs.length === 0 &&
        signal.aborted === false &&
        !fs.existsSync(tempFilePath)
      ) {
        this.logger.debug(() => 'missing pgrep output');
      }

      try {
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
        const psResult = spawnSync('ps', [
          '-o',
          'pgid=',
          '-p',
          String(result.pid),
        ]);

        if (psResult.status === 0 && psResult.stdout.toString().trim()) {
          pgid = parseInt(psResult.stdout.toString().trim(), 10);
        }
      } catch (error) {
        this.logger.debug(() => `Failed to get PGID: ${error}`);
      }
    }
    return { backgroundPIDs, pgid };
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

        if (this.config.getDebugMode()) {
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
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string directory should fall through to '(root)'
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

      if (this.config.getDebugMode()) {
        returnDisplayMessage = llmContent;
      } else if (filteredOutput.trim() !== '') {
        returnDisplayMessage = filteredOutput;
      } else if (result.signal !== null) {
        returnDisplayMessage = `Command terminated by signal: ${result.signal}`;
      } else if (result.error !== null) {
        returnDisplayMessage = `Command failed: ${getErrorMessage(result.error)}`;
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
      !this.config.getDebugMode()
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

  private async trySummarizeOutput(
    llmContent: string,
    shellToolConfig: { tokenBudget?: number },
    signal: AbortSignal,
  ): Promise<string> {
    const contentGenConfig = this.config.getContentGeneratorConfig();
    if (contentGenConfig?.providerManager === undefined) {
      return llmContent;
    }

    const serverToolsProvider =
      contentGenConfig.providerManager.getServerToolsProvider();

    if (serverToolsProvider !== null && serverToolsProvider.name === 'gemini') {
      const summary = (await summarizeToolOutput(
        llmContent,
        this.config.getGeminiClient(),
        signal,
        shellToolConfig.tokenBudget,
      )) as string | null | undefined;
      if (summary !== undefined && summary !== null && summary !== '') {
        return summary;
      }
    }

    return llmContent;
  }

  private applyOutputLimits(
    llmPayload: string,
    returnDisplayMessage: string,
    executionError:
      | { error: { message: string; type: ToolErrorType } }
      | Record<string, never>,
  ): ToolResult {
    const limits = getOutputLimits(this.config);
    const maxTokens = limits.maxTokens;
    const effectiveLimit =
      maxTokens !== undefined && maxTokens !== 0
        ? getEffectiveTokenLimit(maxTokens)
        : undefined;

    if (
      effectiveLimit !== undefined &&
      effectiveLimit > 0 &&
      limits.truncateMode === 'truncate'
    ) {
      const approxMaxChars = effectiveLimit * 3;
      const clipped = clipMiddle(llmPayload, approxMaxChars, 0.3, 0.7);
      if (clipped.wasTruncated) {
        llmPayload = clipped.content;
      }

      return {
        llmContent: llmPayload,
        returnDisplay: returnDisplayMessage,
        ...executionError,
      };
    }

    const limitedResult = limitOutputTokens(
      llmPayload,
      this.config,
      'run_shell_command',
    );

    if (limitedResult.wasTruncated) {
      const formatted = formatLimitedOutput(limitedResult);
      return {
        llmContent: formatted.llmContent,
        returnDisplay: returnDisplayMessage,
        ...executionError,
      };
    }

    this.logger.debug(
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      `Final returnDisplayMessage length=${returnDisplayMessage?.length ?? 0}, preview=${returnDisplayMessage?.slice(0, 100) ?? 'EMPTY'}`,
    );

    return {
      llmContent: limitedResult.content,
      returnDisplay: returnDisplayMessage,
      ...executionError,
    };
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
    maxTimeoutSeconds: number,
  ): number | undefined {
    if (requestedTimeoutSeconds === -1 || defaultTimeoutSeconds === -1) {
      return undefined;
    }

    const effectiveTimeout = requestedTimeoutSeconds ?? defaultTimeoutSeconds;
    if (maxTimeoutSeconds === -1) {
      return effectiveTimeout;
    }

    if (effectiveTimeout > maxTimeoutSeconds) {
      return maxTimeoutSeconds;
    }

    return effectiveTimeout;
  }

  private isInvocationAllowlisted(command: string): boolean {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: getAllowedTools returns undefined or array, empty array should be used
    const allowedTools = this.config.getAllowedTools() || [];
    if (allowedTools.length === 0) {
      return false;
    }

    const invocation = { params: { command } } as unknown as AnyToolInvocation;
    return isShellInvocationAllowlisted(invocation, allowedTools);
  }
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

  // Apply head_lines filter
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

  // Apply tail_lines filter
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
  static Name: string = 'run_shell_command';
  private allowlist: Set<string> = new Set();

  constructor(
    private readonly config: Config,
    messageBus: MessageBus,
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
      false, // output is not markdown
      true, // output can be updated
      messageBus,
    );
  }

  protected override validateToolParamValues(
    params: ShellToolParams,
  ): string | null {
    const commandCheck = isCommandAllowed(params.command, this.config);
    if (!commandCheck.allowed) {
      if (!commandCheck.reason) {
        debugLogger.error(
          'Unexpected: isCommandAllowed returned false without a reason',
        );
        return `Command is not allowed: ${params.command}`;
      }
      return commandCheck.reason;
    }
    if (!params.command.trim()) {
      return 'Command cannot be empty.';
    }
    if (getCommandRoots(params.command).length === 0) {
      return 'Could not identify command root to obtain permission from user.';
    }
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string dir_path should fall through to directory
    const dirPath = params.dir_path || params.directory;
    if (dirPath) {
      const workspaceContext = this.config.getWorkspaceContext();
      if (path.isAbsolute(dirPath)) {
        const pathError = validatePathWithinWorkspace(
          workspaceContext,
          dirPath,
          'Directory',
        );
        if (pathError) {
          return pathError;
        }
        return null;
      }

      // Multi-segment relative paths (e.g., "src/utils") resolve against targetDir
      if (dirPath.includes(path.sep) || dirPath.includes('/')) {
        const resolvedPath = path.resolve(this.config.getTargetDir(), dirPath);
        const pathError = validatePathWithinWorkspace(
          workspaceContext,
          resolvedPath,
          'Directory',
        );
        if (pathError) {
          return pathError;
        }
        return null;
      }

      // Single-segment: try workspace basename matching first for backward compat
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
      const resolvedPath = path.resolve(this.config.getTargetDir(), dirPath);
      if (workspaceContext.isPathWithinWorkspace(resolvedPath)) {
        return null;
      }

      return `Directory '${dirPath}' is not a registered workspace directory. Provide a workspace directory name, a relative path, or an absolute path within the workspace.`;
    }
    return null;
  }

  protected createInvocation(
    params: ShellToolParams,
    messageBus: MessageBus,
  ): ToolInvocation<ShellToolParams, ToolResult> {
    const normalizedParams = { ...params };
    if (!normalizedParams.dir_path && normalizedParams.directory) {
      normalizedParams.dir_path = normalizedParams.directory;
    }
    return new ShellToolInvocation(
      this.config,
      normalizedParams,
      this.allowlist,
      messageBus,
    );
  }
}
/* eslint-enable complexity, max-lines -- Phase 5: legacy core boundary retained while larger decomposition continues. */
