import type {
  BugCommandSettings,
  TelemetrySettings,
} from '@vybestack/llxprt-code-core';
import {
  DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
} from '@vybestack/llxprt-code-core';
import type { DnsResolutionOrder } from './types.js';

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

export const SECURITY_SETTINGS_SCHEMA = {
  ide: {
    type: 'object',
    label: 'IDE',
    category: 'IDE',
    requiresRestart: true,
    default: {},
    description: 'IDE integration settings.',
    showInDialog: false,
    properties: {
      enabled: {
        type: 'boolean',
        label: 'IDE Mode',
        category: 'IDE',
        requiresRestart: true,
        default: false,
        description: 'Enable IDE integration mode.',
        showInDialog: true,
      },
      hasSeenNudge: {
        type: 'boolean',
        label: 'Has Seen IDE Integration Nudge',
        category: 'IDE',
        requiresRestart: false,
        default: false,
        description: 'Whether the user has seen the IDE integration nudge.',
        showInDialog: false,
      },
    },
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
        label: 'Enable Hooks System (Experimental)',
        category: 'Advanced',
        requiresRestart: true,
        default: true,
        description:
          'Enables the hooks system experiment. When disabled, the hooks system is completely deactivated regardless of other settings.',
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
  subagents: {
    type: 'object',
    label: 'Subagents',
    category: 'Subagents',
    requiresRestart: false,
    default: {},
    description: 'Settings for subagent behavior.',
    showInDialog: false,
    properties: {
      asyncEnabled: {
        type: 'boolean',
        label: 'Async Subagents Enabled',
        category: 'Subagents',
        requiresRestart: false,
        default: true,
        description:
          'Globally allow background subagent runs. If off, async=true launches are blocked even if a profile enables them.',
        showInDialog: true,
      },
      maxAsync: {
        type: 'number',
        label: 'Maximum Async Tasks',
        category: 'Subagents',
        requiresRestart: false,
        default: 5,
        minimum: -1,
        description:
          'Maximum concurrent async tasks. Profile setting (task-max-async) can limit but not exceed this value. Use -1 for unlimited.',
        showInDialog: true,
      },
      definitions: {
        type: 'object',
        label: 'Subagent Definitions',
        category: 'Subagents',
        requiresRestart: true,
        default: {} as Record<
          string,
          { profile: string; systemPrompt: string }
        >,
        description:
          'Inline subagent definitions keyed by name. Each value must contain profile and systemPrompt.',
        showInDialog: false,
        additionalProperties: {
          type: 'object',
          ref: 'SubagentDefinition',
        },
      },
    },
  },
} as const;
