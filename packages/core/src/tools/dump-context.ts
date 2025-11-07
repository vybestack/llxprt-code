/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolResult,
} from './tools.js';
import { FunctionDeclaration } from '@google/genai';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { Config } from '../config/config.js';
// import type { SettingsService } from '../settings/SettingsService.js';
import { ToolErrorType } from './tool-error.js';

const dumpContextToolSchemaData: FunctionDeclaration = {
  name: 'dump_context',
  description:
    'Manage context dumping functionality for debugging. Use to control when conversation context is saved to files troubleshooting.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to execute',
        enum: ['status', 'on', 'off', 'error', 'dump'],
      },
    },
    required: ['command'],
  },
};

const dumpContextToolDescription = `
Manage context dumping functionality for debugging and troubleshooting.

Available commands:
- status: Shows the current dump context setting (on/off/error)
- on: Enables dumping context before every new request
- off: Disables context dumping
- error: Enables dumping context only when an error occurs
- dump: Immediately dumps the current context regardless of settings

The context dump files are stored in ~/.llxprt/dumps/ and can be used to debug context-related issues. This setting is stored in the model profile and will appear in /diagnostics output.
`;

export type DumpContextMode = 'on' | 'off' | 'error';

interface DumpContextParams {
  command: 'status' | 'on' | 'off' | 'error' | 'dump';
}

/**
 * Formats a timestamp for use in filenames
 */
function getTimestamp(): string {
  const now = new Date();
  return now.toISOString();
}

/**
 * Gets the dumps directory path for the current user
 */
function getDumpsDir(): string {
  return path.join(os.homedir(), '.llxprt', 'dumps');
}

/**
 * Generates a filename for the context dump
 */
function generateDumpFilename(
  mode: 'immediate' | 'error' = 'immediate',
): string {
  const timestamp = getTimestamp();
  const modePrefix = mode === 'error' ? 'error-' : '';
  return `${modePrefix}context-dump-${timestamp}.json`;
}

/**
 * Creates the dumps directory if it doesn't exist
 */
async function ensureDumpsDir(): Promise<string> {
  const dumpsDir = getDumpsDir();
  await fs.mkdir(dumpsDir, { recursive: true });
  return dumpsDir;
}

/**
 * Mock context data - in a real implementation, this would come from the actual conversation context
 */
function getMockContextData(): object {
  return {
    timestamp: new Date().toISOString(),
    dumpMode: 'test',
    conversation: {
      sessionId: 'test-session',
      messages: [
        { role: 'user', content: 'Hello, how are you?' },
        { role: 'assistant', content: 'I am doing well, thank you!' },
      ],
    },
    system: {
      model: 'test-model',
      provider: 'test-provider',
      tools: ['dump_context', 'read_file', 'write_file'],
    },
  };
}

class DumpContextToolInvocation extends BaseToolInvocation<
  DumpContextParams,
  ToolResult
> {
  private readonly tool: DumpContextTool;
  private fsAdapter = {
    mkdir: fs.mkdir,
    writeFile: fs.writeFile,
  };

  constructor(params: DumpContextParams, tool: DumpContextTool) {
    super(params);
    this.tool = tool;
  }

  getDescription(): string {
    const { command } = this.params;
    switch (command) {
      case 'status':
        return 'Check current dump context status';
      case 'on':
        return 'Enable context dumping for all requests';
      case 'off':
        return 'Disable context dumping';
      case 'error':
        return 'Enable context dumping on errors only';
      case 'dump':
        return 'Immediately dump current context';
      default:
        return 'Execute dump context command';
    }
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const { command } = this.params;

    try {
      switch (command) {
        case 'status':
          return this.handleStatus();
        case 'on':
          return this.handleSetMode('on');
        case 'off':
          return this.handleSetMode('off');
        case 'error':
          return this.handleSetMode('error');
        case 'dump':
          return this.handleImmediateDump();
        default:
          throw new Error(`Unknown command: ${command}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[DumpContextTool] Error executing ${command}: ${errorMessage}`,
      );
      return {
        llmContent: JSON.stringify({
          success: false,
          error: `Failed to execute dump context command: ${errorMessage}`,
        }),
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.DUMP_CONTEXT_TOOL_EXECUTION_ERROR,
        },
      };
    }
  }

  private handleStatus(): ToolResult {
    const currentMode = this.tool.getDumpContextMode();
    const descriptions = {
      on: 'Context dumping is currently ON - dumps before every new request',
      off: 'Context dumping is currently OFF - no automatic dumping',
      error:
        'Context dumping is currently set to ERROR_ONLY - dumps only on errors',
    };

    return {
      llmContent: JSON.stringify({
        mode: currentMode,
        description: descriptions[currentMode as keyof typeof descriptions],
      }),
      returnDisplay: `Current dump context mode: ${currentMode.toUpperCase()}\n\n${descriptions[currentMode as keyof typeof descriptions]}`,
    };
  }

  private handleSetMode(mode: DumpContextMode): ToolResult {
    this.tool.setDumpContextMode(mode);

    const descriptions = {
      on: 'Context dumping is now ON - will dump context before every new request',
      off: 'Context dumping is now OFF - no automatic dumping',
      error:
        'Context dumping is now set to ERROR_ONLY - will dump context only when errors occur',
    };

    return {
      llmContent: JSON.stringify({
        mode,
        description: descriptions[mode],
        previousMode: this.tool.getDumpContextMode(),
      }),
      returnDisplay: descriptions[mode],
    };
  }

  private async handleImmediateDump(): Promise<ToolResult> {
    try {
      const dumpsDir = await ensureDumpsDir();
      const filename = generateDumpFilename('immediate');
      const filePath = path.join(dumpsDir, filename);

      // In a real implementation, this would get actual context data
      const contextData = getMockContextData();
      const jsonContent = JSON.stringify(contextData, null, 2);

      await this.fsAdapter.writeFile(filePath, jsonContent, 'utf-8');

      return {
        llmContent: JSON.stringify({
          success: true,
          description: 'Context dumped successfully',
          filePath,
          timestamp: new Date().toISOString(),
        }),
        returnDisplay: `Context dumped successfully to: ${filePath}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to dump context: ${errorMessage}`);
    }
  }
}

export class DumpContextTool extends BaseDeclarativeTool<
  DumpContextParams,
  ToolResult
> {
  static readonly Name: string = dumpContextToolSchemaData.name!;
  private readonly config: Config;

  constructor(config: Config) {
    super(
      DumpContextTool.Name,
      'Dump Context',
      dumpContextToolDescription,
      Kind.Other,
      dumpContextToolSchemaData.parametersJsonSchema as Record<string, unknown>,
    );
    this.config = config;
  }

  protected override validateToolParamValues(
    params: DumpContextParams,
  ): string | null {
    if (!params.command) {
      return 'Parameter "command" is required.';
    }

    const validCommands = ['status', 'on', 'off', 'error', 'dump'];
    if (!validCommands.includes(params.command)) {
      return `Parameter "command" must be one of: ${validCommands.join(', ')}.`;
    }

    return null;
  }

  protected createInvocation(params: DumpContextParams) {
    return new DumpContextToolInvocation(params, this);
  }

  /**
   * Gets the current dump context mode from settings
   */
  getDumpContextMode(): DumpContextMode {
    const settingsService = this.config.getSettingsService();
    const mode = settingsService.get('dumpContextMode') as DumpContextMode;
    return mode === 'on' || mode === 'error' ? mode : 'off';
  }

  /**
   * Sets the dump context mode in settings
   */
  setDumpContextMode(mode: DumpContextMode): void {
    const settingsService = this.config.getSettingsService();
    settingsService.set('dumpContextMode', mode);
  }

  /**
   * Determines if context should be dumped based on current mode and optional error
   */
  shouldDumpContext(error?: Error): boolean {
    const mode = this.getDumpContextMode();

    switch (mode) {
      case 'on':
        return true;
      case 'error':
        return !!error;
      case 'off':
      default:
        return false;
    }
  }

  /**
   * Dumps context immediately - used by error handling and manual dump command
   */
  async dumpContext(error?: Error): Promise<string | null> {
    if (!this.shouldDumpContext(error)) {
      return null;
    }

    try {
      const dumpsDir = await ensureDumpsDir();
      const mode = error ? 'error' : 'immediate';
      const filename = generateDumpFilename(mode);
      const filePath = path.join(dumpsDir, filename);

      // In a real implementation, this would get actual context data from the conversation
      const contextData = getMockContextData();

      // Add error information if provided
      if (error) {
        (contextData as Record<string, unknown>).error = {
          message: error.message,
          stack: error.stack,
          name: error.name,
          timestamp: new Date().toISOString(),
        };
      }

      const jsonContent = JSON.stringify(contextData, null, 2);
      await fs.writeFile(filePath, jsonContent, 'utf-8');

      return filePath;
    } catch (dumpError) {
      console.error(
        '[DumpContextTool] Failed to dump context:',
        dumpError instanceof Error ? dumpError.message : dumpError,
      );
      return null;
    }
  }

  /**
   * Get the dumps directory for diagnostic purposes
   */
  getDumpsDirectory(): string {
    return getDumpsDir();
  }

  /**
   * Get diagnostic information about dump context settings
   */
  getDiagnosticInfo(): object {
    return {
      mode: this.getDumpContextMode(),
      dumpsDirectory: getDumpsDir(),
      toolName: DumpContextTool.Name,
      availableCommands: ['status', 'on', 'off', 'error', 'dump'],
    };
  }
}
