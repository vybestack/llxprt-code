/**
 * @license
 * Copyright 2025 Google LLC
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
import stripAnsi from 'strip-ansi';
import {
  getCommandRoots,
  isCommandAllowed,
  stripShellWrapper,
} from '../utils/shell-utils.js';
import { summarizeToolOutput } from '../utils/summarizer.js';

export interface ShellToolParams {
  /**
   * The shell command to execute
   */
  command: string;

  /**
   * Optional description of what this command does, used for confirmation prompts
   */
  description?: string;
}

export class ShellTool extends BaseTool<ShellToolParams, ToolResult> {
  static readonly Name = 'shell_tool';

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
  ): Promise<ToolResult> {
    try {
      const isWindows = os.platform() === 'win32';
      const shell = isWindows ? 'cmd.exe' : 'bash';
      const shellArgs = isWindows
        ? ['/c', params.command]
        : ['-c', params.command];

      const { execaCommandSync } = await import('execa');

      let cleanedCommand = stripShellWrapper(params.command);
      if (!isWindows) {
        // On non-windows, wrap the command to capture the final working directory.
        const pwdFileName = `shell_pwd_${crypto.randomBytes(6).toString('hex')}.tmp`;
        const pwdFilePath = path.join(os.tmpdir(), pwdFileName);
        // Ensure command ends with a separator before adding our own.
        cleanedCommand = cleanedCommand.trim();
        if (!cleanedCommand.endsWith(';') && !cleanedCommand.endsWith('&')) {
          cleanedCommand += ';';
        }
        cleanedCommand = `{ ${cleanedCommand} }; __code=$?; pwd > "${pwdFilePath}"; exit $__code`;

        try {
          const result = execaCommandSync(
            `${shell} ${shellArgs.map((arg) => `'${arg}'`).join(' ')} '${cleanedCommand}'`,
            {
              cwd: this.config.getTargetDir(),
              env: {
                ...process.env,
                GEMINI_CLI: '1',
              },
              timeout: 1000 * 60 * 15, // 15 minutes
              all: true,
              shell: false,
            },
          );

          // Read the captured PWD
          let finalPwd = this.config.getTargetDir();
          if (fs.existsSync(pwdFilePath)) {
            try {
              finalPwd = fs.readFileSync(pwdFilePath, 'utf8').trim();
            } catch (readError) {
              console.debug('Failed to read PWD file:', readError);
            } finally {
              // Clean up the temporary file
              try {
                fs.unlinkSync(pwdFilePath);
              } catch (unlinkError) {
                console.debug('Failed to unlink PWD file:', unlinkError);
              }
            }
          }

          const allOutput = stripAnsi(result.all || '');
          let response = allOutput;

          // Add warning if directory changed
          if (finalPwd !== this.config.getTargetDir()) {
            response = `WARNING: shell mode is stateless; the directory change to '${finalPwd}' will not persist.\n\n${response}`;
          }

          // Check if summarization is enabled for this tool
          const summarizerConfig = this.config.getSummarizeToolOutputConfig();
          const toolSummarizeConfig = summarizerConfig
            ? summarizerConfig[this.name]
            : undefined;
          let llmContent = response;

          if (toolSummarizeConfig) {
            const tokenBudget = toolSummarizeConfig.tokenBudget;
            llmContent = await summarizeToolOutput(
              response,
              this.config.getGeminiClient(),
              signal,
              tokenBudget,
            );
          }

          return {
            summary: `Executed command: ${params.command}`,
            returnDisplay: response,
            llmContent,
          };
        } catch (error) {
          // Clean up PWD file on error
          if (fs.existsSync(pwdFilePath)) {
            try {
              fs.unlinkSync(pwdFilePath);
            } catch (unlinkError) {
              console.debug('Failed to unlink PWD file:', unlinkError);
            }
          }
          throw error; // Re-throw to be caught by outer try-catch
        }
      } else {
        // Windows path
        const result = execaCommandSync(
          `${shell} ${shellArgs.map((arg) => `"${arg}"`).join(' ')} "${cleanedCommand}"`,
          {
            cwd: this.config.getTargetDir(),
            env: {
              ...process.env,
              GEMINI_CLI: '1',
            },
            timeout: 1000 * 60 * 15, // 15 minutes
            all: true,
            shell: false,
          },
        );

        const allOutput = stripAnsi(result.all || '');
        // Check if summarization is enabled for this tool
        const summarizerConfig = this.config.getSummarizeToolOutputConfig();
        const toolSummarizeConfig = summarizerConfig
          ? summarizerConfig[this.name]
          : undefined;
        let llmContent = allOutput;

        if (toolSummarizeConfig) {
          const tokenBudget = toolSummarizeConfig.tokenBudget;
          llmContent = await summarizeToolOutput(
            allOutput,
            this.config.getGeminiClient(),
            signal,
            tokenBudget,
          );
        }

        return {
          summary: `Executed command: ${params.command}`,
          returnDisplay: allOutput,
          llmContent,
        };
      }
    } catch (error) {
      let errorMessage = getErrorMessage(error);
      // Check if error has execa-specific properties
      if (error && typeof error === 'object' && 'all' in error) {
        const execaError = error as { all?: string };
        if (execaError.all) {
          const allOutput = stripAnsi(execaError.all);
          errorMessage += `\nOutput:\n${allOutput}`;
        }
      }
      return {
        summary: `Command failed: ${params.command}`,
        llmContent: errorMessage,
        returnDisplay: errorMessage,
      };
    }
  }
}
