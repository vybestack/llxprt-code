/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core';
import type {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  OpenDialogActionReturn,
  LoggingDialogData,
} from './types.js';
import { CommandKind } from './types.js';
import type { LoadedSettings } from '../../config/settings.js';
import { SettingScope } from '../../config/settings.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface LoggingCommandContext {
  config: Config;
  settings: LoadedSettings;
}

export type CommandResult = MessageActionReturn | OpenDialogActionReturn;

// Type guard for log entries
interface LogEntryBase {
  timestamp: string;
  type: string;
  provider: string;
}

interface RequestLogEntry extends LogEntryBase {
  type: 'request';
  messages?: Array<{
    content?: string;
  }>;
}

interface ResponseLogEntry extends LogEntryBase {
  type: 'response';
  response?: string;
}

type LogEntry = RequestLogEntry | ResponseLogEntry;

type LogEntryRecord = Record<string, unknown>;

function isRecord(obj: unknown): obj is LogEntryRecord {
  return typeof obj === 'object' && obj !== null;
}

function isLogEntry(obj: unknown): obj is LogEntry {
  if (!isRecord(obj)) {
    return false;
  }

  const { timestamp, type, provider } = obj;
  return (
    typeof timestamp === 'string' &&
    (type === 'request' || type === 'response') &&
    typeof provider === 'string'
  );
}

function isLoggingDialogData(
  dialogData: OpenDialogActionReturn['dialogData'],
): dialogData is LoggingDialogData {
  return isRecord(dialogData) && Array.isArray(dialogData.entries);
}

function normalizeCommandArgs(args: unknown): string {
  return typeof args === 'string' ? args : '';
}

function splitArgs(args: unknown): string[] {
  const trimmed = normalizeCommandArgs(args).trim();
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/);
}

function formatContentSnippet(content: string): string {
  const snippet = content.substring(0, 100);
  return content.length > 100 ? `${snippet}...` : snippet;
}

function formatLogEntry(entry: LogEntry, index: number): string {
  const timestamp = new Date(entry.timestamp).toLocaleTimeString();
  const typeIcon = entry.type === 'request' ? '→' : '←';
  let content = '';

  if (entry.type === 'request') {
    const messages = entry.messages;
    const lastMessage = messages?.[messages.length - 1];
    const messageContent = lastMessage?.content;
    if (messageContent !== undefined && messageContent !== '') {
      content = formatContentSnippet(messageContent);
    }
  } else if (entry.response !== undefined && entry.response !== '') {
    content = formatContentSnippet(entry.response);
  }

  return `[${index + 1}] ${timestamp} ${typeIcon} ${entry.provider}: ${content}`;
}

function tryParseJsonLine(line: string): unknown | undefined {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

function appendParsedLogLines(entries: unknown[], lines: string[]): void {
  for (const line of lines) {
    const parsed = tryParseJsonLine(line);
    if (parsed !== undefined) {
      entries.push(parsed);
    }
  }
}

function parseRedactionUpdate(arg: string): [string, boolean] | undefined {
  const [key, value] = arg.replace('--', '').split('=');
  const boolValue = value === 'true';

  switch (key) {
    case 'api-keys':
    case 'credentials':
      return ['redactSensitiveData', boolValue];
    case 'file-paths':
      return ['redactFilePaths', boolValue];
    case 'urls':
      return ['redactUrls', boolValue];
    case 'emails':
      return ['redactEmails', boolValue];
    case 'personal-info':
      return ['redactPersonalInfo', boolValue];
    default:
      return undefined;
  }
}

function parseRedactionUpdates(args: string[]): Record<string, boolean> {
  const updates: Record<string, boolean> = {};

  for (const arg of args) {
    const update = parseRedactionUpdate(arg);
    if (update !== undefined) {
      const [key, value] = update;
      updates[key] = value;
    }
  }

  return updates;
}

export async function handleLoggingCommand(
  args: string[],
  context: LoggingCommandContext,
): Promise<CommandResult> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'status':
      return handleLoggingStatus(context);

    case 'enable':
      return handleEnableLogging(args.slice(1), context);

    case 'disable':
      return handleDisableLogging(context);

    case 'redaction':
      return handleRedactionSettings(args.slice(1), context);

    case 'show':
      return handleShowLogs(args.slice(1), context);

    default:
      return {
        type: 'message',
        messageType: 'error',
        content: `Unknown logging subcommand: ${subcommand}. Available: status, enable, disable, redaction, show`,
      };
  }
}

async function handleLoggingStatus(
  context: LoggingCommandContext,
): Promise<CommandResult> {
  // Read directly from settings, not from cached Config
  const isLoggingEnabled =
    context.settings.merged.telemetry.logConversations ?? false;

  const status = `Conversation Logging: ${isLoggingEnabled ? 'Enabled' : 'Disabled'}`;

  return {
    type: 'message',
    messageType: 'info',
    content: status,
  };
}

async function handleEnableLogging(
  _args: string[],
  context: LoggingCommandContext,
): Promise<CommandResult> {
  // Enable conversation logging through settings
  context.settings.setValue(SettingScope.User, 'telemetry', {
    ...context.settings.merged.telemetry,
    logConversations: true,
  });

  // Update the Config to reflect the new setting
  context.config.updateTelemetrySettings({
    ...context.config.getTelemetrySettings(),
    logConversations: true,
  });

  return {
    type: 'message',
    messageType: 'info',
    content: 'Conversation logging enabled. Data stored locally only.',
  };
}

async function handleDisableLogging(
  context: LoggingCommandContext,
): Promise<CommandResult> {
  context.settings.setValue(SettingScope.User, 'telemetry', {
    ...context.settings.merged.telemetry,
    logConversations: false,
  });

  // Update the Config to reflect the new setting
  context.config.updateTelemetrySettings({
    ...context.config.getTelemetrySettings(),
    logConversations: false,
  });

  return {
    type: 'message',
    messageType: 'info',
    content:
      'Conversation logging disabled. No conversation data will be collected.',
  };
}

async function handleShowLogs(
  args: string[],
  context: LoggingCommandContext,
): Promise<CommandResult> {
  // Parse number of lines from args (default to 50)
  const numLines = args[0] ? parseInt(args[0], 10) : 50;

  if (isNaN(numLines) || numLines < 1) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Invalid number of lines. Please provide a positive number.',
    };
  }

  // Get the log path from config
  const logPath = context.config.getConversationLogPath();
  const expandedPath = logPath.replace('~', os.homedir());

  try {
    // Find all log files
    const files = await fs.readdir(expandedPath);
    const logFiles = files
      .filter((file) => file.endsWith('.jsonl'))
      .sort()
      .reverse();

    if (logFiles.length === 0) {
      return {
        type: 'dialog',
        dialog: 'logging',
        dialogData: { entries: [] },
      };
    }

    // Read and parse log entries from all recent files
    const allEntries: unknown[] = [];
    let remainingLines = numLines;

    for (const logFile of logFiles) {
      if (remainingLines <= 0) break;

      const filePath = path.join(expandedPath, logFile);
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      // Read from the end of the file
      const startIndex = Math.max(0, lines.length - remainingLines);
      const fileLines = lines.slice(startIndex);

      appendParsedLogLines(allEntries, fileLines);

      remainingLines -= fileLines.length;
    }

    // Return dialog with entries
    return {
      type: 'dialog',
      dialog: 'logging',
      dialogData: { entries: allEntries.slice(-numLines) },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        type: 'message',
        messageType: 'error',
        content: `Log directory not found: ${logPath}\nCreating directory and starting logging...`,
      };
    }
    return {
      type: 'message',
      messageType: 'error',
      content: `Error reading logs: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function handleRedactionSettings(
  args: string[],
  context: LoggingCommandContext,
): Promise<CommandResult> {
  if (args.length === 0) {
    // Show current redaction settings
    const redactionConfig = context.config.getRedactionConfig();

    const settings = [
      'Current Redaction Settings:',
      `  • API Keys: ${redactionConfig.redactApiKeys ? 'Enabled' : 'Disabled'}`,
      `  • Credentials: ${redactionConfig.redactCredentials ? 'Enabled' : 'Disabled'}`,
      `  • File Paths: ${redactionConfig.redactFilePaths ? 'Enabled' : 'Disabled'}`,
      `  • URLs: ${redactionConfig.redactUrls ? 'Enabled' : 'Disabled'}`,
      `  • Email Addresses: ${redactionConfig.redactEmails ? 'Enabled' : 'Disabled'}`,
      `  • Personal Info: ${redactionConfig.redactPersonalInfo ? 'Enabled' : 'Disabled'}`,
      '',
      'To modify settings:',
      '  /logging redaction --api-keys=false',
      '  /logging redaction --file-paths=true',
    ].join('\n');

    return {
      type: 'message',
      messageType: 'info',
      content: settings,
    };
  }

  // Parse redaction setting changes
  const updates = parseRedactionUpdates(args);

  if (Object.keys(updates).length === 0) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'No valid redaction settings provided. Use format: --api-keys=true',
    };
  }

  // Update telemetry settings
  context.settings.setValue(SettingScope.User, 'telemetry', {
    ...context.settings.merged.telemetry,
    ...updates,
  });

  const changes = Object.entries(updates)
    .map(([key, value]) => `  • ${key}: ${value ? 'enabled' : 'disabled'}`)
    .join('\n');

  return {
    type: 'message',
    messageType: 'info',
    content: `Redaction settings updated:\n${changes}`,
  };
}

// Subcommands for logging
const statusCommand: SlashCommand = {
  name: 'status',
  description: 'show current logging status',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext) => {
    if (!context.services.config) {
      context.ui.addItem(
        {
          type: 'error',
          text: 'Configuration not available',
        },
        Date.now(),
      );
      return;
    }
    const result = await handleLoggingStatus({
      config: context.services.config,
      settings: context.services.settings,
    });
    if (result.type === 'message') {
      context.ui.addItem(
        {
          type: result.messageType,
          text: result.content,
        },
        Date.now(),
      );
    }
  },
};

const enableCommand: SlashCommand = {
  name: 'enable',
  description: 'enable conversation logging',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string) => {
    if (!context.services.config) {
      context.ui.addItem(
        {
          type: 'error',
          text: 'Configuration not available',
        },
        Date.now(),
      );
      return;
    }
    const argsArray = splitArgs(args);
    const result = await handleEnableLogging(argsArray, {
      config: context.services.config,
      settings: context.services.settings,
    });
    if (result.type === 'message') {
      context.ui.addItem(
        {
          type: result.messageType,
          text: result.content,
        },
        Date.now(),
      );
    }
  },
};

const disableCommand: SlashCommand = {
  name: 'disable',
  description: 'disable conversation logging',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext) => {
    if (!context.services.config) {
      context.ui.addItem(
        {
          type: 'error',
          text: 'Configuration not available',
        },
        Date.now(),
      );
      return;
    }
    const result = await handleDisableLogging({
      config: context.services.config,
      settings: context.services.settings,
    });
    if (result.type === 'message') {
      context.ui.addItem(
        {
          type: result.messageType,
          text: result.content,
        },
        Date.now(),
      );
    }
  },
};

const redactionCommand: SlashCommand = {
  name: 'redaction',
  description: 'configure data redaction settings',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string) => {
    if (!context.services.config) {
      context.ui.addItem(
        {
          type: 'error',
          text: 'Configuration not available',
        },
        Date.now(),
      );
      return;
    }
    const argsArray = splitArgs(args);
    const result = await handleRedactionSettings(argsArray, {
      config: context.services.config,
      settings: context.services.settings,
    });
    if (result.type === 'message') {
      context.ui.addItem(
        {
          type: result.messageType,
          text: result.content,
        },
        Date.now(),
      );
    }
  },
};

const showCommand: SlashCommand = {
  name: 'show',
  description: 'show last N lines from conversation log (default 50)',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string) => {
    if (!context.services.config) {
      context.ui.addItem(
        {
          type: 'error',
          text: 'Configuration not available',
        },
        Date.now(),
      );
      return;
    }
    const argsArray = splitArgs(args);
    const result = await handleShowLogs(argsArray, {
      config: context.services.config,
      settings: context.services.settings,
    });
    if (result.type === 'message') {
      context.ui.addItem(
        {
          type: result.messageType,
          text: result.content,
        },
        Date.now(),
      );
      return;
    }

    // Format the log entries as text for now until dialog system is implemented
    const entries = isLoggingDialogData(result.dialogData)
      ? result.dialogData.entries
      : [];
    if (entries.length === 0) {
      context.ui.addItem(
        {
          type: 'info',
          text: 'No log entries found',
        },
        Date.now(),
      );
      return;
    }

    const formattedEntries = entries
      .filter(isLogEntry)
      .map(formatLogEntry)
      .join('\n');

    context.ui.addItem(
      {
        type: 'info',
        text: `Conversation Logs (${entries.length} entries):\n${'─'.repeat(60)}\n${formattedEntries}\n${'─'.repeat(60)}`,
      },
      Date.now(),
    );
  },
};

// Main logging command with subcommands
export const loggingCommand: SlashCommand = {
  name: 'logging',
  description: 'manage conversation logging settings',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    statusCommand,
    enableCommand,
    disableCommand,
    redactionCommand,
    showCommand,
  ],
  action: async (context: CommandContext, args: string) => {
    // Default action shows status when no subcommand provided
    if (normalizeCommandArgs(args).trim() === '') {
      await statusCommand.action?.(context, '');
      return;
    }
    // If args provided but no subcommand matched, show help
    context.ui.addItem(
      {
        type: 'info',
        text: 'Available logging commands:\n  status - show current status\n  enable - enable logging\n  disable - disable logging\n  redaction - configure redaction\n  show [N] - show last N lines from log (default 50)',
      },
      Date.now(),
    );
  },
};
