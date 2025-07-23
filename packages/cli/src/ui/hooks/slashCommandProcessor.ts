/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo, useEffect, useState } from 'react';
import { type PartListUnion } from '@google/genai';
import process from 'node:process';
import { ansi } from '../colors.js';
import { UseHistoryManagerReturn } from './useHistoryManager.js';
import { useStateAndRef } from './useStateAndRef.js';
import {
  Config,
  GitService,
  Logger,
  MCPDiscoveryState,
  MCPServerStatus,
  getMCPDiscoveryState,
  getMCPServerStatus,
  AuthType,
} from '@llxprt/core';
import { useSessionStats } from '../contexts/SessionContext.js';
import {
  Message,
  MessageType,
  HistoryItemWithoutId,
  HistoryItem,
  SlashCommandProcessorResult,
} from '../types.js';
import { promises as fs } from 'fs';
import path from 'path';
import { GIT_COMMIT_INFO } from '../../generated/git-commit.js';
import { formatDuration, formatMemoryUsage } from '../utils/formatters.js';
import { getCliVersion } from '../../utils/version.js';
import { LoadedSettings } from '../../config/settings.js';
import { type CommandContext, type SlashCommand } from '../commands/types.js';
import { CommandService } from '../../services/CommandService.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import open from 'open';

/**
 * Hook to define and process slash commands (e.g., /help, /clear).
 */
export const useSlashCommandProcessor = (
  config: Config | null,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
  clearItems: UseHistoryManagerReturn['clearItems'],
  loadHistory: UseHistoryManagerReturn['loadHistory'],
  refreshStatic: () => void,
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>,
  onDebugMessage: (message: string) => void,
  openThemeDialog: () => void,
  openAuthDialog: () => void,
  openEditorDialog: () => void,
  openProviderDialog: () => void,
  openProviderModelDialog: () => void,
  performMemoryRefresh: () => Promise<void>,
  setQuittingMessages: (message: HistoryItem[]) => void,
  openPrivacyNotice: () => void,
  checkPaymentModeChange?: (forcePreviousProvider?: string) => void,
  showToolDescriptions?: boolean,
) => {
  const session = useSessionStats();
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const gitService = useMemo(() => {
    if (!config?.getProjectRoot()) {
      return;
    }
    return new GitService(config.getProjectRoot());
  }, [config]);

  const logger = useMemo(() => {
    const l = new Logger(config?.getSessionId() || '');
    // The logger's initialize is async, but we can create the instance
    // synchronously. Commands that use it will await its initialization.
    return l;
  }, [config]);

  const [pendingCompressionItemRef, setPendingCompressionItem] =
    useStateAndRef<HistoryItemWithoutId | null>(null);

  const pendingHistoryItems = useMemo(() => {
    const items: HistoryItemWithoutId[] = [];
    if (pendingCompressionItemRef.current != null) {
      items.push(pendingCompressionItemRef.current);
    }
    return items;
  }, [pendingCompressionItemRef]);

  const addMessage = useCallback(
    (message: Message) => {
      // Convert Message to HistoryItemWithoutId
      let historyItemContent: HistoryItemWithoutId;
      if (message.type === MessageType.ABOUT) {
        historyItemContent = {
          type: 'about',
          cliVersion: message.cliVersion,
          osVersion: message.osVersion,
          sandboxEnv: message.sandboxEnv,
          modelVersion: message.modelVersion,
          selectedAuthType: message.selectedAuthType,
          gcpProject: message.gcpProject,
          keyfile: message.keyfile,
          key: message.key,
        };
      } else if (message.type === MessageType.STATS) {
        historyItemContent = {
          type: 'stats',
          duration: message.duration,
        };
      } else if (message.type === MessageType.MODEL_STATS) {
        historyItemContent = {
          type: 'model_stats',
        };
      } else if (message.type === MessageType.TOOL_STATS) {
        historyItemContent = {
          type: 'tool_stats',
        };
      } else if (message.type === MessageType.QUIT) {
        historyItemContent = {
          type: 'quit',
          duration: message.duration,
        };
      } else if (message.type === MessageType.COMPRESSION) {
        historyItemContent = {
          type: 'compression',
          compression: message.compression,
        };
      } else {
        historyItemContent = {
          type: message.type,
          text: message.content,
        };
      }
      addItem(historyItemContent, message.timestamp.getTime());
    },
    [addItem],
  );

  // const showMemoryAction = useMemo(
  //   () => createShowMemoryAction(config, settings, addMessage),
  //   [config, settings, addMessage],
  // );

  const commandContext = useMemo(
    (): CommandContext => ({
      services: {
        config,
        settings,
        git: gitService,
        logger,
      },
      ui: {
        addItem,
        clear: () => {
          clearItems();
          console.clear();
          refreshStatic();
        },
        loadHistory,
        setDebugMessage: onDebugMessage,
        pendingItem: pendingCompressionItemRef.current,
        setPendingItem: setPendingCompressionItem,
      },
      session: {
        stats: session.stats,
      },
    }),
    [
      config,
      settings,
      gitService,
      logger,
      loadHistory,
      addItem,
      clearItems,
      refreshStatic,
      session.stats,
      onDebugMessage,
      pendingCompressionItemRef,
      setPendingCompressionItem,
    ],
  );

  const commandService = useMemo(() => new CommandService(config), [config]);

  useEffect(() => {
    const load = async () => {
      await commandService.loadCommands();
      setCommands(commandService.getCommands());
    };

    load();
  }, [commandService]);

  const _savedChatTags = useCallback(async () => {
    const geminiDir = config?.getProjectTempDir();
    if (!geminiDir) {
      return [];
    }
    try {
      const files = await fs.readdir(geminiDir);
      return files
        .filter(
          (file) => file.startsWith('checkpoint-') && file.endsWith('.json'),
        )
        .map((file) => file.replace('checkpoint-', '').replace('.json', ''));
    } catch (_err) {
      return [];
    }
  }, [config]);

  // Define legacy commands
  // This list contains all commands that have NOT YET been migrated to the
  // new system. As commands are migrated, they are removed from this list.
  const _legacyCommands = useMemo(() => {
    const commands: SlashCommand[] = [
      // `/help` and `/clear` have been migrated and REMOVED from this list.
      {
        name: 'docs',
        description: 'open full LLxprt Code documentation in your browser',
        action: async (_context: CommandContext, _args: string) => {
          const docsUrl = 'https://goo.gle/gemini-cli-docs';
          if (process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec') {
            addMessage({
              type: MessageType.INFO,
              content: `Please open the following URL in your browser to view the documentation:\n${docsUrl}`,
              timestamp: new Date(),
            });
          } else {
            addMessage({
              type: MessageType.INFO,
              content: `Opening documentation in your browser: ${docsUrl}`,
              timestamp: new Date(),
            });
            await open(docsUrl);
          }
        },
      },
      {
        name: 'auth',
        description: 'change the auth method',
        action: async (_context: CommandContext, args: string) => {
          const authMode = args?.split(' ')[0];
          const providerManager = getProviderManager();

          // If no auth mode specified, open the dialog
          if (!authMode) {
            openAuthDialog();
            return;
          }

          // Handle specific auth mode changes for Gemini provider
          try {
            const activeProvider = providerManager.getActiveProvider();

            // Check if this is the Gemini provider
            if (activeProvider.name === 'gemini' && config) {
              const validModes = ['oauth', 'api-key', 'vertex'];

              if (!validModes.includes(authMode)) {
                addMessage({
                  type: MessageType.ERROR,
                  content: `Invalid auth mode. Valid modes: ${validModes.join(', ')}`,
                  timestamp: new Date(),
                });
                return;
              }

              // Map the auth mode to the appropriate AuthType
              let authType: AuthType;
              switch (authMode) {
                case 'oauth':
                  authType = AuthType.LOGIN_WITH_GOOGLE;
                  break;
                case 'api-key':
                  authType = AuthType.USE_GEMINI;
                  break;
                case 'vertex':
                  authType = AuthType.USE_VERTEX_AI;
                  break;
                default:
                  authType = AuthType.LOGIN_WITH_GOOGLE;
              }

              // Refresh auth with the new type
              await config.refreshAuth(authType);

              addMessage({
                type: MessageType.INFO,
                content: `Switched to ${authMode} authentication mode`,
                timestamp: new Date(),
              });
            } else {
              addMessage({
                type: MessageType.ERROR,
                content:
                  'Auth mode switching is only supported for the Gemini provider',
                timestamp: new Date(),
              });
            }
          } catch (error) {
            addMessage({
              type: MessageType.ERROR,
              content: `Failed to switch auth mode: ${error instanceof Error ? error.message : String(error)}`,
              timestamp: new Date(),
            });
          }
        },
      },
      {
        name: 'editor',
        description: 'set external editor preference',
        action: (_context: CommandContext, _args: string) => ({
          type: 'dialog' as const,
          dialog: 'editor' as const,
        }),
      },
      {
        name: 'stats',
        altName: 'usage',
        description: 'check session stats. Usage: /stats [model|tools]',
        action: (_context: CommandContext, args: string) => {
          const subCommand = args?.split(' ')[0];
          if (subCommand === 'model') {
            addMessage({
              type: MessageType.MODEL_STATS,
              timestamp: new Date(),
            });
            return;
          } else if (subCommand === 'tools') {
            addMessage({
              type: MessageType.TOOL_STATS,
              timestamp: new Date(),
            });
            return;
          }

          const now = new Date();
          const { sessionStartTime } = session.stats;
          const wallDuration = now.getTime() - sessionStartTime.getTime();

          addMessage({
            type: MessageType.STATS,
            duration: formatDuration(wallDuration),
            timestamp: new Date(),
          });
        },
      },
      {
        name: 'mcp',
        description: 'list configured MCP servers and tools',
        action: async (_context: CommandContext, args: string) => {
          // Check if the args includes a specific flag to control description visibility
          const [subCommand, ...rest] = args?.split(' ') || [];
          const remainingArgs = rest.join(' ');
          let useShowDescriptions = showToolDescriptions;
          if (subCommand === 'desc' || subCommand === 'descriptions') {
            useShowDescriptions = true;
          } else if (
            subCommand === 'nodesc' ||
            subCommand === 'nodescriptions'
          ) {
            useShowDescriptions = false;
          } else if (
            remainingArgs === 'desc' ||
            remainingArgs === 'descriptions'
          ) {
            useShowDescriptions = true;
          } else if (
            remainingArgs === 'nodesc' ||
            remainingArgs === 'nodescriptions'
          ) {
            useShowDescriptions = false;
          }
          // Check if the args includes a specific flag to show detailed tool schema
          let useShowSchema = false;
          if (subCommand === 'schema' || remainingArgs === 'schema') {
            useShowSchema = true;
          }

          const toolRegistry = await config?.getToolRegistry();
          if (!toolRegistry) {
            addMessage({
              type: MessageType.ERROR,
              content: 'Could not retrieve tool registry.',
              timestamp: new Date(),
            });
            return;
          }

          const mcpServers = config?.getMcpServers() || {};
          const serverNames = Object.keys(mcpServers);

          if (serverNames.length === 0) {
            const docsUrl = 'https://goo.gle/gemini-cli-docs-mcp';
            if (process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec') {
              addMessage({
                type: MessageType.INFO,
                content: `No MCP servers configured. Please open the following URL in your browser to view documentation:\n${docsUrl}`,
                timestamp: new Date(),
              });
            } else {
              addMessage({
                type: MessageType.INFO,
                content: `No MCP servers configured. Opening documentation in your browser: ${docsUrl}`,
                timestamp: new Date(),
              });
              await open(docsUrl);
            }
            return;
          }

          // Check if any servers are still connecting
          const connectingServers = serverNames.filter(
            (name) => getMCPServerStatus(name) === MCPServerStatus.CONNECTING,
          );
          const discoveryState = getMCPDiscoveryState();

          let message = '';

          // Add overall discovery status message if needed
          if (
            discoveryState === MCPDiscoveryState.IN_PROGRESS ||
            connectingServers.length > 0
          ) {
            message +=
              ansi.accentYellow(
                `⏳ MCP servers are starting up (${connectingServers.length} initializing)...`,
              ) + '\n';
            message +=
              ansi.gray(
                'Note: First startup may take longer. Tool availability will update automatically.',
              ) + '\n\n';
          }

          message += 'Configured MCP servers:\n\n';

          for (const serverName of serverNames) {
            const serverTools = toolRegistry.getToolsByServer(serverName);
            const status = getMCPServerStatus(serverName);

            // Add status indicator with descriptive text
            let statusIndicator = '';
            let statusText = '';
            switch (status) {
              case MCPServerStatus.CONNECTED:
                statusIndicator = '🟢';
                statusText = 'Ready';
                break;
              case MCPServerStatus.CONNECTING:
                statusIndicator = '🔄';
                statusText = 'Starting... (first startup may take longer)';
                break;
              case MCPServerStatus.DISCONNECTED:
              default:
                statusIndicator = '🔴';
                statusText = 'Disconnected';
                break;
            }

            // Get server description if available
            const server = mcpServers[serverName];

            // Format server header with bold formatting and status
            message += `${statusIndicator} ${ansi.bold(serverName)} - ${statusText}`;

            // Add tool count with conditional messaging
            if (status === MCPServerStatus.CONNECTED) {
              message += ` (${serverTools.length} tools)`;
            } else if (status === MCPServerStatus.CONNECTING) {
              message += ` (tools will appear when ready)`;
            } else {
              message += ` (${serverTools.length} tools cached)`;
            }

            // Add server description with proper handling of multi-line descriptions
            if ((useShowDescriptions || useShowSchema) && server?.description) {
              const descLines = server.description.trim().split('\n');
              if (descLines) {
                message += ':\n';
                for (const descLine of descLines) {
                  message += `    ${ansi.accentGreen(descLine)}\n`;
                }
              } else {
                message += '\n';
              }
            } else {
              message += '\n';
            }

            if (serverTools.length > 0) {
              serverTools.forEach((tool) => {
                if (
                  (useShowDescriptions || useShowSchema) &&
                  tool.description
                ) {
                  // Format tool name in cyan using simple ANSI cyan color
                  message += `  - ${ansi.accentCyan(tool.name)}`;

                  // Handle multi-line descriptions by properly indenting and preserving formatting
                  const descLines = tool.description.trim().split('\n');
                  if (descLines) {
                    message += ':\n';
                    for (const descLine of descLines) {
                      message += `      ${ansi.accentGreen(descLine)}\n`;
                    }
                  } else {
                    message += '\n';
                  }
                } else {
                  // Use cyan color for the tool name even when not showing descriptions
                  message += `  - ${ansi.accentCyan(tool.name)}\n`;
                }
                if (useShowSchema) {
                  // Prefix the parameters in cyan
                  message += `    ${ansi.accentCyan('Parameters')}:\n`;

                  const paramsLines = JSON.stringify(
                    tool.schema.parameters,
                    null,
                    2,
                  )
                    .trim()
                    .split('\n');
                  if (paramsLines) {
                    for (const paramsLine of paramsLines) {
                      message += `      ${ansi.accentGreen(paramsLine)}\n`;
                    }
                  }
                }
              });
            } else {
              message += '  No tools available\n';
            }
            message += '\n';
          }

          addMessage({
            type: MessageType.INFO,
            content: message,
            timestamp: new Date(),
          });
        },
      },
      {
        name: 'extensions',
        description: 'list active extensions',
        action: async () => {
          const activeExtensions = config?.getActiveExtensions();
          if (!activeExtensions || activeExtensions.length === 0) {
            addMessage({
              type: MessageType.INFO,
              content: 'No active extensions.',
              timestamp: new Date(),
            });
            return;
          }

          let message = 'Active extensions:\n\n';
          for (const ext of activeExtensions) {
            message += `  - \u001b[36m${ext.name} (v${ext.version})\u001b[0m\n`;
          }
          // Make sure to reset any ANSI formatting at the end to prevent it from affecting the terminal
          message += '\u001b[0m';

          addMessage({
            type: MessageType.INFO,
            content: message,
            timestamp: new Date(),
          });
        },
      },
      {
        name: 'tools',
        description: 'list available LLxprt Code tools',
        action: async (_context: CommandContext, args: string) => {
          // Check if the args includes a specific flag to control description visibility
          const [subCommand, ...rest] = args?.split(' ') || [];
          const remainingArgs = rest.join(' ');
          let useShowDescriptions = showToolDescriptions;
          if (subCommand === 'desc' || subCommand === 'descriptions') {
            useShowDescriptions = true;
          } else if (
            subCommand === 'nodesc' ||
            subCommand === 'nodescriptions'
          ) {
            useShowDescriptions = false;
          } else if (
            remainingArgs === 'desc' ||
            remainingArgs === 'descriptions'
          ) {
            useShowDescriptions = true;
          } else if (
            remainingArgs === 'nodesc' ||
            remainingArgs === 'nodescriptions'
          ) {
            useShowDescriptions = false;
          }

          const toolRegistry = await config?.getToolRegistry();
          const tools = toolRegistry?.getAllTools();
          if (!tools) {
            addMessage({
              type: MessageType.ERROR,
              content: 'Could not retrieve tools.',
              timestamp: new Date(),
            });
            return;
          }

          // Filter out MCP tools by checking if they have a serverName property
          const geminiTools = tools.filter((tool) => !('serverName' in tool));

          let message = 'Available Gemini CLI tools:\n\n';

          if (geminiTools.length > 0) {
            geminiTools.forEach((tool) => {
              if (useShowDescriptions && tool.description) {
                // Format tool name in cyan using simple ANSI cyan color
                message += `  - ${ansi.accentCyan(`${tool.displayName} (${tool.name})`)}:\n`;

                // Handle multi-line descriptions by properly indenting and preserving formatting
                const descLines = tool.description.trim().split('\n');

                // If there are multiple lines, add proper indentation for each line
                if (descLines) {
                  for (const descLine of descLines) {
                    message += `      ${ansi.accentGreen(descLine)}\n`;
                  }
                }
              } else {
                // Use cyan color for the tool name even when not showing descriptions
                message += `  - ${ansi.accentCyan(tool.displayName)}\n`;
              }
            });
          } else {
            message += '  No tools available\n';
          }
          message += '\n';

          addMessage({
            type: MessageType.INFO,
            content: message,
            timestamp: new Date(),
          });
        },
      },
      {
        name: 'bug',
        description: 'submit a bug report',
        action: async (_context: CommandContext, args: string) => {
          const bugDescription = args?.trim() || '';

          const osVersion = `${process.platform} ${process.version}`;
          let sandboxEnv = 'no sandbox';
          if (process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec') {
            sandboxEnv = process.env.SANDBOX.replace(/^gemini-(?:code-)?/, '');
          } else if (process.env.SANDBOX === 'sandbox-exec') {
            sandboxEnv = `sandbox-exec (${
              process.env.SEATBELT_PROFILE || 'unknown'
            })`;
          }
          const modelVersion = config?.getModel() || 'Unknown';
          const cliVersion = await getCliVersion();
          const memoryUsage = formatMemoryUsage(process.memoryUsage().rss);

          const info = `
*   **CLI Version:** ${cliVersion}
*   **Git Commit:** ${GIT_COMMIT_INFO}
*   **Operating System:** ${osVersion}
*   **Sandbox Environment:** ${sandboxEnv}
*   **Model Version:** ${modelVersion}
*   **Memory Usage:** ${memoryUsage}
`;

          let bugReportUrl =
            'https://github.com/acoliver/llxprt-code/issues/new?template=bug_report.yml&title={title}&info={info}';
          const bugCommand = config?.getBugCommand();
          if (bugCommand?.urlTemplate) {
            bugReportUrl = bugCommand.urlTemplate;
          }
          bugReportUrl = bugReportUrl
            .replace('{title}', encodeURIComponent(bugDescription))
            .replace('{info}', encodeURIComponent(info));

          addMessage({
            type: MessageType.INFO,
            content: `To submit your bug report, please open the following URL in your browser:\n${bugReportUrl}`,
            timestamp: new Date(),
          });
          (async () => {
            try {
              await open(bugReportUrl);
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              addMessage({
                type: MessageType.ERROR,
                content: `Could not open URL in browser: ${errorMessage}`,
                timestamp: new Date(),
              });
            }
          })();
        },
      },
    ];

    if (config?.getCheckpointingEnabled()) {
      commands.push({
        name: 'restore',
        description:
          'restore a tool call. This will reset the conversation and file history to the state it was in when the tool call was suggested',
        completion: async () => {
          const checkpointDir = config?.getProjectTempDir()
            ? path.join(config.getProjectTempDir(), 'checkpoints')
            : undefined;
          if (!checkpointDir) {
            return [];
          }
          try {
            const files = await fs.readdir(checkpointDir);
            return files
              .filter((file) => file.endsWith('.json'))
              .map((file) => file.replace('.json', ''));
          } catch (_err) {
            return [];
          }
        },
        action: async (_context: CommandContext, args: string) => {
          const subCommand = args?.split(' ')[0];
          const checkpointDir = config?.getProjectTempDir()
            ? path.join(config.getProjectTempDir(), 'checkpoints')
            : undefined;

          if (!checkpointDir) {
            addMessage({
              type: MessageType.ERROR,
              content: 'Could not determine the .llxprt directory path.',
              timestamp: new Date(),
            });
            return;
          }

          try {
            // Ensure the directory exists before trying to read it.
            await fs.mkdir(checkpointDir, { recursive: true });
            const files = await fs.readdir(checkpointDir);
            const jsonFiles = files.filter((file) => file.endsWith('.json'));

            if (!subCommand) {
              if (jsonFiles.length === 0) {
                addMessage({
                  type: MessageType.INFO,
                  content: 'No restorable tool calls found.',
                  timestamp: new Date(),
                });
                return;
              }
              const truncatedFiles = jsonFiles.map((file) => {
                const components = file.split('.');
                if (components.length <= 1) {
                  return file;
                }
                components.pop();
                return components.join('.');
              });
              const fileList = truncatedFiles.join('\n');
              addMessage({
                type: MessageType.INFO,
                content: `Available tool calls to restore:\n\n${fileList}`,
                timestamp: new Date(),
              });
              return;
            }

            const selectedFile = subCommand.endsWith('.json')
              ? subCommand
              : `${subCommand}.json`;

            if (!jsonFiles.includes(selectedFile)) {
              addMessage({
                type: MessageType.ERROR,
                content: `File not found: ${selectedFile}`,
                timestamp: new Date(),
              });
              return;
            }

            const filePath = path.join(checkpointDir, selectedFile);
            const data = await fs.readFile(filePath, 'utf-8');
            const toolCallData = JSON.parse(data);

            if (toolCallData.history) {
              loadHistory(toolCallData.history);
            }

            if (toolCallData.clientHistory) {
              await config
                ?.getGeminiClient()
                ?.setHistory(toolCallData.clientHistory);
            }

            if (toolCallData.commitHash) {
              await gitService?.restoreProjectFromSnapshot(
                toolCallData.commitHash,
              );
              addMessage({
                type: MessageType.INFO,
                content: `Restored project to the state before the tool call.`,
                timestamp: new Date(),
              });
            }

            return {
              type: 'tool',
              toolName: toolCallData.toolCall.name,
              toolArgs: toolCallData.toolCall.args,
            };
          } catch (error) {
            addMessage({
              type: MessageType.ERROR,
              content: `Could not read restorable tool calls. This is the error: ${error}`,
              timestamp: new Date(),
            });
          }
        },
      });
    }
    return commands;
  }, [
    addMessage,
    openAuthDialog,
    config,
    session,
    gitService,
    loadHistory,
    showToolDescriptions,
  ]);

  const handleSlashCommand = useCallback(
    async (
      rawQuery: PartListUnion,
    ): Promise<SlashCommandProcessorResult | false> => {
      if (typeof rawQuery !== 'string') {
        return false;
      }

      const trimmed = rawQuery.trim();
      if (!trimmed.startsWith('/') && !trimmed.startsWith('?')) {
        return false;
      }

      const userMessageTimestamp = Date.now();
      if (trimmed !== '/quit' && trimmed !== '/exit') {
        addItem(
          { type: MessageType.USER, text: trimmed },
          userMessageTimestamp,
        );
      }

      const parts = trimmed.substring(1).trim().split(/\s+/);
      const commandPath = parts.filter((p) => p); // The parts of the command, e.g., ['memory', 'add']

      let currentCommands = commands;
      let commandToExecute: SlashCommand | undefined;
      let pathIndex = 0;

      for (const part of commandPath) {
        const foundCommand = currentCommands.find(
          (cmd) => cmd.name === part || cmd.altName === part,
        );

        if (foundCommand) {
          commandToExecute = foundCommand;
          pathIndex++;
          if (foundCommand.subCommands) {
            currentCommands = foundCommand.subCommands;
          } else {
            break;
          }
        } else {
          break;
        }
      }

      if (commandToExecute) {
        const args = parts.slice(pathIndex).join(' ');

        if (commandToExecute.action) {
          const result = await commandToExecute.action(commandContext, args);

          if (result) {
            switch (result.type) {
              case 'tool':
                return {
                  type: 'schedule_tool',
                  toolName: result.toolName,
                  toolArgs: result.toolArgs,
                };
              case 'message':
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
                return { type: 'handled' };
              case 'dialog':
                switch (result.dialog) {
                  case 'help':
                    setShowHelp(true);
                    return { type: 'handled' };
                  case 'auth':
                    openAuthDialog();
                    return { type: 'handled' };
                  case 'theme':
                    openThemeDialog();
                    return { type: 'handled' };
                  case 'editor':
                    openEditorDialog();
                    return { type: 'handled' };
                  case 'privacy':
                    openPrivacyNotice();
                    return { type: 'handled' };
                  case 'provider':
                    openProviderDialog();
                    return { type: 'handled' };
                  case 'providerModel':
                    openProviderModelDialog();
                    return { type: 'handled' };
                  default: {
                    const unhandled: never = result.dialog;
                    throw new Error(
                      `Unhandled slash command result: ${unhandled}`,
                    );
                  }
                }
              case 'load_history': {
                await config
                  ?.getGeminiClient()
                  ?.setHistory(result.clientHistory);
                commandContext.ui.clear();
                result.history.forEach((item, index) => {
                  commandContext.ui.addItem(item, index);
                });
                return { type: 'handled' };
              }
              case 'quit':
                setQuittingMessages(result.messages);
                setTimeout(() => {
                  process.exit(0);
                }, 100);
                return { type: 'handled' };
              default: {
                const unhandled: never = result;
                throw new Error(`Unhandled slash command result: ${unhandled}`);
              }
            }
          }

          return { type: 'handled' };
        } else if (commandToExecute.subCommands) {
          const helpText = `Command '/${commandToExecute.name}' requires a subcommand. Available:\n${commandToExecute.subCommands
            .map((sc) => `  - ${sc.name}: ${sc.description || ''}`)
            .join('\n')}`;
          addMessage({
            type: MessageType.INFO,
            content: helpText,
            timestamp: new Date(),
          });
          return { type: 'handled' };
        }
      }

      addMessage({
        type: MessageType.ERROR,
        content: `Unknown command: ${trimmed}`,
        timestamp: new Date(),
      });
      return { type: 'handled' };
    },
    [
      config,
      addItem,
      setShowHelp,
      openAuthDialog,
      commands,
      commandContext,
      addMessage,
      openThemeDialog,
      openPrivacyNotice,
      openEditorDialog,
      setQuittingMessages,
      openProviderDialog,
      openProviderModelDialog,
    ],
  );

  return {
    handleSlashCommand,
    slashCommands: commands,
    pendingHistoryItems,
    commandContext,
  };
};
