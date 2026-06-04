/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type {
  DnsResolutionOrder,
  MemoryImportFormat,
  SettingCollectionDefinition,
  SettingDefinition,
  SettingEnumOption,
  SettingsSchema,
  SettingsType,
  SettingsValue,
  ToolEnabledState,
} from './settings-schema/types.js';
export { MergeStrategy, TOGGLE_TYPES } from './settings-schema/types.js';
export { SETTINGS_SCHEMA } from './settings-schema/schema.js';
import { SETTINGS_SCHEMA } from './settings-schema/schema.js';
import type {
  SettingEnumOption,
  SettingsSchema,
} from './settings-schema/types.js';

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
        description:
          'URL for SSE or HTTP transport. Use with "type" field to specify transport type.',
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
      type: {
        type: 'string',
        description:
          'Transport type. Use "stdio" for local command, "sse" for Server-Sent Events, or "http" for Streamable HTTP.',
        enum: ['stdio', 'sse', 'http'],
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
  SubagentDefinition: {
    type: 'object',
    description: 'Definition of a subagent configuration.',
    additionalProperties: false,
    properties: {
      profile: {
        type: 'string',
        description: 'Reference to profile name in ~/.llxprt/profiles/',
      },
      systemPrompt: {
        type: 'string',
        description: 'System prompt text for this subagent.',
      },
    },
    required: ['profile', 'systemPrompt'],
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
  BooleanOrLspConfig: {
    description:
      'Set to true to enable LSP with defaults, false to disable, or provide an object to configure LSP servers and diagnostics behavior.',
    anyOf: [
      { type: 'boolean' },
      {
        type: 'object',
        properties: {
          servers: {
            type: 'array',
            description: 'Custom LSP server definitions.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                command: { type: 'string' },
                args: { type: 'array', items: { type: 'string' } },
              },
              required: ['id', 'command'],
            },
          },
          includeSeverities: {
            type: 'array',
            description: 'Diagnostic severity levels to include.',
            items: {
              type: 'string',
              enum: ['error', 'warning', 'info', 'hint'],
            },
          },
          maxDiagnosticsPerFile: {
            type: 'number',
            description: 'Maximum number of diagnostics per file.',
          },
          maxProjectDiagnosticsFiles: {
            type: 'number',
            description:
              'Maximum number of files included in project diagnostics.',
          },
          diagnosticTimeout: {
            type: 'number',
            description: 'Timeout in milliseconds for diagnostic requests.',
          },
          firstTouchTimeout: {
            type: 'number',
            description:
              'Timeout in milliseconds for first-touch diagnostic requests.',
          },
          navigationTools: {
            type: 'boolean',
            description:
              'Whether to register LSP navigation tools (goto definition, find references, etc.).',
          },
        },
      },
    ],
  },
};

export function getSettingsSchema(): SettingsSchemaType {
  return SETTINGS_SCHEMA;
}

/**
 * Determines if hooks UI should be visible (commands, status indicators).
 * Gated only by the experimental tools.enableHooks flag.
 */
export function getEnableHooksUI(settings: Settings): boolean {
  return settings.tools?.enableHooks ?? true;
}

/**
 * Determines if hooks should be enabled based on both experimental flag and user setting.
 * Both tools.enableHooks (experimental gate) and hooksConfig.enabled (user toggle) must be true.
 */
export function getEnableHooks(settings: Settings): boolean {
  return getEnableHooksUI(settings) && (settings.hooksConfig?.enabled ?? false);
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

/**
 * Settings type for the merged settings object. Sub-objects that are
 * always populated by mergeSettings() are marked as required.
 */
export type MergedSettings = Settings & {
  ui: NonNullable<Settings['ui']>;
  security: NonNullable<Settings['security']>;
  telemetry: NonNullable<Settings['telemetry']>;
  extensions: NonNullable<Settings['extensions']>;
  mcp: NonNullable<Settings['mcp']>;
  tools: NonNullable<Settings['tools']>;
  chatCompression: NonNullable<Settings['chatCompression']>;
};

export interface FooterSettings {
  hideCWD?: boolean;
  hideSandboxStatus?: boolean;
  hideModelInfo?: boolean;
}
