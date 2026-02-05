/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CompressionStatus,
  GeminiCLIExtension,
  ToolCallConfirmationDetails,
  ToolResultDisplay,
  type ThinkingBlock,
} from '@vybestack/llxprt-code-core';

// Only defining the state enum needed by the UI
export enum StreamingState {
  Idle = 'idle',
  Responding = 'responding',
  WaitingForConfirmation = 'waiting_for_confirmation',
}

// Copied from server/src/core/turn.ts for CLI usage
export enum GeminiEventType {
  Content = 'content',
  ToolCallRequest = 'tool_call_request',
  // Add other event types if the UI hook needs to handle them
}

export enum ToolCallStatus {
  Pending = 'Pending',
  Canceled = 'Canceled',
  Confirming = 'Confirming',
  Executing = 'Executing',
  Success = 'Success',
  Error = 'Error',
}

export interface ToolCallEvent {
  type: 'tool_call';
  status: ToolCallStatus;
  callId: string;
  name: string;
  args: Record<string, never>;
  resultDisplay: ToolResultDisplay | undefined;
  confirmationDetails: ToolCallConfirmationDetails | undefined;
}

export interface IndividualToolCallDisplay {
  callId: string;
  name: string;
  description: string;
  resultDisplay: ToolResultDisplay | undefined;
  status: ToolCallStatus;
  confirmationDetails: ToolCallConfirmationDetails | undefined;
  renderOutputAsMarkdown?: boolean;
  isFocused?: boolean;
  ptyId?: number;
}

export interface CompressionProps {
  isPending: boolean;
  originalTokenCount: number | null;
  newTokenCount: number | null;
  compressionStatus: CompressionStatus | null;
}

export interface HistoryItemBase {
  text?: string; // Text content for user/gemini/info/error messages
}

export type HistoryItemUser = HistoryItemBase & {
  type: 'user';
  text: string;
};

export type HistoryItemGemini = HistoryItemBase & {
  type: 'gemini';
  text: string;
  model?: string;
  thinkingBlocks?: ThinkingBlock[]; // @plan:PLAN-20251202-THINKING-UI.P06
};

export type HistoryItemGeminiContent = HistoryItemBase & {
  type: 'gemini_content';
  text: string;
  model?: string;
  thinkingBlocks?: ThinkingBlock[]; // @plan:PLAN-20251202-THINKING-UI.P06
};

export type HistoryItemOAuthURL = HistoryItemBase & {
  type: 'oauth_url';
  text: string;
  url: string;
};

export type HistoryItemInfo = HistoryItemBase & {
  type: 'info';
  text: string;
  icon?: string; // Custom prefix (default: 'ℹ ')
  color?: string; // Custom color (default: theme.status.warning)
};

export type HistoryItemError = HistoryItemBase & {
  type: 'error';
  text: string;
};

export type HistoryItemWarning = HistoryItemBase & {
  type: 'warning';
  text: string;
};

export type HistoryItemAbout = HistoryItemBase & {
  type: 'about';
  cliVersion: string;
  osVersion: string;
  sandboxEnv: string;
  modelVersion: string;
  gcpProject: string;
  /**
   * Path to the configured keyfile for the active provider. Empty string if none.
   */
  keyfile: string;
  /**
   * "active" when an API key is configured for the active provider, otherwise empty string.
   */
  key: string;
  ideClient: string;
  provider: string;
  baseURL: string;
};

export type HistoryItemHelp = HistoryItemBase & {
  type: 'help';
  timestamp: Date;
};

export type HistoryItemStats = HistoryItemBase & {
  type: 'stats';
  duration: string;
};

export type HistoryItemModelStats = HistoryItemBase & {
  type: 'model_stats';
};

export type HistoryItemToolStats = HistoryItemBase & {
  type: 'tool_stats';
};

export type HistoryItemCacheStats = HistoryItemBase & {
  type: 'cache_stats';
};

export type HistoryItemLBStats = HistoryItemBase & {
  type: 'lb_stats';
};

export type HistoryItemQuit = HistoryItemBase & {
  type: 'quit';
  duration: string;
};

export type HistoryItemToolGroup = HistoryItemBase & {
  type: 'tool_group';
  agentId?: string;
  tools: IndividualToolCallDisplay[];
};

export type HistoryItemUserShell = HistoryItemBase & {
  type: 'user_shell';
  text: string;
};

export type HistoryItemCompression = HistoryItemBase & {
  type: 'compression';
  compression: CompressionProps;
};

export type HistoryItemExtensionsList = HistoryItemBase & {
  type: 'extensions_list';
  extensions: GeminiCLIExtension[];
};

export interface ChatDetail {
  name: string;
  mtime: string;
}

export type HistoryItemChatList = HistoryItemBase & {
  type: 'chat_list';
  chats: ChatDetail[];
};

export interface ToolDefinition {
  name: string;
  displayName: string;
  description?: string;
}

export type HistoryItemToolsList = HistoryItemBase & {
  type: 'tools_list';
  tools: ToolDefinition[];
  showDescriptions: boolean;
};

// JSON-friendly types for using as a simple data model showing info about an
// MCP Server.
export interface McpServer {
  name: string;
  connected: boolean;
  description?: string;
  environment?: Record<string, string>;
  error?: string;
  tools: string[];
  prompts: string[];
  resources: string[];
}

export type HistoryItemMcpStatus = HistoryItemBase & {
  type: 'mcp_status';
  servers: McpServer[];
};

// Union type for all history item types
export type HistoryItemWithoutId =
  | HistoryItemUser
  | HistoryItemUserShell
  | HistoryItemGemini
  | HistoryItemGeminiContent
  | HistoryItemInfo
  | HistoryItemError
  | HistoryItemWarning
  | HistoryItemAbout
  | HistoryItemHelp
  | HistoryItemToolGroup
  | HistoryItemStats
  | HistoryItemModelStats
  | HistoryItemToolStats
  | HistoryItemCacheStats
  | HistoryItemLBStats
  | HistoryItemQuit
  | HistoryItemCompression
  | HistoryItemOAuthURL
  | HistoryItemExtensionsList
  | HistoryItemToolsList
  | HistoryItemMcpStatus
  | HistoryItemChatList;

export type HistoryItem = HistoryItemWithoutId & { id: number };

// Constant for "no icon, just indent"
export const emptyIcon = '  ';

// Message types used by internal command feedback (subset of HistoryItem types)
export enum MessageType {
  INFO = 'info',
  ERROR = 'error',
  WARNING = 'warning',
  USER = 'user',
  ABOUT = 'about',
  HELP = 'help',
  STATS = 'stats',
  MODEL_STATS = 'model_stats',
  TOOL_STATS = 'tool_stats',
  CACHE_STATS = 'cache_stats',
  LB_STATS = 'lb_stats',
  QUIT = 'quit',
  GEMINI = 'gemini',
  COMPRESSION = 'compression',
  EXTENSIONS_LIST = 'extensions_list',
  TOOLS_LIST = 'tools_list',
  MCP_STATUS = 'mcp_status',
  CHAT_LIST = 'chat_list',
}

// Simplified message structure for internal feedback
export type Message =
  | {
      type: MessageType.INFO | MessageType.ERROR | MessageType.USER;
      content: string; // Renamed from text for clarity in this context
      timestamp: Date;
    }
  | {
      type: MessageType.ABOUT;
      timestamp: Date;
      cliVersion: string;
      osVersion: string;
      sandboxEnv: string;
      modelVersion: string;
      gcpProject: string;
      keyfile: string;
      key: string;
      ideClient: string;
      provider: string;
      baseURL: string;
      content?: string; // Optional content, not really used for ABOUT
    }
  | {
      type: MessageType.HELP;
      timestamp: Date;
      content?: string;
    }
  | {
      type: MessageType.STATS;
      timestamp: Date;
      duration: string;
      content?: string;
    }
  | {
      type: MessageType.MODEL_STATS;
      timestamp: Date;
      content?: string;
    }
  | {
      type: MessageType.TOOL_STATS;
      timestamp: Date;
      content?: string;
    }
  | {
      type: MessageType.CACHE_STATS;
      timestamp: Date;
      content?: string;
    }
  | {
      type: MessageType.LB_STATS;
      timestamp: Date;
      content?: string;
    }
  | {
      type: MessageType.QUIT;
      timestamp: Date;
      duration: string;
      content?: string;
    }
  | {
      type: MessageType.COMPRESSION;
      compression: CompressionProps;
      timestamp: Date;
    };

export interface ConsoleMessageItem {
  type: 'log' | 'warn' | 'error' | 'debug' | 'info';
  content: string;
  count: number;
}

/**
 * Result type for a slash command that should immediately result in a prompt
 * being submitted to the Gemini model.
 */
export interface SubmitPromptResult {
  type: 'submit_prompt';
  content: string;
}

/**
 * Defines the result of the slash command processor for its consumer (useGeminiStream).
 */
export type SlashCommandProcessorResult =
  | {
      type: 'schedule_tool';
      toolName: string;
      toolArgs: Record<string, unknown>;
    }
  | {
      type: 'handled'; // Indicates the command was processed and no further action is needed.
    }
  | SubmitPromptResult;

export interface ConfirmationRequest {
  prompt: React.ReactNode;
  onConfirm: (confirm: boolean) => void;
}
