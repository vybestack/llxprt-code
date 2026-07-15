/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as acp from '@agentclientprotocol/sdk';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { DebugLogger } from '@vybestack/llxprt-code-core';

const logger = new DebugLogger('llxprt:zed-integration:commands');

export interface ZedCommandContext {
  readonly agent: Agent;
}

export interface ZedCommandResult {
  readonly text: string;
}

interface ZedCommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputHint?: string;
  readonly handler: (
    context: ZedCommandContext,
    args: string,
  ) => Promise<ZedCommandResult>;
}

export function parseZedCommandPrompt(
  prompt: string,
): { readonly name: string; readonly args: string } | null {
  if (!prompt.startsWith('/')) return null;
  const value = prompt.slice(1).trimStart();
  if (value.length === 0) return null;
  const boundary = value.search(/\s/);
  return boundary === -1
    ? { name: value.toLowerCase(), args: '' }
    : {
        name: value.slice(0, boundary).toLowerCase(),
        args: value.slice(boundary + 1).trim(),
      };
}

function formatCompression(
  result: Awaited<ReturnType<Agent['compress']>>,
): string {
  const counts =
    result.originalTokenCount === undefined ||
    result.newTokenCount === undefined
      ? ''
      : ` (${result.originalTokenCount} → ${result.newTokenCount} tokens)`;
  return `Context compression ${result.status}${counts}.`;
}

const COMMANDS: readonly ZedCommandDefinition[] = [
  {
    name: 'compact',
    description: 'Compress conversation history to free context space',
    handler: async ({ agent }) => ({
      text: formatCompression(await agent.compress()),
    }),
  },
  {
    name: 'tools',
    description: 'List available tools and their enabled status',
    handler: async ({ agent }) => {
      const tools = agent.tools.list();
      return {
        text:
          tools.length === 0
            ? 'No tools available.'
            : `Available tools:\n${tools
                .map((tool) => `  ${tool.enabled ? '[x]' : '[ ]'} ${tool.name}`)
                .join('\n')}`,
      };
    },
  },
  {
    name: 'memory',
    description: 'Show memory files currently in use',
    handler: async ({ agent }) => {
      const paths = agent.memory.getFilePaths();
      return {
        text:
          paths.length === 0
            ? 'No memory files in use.'
            : `Memory files:\n${paths.map((path) => `  ${path}`).join('\n')}`,
      };
    },
  },
  {
    name: 'profile',
    description: 'List saved profiles and identify the startup default',
    handler: async ({ agent }) => {
      const profiles = agent.profiles.list();
      return {
        text:
          profiles.length === 0
            ? 'No profiles available.'
            : `Profiles:\n${profiles
                .map(
                  (profile) =>
                    `  ${profile.name}${profile.isDefault ? ' (default)' : ''}`,
                )
                .join('\n')}`,
      };
    },
  },
  {
    name: 'model',
    description: 'Show the current model',
    handler: async ({ agent }) => ({
      text: `Current model: ${agent.getModel()}`,
    }),
  },
  {
    name: 'task',
    description: 'Show active subagent tasks',
    handler: async ({ agent }) => {
      const tasks = agent.tasks.list();
      return {
        text:
          tasks.length === 0
            ? 'No active subagent tasks.'
            : `Subagent tasks:\n${tasks
                .map((task) => `  [${task.status}] ${task.goalPrompt}`)
                .join('\n')}`,
      };
    },
  },
];

const COMMAND_MAP = new Map(COMMANDS.map((command) => [command.name, command]));

export function getZedAvailableCommands(): acp.AvailableCommand[] {
  return COMMANDS.map(({ name, description, inputHint }) => ({
    name,
    description,
    ...(inputHint === undefined ? {} : { input: { hint: inputHint } }),
  }));
}

export function buildAvailableCommandsUpdate(): acp.SessionUpdate {
  return {
    sessionUpdate: 'available_commands_update',
    availableCommands: getZedAvailableCommands(),
  };
}

export async function executeZedCommand(
  prompt: string,
  context: ZedCommandContext,
): Promise<ZedCommandResult | null> {
  const parsed = parseZedCommandPrompt(prompt);
  if (parsed === null) return null;
  const command = COMMAND_MAP.get(parsed.name);
  if (command === undefined) return null;
  try {
    return await command.handler(context, parsed.args);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(() => `Command /${command.name} failed: ${detail}`);
    return { text: `Command /${command.name} failed: ${detail}` };
  }
}
