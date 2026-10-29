/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  RecordingIntegration,
  ToolCallConfirmationDetails,
  AgentRequestInput,
} from '@vybestack/llxprt-code-core';
import type { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-core';
import { SlashCommandEvent } from '@vybestack/llxprt-code-telemetry';
import { parseSlashCommand } from '../../utils/commands.js';
import { secureInputHandler } from '../utils/secureInputHandler.js';
import type {
  CommandContext,
  ModelsDialogData,
  PerformResumeActionReturn,
  SlashCommand,
  SubagentDialogData,
} from '../commands/types.js';
import type { PerformResumeResult } from '../../services/performResume.js';

import type {
  HistoryItemWithoutId,
  IndividualToolCallDisplay,
  Message,
  SlashCommandProcessorResult,
} from '../types.js';
import { MessageType, ToolCallStatus } from '../types.js';
import { stringifyPrompt } from './slash-command-messages.js';
import type { SlashCommandProcessorActions } from './slashCommandProcessor.js';
import { SubagentView } from '../components/SubagentManagement/types.js';
import type { DialogRequest } from '../stores/dialog/dialogStore.js';

/**
 * Slash-command telemetry sink. The handlers only ever log a command event and
 * use the port's presence to decide whether logging is available.
 */
export interface CommandLoggingPort {
  logSlashCommand(event: SlashCommandEvent): void;
}

export interface SlashCommandHandlerDeps {
  writeOutput: (item: HistoryItemWithoutId) => Promise<void>;
  commands: readonly SlashCommand[] | undefined;
  config: CommandLoggingPort | null;
  commandContext: CommandContext;
  resumeOwnedSession:
    | ((action: PerformResumeActionReturn) => Promise<readonly string[]>)
    | null;
  resumeRawSession:
    | ((action: PerformResumeActionReturn) => Promise<PerformResumeResult>)
    | null;
  refreshResumedHistory: () => void;
  recordCommandError: (message: string) => Promise<void>;
  isMcpDiscoveryPending: () => boolean;
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
    request: Extract<DialogRequest, { kind: 'confirmation' }> | null,
  ) => void;
  recordingIntegration?: RecordingIntegration;
  confirmationLogger: DebugLogger;
  slashCommandLogger: DebugLogger;
  /** Registers the action about to be awaited and returns its controller. */
  beginSlashCommandAction: () => AbortController;
  /** Deregisters an action once it has settled. */
  endSlashCommandAction: (controller: AbortController) => void;
}

interface ParsedCommandState {
  trimmed: string;
  commandToExecute: SlashCommand | undefined;
  args: string;
  subcommand: string | undefined;
}

export async function processSlashCommand(
  deps: SlashCommandHandlerDeps,
  rawQuery: AgentRequestInput,
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
    await addUserCommandToHistory(deps, trimmed);
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
    await handleCommandError(deps, parsed, error);
    return { type: 'handled' };
  } finally {
    finalizeCommand(deps, parsed, hasError);
  }
}

async function addUserCommandToHistory(
  deps: SlashCommandHandlerDeps,
  trimmed: string,
): Promise<void> {
  const sanitizedCommand = secureInputHandler.shouldUseSecureMode(trimmed)
    ? secureInputHandler.sanitizeForHistory(trimmed)
    : trimmed;
  await deps.writeOutput({ type: MessageType.USER, text: sanitizedCommand });
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
    const outcome = await runCommandAction(
      deps,
      commandToExecute.action,
      parsed,
      (signal) =>
        buildInvocationContext(
          deps.commandContext,
          parsed,
          oneTimeShellAllowlist,
          overwriteConfirmed,
          signal,
        ),
    );
    if (outcome.cancelled) return { type: 'handled' };
    return outcome.result
      ? handleActionResult(deps, outcome.context, outcome.result)
      : { type: 'handled' };
  }
  if (commandToExecute?.subCommands) {
    await addSubcommandHelp(deps, commandToExecute);
    return { type: 'handled' };
  }
  await addUnknownCommandMessage(deps, parsed.trimmed);
  return { type: 'handled' };
}

type CommandAction = NonNullable<SlashCommand['action']>;

type CommandActionOutcome =
  | { cancelled: true; context?: undefined; result?: undefined }
  | {
      cancelled: false;
      context: CommandContext;
      result: Awaited<ReturnType<CommandAction>>;
    };

/**
 * Awaits the action while it is registered as cancellable.
 *
 * Once the invocation is aborted its outcome is discarded either way. A
 * rejection is the expected shape of "the user pressed Esc" and must not also
 * surface as a command error; a resolution is a command that noticed the abort
 * and unwound cleanly, and acting on its result would carry out work the user
 * just cancelled (for example submitting a prompt built from a shell injection
 * that was killed mid-flight).
 *
 * Context construction happens inside the try so that every registration has a
 * matching deregistration even if building it throws.
 */
async function runCommandAction(
  deps: SlashCommandHandlerDeps,
  action: CommandAction,
  parsed: ParsedCommandState,
  buildContext: (signal: AbortSignal) => CommandContext,
): Promise<CommandActionOutcome> {
  const controller = deps.beginSlashCommandAction();
  try {
    const context = buildContext(controller.signal);
    const result = await action(context, parsed.args);
    if (controller.signal.aborted) {
      logDiscarded(deps, parsed, 'result', undefined);
      return { cancelled: true };
    }
    return { cancelled: false, context, result };
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    // The discard is intentional, but an unrelated failure can land in the same
    // window, so leave a trace rather than losing it entirely.
    logDiscarded(deps, parsed, 'error', error);
    return { cancelled: true };
  } finally {
    deps.endSlashCommandAction(controller);
  }
}

function logDiscarded(
  deps: SlashCommandHandlerDeps,
  parsed: ParsedCommandState,
  kind: 'result' | 'error',
  error: unknown,
): void {
  deps.slashCommandLogger.debug(() => {
    const detail = kind === 'error' ? `: ${describeError(error)}` : '';
    return `discarded ${kind} from cancelled ${parsed.trimmed}${detail}`;
  });
}

function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    const failures: readonly unknown[] = error.errors;
    return `${error.message}: ${failures.map(describeError).join('; ')}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function buildInvocationContext(
  baseContext: CommandContext,
  parsed: ParsedCommandState,
  oneTimeShellAllowlist: Set<string> | undefined,
  overwriteConfirmed: boolean | undefined,
  signal: AbortSignal,
): CommandContext {
  const fullCommandContext: CommandContext = {
    ...baseContext,
    signal,
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
      return performSessionResume(deps, result);
    default: {
      const unhandled: never = result;
      throw new Error(`Unhandled slash command result: ${unhandled}`);
    }
  }
}

async function handleMessageResult(
  deps: SlashCommandHandlerDeps,
  result: Extract<ActionResult, { type: 'message' }>,
): Promise<SlashCommandProcessorResult> {
  await deps.writeOutput({
    type: result.messageType === 'error' ? MessageType.ERROR : MessageType.INFO,
    text: result.content,
  });
  if (result.messageType === 'error') {
    await deps.recordCommandError(result.content);
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
    policies: () => actions.openPoliciesDialog(),
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
    models: (data) => actions.openModelsDialog(readModelsDialogData(data)),
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
    actions.openLoggingDialog({
      entries: Array.isArray(dialogData.entries) ? dialogData.entries : [],
    });
  } else {
    actions.openLoggingDialog();
  }
}

function readProfileName(dialogData: unknown): string | undefined {
  if (
    dialogData != null &&
    typeof dialogData === 'object' &&
    'profileName' in dialogData &&
    typeof dialogData.profileName === 'string'
  ) {
    return dialogData.profileName;
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
  const subagentData = readSubagentDialogData(dialogData);
  actions.openSubagentDialog(
    subagentData?.initialView,
    subagentData?.initialSubagentName,
  );
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
      kind: 'confirmation',
      payload: {
        prompt: result.prompt,
        onConfirm: (resolvedConfirmed) => {
          if (deps.confirmationLogger.enabled) {
            deps.confirmationLogger.debug(
              () =>
                `Confirmation dialog resolved confirmed=${resolvedConfirmed}`,
            );
          }
          deps.setConfirmationRequest(null);
          resolve({ confirmed: resolvedConfirmed });
        },
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

async function performOwnerSessionResume(
  deps: SlashCommandHandlerDeps,
  action: PerformResumeActionReturn,
  resume: NonNullable<SlashCommandHandlerDeps['resumeOwnedSession']>,
): Promise<SlashCommandProcessorResult> {
  const replay = resume(action);
  try {
    for (const warning of await replay)
      await deps.writeOutput({
        type: MessageType.INFO,
        text: `Warning: ${warning}`,
      });
  } catch (error) {
    deps.addMessage({
      type: MessageType.ERROR,
      content: describeError(error),
      timestamp: new Date(),
    });
  }
  return { type: 'handled' };
}

async function performSessionResume(
  deps: SlashCommandHandlerDeps,
  action: PerformResumeActionReturn,
): Promise<SlashCommandProcessorResult> {
  if (!deps.config) {
    deps.addMessage({
      type: MessageType.ERROR,
      content: 'Cannot resume session: configuration not available.',
      timestamp: new Date(),
    });
    return { type: 'handled' };
  }
  if (deps.resumeOwnedSession !== null) {
    return performOwnerSessionResume(deps, action, deps.resumeOwnedSession);
  }
  if (deps.resumeRawSession === null) {
    deps.addMessage({
      type: MessageType.ERROR,
      content: 'Cannot resume session: recording infrastructure not available.',
      timestamp: new Date(),
    });
    return { type: 'handled' };
  }

  const pendingResume = deps.resumeRawSession(action);
  let resumeResult: PerformResumeResult;
  try {
    resumeResult = await pendingResume;
  } catch (error: unknown) {
    deps.addMessage({
      type: MessageType.ERROR,
      content: describeError(error),
      timestamp: new Date(),
    });
    return { type: 'handled' };
  }
  if (!resumeResult.ok) {
    deps.addMessage({
      type: MessageType.ERROR,
      content: resumeResult.error,
      timestamp: new Date(),
    });
    return { type: 'handled' };
  }

  deps.refreshResumedHistory();
  for (const warning of resumeResult.warnings)
    await deps.writeOutput({
      type: MessageType.INFO,
      text: `Warning: ${warning}`,
    });
  return { type: 'handled' };
}

async function addSubcommandHelp(
  deps: SlashCommandHandlerDeps,
  command: SlashCommand,
): Promise<void> {
  const helpText = `Command '/${command.name}' requires a subcommand. Available:\n${command.subCommands
    ?.map((sc) => `  - ${sc.name}: ${sc.description || ''}`)
    .join('\n')}`;
  await deps.writeOutput({ type: MessageType.INFO, text: helpText });
}

async function addUnknownCommandMessage(
  deps: SlashCommandHandlerDeps,
  trimmed: string,
): Promise<void> {
  const isMcpLoading = deps.isMcpDiscoveryPending();
  await deps.writeOutput({
    type: MessageType.ERROR,
    text: isMcpLoading
      ? `Unknown command: ${trimmed}. Command might have been from an MCP server but MCP servers are not done loading.`
      : `Unknown command: ${trimmed}`,
  });
}

async function handleCommandError(
  deps: SlashCommandHandlerDeps,
  parsed: ParsedCommandState,
  error: unknown,
): Promise<void> {
  if (deps.config && parsed.commandToExecute) {
    logParsedCommand(deps, parsed);
  }
  const errorText = error instanceof Error ? error.message : String(error);
  await deps.writeOutput({ type: MessageType.ERROR, text: errorText });
  await deps.recordCommandError(errorText);
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
  deps.config!.logSlashCommand(event);
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || typeof value === 'string') return value;
  throw new Error('Expected a string');
}
function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') return value;
  throw new Error('Expected a boolean');
}
function readModelsFilters(value: unknown): ModelsDialogData['initialFilters'] {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null)
    throw new Error('Invalid model filters');
  return {
    tools: optionalBoolean('tools' in value ? value.tools : undefined),
    vision: optionalBoolean('vision' in value ? value.vision : undefined),
    reasoning: optionalBoolean(
      'reasoning' in value ? value.reasoning : undefined,
    ),
    audio: optionalBoolean('audio' in value ? value.audio : undefined),
  };
}
function readModelsDialogData(data: unknown): ModelsDialogData | undefined {
  if (data === undefined) return undefined;
  if (typeof data !== 'object' || data === null)
    throw new Error('Invalid models dialog data');
  const provider =
    'providerOverride' in data ? data.providerOverride : undefined;
  return {
    initialSearch: optionalString(
      'initialSearch' in data ? data.initialSearch : undefined,
    ),
    includeDeprecated: optionalBoolean(
      'includeDeprecated' in data ? data.includeDeprecated : undefined,
    ),
    providerOverride: provider === null ? null : optionalString(provider),
    showAllProviders: optionalBoolean(
      'showAllProviders' in data ? data.showAllProviders : undefined,
    ),
    initialFilters: readModelsFilters(
      'initialFilters' in data ? data.initialFilters : undefined,
    ),
  };
}
function readSubagentDialogData(data: unknown): SubagentDialogData | undefined {
  if (data === undefined) return undefined;
  if (typeof data !== 'object' || data === null)
    throw new Error('Invalid subagent dialog data');
  const initialView = 'initialView' in data ? data.initialView : undefined;
  const initialSubagentName =
    'initialSubagentName' in data ? data.initialSubagentName : undefined;
  if (
    initialSubagentName !== undefined &&
    typeof initialSubagentName !== 'string'
  )
    throw new Error('Invalid subagent name');
  if (initialView !== undefined && !isSubagentView(initialView))
    throw new Error('Invalid subagent view');
  return { initialView, initialSubagentName };
}
function isSubagentView(value: unknown): value is SubagentView {
  return Object.values(SubagentView).some((view) => view === value);
}
