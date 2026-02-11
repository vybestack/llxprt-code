/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import os, { EOL } from 'os';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { Config } from '../config/config.js';
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
import { stripShellMarkers } from '../utils/shell-markers.js';
import {
  ShellExecutionService,
  type ShellOutputEvent,
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

// Throttle interval for shell output updates to avoid excessive UI updates.
// Using 100ms provides responsive feedback without overwhelming the system.
export const OUTPUT_UPDATE_INTERVAL_MS = 100;

// Tool timeout settings (Issue #1049)
const DEFAULT_SHELL_TIMEOUT_SECONDS = 300;
const MAX_SHELL_TIMEOUT_SECONDS = 900;

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

class ShellToolInvocation extends BaseToolInvocation<
  ShellToolParams,
  ToolResult
> {
  private readonly logger = DebugLogger.getLogger('llxprt:shell');

  constructor(
    private readonly config: Config,
    params: ShellToolParams,
    private readonly allowlist: Set<string>,
    messageBus?: MessageBus,
  ) {
    super(params, messageBus);
  }

  override getToolName(): string {
    return ShellTool.Name;
  }

  private getDirPath(): string | undefined {
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
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          commandsToConfirm.forEach((command) => this.allowlist.add(command));
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
    // Validate filtering parameters
    if (this.params.head_lines) {
      validatePositiveInteger(this.params.head_lines, 'head_lines');
    }
    if (this.params.tail_lines) {
      validatePositiveInteger(this.params.tail_lines, 'tail_lines');
    }
    if (this.params.grep_pattern) {
      if (!this.params.grep_pattern.trim()) {
        throw new Error('grep_pattern cannot be empty');
      }
    }
    if (this.params.grep_flags) {
      validateGrepFlags(this.params.grep_flags);
    }

    const strippedCommand = stripShellWrapper(this.params.command);

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
    // Convert seconds to milliseconds for setTimeout
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
    if (signal.aborted) {
      onUserAbort();
      return {
        llmContent: 'Command was cancelled by user before it could start.',
        returnDisplay: 'Command cancelled by user.',
        error: {
          message: 'Command was cancelled by user before it could start.',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    signal.addEventListener('abort', onUserAbort, { once: true });

    const combinedSignal = timeoutController.signal;

    const isWindows = os.platform() === 'win32';
    const tempFileName = `shell_pgrep_${crypto
      .randomBytes(6)
      .toString('hex')}.tmp`;
    const tempFilePath = path.join(os.tmpdir(), tempFileName);

    try {
      // pgrep is not available on Windows, so we can't get background PIDs
      const commandToExecute = isWindows
        ? strippedCommand
        : (() => {
            // wrap command to append subprocess pids (via pgrep) to temporary file
            let command = strippedCommand.trim();
            // Instrument chained commands with a lightweight marker to indicate which subcommand is starting.
            // This helps the UI display the currently running segment without guessing.
            // Only apply when using a POSIX shell and when a simple && chain is present.
            //
            // Limitations: This simple split('&&') approach does not handle:
            // - Quoted strings containing && (e.g., echo "foo && bar" && echo baz)
            // - Escaped delimiters or other shell operators (||, ;, |)
            // - Complex shell syntax (if/for/while loops, functions, etc.)
            // For such cases, instrumentation is skipped and the command runs as-is.
            const hasComplexSyntax =
              /["'`\\]|\|\||;|\||^if\s|^for\s|^while\s/.test(command);
            const parts = command
              .split('&&')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            if (parts.length > 1 && !hasComplexSyntax) {
              command = parts
                .map((seg) => `echo __LLXPRT_CMD__:${seg}; ${seg}`)
                .join(' && ');
            }
            if (!command.endsWith('&')) command += ';';
            return `{ ${command} }; __code=$?; pgrep -g 0 >${tempFilePath} 2>&1; exit $__code;`;
          })();

      const cwd = path.resolve(
        this.config.getTargetDir(),
        this.getDirPath() || '',
      );

      let cumulativeOutput: string | AnsiOutput = '';
      // Initialize to 0 to allow immediate first update
      let lastUpdateTime = 0;
      let isBinaryStream = false;

      const executionResult = await ShellExecutionService.execute(
        commandToExecute,
        cwd,
        (event: ShellOutputEvent) => {
          if (!updateOutput) {
            return;
          }

          let shouldUpdate = false;

          switch (event.type) {
            case 'data': {
              if (isBinaryStream) break;
              // In PTY mode, event.chunk is AnsiOutput (full screen state)
              // In child_process mode, event.chunk is string (incremental)
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

      // Propagate PID immediately (before awaiting result) so the UI can
      // offer Ctrl+F interactive shell focus while the process is running.
      const pid = executionResult.pid;
      if (
        pid &&
        setPidCallback &&
        this.config.getShouldUseNodePtyShell() &&
        ShellExecutionService.isActivePty(pid)
      ) {
        setPidCallback(pid);
      }

      const result = await executionResult.result;

      const backgroundPIDs: number[] = [];
      let pgid: number | null = null;
      if (os.platform() !== 'win32' && result) {
        if (fs.existsSync(tempFilePath)) {
          const pgrepLines = fs
            .readFileSync(tempFilePath, 'utf8')
            .split(EOL)
            .filter(Boolean);
          for (const line of pgrepLines) {
            if (!/^\d+$/.test(line)) {
              console.error(`pgrep: ${line}`);
            }
            const pid = Number(line);
            if (result.pid && pid !== result.pid) {
              backgroundPIDs.push(pid);
            }
          }
        } else {
          if (!signal.aborted) {
            console.error('missing pgrep output');
          }
        }

        // Try to get the actual PGID
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
        } catch (error) {
          // If we can't get the PGID, that's okay
          console.error('Failed to get PGID:', error);
        }
      }

      const rawOutput = result?.output ?? '';
      const filterInfo = applyOutputFilters(rawOutput, this.params);
      const filteredOutput = filterInfo.content;

      let llmContent = '';
      let returnDisplayMessage = '';

      if (!result) {
        llmContent = 'Command failed to execute.';
        if (this.config.getDebugMode()) {
          returnDisplayMessage = llmContent;
        }
      } else if (result.aborted) {
        const timeoutTriggered =
          timeoutController.signal.aborted && !signal.aborted;
        if (timeoutTriggered) {
          llmContent = `Command timed out after ${timeoutSeconds ?? defaultTimeoutSeconds}s (timeout_seconds).`;
          if (rawOutput && rawOutput.trim()) {
            llmContent += ` Partial output:\n${rawOutput}`;
          } else {
            llmContent += ' There was no output before timeout.';
          }

          returnDisplayMessage = llmContent;
        } else {
          llmContent =
            'Command was cancelled by user before it could complete.';
          if (rawOutput && rawOutput.trim()) {
            llmContent += ` Below is the output before it was cancelled:\n${rawOutput}`;
          } else {
            llmContent += ' There was no output before it was cancelled.';
          }

          if (this.config.getDebugMode()) {
            returnDisplayMessage = llmContent;
          } else if (filteredOutput && filteredOutput.trim()) {
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
          `Directory: ${this.getDirPath() || '(root)'}`,
          `Stdout: ${filteredOutput || '(empty)'}`,
          `Stderr: (empty)`,
          `Error: ${finalError}`,
          `Exit Code: ${result.exitCode ?? '(none)'}`,
          `Signal: ${result.signal ?? '(none)'}`,
          `Background PIDs: ${
            backgroundPIDs.length ? backgroundPIDs.join(', ') : '(none)'
          }`,
          `Process Group PGID: ${pgid ?? result.pid ?? '(none)'}`,
        ].join('\n');

        if (this.config.getDebugMode()) {
          returnDisplayMessage = llmContent;
        } else if (filteredOutput && filteredOutput.trim()) {
          returnDisplayMessage = filteredOutput;
        } else if (result.signal) {
          returnDisplayMessage = `Command terminated by signal: ${result.signal}`;
        } else if (result.error) {
          returnDisplayMessage = `Command failed: ${getErrorMessage(result.error)}`;
        } else if (result.exitCode !== null && result.exitCode !== 0) {
          returnDisplayMessage = `Command exited with code: ${result.exitCode}`;
        }
      }

      if (filterInfo.description && !this.config.getDebugMode()) {
        returnDisplayMessage = returnDisplayMessage
          ? `[${filterInfo.description}]\n${returnDisplayMessage}`
          : `[${filterInfo.description}]`;
      }

      // Check if summarization is configured
      const summarizeConfig = this.config.getSummarizeToolOutputConfig();
      const executionError = result?.error
        ? {
            error: {
              message: result.error.message,
              type: ToolErrorType.SHELL_EXECUTE_ERROR,
            },
          }
        : result?.aborted && timeoutController.signal.aborted && !signal.aborted
          ? {
              error: {
                message: llmContent,
                type: ToolErrorType.TIMEOUT,
              },
            }
          : result?.aborted
            ? {
                error: {
                  message: llmContent,
                  type: ToolErrorType.EXECUTION_FAILED,
                },
              }
            : {};

      // Remove runtime marker lines from model-facing content to reduce summarization cost
      const llmContentStripped = stripShellMarkers(llmContent);
      let llmPayload = llmContentStripped;
      if (
        summarizeConfig &&
        summarizeConfig[ShellTool.Name] &&
        result &&
        !result.aborted
      ) {
        // Get the ServerToolsProvider for summarization
        const contentGenConfig = this.config.getContentGeneratorConfig();
        if (contentGenConfig?.providerManager) {
          const serverToolsProvider =
            contentGenConfig.providerManager.getServerToolsProvider();

          // If we have a ServerToolsProvider that can handle summarization
          if (serverToolsProvider) {
            // TODO: Need to adapt summarizeToolOutput to use ServerToolsProvider
            // For now, check if it's a Gemini provider and use the existing function
            if (serverToolsProvider.name === 'gemini') {
              const summary = await summarizeToolOutput(
                llmContentStripped,
                this.config.getGeminiClient(),
                signal,
                summarizeConfig[ShellTool.Name].tokenBudget,
              );
              if (summary) {
                llmPayload = summary;
              }
            }
            // If not Gemini, we can't summarize yet - need provider-agnostic summarization
          }
        }
      }

      // For ShellTool, apply a "middle clip" strategy so we preserve both the
      // beginning (setup/context) and the end (results/errors).
      // We still respect the current maxTokens and truncateMode settings.
      const limits = getOutputLimits(this.config);
      const maxTokens = limits.maxTokens;
      const effectiveLimit = maxTokens
        ? getEffectiveTokenLimit(maxTokens)
        : undefined;

      if (
        effectiveLimit &&
        effectiveLimit > 0 &&
        limits.truncateMode === 'truncate'
      ) {
        // Approximate a char budget from the token budget. Keep it conservative
        // to avoid overshooting after serialization/escaping.
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

      // In warn/sample, keep the existing limiter behavior.
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
        `Final returnDisplayMessage length=${returnDisplayMessage?.length ?? 0}, preview=${returnDisplayMessage?.slice(0, 100) ?? 'EMPTY'}`,
      );

      return {
        llmContent: limitedResult.content,
        returnDisplay: returnDisplayMessage,
        ...executionError,
      };
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      signal.removeEventListener('abort', onUserAbort);
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
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
    const allowedTools = this.config.getAllowedTools() || [];
    if (allowedTools.length === 0) {
      return false;
    }

    const invocation = { params: { command } } as unknown as AnyToolInvocation;
    return isShellInvocationAllowlisted(invocation, allowedTools);
  }
}

function applyOutputFilters(
  output: string,
  params: ShellToolParams,
): { content: string; description?: string } {
  let content = output;
  const descriptionParts: string[] = [];

  // Apply grep filter first
  if (params.grep_pattern) {
    const lines = content.split('\n');
    let filteredLines: string[];

    if (params.grep_flags?.includes('-v')) {
      // Inverted grep
      const options = params.grep_flags.includes('-i') ? 'i' : '';
      const regex = new RegExp(params.grep_pattern, options);
      filteredLines = lines.filter((line) => !regex.test(line));
    } else {
      // Normal grep
      const options = params.grep_flags?.includes('-i') ? 'i' : '';
      const regex = new RegExp(params.grep_pattern, options);
      filteredLines = lines.filter((line) => regex.test(line));
    }

    content = filteredLines.join('\n');
    descriptionParts.push(`grep_pattern filter: "${params.grep_pattern}"`);
    if (params.grep_flags?.length) {
      descriptionParts.push(`flags: [${params.grep_flags.join(', ')}]`);
    }
  }

  // Apply head_lines filter
  if (params.head_lines) {
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
  if (params.tail_lines) {
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
  } else {
    return `This tool executes a given shell command as \`bash -c <command>\`. Command can start background processes using \`&\`. Command is executed as a subprocess that leads its own process group. Command process group can be terminated as \`kill -- -PGID\` or signaled as \`kill -s SIGNAL -- -PGID\`.${returnedInfo}`;
  }
}

function getCommandDescription(): string {
  const cmd_substitution_warning =
    '\n*** WARNING: Command substitution using $(), `` ` ``, <(), or >() is not allowed for security reasons.';
  if (os.platform() === 'win32') {
    return (
      'Exact command to execute as `cmd.exe /c <command>`' +
      cmd_substitution_warning
    );
  } else {
    return (
      'Exact bash command to execute as `bash -c <command>`' +
      cmd_substitution_warning
    );
  }
}

export class ShellTool extends BaseDeclarativeTool<
  ShellToolParams,
  ToolResult
> {
  static Name: string = 'run_shell_command';
  private allowlist: Set<string> = new Set();

  constructor(
    private readonly config: Config,
    messageBus?: MessageBus,
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
        console.error(
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
    const dirPath = params.dir_path || params.directory;
    if (dirPath) {
      const workspaceContext = this.config.getWorkspaceContext();
      if (path.isAbsolute(dirPath)) {
        if (!workspaceContext.isPathWithinWorkspace(dirPath)) {
          const directories = workspaceContext.getDirectories();
          return `Directory must be within one of the workspace directories: ${directories.join(', ')}`;
        }
        return null;
      }

      // Multi-segment relative paths (e.g., "src/utils") resolve against targetDir
      if (dirPath.includes(path.sep) || dirPath.includes('/')) {
        const resolvedPath = path.resolve(this.config.getTargetDir(), dirPath);
        if (!workspaceContext.isPathWithinWorkspace(resolvedPath)) {
          const directories = workspaceContext.getDirectories();
          return `Directory must be within one of the workspace directories: ${directories.join(', ')}`;
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
    messageBus?: MessageBus,
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
