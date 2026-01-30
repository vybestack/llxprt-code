/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from 'react';
import type { Content, PartListUnion } from '@google/genai';
import type {
  HistoryItemWithoutId,
  HistoryItem,
  ConfirmationRequest,
} from '../types.js';
import type {
  Config,
  GitService,
  Logger,
  ProfileManager,
  SubagentManager,
  Todo,
} from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../../config/settings.js';
import type { OAuthManager } from '../../auth/oauth-manager.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { SessionStatsState } from '../contexts/SessionContext.js';
import type {
  ExtensionUpdateState,
  ExtensionUpdateAction,
} from '../state/extensions.js';
import type { CommandArgumentSchema } from './schema/types.js';
import type { SubagentView } from '../components/SubagentManagement/types.js';

// Grouped dependencies for clarity and easier mocking
export interface CommandContext {
  // Invocation properties for when commands are called.
  invocation?: {
    /** The raw, untrimmed input string from the user. */
    raw: string;
    /** The primary name of the command that was matched. */
    name: string;
    /** The arguments string that follows the command name. */
    args: string;
  };
  // Core services and configuration
  services: {
    // TODO(abhipatel12): Ensure that config is never null.
    config: Config | null;
    settings: LoadedSettings;
    git: GitService | undefined;
    logger: Logger;
    subagentManager?: SubagentManager;
    profileManager?: ProfileManager;
    oauthManager?: OAuthManager;
  };
  // UI state and history management
  ui: {
    /** Adds a new item to the history display. */
    addItem: UseHistoryManagerReturn['addItem'];
    /** Clears all history items and the console screen. */
    clear: () => void;
    /**
     * Sets the transient debug message displayed in the application footer in debug mode.
     */
    setDebugMessage: (message: string) => void;
    /** The currently pending history item, if any. */
    pendingItem: HistoryItemWithoutId | null;
    /**
     * Sets a pending item in the history, which is useful for indicating
     * that a long-running operation is in progress.
     *
     * @param item The history item to display as pending, or `null` to clear.
     */
    setPendingItem: (item: HistoryItemWithoutId | null) => void;
    /**
     * Loads a new set of history items, replacing the current history.
     *
     * @param history The array of history items to load.
     */
    loadHistory: UseHistoryManagerReturn['loadHistory'];
    /** Toggles a special display mode. */
    toggleCorgiMode: () => void;
    toggleDebugProfiler: () => void;
    toggleVimEnabled: () => Promise<boolean>;
    setGeminiMdFileCount: (count: number) => void;
    setLlxprtMdFileCount: (count: number) => void;
    updateHistoryTokenCount: (count: number) => void;
    reloadCommands: () => void;
    extensionsUpdateState: Map<string, ExtensionUpdateState>;
    dispatchExtensionStateUpdate: (action: ExtensionUpdateAction) => void;
    addConfirmUpdateExtensionRequest: (value: ConfirmationRequest) => void;
  };
  // Session-specific data
  session: {
    stats: SessionStatsState;
    /** A transient list of shell commands the user has approved for this session. */
    sessionShellAllowlist: Set<string>;
  };
  // TODO management
  /**
   * @plan PLAN-20260129-TODOPERSIST.P07
   * @requirement REQ-003, REQ-004, REQ-005, REQ-006
   */
  todoContext?: {
    todos: Todo[];
    updateTodos: (todos: Todo[]) => void;
    refreshTodos: () => void;
  };
  // Flag to indicate if an overwrite has been confirmed
  overwriteConfirmed?: boolean;
}

/**
 * The return type for a command action that results in scheduling a tool call.
 */
export interface ToolActionReturn {
  type: 'tool';
  toolName: string;
  toolArgs: Record<string, unknown>;
}

/** The return type for a command action that results in the app quitting. */
export interface QuitActionReturn {
  type: 'quit';
  messages: HistoryItem[];
}

/**
 * The return type for a command action that results in a simple message
 * being displayed to the user.
 */
export interface MessageActionReturn {
  type: 'message';
  messageType: 'info' | 'error';
  content: string;
}

/**
 * Type-safe dialog data for subagent dialog.
 * Maps to SubagentManagerDialogProps expected properties.
 */
export interface SubagentDialogData {
  /** Initial view to display in the subagent dialog */
  initialView?: SubagentView;
  /** Name of the subagent to pre-select */
  initialSubagentName?: string;
}

/**
 * Type-safe dialog data for logging dialog.
 */
export interface LoggingDialogData {
  entries: unknown[];
}

/**
 * Type-safe dialog data for models dialog.
 */
export interface ModelsDialogData {
  /** Pre-fill search term (from positional arg) */
  initialSearch?: string;
  /** Pre-set capability filters */
  initialFilters?: {
    tools?: boolean;
    vision?: boolean;
    reasoning?: boolean;
    audio?: boolean;
  };
  /** Include deprecated models */
  includeDeprecated?: boolean;
  /** Override provider filter from --provider arg */
  providerOverride?: string | null;
  /** Show all providers (from --all flag) */
  showAllProviders?: boolean;
}

/**
 * Type-safe dialog data for profile dialogs.
 */
export interface ProfileDialogData {
  /** Name of the profile to display/edit */
  profileName?: string;
}

/** All supported dialog types */
export type DialogType =
  | 'auth'
  | 'theme'
  | 'editor'
  | 'privacy'
  | 'settings'
  | 'logging'
  | 'permissions'
  | 'provider'
  | 'loadProfile'
  | 'createProfile'
  | 'saveProfile'
  | 'subagent'
  | 'models'
  | 'profileList'
  | 'profileDetail'
  | 'profileEditor'
  | 'welcome';

/** Map dialog types to their associated data types for type-safe access */
export interface DialogDataMap {
  subagent: SubagentDialogData;
  logging: LoggingDialogData;
  models: ModelsDialogData;
  profileDetail: ProfileDialogData;
  profileEditor: ProfileDialogData;
}

/**
 * The return type for a command action that needs to open a dialog.
 * Use SubagentDialogData for type-safe subagent dialog data.
 */
export interface OpenDialogActionReturn {
  type: 'dialog';
  dialog: DialogType;
  /**
   * Dialog-specific data. Type depends on dialog:
   * - 'subagent': SubagentDialogData
   * - 'logging': LoggingDialogData
   * - 'models': ModelsDialogData
   * - 'profileDetail'/'profileEditor': ProfileDialogData
   * - others: undefined
   */
  dialogData?:
    | SubagentDialogData
    | LoggingDialogData
    | ModelsDialogData
    | ProfileDialogData;
}

/**
 * The return type for a command action that results in replacing
 * the entire conversation history.
 */
export interface LoadHistoryActionReturn {
  type: 'load_history';
  history: HistoryItemWithoutId[];
  clientHistory: Content[]; // The history for the generative client
}

/**
 * The return type for a command action that should immediately submit
 * content as a prompt to the Gemini model.
 */
export interface SubmitPromptActionReturn {
  type: 'submit_prompt';
  content: PartListUnion;
}

/**
 * The return type for a command action that needs to pause and request
 * confirmation for a set of shell commands before proceeding.
 */
export interface ConfirmShellCommandsActionReturn {
  type: 'confirm_shell_commands';
  /** The list of shell commands that require user confirmation. */
  commandsToConfirm: string[];
  /** The original invocation context to be re-run after confirmation. */
  originalInvocation: {
    raw: string;
  };
}

export interface ConfirmActionReturn {
  type: 'confirm_action';
  /** The React node to display as the confirmation prompt. */
  prompt: ReactNode;
  /** The original invocation context to be re-run after confirmation. */
  originalInvocation: {
    raw: string;
  };
}

export type SlashCommandActionReturn =
  | ToolActionReturn
  | MessageActionReturn
  | QuitActionReturn
  | OpenDialogActionReturn
  | LoadHistoryActionReturn
  | SubmitPromptActionReturn
  | ConfirmShellCommandsActionReturn
  | ConfirmActionReturn;

export enum CommandKind {
  BUILT_IN = 'built-in',
  FILE = 'file',
  MCP_PROMPT = 'mcp-prompt',
  EXTENSION = 'extension',
}

// The standardized contract for any command in the system.
export interface SlashCommand {
  name: string;
  altNames?: string[];
  description: string;
  hidden?: boolean;

  kind: CommandKind;

  // Optional metadata for extension commands
  extensionName?: string;

  // The action to run. Optional for parent commands that only group sub-commands.
  action?: (
    context: CommandContext,
    args: string, // TODO: Remove args. CommandContext now contains the complete invocation.
  ) =>
    | void
    | SlashCommandActionReturn
    | Promise<void | SlashCommandActionReturn>;

  // Provides argument completion (e.g., completing a tag for `/chat resume <tag>`).
  completion?: (
    context: CommandContext,
    partialArg: string,
  ) => Promise<string[]>;

  // Schema-based argument specification for declarative completion
  schema?: CommandArgumentSchema;

  subCommands?: SlashCommand[];
}
