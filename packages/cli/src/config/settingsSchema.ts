/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MCPServerConfig,
  BugCommandSettings,
  TelemetrySettings,
  ChatCompressionSettings,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
  HookDefinition,
  HookEventName,
} from '@vybestack/llxprt-code-core';
import { CustomTheme } from '../ui/themes/theme.js';
import { type WittyPhraseStyle } from '../ui/constants/phrasesCollections.js';
import type { SessionRetentionSettings } from './settings.js';

export type SettingsType =
  | 'boolean'
  | 'string'
  | 'number'
  | 'array'
  | 'object'
  | 'enum';

export type SettingsValue =
  | boolean
  | string
  | number
  | string[]
  | object
  | undefined;

/**
 * Setting datatypes that "toggle" through a fixed list of options
 * (e.g. an enum or true/false) rather than allowing for free form input
 * (like a number or string).
 */
export const TOGGLE_TYPES: ReadonlySet<SettingsType | undefined> = new Set([
  'boolean',
  'enum',
]);

export interface SettingEnumOption {
  value: string | number;
  label: string;
}

function oneLine(strings: TemplateStringsArray, ...values: unknown[]): string {
  let result = '';
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) {
      result += String(values[i]);
    }
  }
  return result.replace(/\s+/g, ' ').trim();
}

export interface SettingCollectionDefinition {
  type: SettingsType;
  description?: string;
  properties?: SettingsSchema;
  /** Enum type options  */
  options?: readonly SettingEnumOption[];
  /**
   * Optional reference identifier for generators that emit a `$ref`.
   * For example, a JSON schema generator can use this to point to a shared definition.
   */
  ref?: string;
}

export enum MergeStrategy {
  // Replace the old value with the new value. This is the default.
  REPLACE = 'replace',
  // Concatenate arrays.
  CONCAT = 'concat',
  // Merge arrays, ensuring unique values.
  UNION = 'union',
  // Shallow merge objects.
  SHALLOW_MERGE = 'shallow_merge',
}

export interface SettingDefinition {
  type: SettingsType;
  label: string;
  category: string;
  requiresRestart: boolean;
  default: SettingsValue;
  description?: string;
  parentKey?: string;
  childKey?: string;
  key?: string;
  properties?: SettingsSchema;
  showInDialog?: boolean;
  mergeStrategy?: MergeStrategy;
  /** Enum type options  */
  options?: readonly SettingEnumOption[];
  /**
   * For collection types (e.g. arrays), describes the shape of each item.
   */
  items?: SettingCollectionDefinition;
  /**
   * For map-like objects without explicit `properties`, describes the shape of the values.
   */
  additionalProperties?: SettingCollectionDefinition;
  /**
   * Optional reference identifier for generators that emit a `$ref`.
   */
  ref?: string;
  subSettings?: SettingsSchema;
}

export interface SettingsSchema {
  [key: string]: SettingDefinition;
}

export type MemoryImportFormat = 'tree' | 'flat';
export type DnsResolutionOrder = 'ipv4first' | 'verbatim';
export type ToolCallProcessingMode = 'legacy' | 'pipeline';
export type ToolEnabledState = 'enabled' | 'disabled';

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
 *
 * IMPORTANT: When adding a new setting with `showInDialog: true`, ensure it is
 * also documented in docs/cli/configuration.md with a complete description,
 * type, default value, and example.
 */
export const SETTINGS_SCHEMA = {
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
        default: false,
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
  allowPtyThemeOverride: {
    type: 'boolean',
    label: 'Allow PTY to Override Theme',
    category: 'Shell',
    requiresRestart: true,
    default: false,
    description:
      'Allow ANSI colors from PTY output to override the UI theme. When disabled, PTY output uses the current theme colors.',
    showInDialog: true,
  },
  ptyScrollbackLimit: {
    type: 'number',
    label: 'PTY Scrollback Limit',
    category: 'Shell',
    requiresRestart: true,
    default: 600000,
    description:
      'Maximum number of lines to keep in the PTY scrollback buffer for interactive shell output.',
    showInDialog: true,
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
  coreToolSettings: {
    type: 'object',
    label: 'Tool Management',
    category: 'Advanced',
    requiresRestart: true,
    default: {} as Record<string, boolean>,
    description: 'Manage core tool availability',
    showInDialog: true,
    subSettings: {}, // Will be populated dynamically based on loaded tools
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
    options: [
      { value: 'legacy', label: 'Legacy' },
      { value: 'pipeline', label: 'Pipeline' },
    ] as const,
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
    mergeStrategy: MergeStrategy.SHALLOW_MERGE,
    additionalProperties: {
      type: 'object',
      ref: 'MCPServerConfig',
    },
  },

  sessionRetention: {
    type: 'object',
    label: 'Session Retention',
    category: 'General',
    requiresRestart: false,
    default: undefined as SessionRetentionSettings | undefined,
    description: 'Settings for automatic session cleanup.',
  },
  output: {
    type: 'object',
    label: 'Output',
    category: 'General',
    requiresRestart: false,
    default: {},
    description: 'Settings for the CLI output.',
    showInDialog: false,
    properties: {
      format: {
        type: 'enum',
        label: 'Output Format',
        category: 'General',
        requiresRestart: false,
        default: 'text',
        description: 'The format of the CLI output.',
        showInDialog: true,
        options: [
          { value: 'text', label: 'Text' },
          { value: 'json', label: 'JSON' },
        ],
      },
    },
  },

  ui: {
    type: 'object',
    label: 'UI',
    category: 'UI',
    requiresRestart: false,
    default: {},
    description: 'User interface settings.',
    showInDialog: false,
    properties: {
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
        additionalProperties: {
          type: 'object',
          ref: 'CustomTheme',
        },
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
      showStatusInTitle: {
        type: 'boolean',
        label: 'Show Status in Title',
        category: 'UI',
        requiresRestart: false,
        default: false,
        description:
          'Show Gemini CLI status and thoughts in the terminal window title',
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
        description: 'Hide the application banner',
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
      footer: {
        type: 'object',
        label: 'Footer',
        category: 'UI',
        requiresRestart: false,
        default: {},
        description: 'Settings for the footer.',
        showInDialog: false,
        properties: {
          hideCWD: {
            type: 'boolean',
            label: 'Hide CWD',
            category: 'UI',
            requiresRestart: false,
            default: false,
            description:
              'Hide the current working directory path in the footer.',
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
        },
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
      useAlternateBuffer: {
        type: 'boolean',
        label: 'Use Alternate Screen Buffer',
        category: 'UI',
        requiresRestart: true,
        default: true,
        description:
          'Use an alternate screen buffer for the UI, preserving shell history.',
        showInDialog: true,
      },
      incrementalRendering: {
        type: 'boolean',
        label: 'Incremental Rendering',
        category: 'UI',
        requiresRestart: true,
        default: true,
        description:
          'Enable incremental rendering for the UI. Only supported when useAlternateBuffer is enabled.',
        showInDialog: true,
      },
      enableMouseEvents: {
        type: 'boolean',
        label: 'Enable Mouse Events',
        category: 'UI',
        requiresRestart: true,
        default: true,
        description:
          'Enable mouse event tracking for in-app scrolling. Disables terminal text selection and clickable links while active.',
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
      showLineNumbers: {
        type: 'boolean',
        label: 'Show Line Numbers',
        category: 'UI',
        requiresRestart: false,
        default: false,
        description: 'Show line numbers in the chat.',
        showInDialog: true,
      },
      showCitations: {
        type: 'boolean',
        label: 'Show Citations',
        category: 'UI',
        requiresRestart: false,
        default: false,
        description: 'Show citations for generated text in the chat.',
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
      wittyPhraseStyle: {
        type: 'enum',
        label: 'Witty Phrase Style',
        category: 'UI',
        requiresRestart: false,
        default: 'default',
        description:
          'Choose which collection of witty phrases to display during loading.',
        showInDialog: true,
        options: [
          { value: 'default', label: 'Default (LLxprt + Custom Override)' },
          { value: 'llxprt', label: 'LLxprt Built-in' },
          { value: 'gemini-cli', label: 'Gemini-cli Built-in' },
          { value: 'whimsical', label: 'Whimsical' },
          { value: 'custom', label: 'Custom Phrases Only' },
        ] satisfies ReadonlyArray<{ value: WittyPhraseStyle; label: string }>,
      },
      vimMode: {
        type: 'boolean',
        label: 'Vim Mode',
        category: 'UI',
        requiresRestart: false,
        default: false,
        description: 'Enable Vim keybindings in the input field.',
        showInDialog: true,
      },
      ideMode: {
        type: 'boolean',
        label: 'IDE Mode',
        category: 'UI',
        requiresRestart: false,
        default: false,
        description: 'Enable IDE integration mode.',
        showInDialog: true,
      },
      preferredEditor: {
        type: 'string',
        label: 'Preferred Editor',
        category: 'UI',
        requiresRestart: false,
        default: undefined as string | undefined,
        description: 'The preferred code editor for opening files.',
        showInDialog: false,
      },
      autoConfigureMaxOldSpaceSize: {
        type: 'boolean',
        label: 'Auto Configure Max Old Space Size',
        category: 'UI',
        requiresRestart: true,
        default: true,
        description:
          'Automatically configure Node.js max old space size based on system memory.',
        showInDialog: true,
      },
      historyMaxItems: {
        type: 'number',
        label: 'History Max Items',
        category: 'UI',
        requiresRestart: false,
        default: 100,
        description: 'Maximum number of history items to keep.',
        showInDialog: false,
      },
      historyMaxBytes: {
        type: 'number',
        label: 'History Max Bytes',
        category: 'UI',
        requiresRestart: false,
        default: 1048576,
        description: 'Maximum size of history in bytes.',
        showInDialog: false,
      },
      memoryImportFormat: {
        type: 'string',
        label: 'Memory Import Format',
        category: 'UI',
        requiresRestart: false,
        default: 'tree' as MemoryImportFormat,
        description: 'Format for importing memory files (tree or flat).',
        showInDialog: false,
      },
      memoryDiscoveryMaxDirs: {
        type: 'number',
        label: 'Memory Discovery Max Dirs',
        category: 'UI',
        requiresRestart: false,
        default: undefined as number | undefined,
        description: 'Maximum number of directories to scan for memory files.',
        showInDialog: false,
      },
      contextFileName: {
        type: 'string',
        label: 'Context File Name',
        category: 'UI',
        requiresRestart: false,
        default: undefined as string | string[] | undefined,
        ref: 'StringOrStringArray',
        description:
          'The name of the context file or files to load into memory. Accepts either a single string or an array of strings.',
        showInDialog: false,
      },
      usageStatisticsEnabled: {
        type: 'boolean',
        label: 'Usage Statistics Enabled',
        category: 'UI',
        requiresRestart: false,
        default: true,
        description: 'Enable anonymous usage statistics collection.',
        showInDialog: false,
      },
      maxSessionTurns: {
        type: 'number',
        label: 'Max Session Turns',
        category: 'UI',
        requiresRestart: false,
        default: -1,
        description: 'Maximum number of turns in a session (-1 for unlimited).',
        showInDialog: false,
      },
      showTodoPanel: {
        type: 'boolean',
        label: 'Show Todo Panel',
        category: 'UI',
        requiresRestart: false,
        default: true,
        description: 'Show the todo panel in the UI.',
        showInDialog: true,
      },
      useFullWidth: {
        type: 'boolean',
        label: 'Use Full Width',
        category: 'UI',
        requiresRestart: false,
        default: true,
        description: 'Use the entire width of the terminal for output.',
        showInDialog: true,
      },
      disableLoadingPhrases: {
        type: 'boolean',
        label: 'Disable Loading Phrases',
        category: 'UI',
        requiresRestart: true,
        default: false,
        description: 'Disable loading phrases for accessibility.',
        showInDialog: true,
      },
      screenReader: {
        type: 'boolean',
        label: 'Screen Reader Mode',
        category: 'UI',
        requiresRestart: true,
        default: false,
        description:
          'Render output in plain-text to be more screen reader accessible.',
        showInDialog: true,
      },
    },
  },

  ide: {
    type: 'object',
    label: 'IDE',
    category: 'IDE',
    requiresRestart: true,
    default: {},
    description: 'IDE integration settings.',
    showInDialog: false,
    properties: {},
  },

  showStatusInTitle: {
    type: 'boolean',
    label: 'Show Status in Title',
    category: 'UI',
    requiresRestart: false,
    default: false,
    description: 'Show LLxprt status and thoughts in the terminal window title',
    showInDialog: true,
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
    ref: 'TelemetrySettings',
  },
  bugCommand: {
    type: 'object',
    label: 'Bug Command',
    category: 'Advanced',
    requiresRestart: false,
    default: undefined as BugCommandSettings | undefined,
    description: 'Configuration for the bug report command.',
    showInDialog: false,
    ref: 'BugCommandSettings',
  },
  summarizeToolOutput: {
    type: 'object',
    label: 'Summarize Tool Output',
    category: 'Advanced',
    requiresRestart: false,
    default: undefined as Record<string, { tokenBudget?: number }> | undefined,
    description: oneLine`
      Enables or disables summarization of tool output.
      Configure per-tool token budgets (for example {"run_shell_command": {"tokenBudget": 2000}}).
      Currently only the run_shell_command tool supports summarization.
    `,
    showInDialog: false,
    additionalProperties: {
      type: 'object',
      description:
        'Per-tool summarization settings with an optional tokenBudget.',
      ref: 'SummarizeToolOutputSettings',
    },
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
        type: 'string',
        label: 'Sandbox',
        category: 'Tools',
        requiresRestart: true,
        default: undefined as boolean | string | undefined,
        ref: 'BooleanOrString',
        description: oneLine`
          Sandbox execution environment.
          Set to a boolean to enable or disable the sandbox, or provide a string path to a sandbox profile.
        `,
        showInDialog: false,
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
        default: undefined as boolean | undefined,
        description:
          'Use ripgrep for file content search instead of the fallback implementation. When unset, ripgrep is auto-enabled if detected.',
        showInDialog: true,
      },
      enableToolOutputTruncation: {
        type: 'boolean',
        label: 'Enable Tool Output Truncation',
        category: 'Tools',
        requiresRestart: true,
        default: true,
        description: 'Enable truncation of large tool outputs.',
        showInDialog: true,
      },
      truncateToolOutputThreshold: {
        type: 'number',
        label: 'Tool Output Truncation Threshold',
        category: 'Tools',
        requiresRestart: true,
        default: DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
        description:
          'Truncate tool output if it is larger than this many characters. Set to -1 to disable.',
        showInDialog: true,
      },
      truncateToolOutputLines: {
        type: 'number',
        label: 'Tool Output Truncation Lines',
        category: 'Tools',
        requiresRestart: true,
        default: DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
        description: 'The number of lines to keep when truncating tool output.',
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
      enableHooks: {
        type: 'boolean',
        label: 'Enable Hooks System',
        category: 'Advanced',
        requiresRestart: true,
        default: false,
        description:
          'Enable the hooks system for intercepting and customizing LLxprt CLI behavior. When enabled, hooks configured in settings will execute at appropriate lifecycle events (BeforeTool, AfterTool, BeforeModel, etc.). Requires MessageBus integration.',
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
  security: {
    type: 'object',
    label: 'Security',
    category: 'Security',
    requiresRestart: true,
    default: {},
    description: 'Security-related settings.',
    showInDialog: false,
    properties: {
      disableYoloMode: {
        type: 'boolean',
        label: 'Disable YOLO Mode',
        category: 'Security',
        requiresRestart: true,
        default: false,
        description: 'Disable YOLO mode, even if enabled by a flag.',
        showInDialog: true,
      },
      blockGitExtensions: {
        type: 'boolean',
        label: 'Blocks extensions from Git',
        category: 'Security',
        requiresRestart: true,
        default: false,
        description: 'Blocks installing and loading extensions from Git.',
        showInDialog: true,
      },
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
            default: undefined as string | undefined,
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

  experimental: {
    type: 'object',
    label: 'Experimental',
    category: 'Experimental',
    requiresRestart: true,
    default: {},
    description: 'Experimental features.',
    showInDialog: false,
    properties: {
      extensionReloading: {
        type: 'boolean',
        label: 'Extension Reloading',
        category: 'Experimental',
        requiresRestart: true,
        default: false,
        description:
          'Enables extension loading/unloading within the CLI session.',
        showInDialog: false,
      },
    },
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
    default: true,
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
            options: [
              { value: 'immediate', label: 'Immediate' },
              { value: 'on-restart', label: 'On Restart' },
              { value: 'manual', label: 'Manual' },
            ] as const,
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
            options: [
              { value: 'toast', label: 'Toast' },
              { value: 'dialog', label: 'Dialog' },
              { value: 'silent', label: 'Silent' },
            ] as const,
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
    type: 'enum',
    label: 'Shell Replacement',
    category: 'Advanced',
    requiresRestart: false,
    default: 'allowlist',
    description:
      'Control command substitution in shell commands: "allowlist" (validate inner commands against coreTools), "all" (allow all), "none" (block all).',
    showInDialog: false,
    options: [
      { value: 'allowlist', label: 'Validate against coreTools (default)' },
      { value: 'all', label: 'Allow all substitution' },
      { value: 'none', label: 'Block all substitution' },
    ] satisfies ReadonlyArray<{ value: string; label: string }>,
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
    default: undefined as boolean | undefined,
    description:
      'Use ripgrep for file content search instead of the fallback implementation. When unset, ripgrep is auto-enabled if detected.',
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
  enableFuzzyFiltering: {
    type: 'boolean',
    label: 'Enable Fuzzy Filtering',
    category: 'UI',
    requiresRestart: false,
    default: true,
    description:
      'Enable fuzzy filtering for command menu completions. When enabled, you can type partial characters (e.g., "prd" to match "production"). When disabled, only exact prefix matches are shown.',
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
  customWittyPhrases: {
    type: 'array',
    label: 'Custom Witty Phrases',
    category: 'UI',
    requiresRestart: false,
    default: [] as string[],
    description: oneLine`
      Custom witty phrases to display during loading.
      When provided, the CLI cycles through these instead of the defaults.
    `,
    showInDialog: false,
    items: { type: 'string' },
  },
  wittyPhraseStyle: {
    type: 'enum',
    label: 'Witty Phrase Style',
    category: 'UI',
    requiresRestart: false,
    default: 'default',
    description:
      'Choose which collection of witty phrases to display during loading.',
    showInDialog: true,
    options: [
      { value: 'default', label: 'Default (LLxprt + Custom Override)' },
      { value: 'llxprt', label: 'LLxprt Built-in' },
      { value: 'gemini-cli', label: 'Gemini-cli Built-in' },
      { value: 'whimsical', label: 'Whimsical' },
      { value: 'custom', label: 'Custom Phrases Only' },
    ] satisfies ReadonlyArray<{ value: WittyPhraseStyle; label: string }>,
  },

  hooks: {
    type: 'object',
    label: 'Hooks',
    category: 'Advanced',
    requiresRestart: false,
    default: {} as { [K in HookEventName]?: HookDefinition[] },
    description:
      'Hook configurations for intercepting and customizing agent behavior.',
    showInDialog: false,
    mergeStrategy: MergeStrategy.SHALLOW_MERGE,
  },
} as const;

export type SettingsSchemaType = typeof SETTINGS_SCHEMA;

export type SettingsJsonSchemaDefinition = Record<string, unknown>;

export const SETTINGS_SCHEMA_DEFINITIONS: Record<
  string,
  SettingsJsonSchemaDefinition
> = {
  MCPServerConfig: {
    type: 'object',
    description:
      'Definition of a Model Context Protocol (MCP) server configuration.',
    additionalProperties: false,
    properties: {
      command: {
        type: 'string',
        description: 'Executable invoked for stdio transport.',
      },
      args: {
        type: 'array',
        description: 'Command-line arguments for the stdio transport command.',
        items: { type: 'string' },
      },
      env: {
        type: 'object',
        description: 'Environment variables to set for the server process.',
        additionalProperties: { type: 'string' },
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the server process.',
      },
      url: {
        type: 'string',
        description: 'SSE transport URL.',
      },
      httpUrl: {
        type: 'string',
        description: 'Streaming HTTP transport URL.',
      },
      headers: {
        type: 'object',
        description: 'Additional HTTP headers sent to the server.',
        additionalProperties: { type: 'string' },
      },
      tcp: {
        type: 'string',
        description: 'TCP address for websocket transport.',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds for MCP requests.',
      },
      trust: {
        type: 'boolean',
        description:
          'Marks the server as trusted. Trusted servers may gain additional capabilities.',
      },
      description: {
        type: 'string',
        description: 'Human-readable description of the server.',
      },
      includeTools: {
        type: 'array',
        description:
          'Subset of tools that should be enabled for this server. When omitted all tools are enabled.',
        items: { type: 'string' },
      },
      excludeTools: {
        type: 'array',
        description:
          'Tools that should be disabled for this server even if exposed.',
        items: { type: 'string' },
      },
      extension: {
        type: 'object',
        description:
          'Metadata describing the LLxprt Code extension that owns this MCP server.',
        additionalProperties: { type: ['string', 'boolean', 'number'] },
      },
      oauth: {
        type: 'object',
        description: 'OAuth configuration for authenticating with the server.',
        additionalProperties: true,
      },
      authProviderType: {
        type: 'string',
        description:
          'Authentication provider used for acquiring credentials (for example `dynamic_discovery`).',
        enum: [
          'dynamic_discovery',
          'google_credentials',
          'service_account_impersonation',
        ],
      },
      targetAudience: {
        type: 'string',
        description:
          'OAuth target audience (CLIENT_ID.apps.googleusercontent.com).',
      },
      targetServiceAccount: {
        type: 'string',
        description:
          'Service account email to impersonate (name@project.iam.gserviceaccount.com).',
      },
    },
  },
  TelemetrySettings: {
    type: 'object',
    description: 'Telemetry configuration for LLxprt Code.',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        description: 'Enables telemetry emission.',
      },
      target: {
        type: 'string',
        description:
          'Telemetry destination (for example `stderr`, `stdout`, or `otlp`).',
      },
      otlpEndpoint: {
        type: 'string',
        description: 'Endpoint for OTLP exporters.',
      },
      otlpProtocol: {
        type: 'string',
        description: 'Protocol for OTLP exporters.',
        enum: ['grpc', 'http'],
      },
      logPrompts: {
        type: 'boolean',
        description: 'Whether prompts are logged in telemetry payloads.',
      },
      outfile: {
        type: 'string',
        description: 'File path for writing telemetry output.',
      },
      useCollector: {
        type: 'boolean',
        description: 'Whether to forward telemetry to an OTLP collector.',
      },
    },
  },
  BugCommandSettings: {
    type: 'object',
    description: 'Configuration for the bug report helper command.',
    additionalProperties: false,
    properties: {
      urlTemplate: {
        type: 'string',
        description:
          'Template used to open a bug report URL. Variables in the template are populated at runtime.',
      },
    },
    required: ['urlTemplate'],
  },
  SummarizeToolOutputSettings: {
    type: 'object',
    description:
      'Controls summarization behavior for individual tools. All properties are optional.',
    additionalProperties: false,
    properties: {
      tokenBudget: {
        type: 'number',
        description:
          'Maximum number of tokens used when summarizing tool output.',
      },
    },
  },
  CustomTheme: {
    type: 'object',
    description:
      'Custom theme definition used for styling LLxprt Code output. Colors are provided as hex strings or named ANSI colors.',
    additionalProperties: false,
    properties: {
      type: {
        type: 'string',
        enum: ['custom'],
        default: 'custom',
      },
      name: {
        type: 'string',
        description: 'Theme display name.',
      },
      text: {
        type: 'object',
        additionalProperties: false,
        properties: {
          primary: { type: 'string' },
          secondary: { type: 'string' },
          link: { type: 'string' },
          accent: { type: 'string' },
        },
      },
      background: {
        type: 'object',
        additionalProperties: false,
        properties: {
          primary: { type: 'string' },
          diff: {
            type: 'object',
            additionalProperties: false,
            properties: {
              added: { type: 'string' },
              removed: { type: 'string' },
            },
          },
        },
      },
      border: {
        type: 'object',
        additionalProperties: false,
        properties: {
          default: { type: 'string' },
          focused: { type: 'string' },
        },
      },
      ui: {
        type: 'object',
        additionalProperties: false,
        properties: {
          comment: { type: 'string' },
          symbol: { type: 'string' },
          gradient: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
      status: {
        type: 'object',
        additionalProperties: false,
        properties: {
          error: { type: 'string' },
          success: { type: 'string' },
          warning: { type: 'string' },
        },
      },
      Background: { type: 'string' },
      Foreground: { type: 'string' },
      LightBlue: { type: 'string' },
      AccentBlue: { type: 'string' },
      AccentPurple: { type: 'string' },
      AccentCyan: { type: 'string' },
      AccentGreen: { type: 'string' },
      AccentYellow: { type: 'string' },
      AccentRed: { type: 'string' },
      DiffAdded: { type: 'string' },
      DiffRemoved: { type: 'string' },
      Comment: { type: 'string' },
      Gray: { type: 'string' },
      DarkGray: { type: 'string' },
      GradientColors: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['type', 'name'],
  },
  StringOrStringArray: {
    description: 'Accepts either a single string or an array of strings.',
    anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  },
  BooleanOrString: {
    description: 'Accepts either a boolean flag or a string command name.',
    anyOf: [{ type: 'boolean' }, { type: 'string' }],
  },
};

export function getSettingsSchema(): SettingsSchemaType {
  return SETTINGS_SCHEMA;
}

type InferSettings<T extends SettingsSchema> = {
  -readonly [K in keyof T]?: T[K] extends { properties: SettingsSchema }
    ? InferSettings<T[K]['properties']>
    : T[K]['type'] extends 'enum'
      ? T[K]['options'] extends readonly SettingEnumOption[]
        ? T[K]['options'][number]['value']
        : T[K]['default']
      : T[K]['default'] extends boolean
        ? boolean
        : T[K]['default'];
};

export type Settings = InferSettings<SettingsSchemaType>;

export interface FooterSettings {
  hideCWD?: boolean;
  hideSandboxStatus?: boolean;
  hideModelInfo?: boolean;
}
