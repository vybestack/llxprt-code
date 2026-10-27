/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  AgentRequestInput,
  HistoryService,
  RecordingIntegration,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { SlashCommand } from '../commands/types.js';
import type { SlashCommandProcessorResult } from '../types.js';
import { MessageType } from '../types.js';
import { secureInputHandler } from '../utils/secureInputHandler.js';
import type { SlashCommandHandlerDeps } from './slashCommandHandlers.js';
import { writeSlashOutput } from './slash-journal-output.js';

type ActionResult = NonNullable<
  Awaited<ReturnType<NonNullable<SlashCommand['action']>>>
>;

export function addUserCommandToHistory(
  addItem: SlashCommandHandlerDeps['addItem'],
  history: HistoryService | null,
  session: Agent['session'] | undefined,
  recordingOwner: 'agent' | undefined,
  trimmed: string,
): Promise<void> | void {
  const sanitizedCommand = secureInputHandler.shouldUseSecureMode(trimmed)
    ? secureInputHandler.sanitizeForHistory(trimmed)
    : trimmed;
  const writeRaw = (): void => {
    addItem({ type: MessageType.USER, text: sanitizedCommand }, Date.now());
  };
  if (recordingOwner === 'agent') {
    return writeSlashOutput(
      history,
      session,
      recordingOwner,
      'user',
      sanitizedCommand,
      writeRaw,
    );
  }
  writeRaw();
}

export async function handleMessageResult(
  addItem: SlashCommandHandlerDeps['addItem'],
  recordingIntegration: RecordingIntegration | undefined,
  history: HistoryService | null,
  session: Agent['session'] | undefined,
  recordingOwner: 'agent' | undefined,
  result: Extract<ActionResult, { type: 'message' }>,
): Promise<SlashCommandProcessorResult> {
  await writeSlashOutput(
    history,
    session,
    recordingOwner,
    result.messageType === 'error' ? 'error' : 'info',
    result.content,
    () => {
      addItem(
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
    if (recordingOwner === 'agent') {
      if (!session) throw new Error('Session agent is unavailable');
      await session.recordRecordingEvent({
        type: 'session_event',
        severity: 'error',
        message: result.content,
      });
    } else {
      recordingIntegration?.recordSessionEvent('error', result.content);
    }
  }
  return { type: 'handled' };
}

export async function addSubcommandHelp(
  addMessage: SlashCommandHandlerDeps['addMessage'],
  history: HistoryService | null,
  session: Agent['session'] | undefined,
  recordingOwner: 'agent' | undefined,
  command: SlashCommand,
): Promise<void> {
  const helpText = `Command '/${command.name}' requires a subcommand. Available:\n${command.subCommands
    ?.map((sc) => `  - ${sc.name}: ${sc.description || ''}`)
    .join('\n')}`;
  await writeSlashOutput(
    history,
    session,
    recordingOwner,
    'info',
    helpText,
    () => {
      addMessage({
        type: MessageType.INFO,
        content: helpText,
        timestamp: new Date(),
      });
    },
  );
}

export async function addUnknownCommandMessage(
  addMessage: SlashCommandHandlerDeps['addMessage'],
  history: HistoryService | null,
  session: Agent['session'] | undefined,
  recordingOwner: 'agent' | undefined,
  trimmed: string,
  isMcpLoading: boolean,
): Promise<void> {
  const text = isMcpLoading
    ? `Unknown command: ${trimmed}. Command might have been from an MCP server but MCP servers are not done loading.`
    : `Unknown command: ${trimmed}`;
  await writeSlashOutput(
    history,
    session,
    recordingOwner,
    'error',
    text,
    () => {
      addMessage({
        type: MessageType.ERROR,
        content: text,
        timestamp: new Date(),
      });
    },
  );
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
