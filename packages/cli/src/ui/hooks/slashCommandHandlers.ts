/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PartListUnion } from '@google/genai';
import type {
  Config,
  RecordingIntegration,
  ToolCallConfirmationDetails,
} from '@vybestack/llxprt-code-core';
import {
  getProjectHash,
  logSlashCommand,
  MCPDiscoveryState,
  SlashCommandEvent,
  ToolConfirmationOutcome,
} from '@vybestack/llxprt-code-core';
import { join } from 'node:path';
import { parseSlashCommand } from '../../utils/commands.js';
import { secureInputHandler } from '../utils/secureInputHandler.js';
import { iContentToHistoryItems } from '../utils/iContentToHistoryItems.js';
import type {
  CommandContext,
  ModelsDialogData,
  SlashCommand,
  SubagentDialogData,
} from '../commands/types.js';
import type { RecordingSwapCallbacks } from '../../services/performResume.js';
import {
  performResume,
  type ResumeContext,
} from '../../services/performResume.js';
import type {
  HistoryItemWithoutId,
  IndividualToolCallDisplay,
  Message,
  SlashCommandProcessorResult,
} from '../types.js';
import { MessageType, ToolCallStatus } from '../types.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core';
import type { SlashCommandProcessorActions } from './slashCommandProcessor.js';

export interface SlashCommandHandlerDeps {
  commands: readonly SlashCommand[] | undefined;
  config: Config | null;
  commandContext: CommandContext;
  actions: SlashCommandProcessorActions;
  addItem: (item: HistoryItemWithoutId, timestamp: number) => void;
  addMessage: (message: Message) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  setLocalIsProcessing: (isProcessing: boolean) => void;
  setPendingItem: (item: HistoryItemWithoutId | null) => void;
  setSessionShellAllowlist: (
    updater: (prev: Set<string>) => Set<string>,
  ) => void;
  setConfirmationRequest: (
    request: {
      prompt: React.ReactNode;
      onConfirm: (confirmed: boolean) => void;
    } | null,
  ) => void;
  recordingIntegration?: RecordingIntegration;
  recordingSwapCallbacks?: RecordingSwapCallbacks;
  confirmationLogger: DebugLogger;
  slashCommandLogger: DebugLogger;
}

interface ParsedCommandState {
  trimmed: string;
  commandToExecute: SlashCommand | undefined;
  args: string;
  subcommand: string | undefined;
}

export async function processSlashCommand(
  deps: SlashCommandHandlerDeps,
  rawQuery: PartListUnion,
  oneTimeShellAllowlist?: Set<string>,
  overwriteConfirmed?: boolean,
  addToHistory: boolean = true,
): Promise<SlashCommandProcessorResult | false> {
  if (!deps.commands || typeof rawQuery !== 'string') {
    return false;
  }
  const trimmed = rawQuery.trim();
  if (!trimmed.startsWith('/') && !trimmed.startsWith('?')) {
    return false;
  }

  deps.setIsProcessing(true);
  deps.setLocalIsProcessing(true);
  if (addToHistory) {
    addUserCommandToHistory(deps, trimmed);
  }

  const parsed = parseCommand(trimmed, deps.commands);
  let hasError = false;
  try {
    return await executeParsedCommand(
      deps,
      parsed,
      oneTimeShellAllowlist,
      overwriteConfirmed,
    );
  } catch (error) {
    hasError = true;
    handleCommandError(deps, parsed, error);
    return { type: 'handled' };
  } finally {
    finalizeCommand(deps, parsed, hasError);
  }
}

function addUserCommandToHistory(
  deps: SlashCommandHandlerDeps,
  trimmed: string,
): void {
  const sanitizedCommand =
    trimmed.startsWith('/key ') || trimmed.startsWith('/toolkey ')
      ? secureInputHandler.sanitizeForHistory(trimmed)
      : trimmed;
  deps.addItem({ type: MessageType.USER, text: sanitizedCommand }, Date.now());
}

function parseCommand(
  trimmed: string,
  commands: readonly SlashCommand[],
): ParsedCommandState {
  const { commandToExecute, args, canonicalPath } = parseSlashCommand(
    trimmed,
    commands,
  );
  return {
    trimmed,
    commandToExecute,
    args,
    subcommand:
      canonicalPath.length > 1 ? canonicalPath.slice(1).join(' ') : undefined,
  };
}

async function executeParsedCommand(
  deps: SlashCommandHandlerDeps,
  parsed: ParsedCommandState,
  oneTimeShellAllowlist: Set<string> | undefined,
  overwriteConfirmed: boolean | undefined,
): Promise<SlashCommandProcessorResult | false> {
  const { commandToExecute } = parsed;
  if (commandToExecute?.action) {
    const context = buildInvocationContext(
      deps.commandContext,
      parsed,
      oneTimeShellAllowlist,
      overwriteConfirmed,
    );
    const result = await commandToExecute.action(context, parsed.args);
    return result
      ? handleActionResult(deps, context, result)
      : { type: 'handled' };
  }
  if (commandToExecute?.subCommands) {
    addSubcommandHelp(deps, commandToExecute);
    return { type: 'handled' };
  }
  addUnknownCommandMessage(deps, parsed.trimmed);
  return { type: 'handled' };
}

function buildInvocationContext(
  baseContext: CommandContext,
  parsed: ParsedCommandState,
  oneTimeShellAllowlist: Set<string> | undefined,
  overwriteConfirmed: boolean | undefined,
): CommandContext {
  const fullCommandContext: CommandContext = {
    ...baseContext,
    invocation: {
      raw: parsed.trimmed,
      name: parsed.commandToExecute?.name ?? '',
      args: parsed.args,
    },
    overwriteConfirmed,
  };
  if (oneTimeShellAllowlist && oneTimeShellAllowlist.size > 0) {
    fullCommandContext.session = {
      ...fullCommandContext.session,
      sessionShellAllowlist: new Set([
        ...fullCommandContext.session.sessionShellAllowlist,
        ...oneTimeShellAllowlist,
      ]),
    };
  }
  return fullCommandContext;
}

type ActionResult = Exclude<
  Awaited<ReturnType<NonNullable<SlashCommand['action']>>>,
  void
>;

async function handleActionResult(
  deps: SlashCommandHandlerDeps,
  context: CommandContext,
  result: ActionResult,
): Promise<SlashCommandProcessorResult | false> {
  switch (result.type) {
    case 'tool':
      return {
        type: 'schedule_tool',
        toolName: result.toolName,
        toolArgs: result.toolArgs,
      };
    case 'message':
      return handleMessageResult(deps, result);
    case 'dialog':
      return handleDialogResult(deps, result);
    case 'load_history':
      return handleLoadHistoryResult(context, result);
    case 'quit':
      deps.actions.quit(result.messages);
      return { type: 'handled' };
    case 'submit_prompt':
      return {
        type: 'submit_prompt',
        content: stringifyPrompt(result.content),
      };
    case 'confirm_shell_commands':
      return confirmShellCommands(deps, result);
    case 'confirm_action':
      return confirmAction(deps, result);
    case 'perform_resume':
      return performSessionResume(deps, context, result.sessionRef);
    default: {
      const unhandled: never = result;
      throw new Error(`Unhandled slash command result: ${unhandled}`);
    }
  }
}

function handleMessageResult(
  deps: SlashCommandHandlerDeps,
  result: Extract<ActionResult, { type: 'message' }>,
): SlashCommandProcessorResult {
  deps.addItem(
    {
      type:
        result.messageType === 'error' ? MessageType.ERROR : MessageType.INFO,
      text: result.content,
    },
    Date.now(),
  );
  if (result.messageType === 'error') {
    deps.recordingIntegration?.recordSessionEvent('error', result.content);
  }
  return { type: 'handled' };
}

function handleDialogResult(
  deps: SlashCommandHandlerDeps,
  result: Extract<ActionResult, { type: 'dialog' }>,
): SlashCommandProcessorResult {
  const simpleDialogActions = buildSimpleDialogActions(deps);
  const action = simpleDialogActions[result.dialog];
  if (action !== undefined) {
    action(result.dialogData);
    return { type: 'handled' };
  }
  throw new Error(`Unhandled slash command dialog: ${result.dialog}`);
}

type DialogResult = Extract<ActionResult, { type: 'dialog' }>;
type DialogName = DialogResult['dialog'];
type DialogActionMap = Partial<Record<DialogName, (data: unknown) => void>>;

function buildSimpleDialogActions(
  deps: SlashCommandHandlerDeps,
): DialogActionMap {
  const actions = deps.actions;
  return {
    auth: () => actions.openAuthDialog(),
    theme: () => actions.openThemeDialog(),
    editor: () => actions.openEditorDialog(),
    privacy: () => actions.openPrivacyNotice(),
    settings: () => actions.openSettingsDialog(),
    logging: (data) => openLoggingDialog(actions, data),
    permissions: () => actions.openPermissionsDialog(),
    provider: () => actions.openProviderDialog(),
    loadProfile: () => actions.openLoadProfileDialog(),
    createProfile: () => actions.openCreateProfileDialog(),
    profileList: () => {
      deps.slashCommandLogger.log(() => 'opening profileList dialog');
      actions.openProfileListDialog();
    },
    profileDetail: (data) => openProfileDetail(deps, data),
    profileEditor: (data) => openProfileEditor(deps, data),
    saveProfile: () => undefined,
    subagent: (data) => openSubagentDialog(actions, data),
    models: (data) =>
      actions.openModelsDialog(data as ModelsDialogData | undefined),
    welcome: () => actions.openWelcomeDialog(),
    sessionBrowser: () => actions.openSessionBrowserDialog(),
  };
}

function openLoggingDialog(
  actions: SlashCommandProcessorActions,
  dialogData: unknown,
): void {
  if (
    dialogData != null &&
    typeof dialogData === 'object' &&
    'entries' in dialogData
  ) {
    actions.openLoggingDialog(dialogData as { entries: unknown[] });
  } else {
    actions.openLoggingDialog();
  }
}

function readProfileName(dialogData: unknown): string | undefined {
  if (
    dialogData != null &&
    typeof dialogData === 'object' &&
    'profileName' in dialogData &&
    typeof (dialogData as { profileName: unknown }).profileName === 'string'
  ) {
    return (dialogData as { profileName: string }).profileName;
  }
  return undefined;
}

function openProfileDetail(
  deps: SlashCommandHandlerDeps,
  dialogData: unknown,
): void {
  const profileName = readProfileName(dialogData);
  if (profileName === undefined) {
    return;
  }
  deps.slashCommandLogger.log(() => `opening profileDetail for ${profileName}`);
  deps.actions.viewProfileDetail(profileName, true);
}

function openProfileEditor(
  deps: SlashCommandHandlerDeps,
  dialogData: unknown,
): void {
  const profileName = readProfileName(dialogData);
  if (profileName === undefined) {
    return;
  }
  deps.slashCommandLogger.log(() => `opening profileEditor for ${profileName}`);
  deps.actions.openProfileEditor(profileName, true);
}

function openSubagentDialog(
  actions: SlashCommandProcessorActions,
  dialogData: unknown,
): void {
  const subagentData = dialogData as SubagentDialogData | undefined;
  actions.openSubagentDialog(
    subagentData?.initialView,
    subagentData?.initialSubagentName,
  );
}

function handleLoadHistoryResult(
  context: CommandContext,
  result: Extract<ActionResult, { type: 'load_history' }>,
): SlashCommandProcessorResult {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  context.services.config?.getGeminiClient().setHistory(result.clientHistory);
  context.ui.clear();
  result.history.forEach((item, index) => {
    context.ui.addItem(item, index);
  });
  return { type: 'handled' };
}

function stringifyPrompt(content: PartListUnion): string {
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
        return (part as { text?: string }).text ?? '';
      }
      return '';
    })
    .join('');
}

async function confirmShellCommands(
  deps: SlashCommandHandlerDeps,
  result: Extract<ActionResult, { type: 'confirm_shell_commands' }>,
): Promise<SlashCommandProcessorResult | false> {
  const { outcome, approvedCommands } = await requestShellConfirmation(
    deps,
    result.commandsToConfirm,
  );
  deps.setPendingItem(null);
  if (
    outcome === ToolConfirmationOutcome.Cancel ||
    !approvedCommands ||
    approvedCommands.length === 0
  ) {
    deps.addItem(
      {
        type: MessageType.INFO,
        text: 'Slash command shell execution declined.',
      },
      Date.now(),
    );
    return { type: 'handled' };
  }
  if (outcome === ToolConfirmationOutcome.ProceedAlways) {
    deps.setSessionShellAllowlist(
      (prev) => new Set([...prev, ...approvedCommands]),
    );
  }
  return processSlashCommand(
    deps,
    result.originalInvocation.raw,
    new Set(approvedCommands),
    undefined,
    false,
  );
}

function requestShellConfirmation(
  deps: SlashCommandHandlerDeps,
  commandsToConfirm: string[],
): Promise<{ outcome: ToolConfirmationOutcome; approvedCommands?: string[] }> {
  return new Promise((resolve) => {
    if (deps.confirmationLogger.enabled) {
      deps.confirmationLogger.debug(
        () =>
          `Shell confirmation dialog opened for ${commandsToConfirm.length} command(s)`,
      );
    }
    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'exec',
      title: `Confirm Shell Expansion`,
      command: commandsToConfirm[0] || '',
      rootCommand: commandsToConfirm[0] || '',
      rootCommands: commandsToConfirm,
      commands: commandsToConfirm,
      onConfirm: async (resolvedOutcome) => {
        if (deps.confirmationLogger.enabled) {
          deps.confirmationLogger.debug(
            () => `Shell confirmation resolved outcome=${resolvedOutcome}`,
          );
        }
        resolve({
          outcome: resolvedOutcome,
          approvedCommands:
            resolvedOutcome === ToolConfirmationOutcome.Cancel
              ? []
              : commandsToConfirm,
        });
      },
    };
    deps.setPendingItem({
      type: 'tool_group',
      tools: [buildShellConfirmationDisplay(confirmationDetails)],
    });
  });
}

function buildShellConfirmationDisplay(
  confirmationDetails: ToolCallConfirmationDetails,
): IndividualToolCallDisplay {
  return {
    callId: `expansion-${Date.now()}`,
    name: 'Expansion',
    description: 'Command expansion needs shell access',
    status: ToolCallStatus.Confirming,
    resultDisplay: undefined,
    confirmationDetails,
  };
}

async function confirmAction(
  deps: SlashCommandHandlerDeps,
  result: Extract<ActionResult, { type: 'confirm_action' }>,
): Promise<SlashCommandProcessorResult | false> {
  const { confirmed } = await new Promise<{ confirmed: boolean }>((resolve) => {
    if (deps.confirmationLogger.enabled) {
      deps.confirmationLogger.debug(() => 'Confirmation dialog opened');
    }
    deps.setConfirmationRequest({
      prompt: result.prompt,
      onConfirm: (resolvedConfirmed) => {
        if (deps.confirmationLogger.enabled) {
          deps.confirmationLogger.debug(
            () => `Confirmation dialog resolved confirmed=${resolvedConfirmed}`,
          );
        }
        deps.setConfirmationRequest(null);
        resolve({ confirmed: resolvedConfirmed });
      },
    });
  });

  if (!confirmed) {
    deps.addItem(
      { type: MessageType.INFO, text: 'Operation cancelled.' },
      Date.now(),
    );
    return { type: 'handled' };
  }
  return processSlashCommand(
    deps,
    result.originalInvocation.raw,
    undefined,
    true,
  );
}

async function performSessionResume(
  deps: SlashCommandHandlerDeps,
  context: CommandContext,
  sessionRef: string,
): Promise<SlashCommandProcessorResult> {
  if (!deps.config) {
    deps.addMessage({
      type: MessageType.ERROR,
      content: 'Cannot resume session: configuration not available.',
      timestamp: new Date(),
    });
    return { type: 'handled' };
  }
  if (!deps.recordingSwapCallbacks) {
    deps.addMessage({
      type: MessageType.ERROR,
      content: 'Cannot resume session: recording infrastructure not available.',
      timestamp: new Date(),
    });
    return { type: 'handled' };
  }

  const resumeResult = await performResume(
    sessionRef,
    buildResumeContext(deps, deps.config),
  );
  if (!resumeResult.ok) {
    deps.addMessage({
      type: MessageType.ERROR,
      content: resumeResult.error,
      timestamp: new Date(),
    });
    return { type: 'handled' };
  }

  for (const warning of resumeResult.warnings) {
    deps.addMessage({
      type: MessageType.INFO,
      content: `Warning: ${warning}`,
      timestamp: new Date(),
    });
  }
  await deps.config.getGeminiClient().restoreHistory(resumeResult.history);
  const uiHistory = iContentToHistoryItems(resumeResult.history);
  context.ui.clear();
  uiHistory.forEach((item, index) => {
    context.ui.addItem(item, index);
  });
  return { type: 'handled' };
}

function buildResumeContext(
  deps: SlashCommandHandlerDeps,
  config: Config,
): ResumeContext {
  return {
    chatsDir: join(config.storage.getProjectTempDir(), 'chats'),
    projectHash: getProjectHash(config.getProjectRoot()),
    currentSessionId: config.getSessionId(),
    currentProvider: config.getProvider() ?? 'unknown',
    currentModel: config.getModel(),
    workspaceDirs: [...config.getWorkspaceContext().getDirectories()],
    recordingCallbacks: deps.recordingSwapCallbacks!,
    logger: deps.slashCommandLogger,
  };
}

function addSubcommandHelp(
  deps: SlashCommandHandlerDeps,
  command: SlashCommand,
): void {
  const helpText = `Command '/${command.name}' requires a subcommand. Available:\n${command.subCommands
    ?.map((sc) => `  - ${sc.name}: ${sc.description || ''}`)
    .join('\n')}`;
  deps.addMessage({
    type: MessageType.INFO,
    content: helpText,
    timestamp: new Date(),
  });
}

function addUnknownCommandMessage(
  deps: SlashCommandHandlerDeps,
  trimmed: string,
): void {
  const isMcpLoading =
    deps.config?.getMcpClientManager()?.getDiscoveryState() ===
    MCPDiscoveryState.IN_PROGRESS;
  deps.addMessage({
    type: MessageType.ERROR,
    content: isMcpLoading
      ? `Unknown command: ${trimmed}. Command might have been from an MCP server but MCP servers are not done loading.`
      : `Unknown command: ${trimmed}`,
    timestamp: new Date(),
  });
}

function handleCommandError(
  deps: SlashCommandHandlerDeps,
  parsed: ParsedCommandState,
  error: unknown,
): void {
  if (deps.config && parsed.commandToExecute) {
    logParsedCommand(deps, parsed);
  }
  const errorText = error instanceof Error ? error.message : String(error);
  deps.addItem({ type: MessageType.ERROR, text: errorText }, Date.now());
  deps.recordingIntegration?.recordSessionEvent('error', errorText);
}

function finalizeCommand(
  deps: SlashCommandHandlerDeps,
  parsed: ParsedCommandState,
  hasError: boolean,
): void {
  if (deps.config && parsed.commandToExecute && !hasError) {
    logParsedCommand(deps, parsed);
  }
  deps.setIsProcessing(false);
  deps.setLocalIsProcessing(false);
}

function logParsedCommand(
  deps: SlashCommandHandlerDeps,
  parsed: ParsedCommandState,
): void {
  const event = new SlashCommandEvent(
    parsed.commandToExecute?.name ?? '',
    parsed.subcommand,
  );
  logSlashCommand(deps.config!, event);
}
