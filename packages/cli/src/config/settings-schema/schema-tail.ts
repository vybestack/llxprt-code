import type {
  HookDefinition,
  HookEventName,
} from '@vybestack/llxprt-code-core';
import { type WittyPhraseStyle } from '../../ui/constants/phrasesCollections.js';
import { MergeStrategy } from './types.js';

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

export const TAIL_SETTINGS_SCHEMA = {
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
  showProfileChangeInChat: {
    type: 'boolean',
    label: 'Show Profile Change in Chat',
    category: 'General',
    requiresRestart: false,
    default: true,
    description: 'Show a message in chat when the active profile changes.',
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

  skills: {
    type: 'object',
    label: 'Skills',
    category: 'Advanced',
    requiresRestart: true,
    default: {},
    description: 'Settings for skills.',
    showInDialog: false,
    properties: {
      enabled: {
        type: 'boolean',
        label: 'Enable Agent Skills',
        category: 'Advanced',
        requiresRestart: true,
        default: true,
        description: 'Enable Agent Skills.',
        showInDialog: true,
        ignoreInDocs: true,
      },
      disabled: {
        type: 'array',
        label: 'Disabled Skills',
        category: 'Advanced',
        requiresRestart: true,
        default: [] as string[],
        description: 'List of disabled skills.',
        showInDialog: false,
        items: { type: 'string' },
        mergeStrategy: MergeStrategy.UNION,
      },
    },
  },

  hooksConfig: {
    type: 'object',
    label: 'HooksConfig',
    category: 'Advanced',
    requiresRestart: false,
    default: {},
    description: 'Configuration settings for the hooks system.',
    showInDialog: false,
    properties: {
      enabled: {
        type: 'boolean',
        label: 'Enable Hooks',
        category: 'Advanced',
        requiresRestart: false,
        default: false,
        description:
          'Canonical toggle for the hooks system. When disabled, no hooks will be executed.',
        showInDialog: false,
      },
      notifications: {
        type: 'boolean',
        label: 'Hook Notifications',
        default: true,
        category: 'Advanced',
        description: 'Show visual indicators when hooks are executing.',
        showInDialog: true,
        requiresRestart: false,
      },
      disabled: {
        type: 'array',
        label: 'Disabled Hooks',
        category: 'Advanced',
        requiresRestart: false,
        default: [] as string[],
        description:
          'List of hook names (commands) that should be disabled. Hooks in this list will not execute even if configured.',
        showInDialog: false,
      },
    },
  },

  hooks: {
    type: 'object',
    label: 'Hook Events',
    category: 'Advanced',
    requiresRestart: false,
    default: {} as { [K in HookEventName]?: HookDefinition[] },
    description: 'Event-specific hook configurations.',
    showInDialog: false,
    mergeStrategy: MergeStrategy.SHALLOW_MERGE,
  },
  admin: {
    type: 'object',
    label: 'Admin',
    category: 'Admin',
    requiresRestart: false,
    default: {},
    description: 'Settings configured remotely by enterprise admins.',
    showInDialog: false,
    mergeStrategy: MergeStrategy.REPLACE,
    properties: {
      secureModeEnabled: {
        type: 'boolean',
        label: 'Secure Mode Enabled',
        category: 'Admin',
        requiresRestart: false,
        default: false,
        description: 'If true, disallows YOLO mode from being used.',
        showInDialog: false,
        mergeStrategy: MergeStrategy.REPLACE,
      },
      extensions: {
        type: 'object',
        label: 'Extensions Settings',
        category: 'Admin',
        requiresRestart: false,
        default: {},
        description: 'Extensions-specific admin settings.',
        showInDialog: false,
        mergeStrategy: MergeStrategy.REPLACE,
        properties: {
          enabled: {
            type: 'boolean',
            label: 'Extensions Enabled',
            category: 'Admin',
            requiresRestart: false,
            default: true,
            description:
              'If false, disallows extensions from being installed or used.',
            showInDialog: false,
            mergeStrategy: MergeStrategy.REPLACE,
          },
        },
      },
      mcp: {
        type: 'object',
        label: 'MCP Settings',
        category: 'Admin',
        requiresRestart: false,
        default: {},
        description: 'MCP-specific admin settings.',
        showInDialog: false,
        mergeStrategy: MergeStrategy.REPLACE,
        properties: {
          enabled: {
            type: 'boolean',
            label: 'MCP Enabled',
            category: 'Admin',
            requiresRestart: false,
            default: true,
            description: 'If false, disallows MCP servers from being used.',
            showInDialog: false,
            mergeStrategy: MergeStrategy.REPLACE,
          },
        },
      },
      skills: {
        type: 'object',
        label: 'Skills Settings',
        category: 'Admin',
        requiresRestart: false,
        default: {},
        description: 'Skills-specific admin settings.',
        showInDialog: false,
        mergeStrategy: MergeStrategy.REPLACE,
        properties: {
          enabled: {
            type: 'boolean',
            label: 'Skills Enabled',
            category: 'Admin',
            requiresRestart: false,
            default: true,
            description: 'If false, disallows agent skills from being used.',
            showInDialog: false,
            mergeStrategy: MergeStrategy.REPLACE,
          },
        },
      },
    },
  },
} as const;
