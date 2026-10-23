/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as acp from '@agentclientprotocol/sdk';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { DebugLogger } from '@vybestack/llxprt-code-core';

const logger = new DebugLogger('llxprt:zed-integration:commands');

export interface ZedCommandResult {
  readonly text: string;
}

interface ZedCommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputHint?: string;
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
  },
  {
    name: 'tools',
    description: 'List available tools and their enabled status',
  },
  {
    name: 'memory',
    description: 'Show memory files currently in use',
  },
  {
    name: 'profile',
    description: 'List saved profiles and identify the startup default',
  },
  {
    name: 'model',
    description: 'Show the current model',
  },
  {
    name: 'task',
    description: 'Show active subagent tasks',
  },
];

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

export function createZedCommandExecutor(
  compress: Agent['compress'],
  readModel: Agent['getModel'],
  listTools: Agent['tools']['list'],
  readMemoryFiles: Agent['memory']['getFilePaths'],
  listProfiles: Agent['profiles']['list'],
  listTasks: Agent['tasks']['list'],
): (prompt: string) => Promise<ZedCommandResult | null> {
  return async (prompt: string): Promise<ZedCommandResult | null> => {
    const parsed = parseZedCommandPrompt(prompt);
    if (parsed === null) return null;
    try {
      switch (parsed.name) {
        case 'compact':
          return { text: formatCompression(await compress()) };
        case 'tools':
          return formatTools(listTools());
        case 'memory':
          return formatMemory(readMemoryFiles());
        case 'profile':
          return formatProfiles(listProfiles());
        case 'model':
          return { text: `Current model: ${readModel()}` };
        case 'task':
          return formatTasks(listTasks());
        default:
          return null;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error(() => `Command /${parsed.name} failed: ${detail}`);
      return { text: `Command /${parsed.name} failed. See logs for details.` };
    }
  };
}

function formatTools(
  tools: ReturnType<Agent['tools']['list']>,
): ZedCommandResult {
  return {
    text:
      tools.length === 0
        ? 'No tools available.'
        : `Available tools:\n${tools
            .map((tool) => `  ${tool.enabled ? '[x]' : '[ ]'} ${tool.name}`)
            .join('\n')}`,
  };
}

function formatMemory(
  paths: ReturnType<Agent['memory']['getFilePaths']>,
): ZedCommandResult {
  return {
    text:
      paths.length === 0
        ? 'No memory files in use.'
        : `Memory files:\n${paths.map((path) => `  ${path}`).join('\n')}`,
  };
}

function formatProfiles(
  profiles: ReturnType<Agent['profiles']['list']>,
): ZedCommandResult {
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
}

function formatTasks(
  tasks: ReturnType<Agent['tasks']['list']>,
): ZedCommandResult {
  return {
    text:
      tasks.length === 0
        ? 'No active tasks.'
        : `Tasks:\n${tasks
            .map((task) =>
              task.kind === 'subagent'
                ? `  [${task.status}] ${task.goalPrompt}`
                : `  [${task.status}] ${task.command}`,
            )
            .join('\n')}`,
  };
}
