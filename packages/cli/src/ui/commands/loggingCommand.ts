/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '@vybestack/llxprt-code-core';
import {
  CommandKind,
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  OpenDialogActionReturn,
} from './types.js';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
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
    content: string;
  }>;
}

interface ResponseLogEntry extends LogEntryBase {
  type: 'response';
  response?: string;
}

type LogEntry = RequestLogEntry | ResponseLogEntry;

function isLogEntry(obj: unknown): obj is LogEntry {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'timestamp' in obj &&
    'type' in obj &&
    'provider' in obj &&
    typeof (obj as LogEntry).timestamp === 'string' &&
    typeof (obj as LogEntry).type === 'string' &&
    typeof (obj as LogEntry).provider === 'string'
  );
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
    context.settings.merged.telemetry?.logConversations ?? false;

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
  const currentTelemetry = context.settings.merged.telemetry || {};
  context.settings.setValue(SettingScope.User, 'telemetry', {
    ...currentTelemetry,
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
  const currentTelemetry = context.settings.merged.telemetry || {};
  context.settings.setValue(SettingScope.User, 'telemetry', {
    ...currentTelemetry,
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

      for (const line of fileLines) {
        try {
          const parsed = JSON.parse(line);
          allEntries.push(parsed);
        } catch {
          // Skip invalid JSON lines
        }
      }

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
  const updates: Record<string, boolean> = {};

  for (const arg of args) {
    const [key, value] = arg.replace('--', '').split('=');
    const boolValue = value === 'true';

    switch (key) {
      case 'api-keys':
        updates.redactSensitiveData = boolValue; // Maps to existing setting
        break;
      case 'credentials':
        updates.redactSensitiveData = boolValue; // Maps to existing setting
        break;
      case 'file-paths':
        updates.redactFilePaths = boolValue;
        break;
      case 'urls':
        updates.redactUrls = boolValue;
        break;
      case 'emails':
        updates.redactEmails = boolValue;
        break;
      case 'personal-info':
        updates.redactPersonalInfo = boolValue;
        break;
      default:
        // Unknown key, ignore
        break;
    }
  }

  if (Object.keys(updates).length === 0) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'No valid redaction settings provided. Use format: --api-keys=true',
    };
  }

  // Update telemetry settings
  const currentTelemetry = context.settings.merged.telemetry || {};
  context.settings.setValue(SettingScope.User, 'telemetry', {
    ...currentTelemetry,
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
    const argsArray = args ? args.split(/\s+/) : [];
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
    const argsArray = args ? args.split(/\s+/) : [];
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
    const argsArray = args ? args.split(/\s+/) : [];
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
    } else if (result.type === 'dialog') {
      // Format the log entries as text for now until dialog system is implemented
      const entries =
        (result.dialogData as { entries?: unknown[] })?.entries || [];
      if (entries.length === 0) {
        context.ui.addItem(
          {
            type: 'info',
            text: 'No log entries found',
          },
          Date.now(),
        );
      } else {
        // Format entries for display
        const formattedEntries = entries
          .filter(isLogEntry)
          .map((entry: LogEntry, index: number) => {
            const timestamp = new Date(entry.timestamp).toLocaleTimeString();
            const typeIcon = entry.type === 'request' ? '→' : '←';
            let content = '';

            if (entry.type === 'request' && entry.messages) {
              const lastMessage = entry.messages[entry.messages.length - 1];
              if (lastMessage && lastMessage.content) {
                content = lastMessage.content.substring(0, 100);
                if (lastMessage.content.length > 100) content += '...';
              }
            } else if (entry.type === 'response' && entry.response) {
              content = entry.response.substring(0, 100);
              if (entry.response.length > 100) content += '...';
            }

            return `[${index + 1}] ${timestamp} ${typeIcon} ${entry.provider}: ${content}`;
          })
          .join('\n');

        context.ui.addItem(
          {
            type: 'info',
            text: `Conversation Logs (${entries.length} entries):\n${'─'.repeat(60)}\n${formattedEntries}\n${'─'.repeat(60)}`,
          },
          Date.now(),
        );
      }
      return;
    }
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
    if (!args || args.trim() === '') {
      return statusCommand.action!(context, '');
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
