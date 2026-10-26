/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AgentRequestInput } from '@vybestack/llxprt-code-core';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import type { SlashCommandProcessorResult } from '../types.js';
import { MessageType } from '../types.js';
import { secureInputHandler } from '../utils/secureInputHandler.js';
import type { SlashCommandHandlerDeps } from './slashCommandHandlers.js';
import { writeSlashOutput } from './slash-journal-output.js';

type ActionResult = NonNullable<
  Awaited<ReturnType<NonNullable<SlashCommand['action']>>>
>;

export function addUserCommandToHistory(
  deps: SlashCommandHandlerDeps,
  trimmed: string,
): Promise<void> | void {
  const sanitizedCommand = secureInputHandler.shouldUseSecureMode(trimmed)
    ? secureInputHandler.sanitizeForHistory(trimmed)
    : trimmed;
  const writeRaw = (): void => {
    deps.addItem(
      { type: MessageType.USER, text: sanitizedCommand },
      Date.now(),
    );
  };
  if (
    Object.getOwnPropertyDescriptor(deps.commandContext, 'recordingOwner')
      ?.value === 'agent'
  ) {
    return writeSlashOutput(
      deps.commandContext,
      'user',
      sanitizedCommand,
      writeRaw,
    );
  }
  writeRaw();
}

export async function handleMessageResult(
  deps: SlashCommandHandlerDeps,
  context: CommandContext,
  result: Extract<ActionResult, { type: 'message' }>,
): Promise<SlashCommandProcessorResult> {
  await writeSlashOutput(
    context,
    result.messageType === 'error' ? 'error' : 'info',
    result.content,
    () => {
      deps.addItem(
        {
          type:
            result.messageType === 'error'
              ? MessageType.ERROR
              : MessageType.INFO,
          text: result.content,
        },
        Date.now(),
      );
    },
  );
  if (result.messageType === 'error') {
    if (context.recordingOwner === 'agent') {
      const agent = context.services.agent;
      if (!agent) throw new Error('Session agent is unavailable');
      await agent.session.recordRecordingEvent({
        type: 'session_event',
        severity: 'error',
        message: result.content,
      });
    } else {
      deps.recordingIntegration?.recordSessionEvent('error', result.content);
    }
  }
  return { type: 'handled' };
}

export async function addSubcommandHelp(
  deps: SlashCommandHandlerDeps,
  command: SlashCommand,
): Promise<void> {
  const helpText = `Command '/${command.name}' requires a subcommand. Available:\n${command.subCommands
    ?.map((sc) => `  - ${sc.name}: ${sc.description || ''}`)
    .join('\n')}`;
  await writeSlashOutput(deps.commandContext, 'info', helpText, () => {
    deps.addMessage({
      type: MessageType.INFO,
      content: helpText,
      timestamp: new Date(),
    });
  });
}

export async function addUnknownCommandMessage(
  deps: SlashCommandHandlerDeps,
  trimmed: string,
): Promise<void> {
  const isMcpLoading =
    deps.commandContext.services.agent?.mcp.discoveryState() === 'pending';
  const text = isMcpLoading
    ? `Unknown command: ${trimmed}. Command might have been from an MCP server but MCP servers are not done loading.`
    : `Unknown command: ${trimmed}`;
  await writeSlashOutput(deps.commandContext, 'error', text, () => {
    deps.addMessage({
      type: MessageType.ERROR,
      content: text,
      timestamp: new Date(),
    });
  });
}

export function stringifyPrompt(content: AgentRequestInput): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (typeof part === 'object' && 'text' in part) {
        return typeof part.text === 'string' ? part.text : '';
      }
      return '';
    })
    .join('');
}
