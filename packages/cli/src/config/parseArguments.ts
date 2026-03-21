/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P29
 * CLI argument parsing with yargs
 */

import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import process from 'node:process';
import { mcpCommand } from '../commands/mcp.js';
import { skillsCommand } from '../commands/skills.js';
import { hooksCommand } from '../commands/hooks.js';
import { extensionsCommand } from '../commands/extensions.js';
import { OutputFormat } from '@vybestack/llxprt-code-core';
import { Settings } from './settings.js';
import { getCliVersion } from '../utils/version.js';

export interface CliArgs {
  model: string | undefined;
  sandbox: boolean | string | undefined;
  sandboxImage: string | undefined;
  sandboxEngine: string | undefined;
  sandboxProfileLoad: string | undefined;
  debug: boolean | undefined;
  prompt: string | undefined;
  promptInteractive: string | undefined;
  outputFormat: string | undefined;

  showMemoryUsage: boolean | undefined;
  yolo: boolean | undefined;
  approvalMode: string | undefined;
  telemetry: boolean | undefined;
  checkpointing: boolean | undefined;
  telemetryTarget: string | undefined;
  telemetryOtlpEndpoint: string | undefined;
  telemetryLogPrompts: boolean | undefined;
  telemetryOutfile: string | undefined;
  allowedMcpServerNames: string[] | undefined;
  allowedTools: string[] | undefined;
  experimentalAcp: boolean | undefined;
  experimentalUi: boolean | undefined;
  extensions: string[] | undefined;
  listExtensions: boolean | undefined;
  provider: string | undefined;
  key: string | undefined;
  keyfile: string | undefined;
  baseurl: string | undefined;
  proxy: string | undefined;
  includeDirectories: string[] | undefined;
  profileLoad: string | undefined;
  loadMemoryFromIncludeDirectories: boolean | undefined;
  ideMode: string | undefined;
  screenReader: boolean | undefined;
  sessionSummary: string | undefined;
  dumponerror: boolean | undefined;
  promptWords: string[] | undefined;
  query: string | undefined;
  set: string[] | undefined;
  /** @plan PLAN-20260211-SESSIONRECORDING.P24 — widened to support --continue <session-id> */
  continue: string | boolean | undefined;
  nobrowser: boolean | undefined;
  /** @plan:PLAN-20260211-SESSIONRECORDING.P26 — list recorded sessions */
  listSessions: boolean | undefined;
  /** @plan:PLAN-20260211-SESSIONRECORDING.P26 — delete a recorded session by ref */
  deleteSession: string | undefined;
}

export async function parseArguments(settings: Settings): Promise<CliArgs> {
  const yargsInstance = yargs(hideBin(process.argv))
    .locale('en')
    .scriptName('llxprt')
    .usage(
      '$0 [options]',
      'LLxprt Code - Launch an interactive CLI, use -p/--prompt for non-interactive mode',
    )
    .command('$0 [promptWords...]', 'Launch LLxprt CLI', (yargsInstance) =>
      yargsInstance
        .option('model', {
          alias: 'm',
          type: 'string',
          description: `Model`,
          // Don't set default here, handle it in loadCliConfig
        })
        .option('prompt', {
          alias: 'p',
          type: 'string',
          description: 'Prompt. Appended to input on stdin (if any).',
        })
        .option('prompt-interactive', {
          alias: 'i',
          type: 'string',
          description:
            'Execute the provided prompt and continue in interactive mode',
        })
        .option('output-format', {
          type: 'string',
          choices: [
            OutputFormat.TEXT,
            OutputFormat.JSON,
            OutputFormat.STREAM_JSON,
          ],
          description:
            'Output format for non-interactive mode (text, json, or stream-json).',
        })
        .option('sandbox', {
          alias: 's',
          type: 'boolean',
          description: 'Run in sandbox?',
        })
        .option('sandbox-image', {
          type: 'string',
          description: 'Sandbox image URI.',
        })
        .option('sandbox-engine', {
          type: 'string',
          choices: ['auto', 'docker', 'podman', 'sandbox-exec', 'none'],
          description: 'Sandbox engine (auto|docker|podman|sandbox-exec|none).',
        })
        .option('sandbox-profile-load', {
          type: 'string',
          description:
            'Load a sandbox profile from ~/.llxprt/sandboxes/<name>.json',
        })
        .option('debug', {
          alias: 'd',
          type: 'boolean',
          description: 'Run in debug mode?',
          default: false,
        })

        .option('show-memory-usage', {
          type: 'boolean',
          description: 'Show memory usage in status bar',
          default: false,
        })
        .option('yolo', {
          alias: 'y',
          type: 'boolean',
          description:
            'Automatically accept all actions (aka YOLO mode, see https://www.youtube.com/watch?v=xvFZjo5PgG0 for more details)?',
          default: false,
        })
        .option('approval-mode', {
          type: 'string',
          choices: ['default', 'auto_edit', 'yolo'],
          description:
            'Set the approval mode: default (prompt for approval), auto_edit (auto-approve edit tools), yolo (auto-approve all tools)',
        })
        .option('telemetry', {
          type: 'boolean',
          description:
            'Enable telemetry? This flag specifically controls if telemetry is sent. Other --telemetry-* flags set specific values but do not enable telemetry on their own.',
        })
        .option('telemetry-target', {
          type: 'string',
          choices: ['local', 'gcp'],
          description:
            'Set the telemetry target (local or gcp). Overrides settings files.',
        })
        .option('telemetry-otlp-endpoint', {
          type: 'string',
          description:
            'Set the OTLP endpoint for telemetry. Overrides environment variables and settings files.',
        })
        .option('telemetry-log-prompts', {
          type: 'boolean',
          description:
            'Enable or disable logging of user prompts for telemetry. Overrides settings files.',
        })
        .option('telemetry-outfile', {
          type: 'string',
          description: 'Redirect all telemetry output to the specified file.',
        })
        .option('checkpointing', {
          alias: 'c',
          type: 'boolean',
          description: 'Enables checkpointing of file edits',
          default: false,
        })
        .option('experimental-acp', {
          type: 'boolean',
          description: 'Starts the agent in ACP mode',
        })
        .option('experimental-ui', {
          type: 'boolean',
          description:
            'Use experimental terminal UI (requires bun and @vybestack/llxprt-ui)',
        })
        .option('allowed-mcp-server-names', {
          type: 'array',
          string: true,
          description: 'Allowed MCP server names',
          coerce: (mcpServerNames: string[]) =>
            // Handle comma-separated values
            mcpServerNames.flatMap((mcpServerName) =>
              mcpServerName.split(',').map((m) => m.trim()),
            ),
        })
        .option('allowed-tools', {
          type: 'array',
          string: true,
          description: 'Tools that are allowed to run without confirmation',
          coerce: (tools: string[]) =>
            // Handle comma-separated values
            tools.flatMap((tool) => tool.split(',').map((t) => t.trim())),
        })
        .option('extensions', {
          alias: 'e',
          type: 'array',
          string: true,
          nargs: 1,
          description:
            'A list of extensions to use. If not provided, all extensions are used.',
          coerce: (extensions: string[]) =>
            // Handle comma-separated values
            extensions.flatMap((extension) =>
              extension.split(',').map((e) => e.trim()),
            ),
        })
        .option('list-extensions', {
          alias: 'l',
          type: 'boolean',
          description: 'List all available extensions and exit.',
        })
        .option('proxy', {
          type: 'string',
          description:
            'Proxy for LLxprt client, like schema://user:password@host:port',
        })
        .option('include-directories', {
          type: 'array',
          string: true,
          description:
            'Additional directories to include in the workspace (comma-separated or multiple --include-directories)',
          coerce: (dirs: string[]) =>
            // Handle comma-separated values
            dirs.flatMap((dir) => dir.split(',').map((d) => d.trim())),
        })
        .option('screen-reader', {
          type: 'boolean',
          description: 'Enable screen reader mode for accessibility.',
        })
        .option('session-summary', {
          type: 'string',
          description: 'File to write session summary to.',
        })
        .option('dumponerror', {
          type: 'boolean',
          description: 'Dump request body to ~/.llxprt/dumps/ on API errors.',
          default: false,
        })
        .option('continue', {
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
        })
        .option('list-sessions', {
          type: 'boolean',
          description: 'List recorded sessions for the current project.',
          default: false,
        })
        .option('delete-session', {
          type: 'string',
          description:
            'Delete a recorded session by ID, prefix, or 1-based index.',
        })
        .option('nobrowser', {
          type: 'boolean',
          description: 'Skip browser OAuth flow, use manual code entry',
          default: false,
        })
        .deprecateOption(
          'telemetry',
          'Use settings.json instead. This flag will be removed in a future version.',
        )
        .deprecateOption(
          'telemetry-target',
          'Use settings.json instead. This flag will be removed in a future version.',
        )
        .deprecateOption(
          'telemetry-otlp-endpoint',
          'Use settings.json instead. This flag will be removed in a future version.',
        )
        .deprecateOption(
          'telemetry-otlp-protocol',
          'Use settings.json instead. This flag will be removed in a future version.',
        )
        .deprecateOption(
          'telemetry-log-prompts',
          'Use settings.json instead. This flag will be removed in a future version.',
        )
        .deprecateOption(
          'telemetry-outfile',
          'Use settings.json instead. This flag will be removed in a future version.',
        )
        .deprecateOption(
          'show-memory-usage',
          'Use settings.json instead. This flag will be removed in a future version.',
        )
        .deprecateOption(
          'sandbox-image',
          'Use settings.json instead. This flag will be removed in a future version.',
        )
        .deprecateOption(
          'proxy',
          'Use settings.json instead. This flag will be removed in a future version.',
        )
        .deprecateOption(
          'checkpointing',
          'Use settings.json instead. This flag will be removed in a future version.',
        )

        .deprecateOption(
          'prompt',
          'Use the positional prompt instead. This flag will be removed in a future version.',
        )
        .positional('promptWords', {
          describe: 'Prompt to run non-interactively',
          type: 'string',
          array: true,
        })
        .check((argv) => {
          const promptWords = argv['promptWords'];
          if (argv['prompt'] && promptWords && promptWords.length > 0) {
            throw new Error(
              'Cannot use both a positional prompt and the --prompt (-p) flag together',
            );
          }
          if (argv['prompt'] && argv['promptInteractive']) {
            throw new Error(
              'Cannot use both --prompt (-p) and --prompt-interactive (-i) together',
            );
          }
          if (argv.yolo && argv.approvalMode) {
            throw new Error(
              'Cannot use both --yolo (-y) and --approval-mode together. Use --approval-mode=yolo instead.',
            );
          }
          return true;
        }),
    )
    .option('telemetry', {
      type: 'boolean',
      description:
        'Enable telemetry? This flag specifically controls if telemetry is sent. Other --telemetry-* flags set specific values but do not enable telemetry on their own.',
    })
    .option('telemetry-target', {
      type: 'string',
      choices: ['local', 'gcp'],
      description:
        'Set the telemetry target (local or gcp). Overrides settings files.',
    })
    .option('telemetry-otlp-endpoint', {
      type: 'string',
      description:
        'Set the OTLP endpoint for telemetry. Overrides environment variables and settings files.',
    })
    .option('telemetry-log-prompts', {
      type: 'boolean',
      description:
        'Enable or disable logging of user prompts for telemetry. Overrides settings files.',
    })
    .option('telemetry-outfile', {
      type: 'string',
      description: 'Redirect all telemetry output to the specified file.',
    })
    .option('checkpointing', {
      alias: 'c',
      type: 'boolean',
      description: 'Enables checkpointing of file edits',
      default: false,
    })
    .option('experimental-acp', {
      type: 'boolean',
      description: 'Starts the agent in ACP mode',
    })
    .option('experimental-ui', {
      type: 'boolean',
      description:
        'Use experimental terminal UI (requires bun and @vybestack/llxprt-ui)',
    })
    .option('allowed-mcp-server-names', {
      type: 'array',
      string: true,
      description: 'Allowed MCP server names',
    })
    .option('extensions', {
      alias: 'e',
      type: 'array',
      string: true,
      description:
        'A list of extensions to use. If not provided, all extensions are used.',
    })
    .option('list-extensions', {
      alias: 'l',
      type: 'boolean',
      description: 'List all available extensions and exit.',
    })
    .option('provider', {
      type: 'string',
      description: 'The provider to use.',
      // Don't set default here, handle it in loadCliConfig
    })
    .option('ide-mode', {
      type: 'string',
      choices: ['enable', 'disable'],
      description: 'Enable or disable IDE mode',
    })
    .option('key', {
      type: 'string',
      description: 'API key for the current provider',
    })
    .option('keyfile', {
      type: 'string',
      description: 'Path to file containing API key for the current provider',
    })
    .option('key-name', {
      type: 'string',
      description:
        'Load a named API key from the keyring (same as /key load <name>)',
    })
    .option('baseurl', {
      type: 'string',
      description: 'Base URL for the current provider',
    })
    .option('proxy', {
      type: 'string',
      description:
        'Proxy for gemini client, like schema://user:password@host:port',
    })
    .option('include-directories', {
      type: 'array',
      string: true,
      description:
        'Additional directories to include in the workspace (comma-separated or multiple --include-directories)',
      coerce: (dirs: string[]) =>
        // Handle comma-separated values
        dirs.flatMap((dir) => dir.split(',').map((d) => d.trim())),
    })
    .option('set', {
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
    })
    .option('profile-load', {
      type: 'string',
      description: 'Load a saved profile configuration on startup',
    })
    .option('profile', {
      type: 'string',
      description:
        'Inline JSON profile configuration (alternative to --profile-load for CI/CD)',
    })
    .option('load-memory-from-include-directories', {
      type: 'boolean',
      description:
        'If true, when refreshing memory, LLXPRT.md files should be loaded from all directories that are added. If false, LLXPRT.md files should only be loaded from the primary working directory.',
    })
    // Register MCP subcommands
    .command(mcpCommand)
    // Register hooks subcommands
    .command(hooksCommand);

  if (settings?.extensionManagement ?? false) {
    yargsInstance.command(extensionsCommand);
  }

  if (settings?.experimental?.skills ?? false) {
    yargsInstance.command(skillsCommand);
  }

  yargsInstance
    .version(await getCliVersion()) // This will enable the --version flag based on package.json
    .alias('v', 'version')
    .help()
    .alias('h', 'help')
    .strict()
    .check((argv) => {
      if (argv.prompt && argv.promptInteractive) {
        throw new Error(
          'Cannot use both --prompt (-p) and --prompt-interactive (-i) together',
        );
      }
      if (argv.profile && argv.profileLoad) {
        throw new Error(
          'Cannot use both --profile and --profile-load. Use one at a time.',
        );
      }
      return true;
    });

  yargsInstance.wrap(yargsInstance.terminalWidth());
  const result = await yargsInstance.parseAsync();

  // The import format is now only controlled by settings.memoryImportFormat
  // We no longer accept it as a CLI argument

  // Map camelCase names to match CliArgs interface
  // Check if an MCP or extensions subcommand was handled
  // The _ array contains the commands that were run
  if (result._ && result._.length > 0 && result._[0] === 'mcp') {
    // An MCP subcommand was executed (like 'mcp list'), exit cleanly
    process.exit(0);
  }

  if (result._ && result._.length > 0 && result._[0] === 'hooks') {
    // A hooks subcommand was executed (like 'hooks list'), exit cleanly
    process.exit(0);
  }

  if (
    result._ &&
    result._.length > 0 &&
    (result._[0] === 'extensions' ||
      result._[0] === 'extension' ||
      result._[0] === 'ext')
  ) {
    // An extensions subcommand was executed (like 'extensions install'), exit cleanly
    process.exit(0);
  }

  const promptWords = result.promptWords as string[] | undefined;
  const promptWordsFiltered =
    promptWords?.filter((word) => word.trim() !== '') || [];
  const queryFromPromptWords =
    promptWordsFiltered.length > 0 ? promptWordsFiltered.join(' ') : undefined;

  const cliArgs: CliArgs = {
    model: result.model as string | undefined,
    sandbox: result.sandbox as boolean | string | undefined,
    sandboxImage: result.sandboxImage as string | undefined,
    sandboxEngine: result.sandboxEngine as string | undefined,
    sandboxProfileLoad: result.sandboxProfileLoad as string | undefined,
    debug: result.debug as boolean | undefined,
    prompt:
      (result.prompt as string | undefined) ||
      queryFromPromptWords ||
      undefined,
    promptInteractive: result.promptInteractive as string | undefined,
    outputFormat: result.outputFormat as string | undefined,

    showMemoryUsage: result.showMemoryUsage as boolean | undefined,
    yolo: result.yolo as boolean | undefined,
    approvalMode: result.approvalMode as string | undefined,
    telemetry: result.telemetry,
    checkpointing: result.checkpointing as boolean | undefined,
    telemetryTarget: result.telemetryTarget,
    telemetryOtlpEndpoint: result.telemetryOtlpEndpoint,
    telemetryLogPrompts: result.telemetryLogPrompts,
    telemetryOutfile: result.telemetryOutfile,
    allowedMcpServerNames: result.allowedMcpServerNames,
    experimentalAcp: result.experimentalAcp,
    experimentalUi: result.experimentalUi,
    extensions: result.extensions,
    listExtensions: result.listExtensions,
    provider: result.provider,
    key: result.key,
    keyfile: result.keyfile,
    baseurl: result.baseurl,
    proxy: result.proxy,
    includeDirectories: result.includeDirectories,
    profileLoad: result.profileLoad,
    loadMemoryFromIncludeDirectories: result.loadMemoryFromIncludeDirectories,
    ideMode: result.ideMode,
    screenReader: result.screenReader as boolean | undefined,
    sessionSummary: result.sessionSummary as string | undefined,
    dumponerror: result.dumponerror as boolean | undefined,
    allowedTools: result.allowedTools as string[] | undefined,
    promptWords: result.promptWords as string[] | undefined,
    query: queryFromPromptWords,
    set: result.set,
    continue: result.continue as string | boolean | undefined,
    nobrowser: result.nobrowser as boolean | undefined,
    listSessions: result.listSessions as boolean | undefined,
    deleteSession: result.deleteSession as string | undefined,
  };

  return cliArgs;
}
