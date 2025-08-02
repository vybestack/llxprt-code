/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { Config } from '../config/config.js';
import {
  BaseTool,
  ToolResult,
  ToolExecuteConfirmationDetails,
  Icon,
} from './tools.js';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { getErrorMessage } from '../utils/errors.js';
import { Type } from '@google/genai';
import { summarizeToolOutput } from '../utils/summarizer.js';
import {
  ShellExecutionService,
  ShellOutputEvent,
} from '../services/shellExecutionService.js';
import { formatMemoryUsage } from '../utils/formatters.js';
import {
  getCommandRoots,
  isCommandAllowed,
  stripShellWrapper,
} from '../utils/shell-utils.js';

export const OUTPUT_UPDATE_INTERVAL_MS = 1000;

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
  directory?: string;
}

export class ShellTool extends BaseTool<ShellToolParams, ToolResult> {
  static readonly Name = 'run_shell_command';

  constructor(private config: Config) {
    super(
      ShellTool.Name,
      'RunShellCommand',
      'Execute a shell command within a secure sandboxed environment',
      Icon.Terminal,
      {
        properties: {
          command: {
            description: 'The shell command to execute',
            type: Type.STRING,
          },
          description: {
            description:
              'Optional description of what this command does, used for confirmation prompts',
            type: Type.STRING,
          },
          directory: {
            description:
              'Optional directory to execute the command in, relative to the target directory',
            type: Type.STRING,
          },
        },
        required: ['command'],
        type: Type.OBJECT,
      },
      true,
    );
  }

  /**
   * Gets a user-friendly description of the shell command to execute.
   *
   * @param params The shell tool parameters
   * @returns A formatted description of the command
   */
  formatCommand(params: ShellToolParams): string {
    let description = `${params.command}`;
    if (params.description) {
      description += ` (${params.description.replace(/\n/g, ' ')})`;
    }
    return description;
  }

  validateToolParams(params: ShellToolParams): string | null {
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

    const schemaValidationResult = SchemaValidator.validate(
      this.parameterSchema as Record<string, unknown>,
      params,
    );

    if (schemaValidationResult !== null) {
      return `Parameters failed schema validation.`;
    }

    if (!params.command.trim()) {
      return 'Command cannot be empty.';
    }
    if (getCommandRoots(params.command).length === 0) {
      return 'Could not identify command root to obtain permission from user.';
    }
    if (params.directory) {
      if (path.isAbsolute(params.directory)) {
        return 'Directory cannot be absolute. Please refer to workspace directories by their name.';
      }
      const workspaceDirs = this.config.getWorkspaceContext().getDirectories();
      const matchingDirs = workspaceDirs.filter(
        (dir) => path.basename(dir) === params.directory,
      );

      if (matchingDirs.length === 0) {
        return `Directory '${params.directory}' is not a registered workspace directory.`;
      }

      if (matchingDirs.length > 1) {
        return `Directory name '${params.directory}' is ambiguous as it matches multiple workspace directories.`;
      }
    }
    return null;
  }

  async shouldConfirmExecute(
    params: ShellToolParams,
  ): Promise<ToolExecuteConfirmationDetails | false> {
    const commandRoots = getCommandRoots(params.command);
    const uniqueRoots = [...new Set(commandRoots)];
    const rootCommand =
      uniqueRoots.length === 1 ? uniqueRoots[0] : uniqueRoots.join(', ');

    return {
      type: 'exec',
      title: `Execute shell command`,
      command: this.formatCommand(params),
      rootCommand,
      onConfirm: async () => {
        // This will be handled by the calling code
      },
    };
  }

  async execute(
    params: ShellToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const strippedCommand = stripShellWrapper(params.command);
    const validationError = this.validateToolParams({
      ...params,
      command: strippedCommand,
    });
    if (validationError) {
      return {
        llmContent: validationError,
        returnDisplay: validationError,
      };
    }

    if (signal.aborted) {
      return {
        llmContent: 'Command was cancelled by user before it could start.',
        returnDisplay: 'Command cancelled by user.',
      };
    }

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
            if (!command.endsWith('&')) command += ';';
            return `{ ${command} }; __code=$?; pgrep -g 0 >${tempFilePath} 2>&1; exit $__code;`;
          })();

      const cwd = path.resolve(
        this.config.getTargetDir(),
        params.directory || '',
      );

      let cumulativeStdout = '';
      let cumulativeStderr = '';

      let lastUpdateTime = Date.now();
      let isBinaryStream = false;

      const { result: resultPromise } = ShellExecutionService.execute(
        commandToExecute,
        cwd,
        (event: ShellOutputEvent) => {
          if (!updateOutput) {
            return;
          }

          let currentDisplayOutput = '';
          let shouldUpdate = false;

          switch (event.type) {
            case 'data':
              if (isBinaryStream) break; // Don't process text if we are in binary mode
              if (event.stream === 'stdout') {
                cumulativeStdout += event.chunk;
              } else {
                cumulativeStderr += event.chunk;
              }
              currentDisplayOutput =
                cumulativeStdout +
                (cumulativeStderr ? `\n${cumulativeStderr}` : '');
              if (Date.now() - lastUpdateTime > OUTPUT_UPDATE_INTERVAL_MS) {
                shouldUpdate = true;
              }
              break;
            case 'binary_detected':
              isBinaryStream = true;
              currentDisplayOutput =
                '[Binary output detected. Halting stream...]';
              shouldUpdate = true;
              break;
            case 'binary_progress':
              isBinaryStream = true;
              currentDisplayOutput = `[Receiving binary output... ${formatMemoryUsage(
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
            updateOutput(currentDisplayOutput);
            lastUpdateTime = Date.now();
          }
        },
        signal,
      );

      const result = await resultPromise;

      const backgroundPIDs: number[] = [];
      if (os.platform() !== 'win32') {
        if (fs.existsSync(tempFilePath)) {
          const pgrepLines = fs
            .readFileSync(tempFilePath, 'utf8')
            .split('\n')
            .filter(Boolean);
          for (const line of pgrepLines) {
            if (!/^\d+$/.test(line)) {
              console.error(`pgrep: ${line}`);
            }
            const pid = Number(line);
            if (pid !== result.pid) {
              backgroundPIDs.push(pid);
            }
          }
        } else {
          if (!signal.aborted) {
            console.error('missing pgrep output');
          }
        }
      }

      let llmContent = '';
      if (result.aborted) {
        llmContent = 'Command was cancelled by user before it could complete.';
        if (result.output.trim()) {
          llmContent += ` Below is the output (on stdout and stderr) before it was cancelled:\n${result.output}`;
        } else {
          llmContent += ' There was no output before it was cancelled.';
        }
      } else {
        // Create a formatted error string for display, replacing the wrapper command
        // with the user-facing command.
        const finalError = result.error
          ? result.error.message.replace(commandToExecute, params.command)
          : '(none)';

        llmContent = [
          `Command: ${params.command}`,
          `Directory: ${params.directory || '(root)'}`,
          `Stdout: ${result.stdout || '(empty)'}`,
          `Stderr: ${result.stderr || '(empty)'}`,
          `Error: ${finalError}`, // Use the cleaned error string.
          `Exit Code: ${result.exitCode ?? '(none)'}`,
          `Signal: ${result.signal ?? '(none)'}`,
          `Background PIDs: ${
            backgroundPIDs.length ? backgroundPIDs.join(', ') : '(none)'
          }`,
          `Process Group PGID: ${result.pid ?? '(none)'}`,
        ].join('\n');
      }

      let returnDisplayMessage = '';
      if (this.config.getDebugMode()) {
        returnDisplayMessage = llmContent;
      } else {
        if (result.output.trim()) {
          returnDisplayMessage = result.output;
        } else {
          if (result.aborted) {
            returnDisplayMessage = 'Command cancelled by user.';
          } else if (result.signal) {
            returnDisplayMessage = `Command terminated by signal: ${result.signal}`;
          } else if (result.error) {
            returnDisplayMessage = `Command failed: ${getErrorMessage(
              result.error,
            )}`;
          } else if (result.exitCode !== null && result.exitCode !== 0) {
            returnDisplayMessage = `Command exited with code: ${result.exitCode}`;
          }
          // If output is empty and command succeeded (code 0, no error/signal/abort),
          // returnDisplayMessage will remain empty, which is fine.
        }
      }

      const summarizeConfig = this.config.getSummarizeToolOutputConfig();
      if (summarizeConfig && summarizeConfig[this.name]) {
        const summary = await summarizeToolOutput(
          llmContent,
          this.config.getGeminiClient(),
          signal,
          summarizeConfig[this.name].tokenBudget,
        );
        return {
          llmContent: summary,
          returnDisplay: returnDisplayMessage,
        };
      }

      return {
        llmContent,
        returnDisplay: returnDisplayMessage,
      };
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  }
}
