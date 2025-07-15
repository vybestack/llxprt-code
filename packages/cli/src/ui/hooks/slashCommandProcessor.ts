/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo, useEffect, useState } from 'react';
import { type PartListUnion } from '@google/genai';
import open from 'open';
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
} from '@vybestack/llxprt-code-core';
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
import { homedir } from 'os';
// import { createShowMemoryAction } from './useShowMemoryCommand.js';
import { GIT_COMMIT_INFO } from '../../generated/git-commit.js';
import { formatDuration, formatMemoryUsage } from '../utils/formatters.js';
import { getCliVersion } from '../../utils/version.js';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import {
  type CommandContext,
  type SlashCommandActionReturn,
  type SlashCommand,
} from '../commands/types.js';
import { CommandService } from '../../services/CommandService.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';

// This interface is for the old, inline command definitions.
// It will be removed once all commands are migrated to the new system.
export interface LegacySlashCommand {
  name: string;
  altName?: string;
  description?: string;
  completion?: () => Promise<string[]>;
  action: (
    mainCommand: string,
    subCommand?: string,
    args?: string,
  ) =>
    | void
    | SlashCommandActionReturn
    | Promise<void | SlashCommandActionReturn>;
}

/**
 * Hook to define and process slash commands (e.g., /help, /clear).
 */
export const useSlashCommandProcessor = (
  config: Config | null,
  settings: LoadedSettings,
  history: HistoryItem[],
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
  toggleCorgiMode: () => void,
  showToolDescriptions: boolean = false,
  setQuittingMessages: (message: HistoryItem[]) => void,
  openPrivacyNotice: () => void,
  checkPaymentModeChange?: (forcePreviousProvider?: string) => void,
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
        setDebugMessage: onDebugMessage,
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
      addItem,
      clearItems,
      refreshStatic,
      session.stats,
      onDebugMessage,
    ],
  );

  const commandService = useMemo(() => new CommandService(), []);

  useEffect(() => {
    const load = async () => {
      await commandService.loadCommands();
      setCommands(commandService.getCommands());
    };

    load();
  }, [commandService]);

  const savedChatTags = useCallback(async () => {
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
  const legacyCommands: LegacySlashCommand[] = useMemo(() => {
    const commands: LegacySlashCommand[] = [
      // `/help` and `/clear` have been migrated and REMOVED from this list.
      {
        name: 'docs',
        description: 'open full Gemini CLI documentation in your browser',
        action: async (_mainCommand, _subCommand, _args) => {
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
        action: async (_mainCommand, authMode, _args) => {
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
        action: (_mainCommand, _subCommand, _args) => openEditorDialog(),
      },
      {
        name: 'stats',
        altName: 'usage',
        description: 'check session stats. Usage: /stats [model|tools]',
        action: (_mainCommand, subCommand, _args) => {
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
        action: async (_mainCommand, _subCommand, _args) => {
          // Check if the _subCommand includes a specific flag to control description visibility
          let useShowDescriptions = showToolDescriptions;
          if (_subCommand === 'desc' || _subCommand === 'descriptions') {
            useShowDescriptions = true;
          } else if (
            _subCommand === 'nodesc' ||
            _subCommand === 'nodescriptions'
          ) {
            useShowDescriptions = false;
          } else if (_args === 'desc' || _args === 'descriptions') {
            useShowDescriptions = true;
          } else if (_args === 'nodesc' || _args === 'nodescriptions') {
            useShowDescriptions = false;
          }
          // Check if the _subCommand includes a specific flag to show detailed tool schema
          let useShowSchema = false;
          if (_subCommand === 'schema' || _args === 'schema') {
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
        description: 'list available Gemini CLI tools',
        action: async (_mainCommand, _subCommand, _args) => {
          // Check if the _subCommand includes a specific flag to control description visibility
          let useShowDescriptions = showToolDescriptions;
          if (_subCommand === 'desc' || _subCommand === 'descriptions') {
            useShowDescriptions = true;
          } else if (
            _subCommand === 'nodesc' ||
            _subCommand === 'nodescriptions'
          ) {
            useShowDescriptions = false;
          } else if (_args === 'desc' || _args === 'descriptions') {
            useShowDescriptions = true;
          } else if (_args === 'nodesc' || _args === 'nodescriptions') {
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
        name: 'model',
        description: 'select or switch model',
        action: async (_mainCommand, _subCommand, _args) => {
          const modelName = _subCommand || _args;
          const providerManager = getProviderManager();

          // Always use provider model dialog
          if (!modelName) {
            openProviderModelDialog();
            return;
          }

          // Switch model in provider
          try {
            const activeProvider = providerManager.getActiveProvider();
            const currentModel = activeProvider.getCurrentModel
              ? activeProvider.getCurrentModel()
              : 'unknown';

            if (activeProvider.setModel) {
              activeProvider.setModel(modelName);
              addMessage({
                type: MessageType.INFO,
                content: `Switched from ${currentModel} to ${modelName} in provider '${activeProvider.name}'`,
                timestamp: new Date(),
              });
            } else {
              addMessage({
                type: MessageType.ERROR,
                content: `Provider '${activeProvider.name}' does not support model switching`,
                timestamp: new Date(),
              });
            }
          } catch (error) {
            addMessage({
              type: MessageType.ERROR,
              content: `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`,
              timestamp: new Date(),
            });
          }
        },
      },
      {
        name: 'provider',
        description:
          'switch between different AI providers (openai, anthropic, etc.)',
        action: async (_mainCommand, providerName, _args) => {
          const providerManager = getProviderManager();

          if (!providerName) {
            // Open interactive provider selection dialog
            openProviderDialog();
            return;
          }

          try {
            const currentProvider = providerManager.getActiveProviderName();

            // Handle switching to same provider
            if (providerName === currentProvider) {
              addMessage({
                type: MessageType.INFO,
                content: `Already using provider: ${currentProvider}`,
                timestamp: new Date(),
              });
              return;
            }

            const fromProvider = currentProvider || 'none';
            providerManager.setActiveProvider(providerName);

            // Set the appropriate auth type based on provider
            if (providerName === 'gemini') {
              settings.setValue(
                SettingScope.User,
                'selectedAuthType',
                AuthType.USE_GEMINI,
              );
              await config?.refreshAuth(AuthType.USE_GEMINI);
            } else {
              settings.setValue(
                SettingScope.User,
                'selectedAuthType',
                AuthType.USE_PROVIDER,
              );
              await config?.refreshAuth(AuthType.USE_PROVIDER);
            }

            addMessage({
              type: MessageType.INFO,
              content: `Switched from ${fromProvider} to ${providerName}`,
              timestamp: new Date(),
            });

            // Trigger payment mode check to show banner when switching providers
            // Pass the previous provider to ensure proper detection
            if (checkPaymentModeChange) {
              setTimeout(() => checkPaymentModeChange(fromProvider), 100);
            }
          } catch (error) {
            addMessage({
              type: MessageType.ERROR,
              content: `Failed to switch provider: ${error instanceof Error ? error.message : String(error)}`,
              timestamp: new Date(),
            });
          }
        },
      },
      {
        name: 'corgi',
        action: (_mainCommand, _subCommand, _args) => {
          toggleCorgiMode();
        },
      },
      {
        name: 'bug',
        description: 'submit a bug report',
        action: async (_mainCommand, _subCommand, args) => {
          let bugDescription = _subCommand || '';
          if (args) {
            bugDescription += ` ${args}`;
          }
          bugDescription = bugDescription.trim();

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
            'https://github.com/google-gemini/gemini-cli/issues/new?template=bug_report.yml&title={title}&info={info}';
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
      {
        name: 'chat',
        description:
          'Manage conversation history. Usage: /chat <list|save|resume> <tag>',
        action: async (_mainCommand, subCommand, args) => {
          const tag = (args || '').trim();
          const logger = new Logger(config?.getSessionId() || '');
          await logger.initialize();
          const chat = await config?.getGeminiClient()?.getChat();
          if (!chat) {
            addMessage({
              type: MessageType.ERROR,
              content: 'No chat client available for conversation status.',
              timestamp: new Date(),
            });
            return;
          }
          if (!subCommand) {
            addMessage({
              type: MessageType.ERROR,
              content: 'Missing command\nUsage: /chat <list|save|resume> <tag>',
              timestamp: new Date(),
            });
            return;
          }
          switch (subCommand) {
            case 'save': {
              if (!tag) {
                addMessage({
                  type: MessageType.ERROR,
                  content: 'Missing tag. Usage: /chat save <tag>',
                  timestamp: new Date(),
                });
                return;
              }
              const history = chat.getHistory();
              if (history.length > 0) {
                await logger.saveCheckpoint(chat?.getHistory() || [], tag);
                addMessage({
                  type: MessageType.INFO,
                  content: `Conversation checkpoint saved with tag: ${tag}.`,
                  timestamp: new Date(),
                });
              } else {
                addMessage({
                  type: MessageType.INFO,
                  content: 'No conversation found to save.',
                  timestamp: new Date(),
                });
              }
              return;
            }
            case 'resume':
            case 'restore':
            case 'load': {
              if (!tag) {
                addMessage({
                  type: MessageType.ERROR,
                  content: 'Missing tag. Usage: /chat resume <tag>',
                  timestamp: new Date(),
                });
                return;
              }
              const conversation = await logger.loadCheckpoint(tag);
              if (conversation.length === 0) {
                addMessage({
                  type: MessageType.INFO,
                  content: `No saved checkpoint found with tag: ${tag}.`,
                  timestamp: new Date(),
                });
                return;
              }

              clearItems();
              chat.clearHistory();
              const rolemap: { [key: string]: MessageType } = {
                user: MessageType.USER,
                model: MessageType.GEMINI,
              };
              let hasSystemPrompt = false;
              let i = 0;
              for (const item of conversation) {
                i += 1;

                // Add each item to history regardless of whether we display
                // it.
                chat.addHistory(item);

                const text =
                  item.parts
                    ?.filter((m) => !!m.text)
                    .map((m) => m.text)
                    .join('') || '';
                if (!text) {
                  // Parsing Part[] back to various non-text output not yet implemented.
                  continue;
                }
                if (i === 1 && text.match(/context for our chat/)) {
                  hasSystemPrompt = true;
                }
                if (i > 2 || !hasSystemPrompt) {
                  addItem(
                    {
                      type:
                        (item.role && rolemap[item.role]) || MessageType.GEMINI,
                      text,
                    } as HistoryItemWithoutId,
                    i,
                  );
                }
              }
              console.clear();
              refreshStatic();
              return;
            }
            case 'list':
              addMessage({
                type: MessageType.INFO,
                content:
                  'list of saved conversations: ' +
                  (await savedChatTags()).join(', '),
                timestamp: new Date(),
              });
              return;
            default:
              addMessage({
                type: MessageType.ERROR,
                content: `Unknown /chat command: ${subCommand}. Available: list, save, resume`,
                timestamp: new Date(),
              });
              return;
          }
        },
        completion: async () =>
          (await savedChatTags()).map((tag) => 'resume ' + tag),
      },
      {
        name: 'quit',
        altName: 'exit',
        description: 'exit the cli',
        action: async (mainCommand, _subCommand, _args) => {
          const now = new Date();
          const { sessionStartTime } = session.stats;
          const wallDuration = now.getTime() - sessionStartTime.getTime();

          setQuittingMessages([
            {
              type: 'user',
              text: `/${mainCommand}`,
              id: now.getTime() - 1,
            },
            {
              type: 'quit',
              duration: formatDuration(wallDuration),
              id: now.getTime(),
            },
          ]);

          setTimeout(() => {
            process.exit(0);
          }, 100);
        },
      },
      {
        name: 'compress',
        altName: 'summarize',
        description: 'Compresses the context by replacing it with a summary.',
        action: async (_mainCommand, _subCommand, _args) => {
          if (pendingCompressionItemRef.current !== null) {
            addMessage({
              type: MessageType.ERROR,
              content:
                'Already compressing, wait for previous request to complete',
              timestamp: new Date(),
            });
            return;
          }
          setPendingCompressionItem({
            type: MessageType.COMPRESSION,
            compression: {
              isPending: true,
              originalTokenCount: null,
              newTokenCount: null,
            },
          });
          try {
            const compressed = await config!
              .getGeminiClient()!
              // TODO: Set Prompt id for CompressChat from SlashCommandProcessor.
              .tryCompressChat('Prompt Id not set', true);
            if (compressed) {
              addMessage({
                type: MessageType.COMPRESSION,
                compression: {
                  isPending: false,
                  originalTokenCount: compressed.originalTokenCount,
                  newTokenCount: compressed.newTokenCount,
                },
                timestamp: new Date(),
              });
            } else {
              addMessage({
                type: MessageType.ERROR,
                content: 'Failed to compress chat history.',
                timestamp: new Date(),
              });
            }
          } catch (e) {
            addMessage({
              type: MessageType.ERROR,
              content: `Failed to compress chat history: ${e instanceof Error ? e.message : String(e)}`,
              timestamp: new Date(),
            });
          }
          setPendingCompressionItem(null);
        },
      },
      {
        name: 'key',
        description: 'set or remove API key for the current provider',
        action: async (_mainCommand, apiKey, _args) => {
          const providerManager = getProviderManager();

          try {
            const activeProvider = providerManager.getActiveProvider();
            const providerName = activeProvider.name;

            // If no key provided or 'none', remove the key
            if (
              !apiKey ||
              apiKey.trim() === '' ||
              apiKey.trim().toLowerCase() === 'none'
            ) {
              // Clear the API key
              if (activeProvider.setApiKey) {
                activeProvider.setApiKey('');

                // Remove from settings
                const currentKeys = settings.merged.providerApiKeys || {};
                delete currentKeys[providerName];
                settings.setValue(
                  SettingScope.User,
                  'providerApiKeys',
                  currentKeys,
                );

                // If this is the Gemini provider, we might need to switch auth mode
                if (providerName === 'gemini' && config) {
                  // Switch to OAuth if no API key
                  await config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);
                }

                // Check payment mode after auth refresh
                const isPaidMode = activeProvider.isPaidMode?.() ?? true;
                const paymentMessage =
                  !isPaidMode && providerName === 'gemini'
                    ? '\n✅ You are now in FREE MODE - using OAuth authentication'
                    : '';

                addMessage({
                  type: MessageType.INFO,
                  content: `API key removed for provider '${providerName}'${paymentMessage}`,
                  timestamp: new Date(),
                });

                // Trigger payment mode check to show banner
                if (checkPaymentModeChange) {
                  setTimeout(checkPaymentModeChange, 100);
                }
              } else {
                addMessage({
                  type: MessageType.ERROR,
                  content: `Provider '${providerName}' does not support API key updates`,
                  timestamp: new Date(),
                });
              }
              return;
            }

            // Update the provider's API key
            if (activeProvider.setApiKey) {
              activeProvider.setApiKey(apiKey);

              // Save to settings
              const currentKeys = settings.merged.providerApiKeys || {};
              currentKeys[providerName] = apiKey;
              settings.setValue(
                SettingScope.User,
                'providerApiKeys',
                currentKeys,
              );

              // If this is the Gemini provider, we need to refresh auth to use API key mode
              if (providerName === 'gemini' && config) {
                await config.refreshAuth(AuthType.USE_GEMINI);
              }

              // Check if we're now in paid mode
              const isPaidMode = activeProvider.isPaidMode?.() ?? true;
              const paymentWarning = isPaidMode
                ? '\n⚠️  You are now in PAID MODE - API usage will be charged to your account'
                : '';

              addMessage({
                type: MessageType.INFO,
                content: `API key updated for provider '${providerName}'${paymentWarning}`,
                timestamp: new Date(),
              });

              // Trigger payment mode check to show banner
              if (checkPaymentModeChange) {
                setTimeout(checkPaymentModeChange, 100);
              }
            } else {
              addMessage({
                type: MessageType.ERROR,
                content: `Provider '${providerName}' does not support API key updates`,
                timestamp: new Date(),
              });
            }
          } catch (error) {
            addMessage({
              type: MessageType.ERROR,
              content: `Failed to set API key: ${error instanceof Error ? error.message : String(error)}`,
              timestamp: new Date(),
            });
          }
        },
      },
      {
        name: 'keyfile',
        description: 'manage API key file for the current provider',
        action: async (_mainCommand, filePath, _args) => {
          const providerManager = getProviderManager();

          try {
            const activeProvider = providerManager.getActiveProvider();
            const providerName = activeProvider.name;

            // If no path provided, check for existing keyfile
            if (!filePath || filePath.trim() === '') {
              // Check common keyfile locations
              const keyfilePaths = [
                path.join(homedir(), `.${providerName}_key`),
                path.join(homedir(), `.${providerName}-key`),
                path.join(homedir(), `.${providerName}_api_key`),
              ];

              // For specific providers, check their known keyfile locations
              if (providerName === 'openai') {
                keyfilePaths.unshift(path.join(homedir(), '.openai_key'));
              } else if (providerName === 'anthropic') {
                keyfilePaths.unshift(path.join(homedir(), '.anthropic_key'));
              }

              let foundKeyfile: string | null = null;
              for (const keyfilePath of keyfilePaths) {
                try {
                  await fs.access(keyfilePath);
                  foundKeyfile = keyfilePath;
                  break;
                } catch {
                  // File doesn't exist, continue checking
                }
              }

              if (foundKeyfile) {
                addMessage({
                  type: MessageType.INFO,
                  content: `Current keyfile for provider '${providerName}': ${foundKeyfile}\nTo remove: /keyfile none\nTo change: /keyfile <new_path>`,
                  timestamp: new Date(),
                });
              } else {
                addMessage({
                  type: MessageType.INFO,
                  content: `No keyfile found for provider '${providerName}'\nTo set: /keyfile <path>`,
                  timestamp: new Date(),
                });
              }
              return;
            }

            // If 'none' is specified, remove the keyfile setting
            if (filePath.trim().toLowerCase() === 'none') {
              // Clear the API key
              if (activeProvider.setApiKey) {
                activeProvider.setApiKey('');

                // Remove from settings
                const currentKeys = settings.merged.providerApiKeys || {};
                delete currentKeys[providerName];
                settings.setValue(
                  SettingScope.User,
                  'providerApiKeys',
                  currentKeys,
                );

                // If this is the Gemini provider, we might need to switch auth mode
                if (providerName === 'gemini' && config) {
                  // Switch to OAuth if no API key
                  await config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);
                }

                // Check payment mode after auth refresh
                const isPaidMode = activeProvider.isPaidMode?.() ?? true;
                const paymentMessage =
                  !isPaidMode && providerName === 'gemini'
                    ? '\n✅ You are now in FREE MODE - using OAuth authentication'
                    : '';

                addMessage({
                  type: MessageType.INFO,
                  content: `Keyfile removed for provider '${providerName}'${paymentMessage}`,
                  timestamp: new Date(),
                });

                // Trigger payment mode check to show banner
                if (checkPaymentModeChange) {
                  setTimeout(checkPaymentModeChange, 100);
                }
              } else {
                addMessage({
                  type: MessageType.ERROR,
                  content: `Provider '${providerName}' does not support API key updates`,
                  timestamp: new Date(),
                });
              }
              return;
            }

            // Resolve ~ to home directory
            const resolvedPath = filePath.replace(/^~/, homedir());

            // Read the API key from file
            const apiKey = (await fs.readFile(resolvedPath, 'utf-8')).trim();

            if (!apiKey) {
              addMessage({
                type: MessageType.ERROR,
                content: 'The specified file is empty',
                timestamp: new Date(),
              });
              return;
            }

            // Update the provider's API key
            if (activeProvider.setApiKey) {
              activeProvider.setApiKey(apiKey);

              // Save to settings
              const currentKeys = settings.merged.providerApiKeys || {};
              currentKeys[providerName] = apiKey;
              settings.setValue(
                SettingScope.User,
                'providerApiKeys',
                currentKeys,
              );

              // Check if we're now in paid mode
              const isPaidMode = activeProvider.isPaidMode?.() ?? true;
              const paymentWarning = isPaidMode
                ? '\n⚠️  You are now in PAID MODE - API usage will be charged to your account'
                : '';

              addMessage({
                type: MessageType.INFO,
                content: `API key loaded from ${resolvedPath} for provider '${providerName}'${paymentWarning}`,
                timestamp: new Date(),
              });

              // Trigger payment mode check to show banner
              if (checkPaymentModeChange) {
                setTimeout(checkPaymentModeChange, 100);
              }
            } else {
              addMessage({
                type: MessageType.ERROR,
                content: `Provider '${providerName}' does not support API key updates`,
                timestamp: new Date(),
              });
            }
          } catch (error) {
            addMessage({
              type: MessageType.ERROR,
              content: `Failed to process keyfile: ${error instanceof Error ? error.message : String(error)}`,
              timestamp: new Date(),
            });
          }
        },
      },
      {
        name: 'baseurl',
        description: 'set base URL for the current provider',
        action: async (_mainCommand, baseUrl, _args) => {
          const providerManager = getProviderManager();

          if (!baseUrl || baseUrl.trim() === '') {
            // Clear base URL to provider default
            try {
              const activeProvider = providerManager.getActiveProvider();
              const providerName = activeProvider.name;
              if (activeProvider.setBaseUrl) {
                activeProvider.setBaseUrl(undefined);
                // Remove from settings
                const currentUrls = settings.merged.providerBaseUrls || {};
                delete currentUrls[providerName];
                settings.setValue(
                  SettingScope.User,
                  'providerBaseUrls',
                  currentUrls,
                );
                addMessage({
                  type: MessageType.INFO,
                  content: `Base URL cleared for provider '${providerName}' (using default).`,
                  timestamp: new Date(),
                });
              } else {
                addMessage({
                  type: MessageType.ERROR,
                  content: `Provider '${providerName}' does not support base URL updates`,
                  timestamp: new Date(),
                });
              }
            } catch (error) {
              addMessage({
                type: MessageType.ERROR,
                content: `Failed to clear base URL: ${error instanceof Error ? error.message : String(error)}`,
                timestamp: new Date(),
              });
            }
            return;
          }

          try {
            const activeProvider = providerManager.getActiveProvider();
            const providerName = activeProvider.name;

            // Update the provider's base URL
            if (activeProvider.setBaseUrl) {
              activeProvider.setBaseUrl(baseUrl);

              // Save to settings
              const currentUrls = settings.merged.providerBaseUrls || {};
              currentUrls[providerName] = baseUrl;
              settings.setValue(
                SettingScope.User,
                'providerBaseUrls',
                currentUrls,
              );

              addMessage({
                type: MessageType.INFO,
                content: `Base URL updated to '${baseUrl}' for provider '${providerName}'`,
                timestamp: new Date(),
              });
            } else {
              addMessage({
                type: MessageType.ERROR,
                content: `Provider '${providerName}' does not support base URL updates`,
                timestamp: new Date(),
              });
            }
          } catch (error) {
            addMessage({
              type: MessageType.ERROR,
              content: `Failed to set base URL: ${error instanceof Error ? error.message : String(error)}`,
              timestamp: new Date(),
            });
          }
        },
      },
      {
        name: 'toolformat',
        description: 'override the auto-detected tool calling format',
        action: async (_mainCommand, formatName, _args) => {
          const providerManager = getProviderManager();

          const activeProvider = providerManager.getActiveProvider();
          const providerName = activeProvider.name;

          // Supported formats
          const structuredFormats = ['openai', 'anthropic', 'deepseek', 'qwen'];
          const textFormats = ['hermes', 'xml', 'llama', 'gemma'];
          const allFormats = [...structuredFormats, ...textFormats];

          // Show current format
          if (!formatName) {
            const currentFormat = activeProvider.getToolFormat
              ? activeProvider.getToolFormat()
              : 'unknown';
            const isAutoDetected = !(
              settings.merged.providerToolFormatOverrides &&
              settings.merged.providerToolFormatOverrides[providerName]
            );

            addMessage({
              type: MessageType.INFO,
              content: `Current tool format: ${currentFormat} (${isAutoDetected ? 'auto-detected' : 'manual override'})
To override: /toolformat <format>
To return to auto: /toolformat auto
Supported formats:
  Structured: ${structuredFormats.join(', ')}
  Text-based: ${textFormats.join(', ')}`,
              timestamp: new Date(),
            });
            return;
          }

          // Return to auto-detection
          if (formatName === 'auto') {
            // Clear override in provider
            if (activeProvider.setToolFormatOverride) {
              activeProvider.setToolFormatOverride(null);
            }

            // Also clear from settings
            const currentOverrides =
              settings.merged.providerToolFormatOverrides || {};
            delete currentOverrides[providerName];
            settings.setValue(
              SettingScope.User,
              'providerToolFormatOverrides',
              currentOverrides,
            );

            addMessage({
              type: MessageType.INFO,
              content: `Tool format override cleared for provider '${providerName}'. Using auto-detection.`,
              timestamp: new Date(),
            });
            return;
          }

          // Validate format
          if (!allFormats.includes(formatName)) {
            addMessage({
              type: MessageType.ERROR,
              content: `Invalid format '${formatName}'. Supported formats:
  Structured: ${structuredFormats.join(', ')}
  Text-based: ${textFormats.join(', ')}`,
              timestamp: new Date(),
            });
            return;
          }

          // Set override
          try {
            // Update provider directly
            if (activeProvider.setToolFormatOverride) {
              activeProvider.setToolFormatOverride(formatName);
            }

            // Also save to settings for persistence
            const currentOverrides =
              settings.merged.providerToolFormatOverrides || {};
            currentOverrides[providerName] = formatName;
            settings.setValue(
              SettingScope.User,
              'providerToolFormatOverrides',
              currentOverrides,
            );

            addMessage({
              type: MessageType.INFO,
              content: `Tool format override set to '${formatName}' for provider '${providerName}'`,
              timestamp: new Date(),
            });
          } catch (error) {
            addMessage({
              type: MessageType.ERROR,
              content: `Failed to set tool format override: ${error instanceof Error ? error.message : String(error)}`,
              timestamp: new Date(),
            });
          }
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
        action: async (_mainCommand, subCommand, _args) => {
          const checkpointDir = config?.getProjectTempDir()
            ? path.join(config.getProjectTempDir(), 'checkpoints')
            : undefined;

          if (!checkpointDir) {
            addMessage({
              type: MessageType.ERROR,
              content: 'Could not determine the .gemini directory path.',
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
    openEditorDialog,
    openProviderModelDialog,
    openProviderDialog,
    clearItems,
    refreshStatic,
    toggleCorgiMode,
    savedChatTags,
    config,
    showToolDescriptions,
    session,
    gitService,
    loadHistory,
    addItem,
    setQuittingMessages,
    pendingCompressionItemRef,
    setPendingCompressionItem,
    checkPaymentModeChange,
    openAuthDialog,
    settings,
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

      // --- Start of New Tree Traversal Logic ---

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
                  case 'privacy':
                    openPrivacyNotice();
                    return { type: 'handled' };
                  default: {
                    const unhandled: never = result.dialog;
                    throw new Error(
                      `Unhandled slash command result: ${unhandled}`,
                    );
                  }
                }
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

      // --- End of New Tree Traversal Logic ---

      // --- Legacy Fallback Logic (for commands not yet migrated) ---

      const mainCommand = parts[0];
      const subCommand = parts[1];
      const legacyArgs = parts.slice(2).join(' ');

      for (const cmd of legacyCommands) {
        if (mainCommand === cmd.name || mainCommand === cmd.altName) {
          const actionResult = await cmd.action(
            mainCommand,
            subCommand,
            legacyArgs,
          );

          if (actionResult?.type === 'tool') {
            return {
              type: 'schedule_tool',
              toolName: actionResult.toolName,
              toolArgs: actionResult.toolArgs,
            };
          }
          if (actionResult?.type === 'message') {
            addItem(
              {
                type:
                  actionResult.messageType === 'error'
                    ? MessageType.ERROR
                    : MessageType.INFO,
                text: actionResult.content,
              },
              Date.now(),
            );
          }
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
      addItem,
      setShowHelp,
      openAuthDialog,
      commands,
      legacyCommands,
      commandContext,
      addMessage,
      openThemeDialog,
      openPrivacyNotice,
    ],
  );

  const allCommands = useMemo(() => {
    // Adapt legacy commands to the new SlashCommand interface
    const adaptedLegacyCommands: SlashCommand[] = legacyCommands.map(
      (legacyCmd) => ({
        name: legacyCmd.name,
        altName: legacyCmd.altName,
        description: legacyCmd.description,
        action: async (_context: CommandContext, args: string) => {
          const parts = args.split(/\s+/);
          const subCommand = parts[0] || undefined;
          const restOfArgs = parts.slice(1).join(' ') || undefined;

          return legacyCmd.action(legacyCmd.name, subCommand, restOfArgs);
        },
        completion: legacyCmd.completion
          ? async (_context: CommandContext, _partialArg: string) =>
              legacyCmd.completion!()
          : undefined,
      }),
    );

    const newCommandNames = new Set(commands.map((c) => c.name));
    const filteredAdaptedLegacy = adaptedLegacyCommands.filter(
      (c) => !newCommandNames.has(c.name),
    );

    return [...commands, ...filteredAdaptedLegacy];
  }, [commands, legacyCommands]);

  return {
    handleSlashCommand,
    slashCommands: allCommands,
    pendingHistoryItems,
    commandContext,
  };
};
