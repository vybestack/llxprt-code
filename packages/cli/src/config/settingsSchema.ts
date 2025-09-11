/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MCPServerConfig,
  BugCommandSettings,
  TelemetrySettings,
  AuthType,
  ChatCompressionSettings,
} from '@vybestack/llxprt-code-core';
import { CustomTheme } from '../ui/themes/theme.js';
import {
  DEFAULT_HISTORY_MAX_BYTES,
  DEFAULT_HISTORY_MAX_ITEMS,
} from '../constants/historyLimits.js';

export interface SettingDefinition {
  type: 'boolean' | 'string' | 'number' | 'array' | 'object' | 'enum';
  label: string;
  category: string;
  requiresRestart: boolean;
  default: boolean | string | number | string[] | object | undefined;
  description?: string;
  parentKey?: string;
  childKey?: string;
  key?: string;
  properties?: SettingsSchema;
  showInDialog?: boolean;
  options?: readonly string[];
}

export interface SettingsSchema {
  [key: string]: SettingDefinition;
}

export type MemoryImportFormat = 'tree' | 'flat';
export type DnsResolutionOrder = 'ipv4first' | 'verbatim';
export type ToolCallProcessingMode = 'legacy' | 'pipeline';

const DEFAULT_EXTENSION_AUTO_UPDATE = {
  enabled: true,
  checkIntervalHours: 24,
  installMode: 'immediate' as const,
  notificationLevel: 'toast' as const,
  perExtension: {} as Record<
    string,
    {
      enabled?: boolean;
      installMode?: 'immediate' | 'on-restart' | 'manual';
      notificationLevel?: 'silent' | 'toast' | 'dialog';
      checkIntervalHours?: number;
    }
  >,
};

/**
 * The canonical schema for all settings.
 * The structure of this object defines the structure of the `Settings` type.
 * `as const` is crucial for TypeScript to infer the most specific types possible.
 */
export const SETTINGS_SCHEMA = {
  // UI Settings
  theme: {
    type: 'string',
    label: 'Theme',
    category: 'UI',
    requiresRestart: false,
    default: undefined as string | undefined,
    description: 'The color theme for the UI.',
    showInDialog: false,
  },
  customThemes: {
    type: 'object',
    label: 'Custom Themes',
    category: 'UI',
    requiresRestart: false,
    default: {} as Record<string, CustomTheme>,
    description: 'Custom theme definitions.',
    showInDialog: false,
  },
  hideWindowTitle: {
    type: 'boolean',
    label: 'Hide Window Title',
    category: 'UI',
    requiresRestart: true,
    default: false,
    description: 'Hide the window title bar',
    showInDialog: true,
  },
  hideTips: {
    type: 'boolean',
    label: 'Hide Tips',
    category: 'UI',
    requiresRestart: false,
    default: false,
    description: 'Hide helpful tips in the UI',
    showInDialog: true,
  },
  hideBanner: {
    type: 'boolean',
    label: 'Hide Banner',
    category: 'UI',
    requiresRestart: false,
    default: false,
    description: 'Hide application banner',
    showInDialog: true,
  },
  useFullWidth: {
    type: 'boolean',
    label: 'Use Full Width',
    category: 'UI',
    requiresRestart: false,
    default: true,
    description: 'Use full terminal width instead of margins',
    showInDialog: true,
  },
  hideFooter: {
    type: 'boolean',
    label: 'Hide Footer',
    category: 'UI',
    requiresRestart: false,
    default: false,
    description: 'Hide the footer from the UI',
    showInDialog: true,
  },
  hideContextSummary: {
    type: 'boolean',
    label: 'Hide Context Summary',
    category: 'UI',
    requiresRestart: false,
    default: false,
    description:
      'Hide the context summary (LLXPRT.md, MCP servers) above the input.',
    showInDialog: true,
  },
  showTodoPanel: {
    type: 'boolean',
    label: 'Show Todo Panel',
    category: 'UI',
    requiresRestart: false,
    default: true,
    description:
      'Display the interactive Todo panel. Disable to keep todos in the scrollback view instead.',
    showInDialog: true,
  },
  showMemoryUsage: {
    type: 'boolean',
    label: 'Show Memory Usage',
    category: 'UI',
    requiresRestart: false,
    default: false,
    description: 'Display memory usage information in the UI',
    showInDialog: true,
  },
  historyMaxItems: {
    type: 'number',
    label: 'History Max Items',
    category: 'UI',
    requiresRestart: false,
    default: DEFAULT_HISTORY_MAX_ITEMS,
    description:
      'Maximum number of history entries to keep in the scrollback before trimming the oldest ones. Set to -1 for unlimited.',
    showInDialog: true,
  },
  historyMaxBytes: {
    type: 'number',
    label: 'History Max Bytes',
    category: 'UI',
    requiresRestart: false,
    default: DEFAULT_HISTORY_MAX_BYTES,
    description:
      'Approximate maximum number of bytes to keep in history. Older entries are removed once this budget is exceeded. Set to -1 for unlimited.',
    showInDialog: true,
  },
  customWittyPhrases: {
    type: 'array',
    label: 'Custom Witty Phrases',
    category: 'UI',
    requiresRestart: false,
    default: [] as string[],
    description: 'Custom witty phrases to display during loading.',
    showInDialog: false,
  },

  usageStatisticsEnabled: {
    type: 'boolean',
    label: 'Enable Usage Statistics',
    category: 'General',
    requiresRestart: true,
    default: true,
    description: 'Enable collection of usage statistics',
    showInDialog: false, // All details are shown in /privacy and dependent on auth type
  },
  autoConfigureMaxOldSpaceSize: {
    type: 'boolean',
    label: 'Auto Configure Max Old Space Size',
    category: 'General',
    requiresRestart: true,
    default: false,
    description: 'Automatically configure Node.js memory limits',
    showInDialog: true,
  },
  preferredEditor: {
    type: 'string',
    label: 'Preferred Editor',
    category: 'General',
    requiresRestart: false,
    default: undefined as string | undefined,
    description: 'The preferred editor to open files in.',
    showInDialog: false,
  },
  maxSessionTurns: {
    type: 'number',
    label: 'Max Session Turns',
    category: 'General',
    requiresRestart: false,
    default: -1,
    description:
      'Maximum number of user/model/tool turns to keep in a session. -1 means unlimited.',
    showInDialog: true,
  },
  maxTurnsPerPrompt: {
    type: 'number',
    label: 'Max Turns Per Prompt',
    category: 'General',
    requiresRestart: false,
    default: 200,
    description:
      'Maximum number of turns allowed per prompt before stopping to prevent loops. Set to -1 for unlimited (default: 200).',
    showInDialog: true,
  },
  memoryImportFormat: {
    type: 'string',
    label: 'Memory Import Format',
    category: 'General',
    requiresRestart: false,
    default: undefined as MemoryImportFormat | undefined,
    description: 'The format to use when importing memory.',
    showInDialog: false,
  },
  memoryDiscoveryMaxDirs: {
    type: 'number',
    label: 'Memory Discovery Max Dirs',
    category: 'General',
    requiresRestart: false,
    default: 200,
    description: 'Maximum number of directories to search for memory.',
    showInDialog: true,
  },
  contextFileName: {
    type: 'object',
    label: 'Context File Name',
    category: 'General',
    requiresRestart: false,
    default: undefined as string | string[] | undefined,
    description: 'The name of the context file.',
    showInDialog: false,
  },
  vimMode: {
    type: 'boolean',
    label: 'Vim Mode',
    category: 'Mode',
    requiresRestart: false,
    default: false,
    description: 'Enable Vim keybindings',
    showInDialog: true,
  },
  ideMode: {
    type: 'boolean',
    label: 'IDE Mode',
    category: 'Mode',
    requiresRestart: true,
    default: false,
    description: 'Enable IDE integration mode',
    showInDialog: true,
  },

  accessibility: {
    type: 'object',
    label: 'Accessibility',
    category: 'Accessibility',
    requiresRestart: true,
    default: {},
    description: 'Accessibility settings.',
    showInDialog: false,
    properties: {
      disableLoadingPhrases: {
        type: 'boolean',
        label: 'Disable Loading Phrases',
        category: 'Accessibility',
        requiresRestart: true,
        default: false,
        description: 'Disable loading phrases for accessibility',
        showInDialog: true,
      },
      screenReader: {
        type: 'boolean',
        label: 'Screen Reader Mode',
        category: 'Accessibility',
        requiresRestart: true,
        default: undefined as boolean | undefined,
        description:
          'Render output in plain-text to be more screen reader accessible',
        showInDialog: true,
      },
    },
  },
  checkpointing: {
    type: 'object',
    label: 'Checkpointing',
    category: 'Checkpointing',
    requiresRestart: true,
    default: {},
    description: 'Session checkpointing settings.',
    showInDialog: false,
    properties: {
      enabled: {
        type: 'boolean',
        label: 'Enable Checkpointing',
        category: 'Checkpointing',
        requiresRestart: true,
        default: false,
        description: 'Enable session checkpointing for recovery',
        showInDialog: false,
      },
    },
  },
  emojifilter: {
    type: 'string',
    label: 'Emoji Filter',
    category: 'Content Filtering',
    requiresRestart: false,
    default: 'auto' as 'allowed' | 'auto' | 'warn' | 'error',
    description:
      'Filter emojis from AI-generated content and file operations. Options: allowed (no filtering), auto (silent filtering), warn (filter with warnings to AI), error (block operations with emojis).',
    showInDialog: true,
  },
  fileFiltering: {
    type: 'object',
    label: 'File Filtering',
    category: 'File Filtering',
    requiresRestart: true,
    default: {},
    description: 'Settings for git-aware file filtering.',
    showInDialog: false,
    properties: {
      respectGitIgnore: {
        type: 'boolean',
        label: 'Respect .gitignore',
        category: 'File Filtering',
        requiresRestart: true,
        default: true,
        description: 'Respect .gitignore files when searching',
        showInDialog: true,
      },
      respectLlxprtIgnore: {
        type: 'boolean',
        label: 'Respect .llxprtignore',
        category: 'File Filtering',
        requiresRestart: true,
        default: true,
        description: 'Respect .llxprtignore files when searching',
        showInDialog: true,
      },
      enableRecursiveFileSearch: {
        type: 'boolean',
        label: 'Enable Recursive File Search',
        category: 'File Filtering',
        requiresRestart: true,
        default: true,
        description: 'Enable recursive file search functionality',
        showInDialog: true,
      },
      disableFuzzySearch: {
        type: 'boolean',
        label: 'Disable Fuzzy Search',
        category: 'File Filtering',
        requiresRestart: true,
        default: false,
        description: 'Disable fuzzy search when searching for files.',
        showInDialog: true,
      },
    },
  },

  disableAutoUpdate: {
    type: 'boolean',
    label: 'Disable Auto Update',
    category: 'Updates',
    requiresRestart: false,
    default: false,
    description: 'Disable automatic updates',
    showInDialog: true,
  },

  shouldUseNodePtyShell: {
    type: 'boolean',
    label: 'Enable Interactive Shell (node-pty)',
    category: 'Shell',
    requiresRestart: true,
    default: false,
    description:
      'Allow fully interactive shell commands (vim, git rebase -i, etc.) by running tools through node-pty. Falls back to child_process when disabled.',
    showInDialog: true,
  },

  selectedAuthType: {
    type: 'string',
    label: 'Selected Auth Type',
    category: 'Advanced',
    requiresRestart: true,
    default: 'provider' as AuthType,
    description: 'The currently selected authentication type.',
    showInDialog: false,
  },
  useExternalAuth: {
    type: 'boolean',
    label: 'Use External Auth',
    category: 'Advanced',
    requiresRestart: true,
    default: undefined as boolean | undefined,
    description: 'Whether to use an external authentication flow.',
    showInDialog: false,
  },
  sandbox: {
    type: 'object',
    label: 'Sandbox',
    category: 'Advanced',
    requiresRestart: true,
    default: undefined as boolean | string | undefined,
    description:
      'Sandbox execution environment (can be a boolean or a path string).',
    showInDialog: false,
  },
  coreTools: {
    type: 'array',
    label: 'Core Tools',
    category: 'Advanced',
    requiresRestart: true,
    default: undefined as string[] | undefined,
    description: 'Paths to core tool definitions.',
    showInDialog: false,
  },
  allowedTools: {
    type: 'array',
    label: 'Allowed Tools',
    category: 'Advanced',
    requiresRestart: true,
    default: undefined as string[] | undefined,
    description:
      'A list of tool names that will bypass the confirmation dialog.',
    showInDialog: false,
  },
  excludeTools: {
    type: 'array',
    label: 'Exclude Tools',
    category: 'Advanced',
    requiresRestart: true,
    default: undefined as string[] | undefined,
    description: 'Tool names to exclude from discovery.',
    showInDialog: false,
  },
  toolDiscoveryCommand: {
    type: 'string',
    label: 'Tool Discovery Command',
    category: 'Advanced',
    requiresRestart: true,
    default: undefined as string | undefined,
    description: 'Command to run for tool discovery.',
    showInDialog: false,
  },
  toolCallCommand: {
    type: 'string',
    label: 'Tool Call Command',
    category: 'Advanced',
    requiresRestart: true,
    default: undefined as string | undefined,
    description: 'Command to run for tool calls.',
    showInDialog: false,
  },
  toolCallProcessingMode: {
    type: 'enum',
    label: 'Tool Call Processing Mode',
    category: 'Advanced',
    requiresRestart: true,
    default: 'legacy' as ToolCallProcessingMode,
    description:
      'Mode for processing tool calls. Pipeline mode is optimized, legacy mode uses older implementation.',
    showInDialog: true,
    options: ['legacy', 'pipeline'],
  },
  mcpServerCommand: {
    type: 'string',
    label: 'MCP Server Command',
    category: 'Advanced',
    requiresRestart: true,
    default: undefined as string | undefined,
    description: 'Command to start an MCP server.',
    showInDialog: false,
  },
  mcpServers: {
    type: 'object',
    label: 'MCP Servers',
    category: 'Advanced',
    requiresRestart: true,
    default: {} as Record<string, MCPServerConfig>,
    description: 'Configuration for MCP servers.',
    showInDialog: false,
  },
  // Footer configuration settings - adapted to llxprt's flat structure
  hideCWD: {
    type: 'boolean',
    label: 'Hide CWD',
    category: 'UI',
    requiresRestart: false,
    default: false,
    description: 'Hide the current working directory path in the footer.',
    showInDialog: true,
  },
  hideSandboxStatus: {
    type: 'boolean',
    label: 'Hide Sandbox Status',
    category: 'UI',
    requiresRestart: false,
    default: false,
    description: 'Hide the sandbox status indicator in the footer.',
    showInDialog: true,
  },
  hideModelInfo: {
    type: 'boolean',
    label: 'Hide Model Info',
    category: 'UI',
    requiresRestart: false,
    default: false,
    description: 'Hide the model name and context usage in the footer.',
    showInDialog: true,
  },
  allowMCPServers: {
    type: 'array',
    label: 'Allow MCP Servers',
    category: 'Advanced',
    requiresRestart: true,
    default: undefined as string[] | undefined,
    description: 'A whitelist of MCP servers to allow.',
    showInDialog: false,
  },
  excludeMCPServers: {
    type: 'array',
    label: 'Exclude MCP Servers',
    category: 'Advanced',
    requiresRestart: true,
    default: undefined as string[] | undefined,
    description: 'A blacklist of MCP servers to exclude.',
    showInDialog: false,
  },
  telemetry: {
    type: 'object',
    label: 'Telemetry',
    category: 'Advanced',
    requiresRestart: true,
    default: undefined as TelemetrySettings | undefined,
    description: 'Telemetry configuration.',
    showInDialog: false,
  },
  bugCommand: {
    type: 'object',
    label: 'Bug Command',
    category: 'Advanced',
    requiresRestart: false,
    default: undefined as BugCommandSettings | undefined,
    description: 'Configuration for the bug report command.',
    showInDialog: false,
  },
  summarizeToolOutput: {
    type: 'object',
    label: 'Summarize Tool Output',
    category: 'Advanced',
    requiresRestart: false,
    default: undefined as Record<string, { tokenBudget?: number }> | undefined,
    description: 'Settings for summarizing tool output.',
    showInDialog: false,
  },

  dnsResolutionOrder: {
    type: 'string',
    label: 'DNS Resolution Order',
    category: 'Advanced',
    requiresRestart: true,
    default: undefined as DnsResolutionOrder | undefined,
    description: 'The DNS resolution order.',
    showInDialog: false,
  },

  tools: {
    type: 'object',
    label: 'Tools',
    category: 'Tools',
    requiresRestart: true,
    default: {},
    description: 'Settings for built-in and custom tools.',
    showInDialog: false,
    properties: {
      sandbox: {
        type: 'object',
        label: 'Sandbox',
        category: 'Tools',
        requiresRestart: true,
        default: undefined as boolean | string | undefined,
        description:
          'Sandbox execution environment (can be a boolean or a path string).',
        showInDialog: false,
      },
      usePty: {
        type: 'boolean',
        label: 'Use node-pty for Shell Execution',
        category: 'Tools',
        requiresRestart: true,
        default: false,
        description:
          'Use node-pty for shell command execution. Fallback to child_process still applies.',
        showInDialog: true,
      },
      shell: {
        type: 'object',
        label: 'Shell',
        category: 'Tools',
        requiresRestart: false,
        default: {},
        description: 'Settings for shell execution.',
        showInDialog: false,
        properties: {
          pager: {
            type: 'string',
            label: 'Pager',
            category: 'Tools',
            requiresRestart: false,
            default: 'cat' as string | undefined,
            description:
              'The pager command to use for shell output. Defaults to `cat`.',
            showInDialog: false,
          },
          showColor: {
            type: 'boolean',
            label: 'Show Color',
            category: 'Tools',
            requiresRestart: false,
            default: false,
            description: 'Show color in shell output.',
            showInDialog: true,
          },
        },
      },
      autoAccept: {
        type: 'boolean',
        label: 'Auto Accept',
        category: 'Tools',
        requiresRestart: false,
        default: false,
        description:
          'Automatically accept and execute tool calls that are considered safe (e.g., read-only operations).',
        showInDialog: true,
      },
      core: {
        type: 'array',
        label: 'Core Tools',
        category: 'Tools',
        requiresRestart: true,
        default: undefined as string[] | undefined,
        description: 'Paths to core tool definitions.',
        showInDialog: false,
      },
      allowed: {
        type: 'array',
        label: 'Allowed Tools',
        category: 'Advanced',
        requiresRestart: true,
        default: undefined as string[] | undefined,
        description:
          'A list of tool names that will bypass the confirmation dialog.',
        showInDialog: false,
      },
      exclude: {
        type: 'array',
        label: 'Exclude Tools',
        category: 'Tools',
        requiresRestart: true,
        default: undefined as string[] | undefined,
        description: 'Tool names to exclude from discovery.',
        showInDialog: false,
      },
      discoveryCommand: {
        type: 'string',
        label: 'Tool Discovery Command',
        category: 'Tools',
        requiresRestart: true,
        default: undefined as string | undefined,
        description: 'Command to run for tool discovery.',
        showInDialog: false,
      },
      callCommand: {
        type: 'string',
        label: 'Tool Call Command',
        category: 'Tools',
        requiresRestart: true,
        default: undefined as string | undefined,
        description: 'Command to run for tool calls.',
        showInDialog: false,
      },
      useRipgrep: {
        type: 'boolean',
        label: 'Use Ripgrep',
        category: 'Tools',
        requiresRestart: false,
        default: false,
        description:
          'Use ripgrep for file content search instead of the fallback implementation. Provides faster search performance.',
        showInDialog: true,
      },
      policyPath: {
        type: 'string',
        label: 'Policy File Path',
        category: 'Tools',
        requiresRestart: false,
        default: undefined as string | undefined,
        description:
          'Absolute path to a TOML policy file that augments the built-in policy rules.',
        showInDialog: false,
      },
    },
  },

  mcp: {
    type: 'object',
    label: 'MCP',
    category: 'MCP',
    requiresRestart: true,
    default: {},
    description: 'Settings for Model Context Protocol (MCP) servers.',
    showInDialog: false,
    properties: {
      serverCommand: {
        type: 'string',
        label: 'MCP Server Command',
        category: 'MCP',
        requiresRestart: true,
        default: undefined as string | undefined,
        description: 'Command to start an MCP server.',
        showInDialog: false,
      },
      allowed: {
        type: 'array',
        label: 'Allow MCP Servers',
        category: 'MCP',
        requiresRestart: true,
        default: undefined as string[] | undefined,
        description: 'A list of MCP servers to allow.',
        showInDialog: false,
      },
      excluded: {
        type: 'array',
        label: 'Exclude MCP Servers',
        category: 'MCP',
        requiresRestart: true,
        default: undefined as string[] | undefined,
        description: 'A list of MCP servers to exclude.',
        showInDialog: false,
      },
    },
  },
  useSmartEdit: {
    type: 'boolean',
    label: 'Use Smart Edit',
    category: 'Advanced',
    requiresRestart: false,
    default: false,
    description: 'Enable the smart-edit tool instead of the replace tool.',
    showInDialog: false,
  },
  security: {
    type: 'object',
    label: 'Security',
    category: 'Security',
    requiresRestart: true,
    default: {},
    description: 'Security-related settings.',
    showInDialog: false,
    properties: {
      folderTrust: {
        type: 'object',
        label: 'Folder Trust',
        category: 'Security',
        requiresRestart: true,
        default: {},
        description: 'Settings for folder trust.',
        showInDialog: false,
        properties: {
          enabled: {
            type: 'boolean',
            label: 'Folder Trust',
            category: 'Security',
            requiresRestart: true,
            default: false,
            description: 'Setting to track whether Folder trust is enabled.',
            showInDialog: true,
          },
        },
      },
      auth: {
        type: 'object',
        label: 'Authentication',
        category: 'Security',
        requiresRestart: true,
        default: {},
        description: 'Authentication settings.',
        showInDialog: false,
        properties: {
          selectedType: {
            type: 'string',
            label: 'Selected Auth Type',
            category: 'Security',
            requiresRestart: true,
            default: undefined as AuthType | undefined,
            description: 'The currently selected authentication type.',
            showInDialog: false,
          },
          useExternal: {
            type: 'boolean',
            label: 'Use External Auth',
            category: 'Security',
            requiresRestart: true,
            default: undefined as boolean | undefined,
            description: 'Whether to use an external authentication flow.',
            showInDialog: false,
          },
        },
      },
    },
  },

  excludedProjectEnvVars: {
    type: 'array',
    label: 'Excluded Project Environment Variables',
    category: 'Advanced',
    requiresRestart: false,
    default: ['DEBUG', 'DEBUG_MODE'] as string[],
    description: 'Environment variables to exclude from project context.',
    showInDialog: false,
  },
  disableUpdateNag: {
    type: 'boolean',
    label: 'Disable Update Nag',
    category: 'Updates',
    requiresRestart: false,
    default: false,
    description: 'Disable update notification prompts.',
    showInDialog: false,
  },
  includeDirectories: {
    type: 'array',
    label: 'Include Directories',
    category: 'General',
    requiresRestart: false,
    default: [] as string[],
    description:
      'Additional directories to include in the workspace context. Missing directories will be skipped with a warning.',
    showInDialog: false,
  },
  loadMemoryFromIncludeDirectories: {
    type: 'boolean',
    label: 'Load Memory From Include Directories',
    category: 'General',
    requiresRestart: false,
    default: false,
    description: 'Whether to load memory files from include directories.',
    showInDialog: true,
  },
  model: {
    type: 'string',
    label: 'Model',
    category: 'General',
    requiresRestart: false,
    default: undefined as string | undefined,
    description: 'The Gemini model to use for conversations.',
    showInDialog: false,
  },
  hasSeenIdeIntegrationNudge: {
    type: 'boolean',
    label: 'Has Seen IDE Integration Nudge',
    category: 'General',
    requiresRestart: false,
    default: false,
    description: 'Whether the user has seen the IDE integration nudge.',
    showInDialog: false,
  },
  folderTrustFeature: {
    type: 'boolean',
    label: 'Folder Trust Feature',
    category: 'General',
    requiresRestart: true,
    default: false,
    description: 'Enable folder trust feature for enhanced security.',
    showInDialog: true,
  },
  folderTrust: {
    type: 'boolean',
    label: 'Folder Trust',
    category: 'General',
    requiresRestart: true,
    default: false,
    description: 'Setting to track whether Folder trust is enabled.',
    showInDialog: true,
  },
  chatCompression: {
    type: 'object',
    label: 'Chat Compression',
    category: 'General',
    requiresRestart: false,
    default: undefined as ChatCompressionSettings | undefined,
    description: 'Chat compression settings.',
    showInDialog: false,
  },
  showLineNumbers: {
    type: 'boolean',
    label: 'Show Line Numbers',
    category: 'General',
    requiresRestart: false,
    default: false,
    description: 'Show line numbers in the chat.',
    showInDialog: true,
  },

  // LLxprt-specific provider settings
  defaultProfile: {
    type: 'string',
    label: 'Default Profile',
    category: 'Provider',
    requiresRestart: true,
    default: undefined as string | undefined,
    description: 'Default provider profile to use.',
    showInDialog: false,
  },
  providerApiKeys: {
    type: 'object',
    label: 'Provider API Keys',
    category: 'Provider',
    requiresRestart: true,
    default: {} as Record<string, string>,
    description: 'API keys for different providers.',
    showInDialog: false,
  },
  providerBaseUrls: {
    type: 'object',
    label: 'Provider Base URLs',
    category: 'Provider',
    requiresRestart: true,
    default: {} as Record<string, string>,
    description: 'Base URLs for different providers.',
    showInDialog: false,
  },
  providerToolFormatOverrides: {
    type: 'object',
    label: 'Provider Tool Format Overrides',
    category: 'Provider',
    requiresRestart: true,
    default: {} as Record<string, string>,
    description: 'Tool format overrides for different providers.',
    showInDialog: false,
  },
  providerKeyfiles: {
    type: 'object',
    label: 'Provider Keyfiles',
    category: 'Provider',
    requiresRestart: true,
    default: {} as Record<string, string>,
    description: 'Keyfile paths for different providers.',
    showInDialog: false,
  },

  extensionManagement: {
    type: 'boolean',
    label: 'Extension Management',
    category: 'Feature Flag',
    requiresRestart: true,
    default: false,
    description: 'Enable extension management features.',
    showInDialog: false,
  },
  extensions: {
    type: 'object',
    label: 'Extensions',
    category: 'Extensions',
    requiresRestart: true,
    default: {
      disabled: [] as string[],
      workspacesWithMigrationNudge: [] as string[],
      autoUpdate: DEFAULT_EXTENSION_AUTO_UPDATE,
    },
    description: 'Settings for extensions.',
    showInDialog: false,
    properties: {
      disabled: {
        type: 'array',
        label: 'Disabled Extensions',
        category: 'Extensions',
        requiresRestart: true,
        default: [] as string[],
        description: 'List of disabled extensions.',
        showInDialog: false,
      },
      workspacesWithMigrationNudge: {
        type: 'array',
        label: 'Workspaces with Migration Nudge',
        category: 'Extensions',
        requiresRestart: false,
        default: [] as string[],
        description:
          'List of workspaces for which the migration nudge has been shown.',
        showInDialog: false,
      },
      autoUpdate: {
        type: 'object',
        label: 'Extension Auto-Update',
        category: 'Extensions',
        requiresRestart: false,
        default: DEFAULT_EXTENSION_AUTO_UPDATE,
        description:
          'Configure how llxprt-code checks for and applies extension updates.',
        showInDialog: false,
        properties: {
          enabled: {
            type: 'boolean',
            label: 'Enable Auto-Update',
            category: 'Extensions',
            requiresRestart: false,
            default: true,
            description:
              'Automatically check for updates to globally installed extensions.',
            showInDialog: false,
          },
          checkIntervalHours: {
            type: 'number',
            label: 'Auto-Update Interval (hours)',
            category: 'Extensions',
            requiresRestart: false,
            default: 24,
            description:
              'How often llxprt-code should check for extension updates.',
            showInDialog: false,
          },
          installMode: {
            type: 'enum',
            label: 'Install Mode',
            category: 'Extensions',
            requiresRestart: false,
            default: 'immediate' as const,
            description:
              'Choose whether updates apply immediately, on restart, or manually.',
            showInDialog: false,
            options: ['immediate', 'on-restart', 'manual'] as const,
          },
          notificationLevel: {
            type: 'enum',
            label: 'Notification Level',
            category: 'Extensions',
            requiresRestart: false,
            default: 'toast' as const,
            description:
              'Controls how aggressively update notifications are surfaced.',
            showInDialog: false,
            options: ['toast', 'dialog', 'silent'] as const,
          },
          perExtension: {
            type: 'object',
            label: 'Per Extension Overrides',
            category: 'Extensions',
            requiresRestart: false,
            default: DEFAULT_EXTENSION_AUTO_UPDATE.perExtension,
            description:
              'Override auto-update behavior for individual extensions (by extension name).',
            showInDialog: false,
          },
        },
      },
    },
  },

  // Text-based tool call parsing settings
  enableTextToolCallParsing: {
    type: 'boolean',
    label: 'Enable Text Tool Call Parsing',
    category: 'Advanced',
    requiresRestart: false,
    default: false,
    description: 'Enable parsing of tool calls from text responses.',
    showInDialog: false,
  },
  textToolCallModels: {
    type: 'array',
    label: 'Text Tool Call Models',
    category: 'Advanced',
    requiresRestart: false,
    default: [] as string[],
    description: 'Models that support text-based tool call parsing.',
    showInDialog: false,
  },

  // OpenAI Responses API settings
  openaiResponsesEnabled: {
    type: 'boolean',
    label: 'OpenAI Responses Enabled',
    category: 'Advanced',
    requiresRestart: false,
    default: false,
    description: 'Enable OpenAI Responses API compatibility.',
    showInDialog: false,
  },

  // Shell replacement setting
  shellReplacement: {
    type: 'boolean',
    label: 'Shell Replacement',
    category: 'Advanced',
    requiresRestart: false,
    default: false,
    description: 'Allow command substitution in shell commands.',
    showInDialog: false,
  },

  // OAuth enablement configuration per provider
  oauthEnabledProviders: {
    type: 'object',
    label: 'OAuth Enabled Providers',
    category: 'Provider',
    requiresRestart: true,
    default: {} as Record<string, boolean>,
    description: 'OAuth enablement configuration per provider.',
    showInDialog: false,
  },
  useRipgrep: {
    type: 'boolean',
    label: 'Use Ripgrep',
    category: 'Tools',
    requiresRestart: false,
    default: false,
    description:
      'Use ripgrep for file content search instead of the fallback implementation. Provides faster search performance.',
    showInDialog: true,
  },
  enablePromptCompletion: {
    type: 'boolean',
    label: 'Enable Prompt Completion',
    category: 'General',
    requiresRestart: true,
    default: false,
    description:
      'Enable AI-powered prompt completion suggestions while typing.',
    showInDialog: true,
  },
  debugKeystrokeLogging: {
    type: 'boolean',
    label: 'Debug Keystroke Logging',
    category: 'General',
    requiresRestart: false,
    default: false,
    description: 'Enable debug logging of keystrokes to the console.',
    showInDialog: true,
  },
} as const;

type InferSettings<T extends SettingsSchema> = {
  -readonly [K in keyof T]?: T[K] extends { properties: SettingsSchema }
  ? InferSettings<T[K]['properties']>
  : T[K]['default'] extends boolean
  ? boolean
  : T[K]['default'];
};

export type Settings = InferSettings<typeof SETTINGS_SCHEMA>;

export interface FooterSettings {
  hideCWD?: boolean;
  hideSandboxStatus?: boolean;
  hideModelInfo?: boolean;
}
