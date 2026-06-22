/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core';
import {
  getErrorMessage,
  getMCPServerPrompts,
} from '@vybestack/llxprt-code-core';
import type { DiscoveredMCPPrompt } from '@vybestack/llxprt-code-mcp';
import type {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from '../ui/commands/types.js';
import { CommandKind } from '../ui/commands/types.js';
import type { ICommandLoader } from './types.js';
import { parsePromptArgs } from './mcpPromptArgParser.js';
import type {
  PromptArgument,
  PromptMessage,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Discovers and loads executable slash commands from prompts exposed by
 * Model-Context-Protocol (MCP) servers.
 */
export class McpPromptLoader implements ICommandLoader {
  constructor(private readonly config: Config | null) {}

  /**
   * Loads all available prompts from all configured MCP servers and adapts
   * them into executable SlashCommand objects.
   *
   * @param _signal An AbortSignal (unused for this synchronous loader).
   * @returns A promise that resolves to an array of loaded SlashCommands.
   */
  loadCommands(_signal: AbortSignal): Promise<SlashCommand[]> {
    const promptCommands: SlashCommand[] = [];
    if (!this.config) {
      return Promise.resolve([]);
    }
    const mcpServers = this.config.getMcpServers() ?? {};
    for (const serverName in mcpServers) {
      const prompts = getMCPServerPrompts(this.config, serverName);
      for (const prompt of prompts) {
        promptCommands.push(this.buildPromptCommand(prompt, serverName));
      }
    }
    return Promise.resolve(promptCommands);
  }

  private buildPromptCommand(
    prompt: DiscoveredMCPPrompt,
    serverName: string,
  ): SlashCommand {
    const commandName = `${prompt.name}`.trim().replace(/\s+/g, '-');
    const description = prompt.description ?? '';
    return {
      name: commandName,
      description:
        description !== '' ? description : `Invoke prompt ${prompt.name}`,
      kind: CommandKind.MCP_PROMPT,
      autoExecute: !prompt.arguments || prompt.arguments.length === 0,
      subCommands: [
        {
          name: 'help',
          description: 'Show help for this prompt',
          kind: CommandKind.MCP_PROMPT,
          action: McpPromptLoader.buildHelpAction(prompt),
        },
      ],
      action: this.buildInvokeAction(prompt, serverName),
    };
  }

  private static buildHelpAction(prompt: {
    name: string;
    arguments?: PromptArgument[];
  }): () => Promise<SlashCommandActionReturn> {
    return async (): Promise<SlashCommandActionReturn> => {
      if (!prompt.arguments || prompt.arguments.length === 0) {
        return {
          type: 'message',
          messageType: 'info',
          content: `Prompt "${prompt.name}" has no arguments.`,
        };
      }

      const promptArgs = prompt.arguments;
      let helpMessage = `Arguments for "${prompt.name}":\n\n`;
      helpMessage += `You can provide arguments by name (e.g., --argName="value") or by position.\n\n`;
      helpMessage += `e.g., ${prompt.name} ${promptArgs.map(() => `"foo"`)} is equivalent to ${prompt.name} ${promptArgs.map((arg) => `--${arg.name}="foo"`)}\n\n`;
      for (const arg of promptArgs) {
        helpMessage += `  --${arg.name}\n`;
        if (arg.description) {
          helpMessage += `    ${arg.description}\n`;
        }
        helpMessage += `    (required: ${
          arg.required === true ? 'yes' : 'no'
        })\n\n`;
      }

      return {
        type: 'message',
        messageType: 'info',
        content: helpMessage,
      };
    };
  }

  private buildInvokeAction(
    prompt: DiscoveredMCPPrompt,
    serverName: string,
  ): (
    context: CommandContext,
    args: string,
  ) => Promise<SlashCommandActionReturn> {
    return async (
      context: CommandContext,
      args: string,
    ): Promise<SlashCommandActionReturn> => {
      if (!this.config) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Config not loaded.',
        };
      }

      const promptInputs = this.parseArgs(args, prompt.arguments);
      if (promptInputs instanceof Error) {
        return {
          type: 'message',
          messageType: 'error',
          content: promptInputs.message,
        };
      }

      try {
        return await this.invokePrompt(prompt, promptInputs, serverName);
      } catch (error) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Error: ${getErrorMessage(error)}`,
        };
      }
    };
  }

  private async invokePrompt(
    prompt: DiscoveredMCPPrompt,
    promptInputs: Record<string, unknown>,
    serverName: string,
  ): Promise<SlashCommandActionReturn> {
    const mcpServers = this.config?.getMcpServers() ?? {};
    if (!Object.hasOwn(mcpServers, serverName)) {
      return {
        type: 'message',
        messageType: 'error',
        content: `MCP server config not found for '${serverName}'.`,
      };
    }
    const result = await prompt.invoke(promptInputs);

    if (result.error != null) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Error invoking prompt: ${result.error}`,
      };
    }

    const responseText = McpPromptLoader.extractFirstTextContent(
      result.messages,
    );
    if (!responseText) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'Received an empty or invalid prompt response from the server.',
      };
    }

    return {
      type: 'submit_prompt',
      content: JSON.stringify(responseText),
    };
  }

  private static extractFirstTextContent(
    messages?: PromptMessage[],
  ): string | null {
    const firstContent = messages?.[0]?.content;
    if (firstContent && firstContent.type === 'text') {
      return firstContent.text;
    }
    return null;
  }

  /**
   * Parses the `userArgs` string representing the prompt arguments (all the text
   * after the command) into a record matching the shape of the `promptArgs`.
   *
   * Delegates to {@link parsePromptArgs} in mcpPromptArgParser.ts.
   *
   * @param userArgs
   * @param promptArgs
   * @returns A record of the parsed arguments
   * @visibleForTesting
   */
  parseArgs(
    userArgs: string,
    promptArgs: PromptArgument[] | undefined,
  ): Record<string, unknown> | Error {
    return parsePromptArgs(userArgs, promptArgs);
  }
}
