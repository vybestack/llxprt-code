/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Declarative yargs option definitions for the LLxprt CLI.
 * This module contains only static data — no command wiring, no runtime logic.
 */

import { OutputFormat } from '@vybestack/llxprt-code-core';
import type { Options } from 'yargs';

/**
 * Options registered on the root command scope (accessible before subcommand dispatch).
 * These duplicate a subset of the inner-command options intentionally so that
 * `--provider`, `--key`, etc. are parseable during bootstrap arg scanning.
 */
export const rootOptions: Record<string, Options> = {
  telemetry: {
    type: 'boolean',
    description:
      'Enable telemetry? This flag specifically controls if telemetry is sent. Other --telemetry-* flags set specific values but do not enable telemetry on their own.',
  },
  'telemetry-target': {
    type: 'string',
    choices: ['local', 'gcp'],
    description:
      'Set the telemetry target (local or gcp). Overrides settings files.',
  },
  'telemetry-otlp-endpoint': {
    type: 'string',
    description:
      'Set the OTLP endpoint for telemetry. Overrides environment variables and settings files.',
  },
  'telemetry-log-prompts': {
    type: 'boolean',
    description:
      'Enable or disable logging of user prompts for telemetry. Overrides settings files.',
  },
  'telemetry-outfile': {
    type: 'string',
    description: 'Redirect all telemetry output to the specified file.',
  },
  checkpointing: {
    alias: 'c',
    type: 'boolean',
    description: 'Enables checkpointing of file edits',
    default: false,
  },
  'experimental-acp': {
    type: 'boolean',
    description: 'Starts the agent in ACP mode',
  },
  'experimental-ui': {
    type: 'boolean',
    description:
      'Use experimental terminal UI (requires bun and @vybestack/llxprt-ui)',
  },
  'allowed-mcp-server-names': {
    type: 'array',
    string: true,
    description: 'Allowed MCP server names',
  },
  extensions: {
    alias: 'e',
    type: 'array',
    string: true,
    description:
      'A list of extensions to use. If not provided, all extensions are used.',
  },
  'list-extensions': {
    alias: 'l',
    type: 'boolean',
    description: 'List all available extensions and exit.',
  },
  provider: {
    type: 'string',
    description: 'The provider to use.',
    // Don't set default here, handle it in loadCliConfig
  },
  'ide-mode': {
    type: 'string',
    choices: ['enable', 'disable'],
    description: 'Enable or disable IDE mode',
  },
  key: {
    type: 'string',
    description: 'API key for the current provider',
  },
  keyfile: {
    type: 'string',
    description: 'Path to file containing API key for the current provider',
  },
  'key-name': {
    type: 'string',
    description:
      'Load a named API key from the keyring (same as /key load <name>)',
  },
  baseurl: {
    type: 'string',
    description: 'Base URL for the current provider',
  },
  proxy: {
    type: 'string',
    description:
      'Proxy for gemini client, like schema://user:password@host:port',
  },
  'include-directories': {
    type: 'array',
    string: true,
    description:
      'Additional directories to include in the workspace (comma-separated or multiple --include-directories)',
    coerce: (dirs: string[]) =>
      dirs.flatMap((dir) => dir.split(',').map((d) => d.trim())),
  },
  set: {
    type: 'array',
    string: true,
    description: 'Set an ephemeral setting via key=value (can be repeated)',
    coerce: (entries: unknown[]) =>
      entries.map((entry) => {
        if (typeof entry !== 'string') {
          throw new Error(
            `Invalid value for --set: ${String(entry)}. Expected key=value string.`,
          );
        }
        return entry;
      }),
  },
  'profile-load': {
    type: 'string',
    description: 'Load a saved profile configuration on startup',
  },
  profile: {
    type: 'string',
    description:
      'Inline JSON profile configuration (alternative to --profile-load for CI/CD)',
  },
  'load-memory-from-include-directories': {
    type: 'boolean',
    description:
      'If true, when refreshing memory, LLXPRT.md files should be loaded from all directories that are added. If false, LLXPRT.md files should only be loaded from the primary working directory.',
  },
};

/**
 * Options registered inside the default command handler (`$0 [promptWords...]`).
 * These are the primary CLI flags available to end users.
 */
export const innerCommandOptions: Record<string, Options> = {
  model: {
    alias: 'm',
    type: 'string',
    description: `Model`,
    // Don't set default here, handle it in loadCliConfig
  },
  prompt: {
    alias: 'p',
    type: 'string',
    description: 'Prompt. Appended to input on stdin (if any).',
  },
  'prompt-interactive': {
    alias: 'i',
    type: 'string',
    description: 'Execute the provided prompt and continue in interactive mode',
  },
  'output-format': {
    type: 'string',
    choices: [OutputFormat.TEXT, OutputFormat.JSON, OutputFormat.STREAM_JSON],
    description:
      'Output format for non-interactive mode (text, json, or stream-json).',
  },
  sandbox: {
    alias: 's',
    type: 'boolean',
    description: 'Run in sandbox?',
  },
  'sandbox-image': {
    type: 'string',
    description: 'Sandbox image URI.',
  },
  'sandbox-engine': {
    type: 'string',
    choices: ['auto', 'docker', 'podman', 'sandbox-exec', 'none'],
    description: 'Sandbox engine (auto|docker|podman|sandbox-exec|none).',
  },
  'sandbox-profile-load': {
    type: 'string',
    description: 'Load a sandbox profile from ~/.llxprt/sandboxes/<name>.json',
  },
  debug: {
    alias: 'd',
    type: 'boolean',
    description: 'Run in debug mode?',
    default: false,
  },
  'show-memory-usage': {
    type: 'boolean',
    description: 'Show memory usage in status bar',
    default: false,
  },
  yolo: {
    alias: 'y',
    type: 'boolean',
    description:
      'Automatically accept all actions (aka YOLO mode, see https://www.youtube.com/watch?v=xvFZjo5PgG0 for more details)?',
    default: false,
  },
  'approval-mode': {
    type: 'string',
    choices: ['default', 'auto_edit', 'yolo'],
    description:
      'Set the approval mode: default (prompt for approval), auto_edit (auto-approve edit tools), yolo (auto-approve all tools)',
  },
  telemetry: {
    type: 'boolean',
    description:
      'Enable telemetry? This flag specifically controls if telemetry is sent. Other --telemetry-* flags set specific values but do not enable telemetry on their own.',
  },
  'telemetry-target': {
    type: 'string',
    choices: ['local', 'gcp'],
    description:
      'Set the telemetry target (local or gcp). Overrides settings files.',
  },
  'telemetry-otlp-endpoint': {
    type: 'string',
    description:
      'Set the OTLP endpoint for telemetry. Overrides environment variables and settings files.',
  },
  'telemetry-log-prompts': {
    type: 'boolean',
    description:
      'Enable or disable logging of user prompts for telemetry. Overrides settings files.',
  },
  'telemetry-outfile': {
    type: 'string',
    description: 'Redirect all telemetry output to the specified file.',
  },
  checkpointing: {
    alias: 'c',
    type: 'boolean',
    description: 'Enables checkpointing of file edits',
    default: false,
  },
  'experimental-acp': {
    type: 'boolean',
    description: 'Starts the agent in ACP mode',
  },
  'experimental-ui': {
    type: 'boolean',
    description:
      'Use experimental terminal UI (requires bun and @vybestack/llxprt-ui)',
  },
  'allowed-mcp-server-names': {
    type: 'array',
    string: true,
    description: 'Allowed MCP server names',
    coerce: (mcpServerNames: string[]) =>
      mcpServerNames.flatMap((mcpServerName) =>
        mcpServerName.split(',').map((m) => m.trim()),
      ),
  },
  'allowed-tools': {
    type: 'array',
    string: true,
    description: 'Tools that are allowed to run without confirmation',
    coerce: (tools: string[]) =>
      tools.flatMap((tool) => tool.split(',').map((t) => t.trim())),
  },
  extensions: {
    alias: 'e',
    type: 'array',
    string: true,
    nargs: 1,
    description:
      'A list of extensions to use. If not provided, all extensions are used.',
    coerce: (extensions: string[]) =>
      extensions.flatMap((extension) =>
        extension.split(',').map((e) => e.trim()),
      ),
  },
  'list-extensions': {
    alias: 'l',
    type: 'boolean',
    description: 'List all available extensions and exit.',
  },
  proxy: {
    type: 'string',
    description:
      'Proxy for LLxprt client, like schema://user:password@host:port',
  },
  'include-directories': {
    type: 'array',
    string: true,
    description:
      'Additional directories to include in the workspace (comma-separated or multiple --include-directories)',
    coerce: (dirs: string[]) =>
      dirs.flatMap((dir) => dir.split(',').map((d) => d.trim())),
  },
  'screen-reader': {
    type: 'boolean',
    description: 'Enable screen reader mode for accessibility.',
  },
  'session-summary': {
    type: 'string',
    description: 'File to write session summary to.',
  },
  dumponerror: {
    type: 'boolean',
    description: 'Dump request body to ~/.llxprt/dumps/ on API errors.',
    default: false,
  },
  continue: {
    alias: 'C',
    type: 'string',
    skipValidation: true,
    description:
      'Resume a previous session. Bare --continue resumes the most recent. --continue <id> resumes a specific session.',
    coerce: (value: string): string => {
      if (value === '') {
        return value;
      }
      return value;
    },
  },
  'list-sessions': {
    type: 'boolean',
    description: 'List recorded sessions for the current project.',
    default: false,
  },
  'delete-session': {
    type: 'string',
    description: 'Delete a recorded session by ID, prefix, or 1-based index.',
  },
  nobrowser: {
    type: 'boolean',
    description: 'Skip browser OAuth flow, use manual code entry',
    default: false,
  },
};

/** Options that are deprecated and should show deprecation warnings. */
export const deprecatedOptions = [
  {
    key: 'telemetry',
    message:
      'Use settings.json instead. This flag will be removed in a future version.',
  },
  {
    key: 'telemetry-target',
    message:
      'Use settings.json instead. This flag will be removed in a future version.',
  },
  {
    key: 'telemetry-otlp-endpoint',
    message:
      'Use settings.json instead. This flag will be removed in a future version.',
  },
  {
    key: 'telemetry-otlp-protocol',
    message:
      'Use settings.json instead. This flag will be removed in a future version.',
  },
  {
    key: 'telemetry-log-prompts',
    message:
      'Use settings.json instead. This flag will be removed in a future version.',
  },
  {
    key: 'telemetry-outfile',
    message:
      'Use settings.json instead. This flag will be removed in a future version.',
  },
  {
    key: 'show-memory-usage',
    message:
      'Use settings.json instead. This flag will be removed in a future version.',
  },
  {
    key: 'sandbox-image',
    message:
      'Use settings.json instead. This flag will be removed in a future version.',
  },
  {
    key: 'proxy',
    message:
      'Use settings.json instead. This flag will be removed in a future version.',
  },
  {
    key: 'checkpointing',
    message:
      'Use settings.json instead. This flag will be removed in a future version.',
  },
] as const;
