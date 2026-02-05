/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo, useEffect, useState } from 'react';
import { type PartListUnion } from '@google/genai';
import process from 'node:process';
import * as path from 'node:path';
import * as os from 'node:os';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { Config, Todo } from '@vybestack/llxprt-code-core';
import {
  GitService,
  Logger,
  DebugLogger,
  logSlashCommand,
  SlashCommandEvent,
  ToolConfirmationOutcome,
  Storage,
  IdeClient,
  ProfileManager,
  SubagentManager,
} from '@vybestack/llxprt-code-core';
import { useSessionStats } from '../contexts/SessionContext.js';
import type {
  Message,
  HistoryItemWithoutId,
  SlashCommandProcessorResult,
  HistoryItem,
  ConfirmationRequest,
} from '../types.js';
import { MessageType } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';
import {
  type CommandContext,
  type SlashCommand,
  type SubagentDialogData,
  type ModelsDialogData,
} from '../commands/types.js';
import { CommandService } from '../../services/CommandService.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { FileCommandLoader } from '../../services/FileCommandLoader.js';
import { McpPromptLoader } from '../../services/McpPromptLoader.js';
import { parseSlashCommand } from '../../utils/commands.js';
import type {
  ExtensionUpdateState,
  ExtensionUpdateAction,
} from '../state/extensions.js';
import { SubagentView } from '../components/SubagentManagement/types.js';

const confirmationLogger = new DebugLogger('llxprt:ui:selection');
const slashCommandLogger = new DebugLogger('llxprt:ui:slash-commands');

interface SlashCommandProcessorActions {
  openAuthDialog: () => void;
  openThemeDialog: () => void;
  openEditorDialog: () => void;
  openPrivacyNotice: () => void;
  openSettingsDialog: () => void;
  openLoggingDialog: (data?: { entries: unknown[] }) => void;
  openSubagentDialog: (
    initialView?: SubagentView,
    initialName?: string,
  ) => void;
  openModelsDialog: (data?: ModelsDialogData) => void;
  openPermissionsDialog: () => void;
  openProviderDialog: () => void;
  openLoadProfileDialog: () => void;
  openCreateProfileDialog: () => void;
  openProfileListDialog: () => void;
  viewProfileDetail: (profileName: string, openedDirectly?: boolean) => void;
  openProfileEditor: (profileName: string, openedDirectly?: boolean) => void;
  quit: (messages: HistoryItem[]) => void;
  setDebugMessage: (message: string) => void;
  toggleCorgiMode: () => void;
  toggleDebugProfiler: () => void;
  dispatchExtensionStateUpdate: (action: ExtensionUpdateAction) => void;
  addConfirmUpdateExtensionRequest: (request: ConfirmationRequest) => void;
  openWelcomeDialog: () => void;
}

/**
 * Hook to define and process slash commands (e.g., /help, /clear).
 *
 * @plan PLAN-20260129-TODOPERSIST.P07 - Added todoContext param
 */
export const useSlashCommandProcessor = (
  config: Config | null,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
  clearItems: UseHistoryManagerReturn['clearItems'],
  loadHistory: UseHistoryManagerReturn['loadHistory'],
  refreshStatic: () => void,
  toggleVimEnabled: () => Promise<boolean>,
  setIsProcessing: (isProcessing: boolean) => void,
  setLlxprtMdFileCount: (count: number) => void,
  actions: SlashCommandProcessorActions,
  extensionsUpdateState: Map<string, ExtensionUpdateState>,
  isConfigInitialized: boolean,
  todoContext?: {
    todos: Todo[];
    updateTodos: (todos: Todo[]) => void;
    refreshTodos: () => void;
  },
) => {
  const session = useSessionStats();
  const [commands, setCommands] = useState<readonly SlashCommand[] | undefined>(
    undefined,
  );
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const alternateBuffer =
    settings.merged.ui?.useAlternateBuffer === true &&
    !config?.getScreenReader();

  const reloadCommands = useCallback(() => {
    setReloadTrigger((v) => v + 1);
  }, []);
  const [shellConfirmationRequest, setShellConfirmationRequest] =
    useState<null | {
      commands: string[];
      onConfirm: (
        outcome: ToolConfirmationOutcome,
        approvedCommands?: string[],
      ) => void;
    }>(null);
  const [confirmationRequest, setConfirmationRequest] = useState<null | {
    prompt: React.ReactNode;
    onConfirm: (confirmed: boolean) => void;
  }>(null);

  const [sessionShellAllowlist, setSessionShellAllowlist] = useState(
    new Set<string>(),
  );
  const gitService = useMemo(() => {
    if (!config?.getProjectRoot()) {
      return;
    }
    return new GitService(config.getProjectRoot(), config.storage);
  }, [config]);

  const logger = useMemo(() => {
    const l = new Logger(
      config?.getSessionId() || '',
      config?.storage ?? new Storage(process.cwd()),
    );
    // The logger's initialize is async, but we can create the instance
    // synchronously. Commands that use it will await its initialization.
    return l;
  }, [config]);

  /**
   * Initialize ProfileManager and SubagentManager for command context
   *
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P15
   * @requirement:REQ-010
   */
  const profileManager = useMemo(() => {
    if (!config) return undefined;
    const llxprtDir = path.join(os.homedir(), '.llxprt');
    const profilesDir = path.join(llxprtDir, 'profiles');
    return new ProfileManager(profilesDir);
  }, [config]);

  const subagentManager = useMemo(() => {
    if (!config || !profileManager) return undefined;
    const llxprtDir = path.join(os.homedir(), '.llxprt');
    const subagentsDir = path.join(llxprtDir, 'subagents');
    return new SubagentManager(subagentsDir, profileManager);
  }, [config, profileManager]);

  const [pendingItem, setPendingItem] = useState<HistoryItemWithoutId | null>(
    null,
  );

  const pendingHistoryItems = useMemo(() => {
    const items: HistoryItemWithoutId[] = [];
    if (pendingItem != null) {
      items.push(pendingItem);
    }
    return items;
  }, [pendingItem]);

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
          gcpProject: message.gcpProject,
          keyfile: message.keyfile || '',
          key: message.key || '',
          ideClient: message.ideClient,
          provider: message.provider || 'Unknown',
          baseURL: message.baseURL || '',
        };
      } else if (message.type === MessageType.HELP) {
        historyItemContent = {
          type: 'help',
          timestamp: message.timestamp,
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
      } else if (message.type === MessageType.CACHE_STATS) {
        historyItemContent = {
          type: 'cache_stats',
        };
      } else if (message.type === MessageType.LB_STATS) {
        historyItemContent = {
          type: 'lb_stats',
        };
      } else if (
        message.type === MessageType.INFO ||
        message.type === MessageType.ERROR ||
        message.type === MessageType.USER ||
        message.type === MessageType.WARNING
      ) {
        historyItemContent = {
          type: message.type,
          text: message.content || '',
        };
      } else if (message.type === MessageType.GEMINI) {
        historyItemContent = {
          type: 'cache_stats',
        };
      } else {
        // Fallback for unknown types - treat as info message
        historyItemContent = {
          type: MessageType.INFO,
          text: message.content || '',
        };
      }
      addItem(historyItemContent, message.timestamp.getTime());
    },
    [addItem],
  );
  /**
   * @plan PLAN-20260129-TODOPERSIST.P07
   * @requirement REQ-003, REQ-004, REQ-005, REQ-006
   * Added todoContext to CommandContext for /todo command integration
   */
  const commandContext = useMemo(
    (): CommandContext => ({
      services: {
        config,
        settings,
        git: gitService,
        logger,
        profileManager, // @plan:PLAN-20250117-SUBAGENTCONFIG.P15 @requirement:REQ-010
        subagentManager, // @plan:PLAN-20250117-SUBAGENTCONFIG.P15 @requirement:REQ-010
      },
      ui: {
        addItem,
        clear: () => {
          clearItems();
          if (!alternateBuffer) {
            console.clear();
          }
          refreshStatic();
        },
        loadHistory,
        setDebugMessage: actions.setDebugMessage,
        pendingItem,
        setPendingItem,
        toggleCorgiMode: actions.toggleCorgiMode,
        toggleDebugProfiler: actions.toggleDebugProfiler,
        toggleVimEnabled,
        setGeminiMdFileCount: setLlxprtMdFileCount,
        setLlxprtMdFileCount,
        updateHistoryTokenCount: session.updateHistoryTokenCount,
        reloadCommands,
        extensionsUpdateState,
        dispatchExtensionStateUpdate: actions.dispatchExtensionStateUpdate,
        addConfirmUpdateExtensionRequest:
          actions.addConfirmUpdateExtensionRequest,
      },
      session: {
        stats: session.stats,
        sessionShellAllowlist,
      },
      todoContext,
    }),
    [
      alternateBuffer,
      config,
      settings,
      gitService,
      logger,
      profileManager,
      subagentManager,
      loadHistory,
      addItem,
      clearItems,
      refreshStatic,
      session.stats,
      session.updateHistoryTokenCount,
      actions,
      pendingItem,
      setPendingItem,
      toggleVimEnabled,
      sessionShellAllowlist,
      setLlxprtMdFileCount,
      reloadCommands,
      extensionsUpdateState,
      todoContext,
    ],
  );

  useEffect(() => {
    if (!config) {
      return;
    }

    const listener = () => {
      reloadCommands();
    };

    (async () => {
      const ideClient = await IdeClient.getInstance();
      ideClient.addStatusChangeListener(listener);
    })();

    return () => {
      (async () => {
        const ideClient = await IdeClient.getInstance();
        ideClient.removeStatusChangeListener(listener);
      })();
    };
  }, [config, reloadCommands]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const loaders = [
          new McpPromptLoader(config),
          new BuiltinCommandLoader(config),
          new FileCommandLoader(config),
        ];
        const commandService = await CommandService.create(
          loaders,
          controller.signal,
        );
        if (controller.signal.aborted) {
          return;
        }
        setCommands(commandService.getCommands());
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        slashCommandLogger.error(
          () => 'Failed to initialize slash commands',
          error,
        );
        setCommands([]);
      }
    };

    void load();

    return () => {
      controller.abort();
    };
  }, [config, reloadTrigger, isConfigInitialized]);

  const handleSlashCommand = useCallback(
    async (
      rawQuery: PartListUnion,
      oneTimeShellAllowlist?: Set<string>,
      overwriteConfirmed?: boolean,
    ): Promise<SlashCommandProcessorResult | false> => {
      if (!commands) {
        return false;
      }
      if (typeof rawQuery !== 'string') {
        return false;
      }

      const trimmed = rawQuery.trim();
      if (!trimmed.startsWith('/') && !trimmed.startsWith('?')) {
        return false;
      }

      setIsProcessing(true);

      const userMessageTimestamp = Date.now();
      addItem({ type: MessageType.USER, text: trimmed }, userMessageTimestamp);

      let hasError = false;
      const { commandToExecute, args, canonicalPath } = parseSlashCommand(
        trimmed,
        commands,
      );

      // Extract subcommand from canonical path if present
      const subcommand =
        canonicalPath.length > 1 ? canonicalPath.slice(1).join(' ') : undefined;

      try {
        if (commandToExecute) {
          if (commandToExecute.action) {
            const fullCommandContext: CommandContext = {
              ...commandContext,
              invocation: {
                raw: trimmed,
                name: commandToExecute.name,
                args,
              },
              overwriteConfirmed,
            };

            // If a one-time list is provided for a "Proceed" action, temporarily
            // augment the session allowlist for this single execution.
            if (oneTimeShellAllowlist && oneTimeShellAllowlist.size > 0) {
              fullCommandContext.session = {
                ...fullCommandContext.session,
                sessionShellAllowlist: new Set([
                  ...fullCommandContext.session.sessionShellAllowlist,
                  ...oneTimeShellAllowlist,
                ]),
              };
            }
            const result = await commandToExecute.action(
              fullCommandContext,
              args,
            );

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
                    case 'auth':
                      actions.openAuthDialog();
                      return { type: 'handled' };
                    case 'theme':
                      actions.openThemeDialog();
                      return { type: 'handled' };
                    case 'editor':
                      actions.openEditorDialog();
                      return { type: 'handled' };
                    case 'privacy':
                      actions.openPrivacyNotice();
                      return { type: 'handled' };
                    case 'settings':
                      actions.openSettingsDialog();
                      return { type: 'handled' };
                    case 'logging':
                      if (
                        result.dialogData &&
                        typeof result.dialogData === 'object' &&
                        'entries' in result.dialogData
                      ) {
                        actions.openLoggingDialog(
                          result.dialogData as { entries: unknown[] },
                        );
                      } else {
                        actions.openLoggingDialog();
                      }
                      return { type: 'handled' };
                    case 'permissions':
                      actions.openPermissionsDialog();
                      return { type: 'handled' };
                    case 'provider':
                      actions.openProviderDialog();
                      return { type: 'handled' };
                    case 'loadProfile':
                      actions.openLoadProfileDialog();
                      return { type: 'handled' };
                    case 'createProfile':
                      actions.openCreateProfileDialog();
                      return { type: 'handled' };
                    case 'profileList':
                      slashCommandLogger.log(
                        () => 'opening profileList dialog',
                      );
                      actions.openProfileListDialog();
                      return { type: 'handled' };
                    case 'profileDetail':
                      if (
                        result.dialogData &&
                        typeof result.dialogData === 'object' &&
                        'profileName' in result.dialogData &&
                        typeof (result.dialogData as { profileName: unknown })
                          .profileName === 'string'
                      ) {
                        const profileName = (
                          result.dialogData as { profileName: string }
                        ).profileName;
                        slashCommandLogger.log(
                          () => `opening profileDetail for ${profileName}`,
                        );
                        // Pass true for openedDirectly since this came from /profile show
                        actions.viewProfileDetail(profileName, true);
                      }
                      return { type: 'handled' };
                    case 'profileEditor':
                      if (
                        result.dialogData &&
                        typeof result.dialogData === 'object' &&
                        'profileName' in result.dialogData &&
                        typeof (result.dialogData as { profileName: unknown })
                          .profileName === 'string'
                      ) {
                        const profileName = (
                          result.dialogData as { profileName: string }
                        ).profileName;
                        slashCommandLogger.log(
                          () => `opening profileEditor for ${profileName}`,
                        );
                        // Pass true for openedDirectly since this came from /profile edit
                        actions.openProfileEditor(profileName, true);
                      }
                      return { type: 'handled' };
                    case 'saveProfile':
                      return { type: 'handled' };
                    case 'subagent': {
                      // Type-safe access via discriminated union - dialogData is SubagentDialogData when dialog is 'subagent'
                      const subagentData = result.dialogData as
                        | SubagentDialogData
                        | undefined;
                      actions.openSubagentDialog(
                        subagentData?.initialView,
                        subagentData?.initialSubagentName,
                      );
                      return { type: 'handled' };
                    }
                    case 'models': {
                      // Type-safe access via discriminated union - dialogData is ModelsDialogData when dialog is 'models'
                      const modelsData = result.dialogData as
                        | ModelsDialogData
                        | undefined;
                      actions.openModelsDialog(modelsData);
                      return { type: 'handled' };
                    }
                    case 'welcome':
                      actions.openWelcomeDialog();
                      return { type: 'handled' };
                    default: {
                      const unhandled: never = result.dialog;
                      throw new Error(
                        `Unhandled slash command result: ${unhandled}`,
                      );
                    }
                  }
                case 'load_history': {
                  config?.getGeminiClient()?.setHistory(result.clientHistory);
                  fullCommandContext.ui.clear();
                  result.history.forEach((item, index) => {
                    fullCommandContext.ui.addItem(item, index);
                  });
                  return { type: 'handled' };
                }
                case 'quit':
                  actions.quit(result.messages);
                  return { type: 'handled' };

                case 'submit_prompt': {
                  // Convert PartListUnion to string
                  let contentString: string;
                  if (typeof result.content === 'string') {
                    contentString = result.content;
                  } else if (Array.isArray(result.content)) {
                    // Extract text from parts array
                    contentString = result.content
                      .map((part) => {
                        if (typeof part === 'string') {
                          return part;
                        }
                        if (
                          typeof part === 'object' &&
                          part !== null &&
                          'text' in part
                        ) {
                          return (part as { text?: string }).text || '';
                        }
                        return '';
                      })
                      .join('');
                  } else {
                    contentString = '';
                  }
                  return {
                    type: 'submit_prompt',
                    content: contentString,
                  };
                }
                case 'confirm_shell_commands': {
                  const { outcome, approvedCommands } = await new Promise<{
                    outcome: ToolConfirmationOutcome;
                    approvedCommands?: string[];
                  }>((resolve) => {
                    if (confirmationLogger.enabled) {
                      confirmationLogger.debug(
                        () =>
                          `Shell confirmation dialog opened for ${result.commandsToConfirm.length} command(s)`,
                      );
                    }
                    setShellConfirmationRequest({
                      commands: result.commandsToConfirm,
                      onConfirm: (
                        resolvedOutcome,
                        resolvedApprovedCommands,
                      ) => {
                        if (confirmationLogger.enabled) {
                          confirmationLogger.debug(
                            () =>
                              `Shell confirmation resolved outcome=${resolvedOutcome} approved=${resolvedApprovedCommands?.length}`,
                          );
                        }
                        setShellConfirmationRequest(null); // Close the dialog
                        resolve({
                          outcome: resolvedOutcome,
                          approvedCommands: resolvedApprovedCommands,
                        });
                      },
                    });
                  });

                  if (
                    outcome === ToolConfirmationOutcome.Cancel ||
                    !approvedCommands ||
                    approvedCommands.length === 0
                  ) {
                    return { type: 'handled' };
                  }

                  if (outcome === ToolConfirmationOutcome.ProceedAlways) {
                    setSessionShellAllowlist(
                      (prev) => new Set([...prev, ...approvedCommands]),
                    );
                  }

                  return await handleSlashCommand(
                    result.originalInvocation.raw,
                    // Pass the approved commands as a one-time grant for this execution.
                    new Set(approvedCommands),
                  );
                }
                case 'confirm_action': {
                  const { confirmed } = await new Promise<{
                    confirmed: boolean;
                  }>((resolve) => {
                    if (confirmationLogger.enabled) {
                      confirmationLogger.debug(
                        () => 'Confirmation dialog opened',
                      );
                    }
                    setConfirmationRequest({
                      prompt: result.prompt,
                      onConfirm: (resolvedConfirmed) => {
                        if (confirmationLogger.enabled) {
                          confirmationLogger.debug(
                            () =>
                              `Confirmation dialog resolved confirmed=${resolvedConfirmed}`,
                          );
                        }
                        setConfirmationRequest(null);
                        resolve({ confirmed: resolvedConfirmed });
                      },
                    });
                  });

                  if (!confirmed) {
                    addItem(
                      {
                        type: MessageType.INFO,
                        text: 'Operation cancelled.',
                      },
                      Date.now(),
                    );
                    return { type: 'handled' };
                  }

                  return await handleSlashCommand(
                    result.originalInvocation.raw,
                    undefined,
                    true,
                  );
                }
                default: {
                  const unhandled: never = result;
                  throw new Error(
                    `Unhandled slash command result: ${unhandled}`,
                  );
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
      } catch (e: unknown) {
        hasError = true;
        if (config && commandToExecute) {
          const event = new SlashCommandEvent(
            commandToExecute.name,
            subcommand,
          );
          logSlashCommand(config, event);
        }
        addItem(
          {
            type: MessageType.ERROR,
            text: e instanceof Error ? e.message : String(e),
          },
          Date.now(),
        );
        return { type: 'handled' };
      } finally {
        if (config && commandToExecute && !hasError) {
          const event = new SlashCommandEvent(
            commandToExecute.name,
            subcommand,
          );
          logSlashCommand(config, event);
        }
        setIsProcessing(false);
      }
    },
    [
      config,
      addItem,
      actions,
      commands,
      commandContext,
      addMessage,
      setShellConfirmationRequest,
      setSessionShellAllowlist,
      setIsProcessing,
      setConfirmationRequest,
    ],
  );

  return {
    handleSlashCommand,
    slashCommands: commands,
    pendingHistoryItems,
    commandContext,
    shellConfirmationRequest,
    confirmationRequest,
  };
};
