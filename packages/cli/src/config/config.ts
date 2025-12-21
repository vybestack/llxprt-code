/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'node:os';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import process from 'node:process';
import { mcpCommand } from '../commands/mcp.js';
import {
  Config,
  loadServerHierarchicalMemory,
  setLlxprtMdFilename as setServerGeminiMdFilename,
  getCurrentLlxprtMdFilename,
  ApprovalMode,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
  FileDiscoveryService,
  TelemetryTarget,
  OutputFormat,
  FileFilteringOptions,
  ProfileManager,
  ShellTool,
  EditTool,
  WriteFileTool,
  MCPServerConfig,
  SettingsService,
  DebugLogger,
  createPolicyEngineConfig,
  SHELL_TOOL_NAMES,
  type GeminiCLIExtension,
  type Profile,
} from '@vybestack/llxprt-code-core';
import { extensionsCommand } from '../commands/extensions.js';
import { Settings } from './settings.js';

import { annotateActiveExtensions } from './extension.js';
import { getCliVersion } from '../utils/version.js';
import { loadSandboxConfig } from './sandboxConfig.js';
import * as dotenv from 'dotenv';
import * as os from 'node:os';
import { resolvePath } from '../utils/resolvePath.js';
import { appEvents } from '../utils/events.js';

import { isWorkspaceTrusted } from './trustedFolders.js';
// @plan:PLAN-20251020-STATELESSPROVIDER3.P04
import {
  parseBootstrapArgs,
  prepareRuntimeForProfile,
  createBootstrapResult,
  type BootstrapProfileArgs,
} from './profileBootstrap.js';
import type { ExtensionEnablementManager } from './extensions/extensionEnablement.js';

import {
  applyProfileSnapshot,
  getCliRuntimeContext,
  setCliRuntimeContext,
  switchActiveProvider,
} from '../runtime/runtimeSettings.js';
import { applyCliSetArguments } from './cliEphemeralSettings.js';

import { loadProviderAliasEntries } from '../providers/providerAliases.js';

const LLXPRT_DIR = '.llxprt';

const logger = new DebugLogger('llxprt:config');

export const READ_ONLY_TOOL_NAMES = [
  'glob',
  'search_file_content',
  'read_file',
  'read_many_files',
  'list_directory',
  'ls',
  'list_subagents',
  'google_web_search',
  'web_fetch',
  'todo_read',
  'task',
  'self_emitvalue',
] as const;

const EDIT_TOOL_NAME = 'replace';

const normalizeToolNameForPolicy = (name: string): string =>
  name.trim().toLowerCase();

const buildNormalizedToolSet = (value: unknown): Set<string> => {
  const normalized = new Set<string>();
  if (!value) {
    return normalized;
  }

  const entries =
    Array.isArray(value) && value.length > 0
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? [value]
        : [];

  for (const entry of entries) {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      const trimmedEntry = entry.trim();
      const openParenIndex = trimmedEntry.indexOf('(');
      const baseName =
        openParenIndex === -1
          ? trimmedEntry
          : trimmedEntry.substring(0, openParenIndex).trim();

      const canonicalName =
        normalizeToolNameForPolicy(baseName) === 'shelltool'
          ? 'run_shell_command'
          : baseName;
      const normalizedName = normalizeToolNameForPolicy(canonicalName);
      if (normalizedName) {
        normalized.add(normalizedName);
      }
    }
  }

  return normalized;
};

export interface CliArgs {
  model: string | undefined;
  sandbox: boolean | string | undefined;
  sandboxImage: string | undefined;
  debug: boolean | undefined;
  prompt: string | undefined;
  promptInteractive: string | undefined;
  outputFormat: string | undefined;
  allFiles: boolean | undefined;
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
          choices: [OutputFormat.TEXT, OutputFormat.JSON],
          description: 'Output format for non-interactive mode (text or json).',
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
        .option('debug', {
          alias: 'd',
          type: 'boolean',
          description: 'Run in debug mode?',
          default: false,
        })
        .option('all-files', {
          alias: ['a'],
          type: 'boolean',
          description: 'Include ALL files in context?',
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
          'all-files',
          'Use @ includes in the application instead. This flag will be removed in a future version.',
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
          const promptWords = argv['promptWords'] as string[] | undefined;
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
    .command(mcpCommand);

  if (settings?.extensionManagement ?? false) {
    yargsInstance.command(extensionsCommand);
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
  // Check if an MCP subcommand was handled
  // The _ array contains the commands that were run
  if (result._ && result._.length > 0 && result._[0] === 'mcp') {
    // An MCP subcommand was executed (like 'mcp list'), exit cleanly
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
    debug: result.debug as boolean | undefined,
    prompt:
      (result.prompt as string | undefined) ||
      queryFromPromptWords ||
      undefined,
    promptInteractive: result.promptInteractive as string | undefined,
    outputFormat: result.outputFormat as string | undefined,
    allFiles: result.allFiles as boolean | undefined,
    showMemoryUsage: result.showMemoryUsage as boolean | undefined,
    yolo: result.yolo as boolean | undefined,
    approvalMode: result.approvalMode as string | undefined,
    telemetry: result.telemetry as boolean | undefined,
    checkpointing: result.checkpointing as boolean | undefined,
    telemetryTarget: result.telemetryTarget as string | undefined,
    telemetryOtlpEndpoint: result.telemetryOtlpEndpoint as string | undefined,
    telemetryLogPrompts: result.telemetryLogPrompts as boolean | undefined,
    telemetryOutfile: result.telemetryOutfile as string | undefined,
    allowedMcpServerNames: result.allowedMcpServerNames as string[] | undefined,
    experimentalAcp: result.experimentalAcp as boolean | undefined,
    experimentalUi: result.experimentalUi as boolean | undefined,
    extensions: result.extensions as string[] | undefined,
    listExtensions: result.listExtensions as boolean | undefined,
    provider: result.provider as string | undefined,
    key: result.key as string | undefined,
    keyfile: result.keyfile as string | undefined,
    baseurl: result.baseurl as string | undefined,
    proxy: result.proxy as string | undefined,
    includeDirectories: result.includeDirectories as string[] | undefined,
    profileLoad: result.profileLoad as string | undefined,
    loadMemoryFromIncludeDirectories:
      result.loadMemoryFromIncludeDirectories as boolean | undefined,
    ideMode: result.ideMode as string | undefined,
    screenReader: result.screenReader as boolean | undefined,
    sessionSummary: result.sessionSummary as string | undefined,
    dumponerror: result.dumponerror as boolean | undefined,
    allowedTools: result.allowedTools as string[] | undefined,
    promptWords: result.promptWords as string[] | undefined,
    query: queryFromPromptWords,
    set: result.set as string[] | undefined,
  };

  return cliArgs;
}

// This function is now a thin wrapper around the server's implementation.
// It's kept in the CLI for now as App.tsx directly calls it for memory refresh.
// TODO: Consider if App.tsx should get memory via a server call or if Config should refresh itself.
export async function loadHierarchicalLlxprtMemory(
  currentWorkingDirectory: string,
  includeDirectoriesToReadGemini: readonly string[] = [],
  debugMode: boolean,
  fileService: FileDiscoveryService,
  settings: Settings,
  extensionContextFilePaths: string[] = [],
  folderTrust: boolean,
  memoryImportFormat: 'flat' | 'tree' = 'tree',
  fileFilteringOptions?: FileFilteringOptions,
): Promise<{ memoryContent: string; fileCount: number; filePaths: string[] }> {
  // FIX: Use real, canonical paths for a reliable comparison to handle symlinks.
  const realCwd = fs.realpathSync(path.resolve(currentWorkingDirectory));
  const realHome = fs.realpathSync(path.resolve(homedir()));
  const isHomeDirectory = realCwd === realHome;

  // If it is the home directory, pass an empty string to the core memory
  // function to signal that it should skip the workspace search.
  const effectiveCwd = isHomeDirectory ? '' : currentWorkingDirectory;

  if (debugMode) {
    logger.debug(
      `CLI: Delegating hierarchical memory load to server for CWD: ${currentWorkingDirectory} (memoryImportFormat: ${memoryImportFormat})`,
    );
  }

  // Directly call the server function with the corrected path.
  return loadServerHierarchicalMemory(
    effectiveCwd,
    includeDirectoriesToReadGemini,
    debugMode,
    fileService,
    extensionContextFilePaths,
    folderTrust,
    memoryImportFormat,
    fileFilteringOptions,
    settings.ui?.memoryDiscoveryMaxDirs,
  );
}

/**
 * Creates a filter function to determine if a tool should be excluded.
 *
 * In non-interactive mode, we want to disable tools that require user
 * interaction to prevent the CLI from hanging. This function creates a predicate
 * that returns `true` if a tool should be excluded.
 *
 * A tool is excluded if it's not in the `allowedToolsSet`. The shell tool
 * has a special case: it's not excluded if any of its subcommands
 * are in the `allowedTools` list.
 *
 * @param allowedTools A list of explicitly allowed tool names.
 * @param allowedToolsSet A set of explicitly allowed tool names for quick lookups.
 * @returns A function that takes a tool name and returns `true` if it should be excluded.
 */
function createToolExclusionFilter(
  allowedTools: string[],
  allowedToolsSet: Set<string>,
) {
  return (tool: string): boolean => {
    if (tool === ShellTool.Name) {
      // If any of the allowed tools is ShellTool (even with subcommands), don't exclude it.
      return !allowedTools.some((allowed) =>
        SHELL_TOOL_NAMES.some((shellName) => allowed.startsWith(shellName)),
      );
    }
    return !allowedToolsSet.has(tool);
  };
}

export function isDebugMode(argv: CliArgs): boolean {
  return (
    argv.debug ||
    [process.env['DEBUG'], process.env['DEBUG_MODE']].some(
      (v) => v === 'true' || v === '1',
    )
  );
}

export async function loadCliConfig(
  settings: Settings,
  extensions: GeminiCLIExtension[],
  extensionEnablementManager: ExtensionEnablementManager,
  sessionId: string,
  argv: CliArgs,
  cwd: string = process.cwd(),
  runtimeOverrides: { settingsService?: SettingsService } = {},
): Promise<Config> {
  /**
   * @plan PLAN-20251020-STATELESSPROVIDER3.P06
   * @requirement REQ-SP3-001
   * @pseudocode bootstrap-order.md lines 1-9
   */
  const bootstrapParsed = parseBootstrapArgs();

  const parsedWithOverrides = {
    bootstrapArgs: bootstrapParsed.bootstrapArgs,
    runtimeMetadata: {
      ...bootstrapParsed.runtimeMetadata,
      settingsService:
        runtimeOverrides.settingsService ??
        bootstrapParsed.runtimeMetadata.settingsService,
    },
  };

  const bootstrapArgs = parsedWithOverrides.bootstrapArgs;

  const runtimeState = await prepareRuntimeForProfile(parsedWithOverrides);

  /**
   * Helper function to prepare profile data for application
   * Extracts common logic used by both --profile and --profile-load
   * @plan:PLAN-20251118-ISSUE533.P13
   */
  function prepareProfileForApplication(
    profile: Profile,
    profileSource: string, // 'inline' or profile name
    argv: CliArgs,
    baseSettings: Settings,
  ): {
    profileProvider: string | undefined;
    profileModel: string | undefined;
    profileModelParams: Record<string, unknown> | undefined;
    profileBaseUrl: string | undefined;
    effectiveSettings: Settings;
  } {
    // Extract profile values, respecting --provider override
    const profileProvider =
      argv.provider !== undefined ? undefined : profile.provider;
    const profileModel =
      argv.provider !== undefined ? undefined : profile.model;
    const profileModelParams = profile.modelParams;
    const profileBaseUrl =
      typeof profile.ephemeralSettings?.['base-url'] === 'string'
        ? profile.ephemeralSettings['base-url']
        : undefined;

    // Log profile loading
    const loadSummary = `Loaded ${profileSource === 'inline' ? 'inline profile from --profile' : `profile ${profileSource}`}: provider=${profile.provider}, model=${profile.model}, hasEphemeralSettings=${!!profile.ephemeralSettings}`;
    logger.debug(() => loadSummary);

    // Merge ephemeral settings into settings object
    let effectiveSettings = baseSettings;
    if (argv.provider === undefined && profile.ephemeralSettings) {
      effectiveSettings = {
        ...baseSettings,
        ...profile.ephemeralSettings,
      } as Settings;
      logger.debug(
        () =>
          `Merged ephemeral settings from ${profileSource === 'inline' ? 'inline profile' : `profile '${profileSource}'`}`,
      );
    } else if (argv.provider !== undefined) {
      logger.debug(
        () =>
          `Skipping profile ephemeral settings because --provider was explicitly specified`,
      );
    }

    return {
      profileProvider,
      profileModel,
      profileModelParams,
      profileBaseUrl,
      effectiveSettings,
    };
  }

  // Handle --profile (inline JSON) or --profile-load (file-based) early to apply profile settings
  let effectiveSettings = settings;
  let profileModel: string | undefined;
  let profileProvider: string | undefined;
  let profileModelParams: Record<string, unknown> | undefined;
  let profileBaseUrl: string | undefined;
  let loadedProfile: Profile | null = null;
  const profileWarnings: string[] = [];

  // @plan:PLAN-20251118-ISSUE533.P13 - Handle inline profile from --profile flag
  // Check for both null and undefined since tests may not set this field
  if (bootstrapArgs.profileJson != null) {
    try {
      const profile = JSON.parse(bootstrapArgs.profileJson) as Profile;
      loadedProfile = profile;

      const prepared = prepareProfileForApplication(
        profile,
        'inline',
        argv,
        settings,
      );
      profileProvider = prepared.profileProvider;
      profileModel = prepared.profileModel;
      profileModelParams = prepared.profileModelParams;
      profileBaseUrl = prepared.profileBaseUrl;
      effectiveSettings = prepared.effectiveSettings;
    } catch (err) {
      // Profile parsing/validation errors are thrown during parseBootstrapArgs
      // If we get here, JSON.parse failed which shouldn't happen since it was already validated
      throw new Error(
        `Failed to parse inline profile: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const normaliseProfileName = (
    value: string | null | undefined,
  ): string | undefined => {
    if (value === null || value === undefined) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  // Check for profile to load - either from CLI arg, env var, or default profile setting
  // BUT skip default profile if --provider is explicitly specified
  // AND skip all file-based profiles entirely when an inline profile (--profile) is provided.
  const profileToLoad =
    bootstrapArgs.profileJson != null
      ? undefined
      : (normaliseProfileName(bootstrapArgs.profileName) ??
        normaliseProfileName(process.env.LLXPRT_PROFILE) ??
        (argv.provider === undefined
          ? normaliseProfileName(
              typeof settings.defaultProfile === 'string'
                ? settings.defaultProfile
                : undefined,
            )
          : undefined));

  if (profileToLoad) {
    try {
      const profileManager = new ProfileManager();
      const profile = await profileManager.loadProfile(profileToLoad);
      loadedProfile = profile;

      const prepared = prepareProfileForApplication(
        profile,
        profileToLoad,
        argv,
        settings,
      );
      profileProvider = prepared.profileProvider;
      profileModel = prepared.profileModel;
      profileModelParams = prepared.profileModelParams;
      profileBaseUrl = prepared.profileBaseUrl;
      effectiveSettings = prepared.effectiveSettings;

      // Additional console.debug logging for file-based profiles (for backward compatibility)
      const tempDebugMode =
        argv.debug ||
        [process.env.DEBUG, process.env.DEBUG_MODE].some(
          (v) => v === 'true' || v === '1',
        ) ||
        false;

      if (tempDebugMode) {
        console.debug(
          `Loaded profile '${profileToLoad}': provider=${profile.provider}, model=${profile.model}`,
        );
        if (profileProvider && profileModel) {
          console.debug(
            `Applied profile '${profileToLoad}' with provider: ${profileProvider}, model: ${profileModel}`,
          );
        }
      }
    } catch (error) {
      const failureSummary = `Failed to load profile '${profileToLoad}': ${error instanceof Error ? error.message : String(error)}`;
      logger.error(() => {
        if (error instanceof Error && error.stack) {
          return `${failureSummary}\n${error.stack}`;
        }
        return failureSummary;
      });
      console.error(failureSummary);
      profileWarnings.push(failureSummary);
      // Continue without the profile settings
    }
  }

  // Calculate debugMode after profile settings have been applied
  const debugMode =
    argv.debug ||
    [process.env.DEBUG, process.env.DEBUG_MODE].some(
      (v) => v === 'true' || v === '1',
    ) ||
    false;

  const memoryImportFormat = effectiveSettings.ui?.memoryImportFormat || 'tree';

  // Handle IDE mode: CLI flag overrides settings
  let ideMode: boolean;
  if (argv.ideMode === 'enable') {
    ideMode = true;
  } else if (argv.ideMode === 'disable') {
    ideMode = false;
  } else {
    // No CLI flag, use settings
    ideMode = effectiveSettings.ui?.ideMode ?? false;
  }

  if (debugMode) {
    console.debug('[DEBUG] IDE mode configuration:', {
      'argv.ideMode': argv.ideMode,
      'effectiveSettings.ui.ideMode': effectiveSettings.ui?.ideMode,
      'final ideMode': ideMode,
    });
  }

  // ideModeFeature flag removed - now using ideMode directly

  // Folder trust feature flag removed - now using settings directly
  const folderTrust = settings.folderTrust ?? false;
  const trustedFolder = isWorkspaceTrusted(settings) ?? true;

  const allExtensions = annotateActiveExtensions(
    extensions,
    cwd,
    extensionEnablementManager,
  );

  const activeExtensions = extensions.filter(
    (_, i) => allExtensions[i].isActive,
  );

  // Set the context filename in the server's memoryTool module BEFORE loading memory
  // TODO(b/343434939): This is a bit of a hack. The contextFileName should ideally be passed
  // directly to the Config constructor in core, and have core handle setLlxprtMdFilename.
  // However, loadHierarchicalLlxprtMemory is called *before* createServerConfig.
  if (effectiveSettings.ui?.contextFileName) {
    setServerGeminiMdFilename(effectiveSettings.ui.contextFileName);
  } else {
    // Reset to default if not provided in settings.
    setServerGeminiMdFilename(getCurrentLlxprtMdFilename());
  }

  const extensionContextFilePaths = activeExtensions.flatMap(
    (e) => e.contextFiles,
  );

  const fileService = new FileDiscoveryService(cwd);

  const fileFiltering = {
    ...DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
    ...effectiveSettings.fileFiltering,
  };

  const includeDirectoriesFromSettings =
    effectiveSettings.includeDirectories || [];
  const includeDirectoriesFromCli = argv.includeDirectories || [];
  const includeDirectories = includeDirectoriesFromSettings
    .map(resolvePath)
    .concat(includeDirectoriesFromCli.map(resolvePath));

  const includeDirectoriesProvided = includeDirectories.length > 0;
  const cliLoadMemoryPreference = argv.loadMemoryFromIncludeDirectories;
  const settingsLoadMemoryPreference =
    effectiveSettings.loadMemoryFromIncludeDirectories;

  let resolvedLoadMemoryFromIncludeDirectories =
    cliLoadMemoryPreference ?? settingsLoadMemoryPreference ?? false;

  if (
    !resolvedLoadMemoryFromIncludeDirectories &&
    includeDirectoriesProvided &&
    cliLoadMemoryPreference === undefined &&
    settingsLoadMemoryPreference !== true
  ) {
    resolvedLoadMemoryFromIncludeDirectories = true;
  }

  // Call the (now wrapper) loadHierarchicalLlxprtMemory which calls the server's version
  const { memoryContent, fileCount, filePaths } =
    await loadHierarchicalLlxprtMemory(
      cwd,
      resolvedLoadMemoryFromIncludeDirectories ? includeDirectories : [],
      debugMode,
      fileService,
      effectiveSettings,
      extensionContextFilePaths,
      trustedFolder,
      memoryImportFormat,
      fileFiltering,
    );

  let mcpServers = mergeMcpServers(effectiveSettings, activeExtensions);
  const question =
    argv.promptInteractive || argv.prompt || (argv.promptWords || []).join(' ');

  // Determine approval mode with backward compatibility
  let approvalMode: ApprovalMode;
  if (argv.approvalMode) {
    // New --approval-mode flag takes precedence
    switch (argv.approvalMode) {
      case 'yolo':
        approvalMode = ApprovalMode.YOLO;
        break;
      case 'auto_edit':
        approvalMode = ApprovalMode.AUTO_EDIT;
        break;
      case 'default':
        approvalMode = ApprovalMode.DEFAULT;
        break;
      default:
        throw new Error(
          `Invalid approval mode: ${argv.approvalMode}. Valid values are: yolo, auto_edit, default`,
        );
    }
  } else {
    // Fallback to legacy --yolo flag behavior
    approvalMode =
      argv.yolo || false ? ApprovalMode.YOLO : ApprovalMode.DEFAULT;
  }

  // Force approval mode to default if the folder is not trusted.
  if (!trustedFolder && approvalMode !== ApprovalMode.DEFAULT) {
    logger.log(
      `Approval mode overridden to "default" because the current folder is not trusted.`,
    );
    approvalMode = ApprovalMode.DEFAULT;
  }

  // Fix: If promptWords are provided (and non-empty), always use non-interactive mode
  const hasPromptWords =
    argv.promptWords && argv.promptWords.some((word) => word.trim() !== '');
  const interactive =
    !!argv.promptInteractive ||
    (process.stdin.isTTY && !hasPromptWords && !argv.prompt);

  const allowedTools = argv.allowedTools || settings.allowedTools || [];
  const allowedToolsSet = new Set(allowedTools);

  // In non-interactive mode, exclude tools that require a prompt.
  const extraExcludes: string[] = [];
  if (!interactive && !argv.experimentalAcp) {
    const defaultExcludes = [ShellTool.Name, EditTool.Name, WriteFileTool.Name];
    const autoEditExcludes = [ShellTool.Name];

    const toolExclusionFilter = createToolExclusionFilter(
      allowedTools,
      allowedToolsSet,
    );

    switch (approvalMode) {
      case ApprovalMode.DEFAULT:
        // In default non-interactive mode, all tools that require approval are excluded.
        extraExcludes.push(...defaultExcludes.filter(toolExclusionFilter));
        break;
      case ApprovalMode.AUTO_EDIT:
        // In auto-edit non-interactive mode, only tools that still require a prompt are excluded.
        extraExcludes.push(...autoEditExcludes.filter(toolExclusionFilter));
        break;
      case ApprovalMode.YOLO:
        // No extra excludes for YOLO mode.
        break;
      default:
        // This should never happen due to validation earlier, but satisfies the linter
        break;
    }
  }

  const excludeTools = mergeExcludeTools(
    effectiveSettings,
    activeExtensions,
    extraExcludes.length > 0 ? extraExcludes : undefined,
  );
  const blockedMcpServers: Array<{ name: string; extensionName: string }> = [];

  if (!argv.allowedMcpServerNames) {
    if (effectiveSettings.allowMCPServers) {
      mcpServers = allowedMcpServers(
        mcpServers,
        effectiveSettings.allowMCPServers,
        blockedMcpServers,
      );
    }

    if (effectiveSettings.excludeMCPServers) {
      const excludedNames = new Set(
        effectiveSettings.excludeMCPServers.filter(Boolean),
      );
      if (excludedNames.size > 0) {
        mcpServers = Object.fromEntries(
          Object.entries(mcpServers).filter(([key]) => !excludedNames.has(key)),
        );
      }
    }
  }

  if (argv.allowedMcpServerNames) {
    mcpServers = allowedMcpServers(
      mcpServers,
      argv.allowedMcpServerNames,
      blockedMcpServers,
    );
  }

  const sandboxConfig = await loadSandboxConfig(effectiveSettings, argv);

  // Handle provider selection FIRST with proper precedence
  // Priority: CLI arg > Profile > Environment > Default
  let finalProvider: string;
  if (argv.provider) {
    finalProvider = argv.provider;
  } else if (profileProvider && profileProvider.trim() !== '') {
    // Use profile provider only if it's not empty/whitespace
    finalProvider = profileProvider;
  } else if (process.env.LLXPRT_DEFAULT_PROVIDER) {
    finalProvider = process.env.LLXPRT_DEFAULT_PROVIDER;
  } else {
    finalProvider = 'gemini';
  }

  logger.debug(
    () =>
      `Provider selection: argv=${argv.provider}, profile=${profileProvider}, env=${process.env.LLXPRT_DEFAULT_PROVIDER}, final=${finalProvider}`,
  );

  // If provider is a known alias with defaultModel, use it as a fallback when no model is otherwise specified.
  // This prevents `model.missing` during Config construction for non-gemini providers.
  const aliasDefaultModel = (() => {
    try {
      const entry = loadProviderAliasEntries().find(
        (candidate: { alias: string }) => candidate.alias === finalProvider,
      );
      const candidate = entry?.config?.defaultModel;
      return typeof candidate === 'string' && candidate.trim()
        ? candidate.trim()
        : undefined;
    } catch {
      return undefined;
    }
  })();

  const finalModel: string =
    argv.model ||
    profileModel ||
    effectiveSettings.model ||
    process.env.LLXPRT_DEFAULT_MODEL ||
    process.env.GEMINI_MODEL ||
    // If no model specified and provider is gemini, use the Gemini default
    (finalProvider === 'gemini'
      ? DEFAULT_GEMINI_MODEL
      : aliasDefaultModel || '');

  // Ensure SettingsService reflects the selected model so Config#getModel picks it up
  if (finalModel && finalModel.trim() !== '') {
    const targetProviderForModel = finalProvider;
    const settingsServiceForModel = runtimeState.runtime.settingsService;
    settingsServiceForModel.setProviderSetting(
      targetProviderForModel,
      'model',
      finalModel,
    );
  }

  // The screen reader argument takes precedence over the accessibility setting.
  const screenReader =
    argv.screenReader !== undefined
      ? argv.screenReader
      : (effectiveSettings.accessibility?.screenReader ?? false);

  const policyPathSetting = effectiveSettings.tools?.policyPath;
  const resolvedPolicyPath = policyPathSetting
    ? resolvePath(policyPathSetting)
    : undefined;

  // Create policy engine config from legacy approval mode and allowed tools
  const policyEngineConfig = await createPolicyEngineConfig({
    getApprovalMode: () => approvalMode,
    getAllowedTools: () =>
      argv.allowedTools || settings.allowedTools || undefined,
    getNonInteractive: () => !interactive,
    getUserPolicyPath: () => resolvedPolicyPath,
  });

  const outputFormat =
    argv.outputFormat === OutputFormat.JSON
      ? OutputFormat.JSON
      : OutputFormat.TEXT;

  const config = new Config({
    sessionId,
    embeddingModel: undefined, // No embedding model configured for llxprt-code
    sandbox: sandboxConfig,
    targetDir: cwd,
    includeDirectories,
    loadMemoryFromIncludeDirectories: resolvedLoadMemoryFromIncludeDirectories,
    debugMode,
    outputFormat,
    question,
    fullContext: argv.allFiles || false,
    coreTools: effectiveSettings.coreTools || undefined,
    allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
    policyEngineConfig,
    excludeTools,
    toolDiscoveryCommand: effectiveSettings.toolDiscoveryCommand,
    toolCallCommand: effectiveSettings.toolCallCommand,
    mcpServerCommand: effectiveSettings.mcpServerCommand,
    mcpServers,
    userMemory: memoryContent,
    llxprtMdFileCount: fileCount,
    llxprtMdFilePaths: filePaths,
    approvalMode,
    showMemoryUsage:
      argv.showMemoryUsage || effectiveSettings.ui?.showMemoryUsage || false,
    accessibility: {
      ...effectiveSettings.accessibility,
      screenReader,
    },
    telemetry: {
      enabled: argv.telemetry ?? effectiveSettings.telemetry?.enabled,
      target: (argv.telemetryTarget ??
        effectiveSettings.telemetry?.target) as TelemetryTarget,
      otlpEndpoint:
        argv.telemetryOtlpEndpoint ??
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
        effectiveSettings.telemetry?.otlpEndpoint,
      logPrompts:
        argv.telemetryLogPrompts ?? effectiveSettings.telemetry?.logPrompts,
      outfile: argv.telemetryOutfile ?? effectiveSettings.telemetry?.outfile,
      logConversations: effectiveSettings.telemetry?.logConversations,
      logResponses: effectiveSettings.telemetry?.logResponses,
      redactSensitiveData: effectiveSettings.telemetry?.redactSensitiveData,
      redactFilePaths: effectiveSettings.telemetry?.redactFilePaths,
      redactUrls: effectiveSettings.telemetry?.redactUrls,
      redactEmails: effectiveSettings.telemetry?.redactEmails,
      redactPersonalInfo: effectiveSettings.telemetry?.redactPersonalInfo,
    },
    usageStatisticsEnabled:
      effectiveSettings.ui?.usageStatisticsEnabled ?? true,
    // Git-aware file filtering settings - fix from upstream: pass fileFiltering correctly
    fileFiltering,
    checkpointing:
      argv.checkpointing || effectiveSettings.checkpointing?.enabled,
    dumpOnError: argv.dumponerror || false,
    proxy:
      argv.proxy ||
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy,
    cwd,
    fileDiscoveryService: fileService,
    bugCommand: effectiveSettings.bugCommand,
    model: finalModel,
    extensionContextFilePaths,
    maxSessionTurns: effectiveSettings.ui?.maxSessionTurns ?? -1,
    experimentalZedIntegration: argv.experimentalAcp || false,
    listExtensions: argv.listExtensions || false,
    activeExtensions: activeExtensions.map((e) => ({
      name: e.name,
      version: e.version,
    })),
    provider: finalProvider,
    extensions: allExtensions,
    blockedMcpServers,
    noBrowser: !!process.env.NO_BROWSER,
    summarizeToolOutput: effectiveSettings.summarizeToolOutput,
    ideMode,
    chatCompression: settings.chatCompression,
    interactive,
    folderTrust,
    trustedFolder,
    shellReplacement: effectiveSettings.shellReplacement,
    useRipgrep: effectiveSettings.useRipgrep,
    shouldUseNodePtyShell: effectiveSettings.shouldUseNodePtyShell,
    enablePromptCompletion: effectiveSettings.enablePromptCompletion ?? false,
    eventEmitter: appEvents,
  });

  const enhancedConfig = config;

  const bootstrapRuntimeId =
    runtimeState.runtime.runtimeId ?? 'cli.runtime.bootstrap';
  const baseBootstrapMetadata = {
    ...(runtimeState.runtime.metadata ?? {}),
    stage: 'post-config',
  };

  const profileManager = new ProfileManager();
  setCliRuntimeContext(runtimeState.runtime.settingsService, enhancedConfig, {
    runtimeId: bootstrapRuntimeId,
    metadata: baseBootstrapMetadata,
    profileManager,
  });

  // Register provider infrastructure AFTER runtime context but BEFORE any profile application
  // This is critical for applyProfileSnapshot to access the provider manager
  const { registerCliProviderInfrastructure } =
    await import('../runtime/runtimeSettings.js');
  if (runtimeState.oauthManager) {
    registerCliProviderInfrastructure(
      runtimeState.providerManager,
      runtimeState.oauthManager,
    );
  }

  let appliedProfileResult: Awaited<
    ReturnType<typeof applyProfileSnapshot>
  > | null = null;

  logger.debug(
    () =>
      `[bootstrap] profileToLoad=${profileToLoad ?? 'none'} providerArg=${argv.provider ?? 'unset'} loadedProfile=${loadedProfile ? 'yes' : 'no'}`,
  );

  // CRITICAL FIX for #492: When --provider is specified with CLI auth (--key/--keyfile/--baseurl),
  // create a synthetic profile to apply the auth credentials using the same flow as profile loading.
  // This ensures auth is applied BEFORE provider switch, just like profile loading does.
  if (
    argv.provider &&
    (bootstrapArgs.keyOverride ||
      bootstrapArgs.keyfileOverride ||
      bootstrapArgs.baseurlOverride)
  ) {
    logger.debug(
      () => '[bootstrap] Creating synthetic profile for CLI auth args',
    );
    const syntheticProfile: Profile = {
      version: 1,
      provider: argv.provider,
      model: argv.model ?? finalModel,
      modelParams: {},
      ephemeralSettings: {},
    };

    if (bootstrapArgs.keyOverride) {
      syntheticProfile.ephemeralSettings['auth-key'] =
        bootstrapArgs.keyOverride;
    }
    if (bootstrapArgs.keyfileOverride) {
      syntheticProfile.ephemeralSettings['auth-keyfile'] =
        bootstrapArgs.keyfileOverride;
    }
    if (bootstrapArgs.baseurlOverride) {
      syntheticProfile.ephemeralSettings['base-url'] =
        bootstrapArgs.baseurlOverride;
    }

    appliedProfileResult = await applyProfileSnapshot(syntheticProfile, {
      profileName: 'cli-args',
    });

    profileProvider = appliedProfileResult.providerName;
    profileModel = appliedProfileResult.modelName;
    if (appliedProfileResult.baseUrl) {
      profileBaseUrl = appliedProfileResult.baseUrl;
    }
    if (appliedProfileResult.warnings.length > 0) {
      profileWarnings.push(...appliedProfileResult.warnings);
    }
    logger.debug(
      () =>
        `[bootstrap] Applied CLI auth -> provider=${profileProvider}, model=${profileModel}, baseUrl=${profileBaseUrl ?? 'default'}`,
    );
  } else if (
    loadedProfile &&
    (profileToLoad || bootstrapArgs.profileJson !== null) &&
    argv.provider === undefined
  ) {
    // @plan:PLAN-20251118-ISSUE533.P13 - Apply inline or file-based profile through runtime
    appliedProfileResult = await applyProfileSnapshot(loadedProfile, {
      profileName: profileToLoad || 'inline-profile',
    });

    profileProvider = appliedProfileResult.providerName;
    profileModel = appliedProfileResult.modelName;
    if (appliedProfileResult.baseUrl) {
      profileBaseUrl = appliedProfileResult.baseUrl;
    }
    if (appliedProfileResult.warnings.length > 0) {
      profileWarnings.push(...appliedProfileResult.warnings);
    }
    // @plan:PLAN-20251211issue486b - Update finalProvider after applyProfile
    // applyProfile may change the provider (e.g., to "load-balancer" for LB profiles)
    // so we need to update finalProvider to match
    if (profileProvider && profileProvider.trim() !== '') {
      finalProvider = profileProvider;
    }
    logger.debug(
      () =>
        `[bootstrap] Applied profile '${profileToLoad || 'inline'}' -> provider=${profileProvider}, model=${profileModel}, baseUrl=${profileBaseUrl ?? 'default'}`,
    );
  } else if (profileToLoad && argv.provider !== undefined) {
    logger.debug(
      () =>
        `[bootstrap] Skipping profile application for '${profileToLoad}' because --provider was specified.`,
    );
  }

  const cliModelOverride = (() => {
    if (typeof argv.model === 'string') {
      const trimmed = argv.model.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
    if (typeof bootstrapArgs.modelOverride === 'string') {
      const trimmed = bootstrapArgs.modelOverride.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
    return undefined;
  })();

  const bootstrapRuntimeContext = getCliRuntimeContext();
  const bootstrapResult = createBootstrapResult({
    runtime: bootstrapRuntimeContext,
    providerManager: runtimeState.providerManager,
    oauthManager: runtimeState.oauthManager,
    bootstrapArgs,
    profileApplication: {
      providerName: profileProvider ?? finalProvider,
      modelName: profileModel ?? finalModel,
      ...(profileBaseUrl ? { baseUrl: profileBaseUrl } : {}),
      warnings: profileWarnings.slice(),
    },
  });

  // Store bootstrap args in runtime context for later use
  const configWithBootstrapArgs = enhancedConfig as Config & {
    _bootstrapArgs?: BootstrapProfileArgs;
  };
  configWithBootstrapArgs._bootstrapArgs = bootstrapArgs;

  if (bootstrapResult.profile.warnings.length > 0) {
    for (const warning of bootstrapResult.profile.warnings) {
      logger.warn(() => `[bootstrap] ${warning}`);
    }
  }

  try {
    await switchActiveProvider(finalProvider);
  } catch (error) {
    logger.warn(
      () =>
        `[bootstrap] Failed to switch active provider to ${finalProvider}: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }

  if (cliModelOverride) {
    runtimeState.runtime.settingsService.setProviderSetting(
      finalProvider,
      'model',
      cliModelOverride,
    );
    enhancedConfig.setModel(cliModelOverride);
    const configWithCliOverride = enhancedConfig as Config & {
      _cliModelOverride?: string;
    };
    configWithCliOverride._cliModelOverride = cliModelOverride;
    logger.debug(
      () =>
        `[bootstrap] Re-applied CLI model override '${cliModelOverride}' after provider activation`,
    );
  }

  // Apply CLI argument overrides AFTER provider switch (switchActiveProvider clears ephemerals)
  // Note: We already applied key/keyfile/baseurl earlier, but we need to reapply after provider switch
  // Also apply --set arguments which weren't handled earlier
  if (
    bootstrapArgs &&
    (bootstrapArgs.keyOverride ||
      bootstrapArgs.keyfileOverride ||
      bootstrapArgs.baseurlOverride ||
      (bootstrapArgs.setOverrides && bootstrapArgs.setOverrides.length > 0))
  ) {
    const { applyCliArgumentOverrides } =
      await import('../runtime/runtimeSettings.js');
    await applyCliArgumentOverrides(
      {
        key: argv.key,
        keyfile: argv.keyfile,
        baseurl: argv.baseurl,
        set: argv.set as string[] | undefined,
      },
      bootstrapArgs,
    );
  }

  const explicitAllowedTools = buildNormalizedToolSet(
    argv.allowedTools && argv.allowedTools.length > 0
      ? argv.allowedTools
      : (settings.allowedTools ?? []),
  );

  const profileAllowedTools = buildNormalizedToolSet(
    enhancedConfig.getEphemeralSetting('tools.allowed'),
  );

  const applyToolGovernancePolicy = (
    allowedSet: Set<string> | undefined,
  ): void => {
    if (allowedSet === undefined) {
      enhancedConfig.setEphemeralSetting('tools.allowed', undefined);
    } else {
      enhancedConfig.setEphemeralSetting(
        'tools.allowed',
        Array.from(allowedSet).sort(),
      );
    }
  };

  if (!interactive) {
    if (approvalMode === ApprovalMode.YOLO) {
      if (profileAllowedTools.size > 0 || explicitAllowedTools.size > 0) {
        const finalAllowed = new Set(profileAllowedTools);
        explicitAllowedTools.forEach((tool) => finalAllowed.add(tool));
        applyToolGovernancePolicy(finalAllowed);
      } else {
        applyToolGovernancePolicy(undefined);
      }
    } else {
      const baseAllowed = new Set<string>(
        READ_ONLY_TOOL_NAMES.map(normalizeToolNameForPolicy),
      );
      explicitAllowedTools.forEach((tool) => baseAllowed.add(tool));
      if (approvalMode === ApprovalMode.AUTO_EDIT) {
        baseAllowed.add(EDIT_TOOL_NAME);
      }

      const finalAllowed =
        profileAllowedTools.size > 0
          ? new Set(
              [...baseAllowed].filter((tool) => profileAllowedTools.has(tool)),
            )
          : baseAllowed;

      applyToolGovernancePolicy(finalAllowed);
    }
  } else if (profileAllowedTools.size > 0 || explicitAllowedTools.size > 0) {
    const finalAllowed = new Set(profileAllowedTools);
    explicitAllowedTools.forEach((tool) => finalAllowed.add(tool));
    applyToolGovernancePolicy(finalAllowed);
  }

  // Apply emojifilter setting from settings.json to SettingsService
  // Only set if there isn't already an ephemeral setting (from /set command)
  const settingsService = runtimeState.runtime.settingsService;
  if (!runtimeOverrides.settingsService) {
    /**
     * @plan:PLAN-20250218-STATELESSPROVIDER.P06
     * @requirement:REQ-SP-005
     * Fallback path maintained temporarily until remaining entrypoints adopt
     * runtime helpers. Remove once all callers supply a scoped SettingsService.
     */
    logger.warn(
      '[cli-runtime] loadCliConfig called without runtime SettingsService override; using bootstrap-scoped instance (temporary compatibility path).',
    );
  }
  if (effectiveSettings.emojifilter && !settingsService.get('emojifilter')) {
    settingsService.set('emojifilter', effectiveSettings.emojifilter);
  }

  // Apply ephemeral settings from profile if loaded (either --profile-load or --profile)
  // BUT skip ALL profile ephemeral settings if --provider was explicitly specified
  // @plan:PLAN-20251118-ISSUE533.P13 - Also apply for inline profiles
  if (
    (profileToLoad || bootstrapArgs.profileJson !== null) &&
    effectiveSettings &&
    argv.provider === undefined
  ) {
    // Extract ephemeral settings that were merged from the profile
    const ephemeralKeys = [
      'auth-key',
      'auth-keyfile',
      'context-limit',
      'compression-threshold',
      'base-url',
      'tool-format',
      'api-version',
      'custom-headers',
      'shell-replacement',
      'authOnly',
    ];

    for (const key of ephemeralKeys) {
      const value = (effectiveSettings as Record<string, unknown>)[key];
      if (value !== undefined) {
        enhancedConfig.setEphemeralSetting(key, value);
      }
    }
  }

  const cliSetResult = applyCliSetArguments(enhancedConfig, argv.set);

  if (Object.keys(cliSetResult.modelParams).length > 0) {
    const configWithCliParams = enhancedConfig as Config & {
      _cliModelParams?: Record<string, unknown>;
    };
    configWithCliParams._cliModelParams = cliSetResult.modelParams;
  }

  // Store profile model params on the config for later application
  if (profileModelParams) {
    // Attach profile params to config object with proper typing
    const configWithProfile = enhancedConfig as Config & {
      _profileModelParams?: Record<string, unknown>;
    };
    configWithProfile._profileModelParams = profileModelParams;
  }

  return enhancedConfig;
}

function allowedMcpServers(
  mcpServers: { [x: string]: MCPServerConfig },
  allowMCPServers: string[],
  blockedMcpServers: Array<{ name: string; extensionName: string }>,
) {
  const allowedNames = new Set(allowMCPServers.filter(Boolean));
  if (allowedNames.size > 0) {
    mcpServers = Object.fromEntries(
      Object.entries(mcpServers).filter(([key, server]) => {
        const isAllowed = allowedNames.has(key);
        if (!isAllowed) {
          blockedMcpServers.push({
            name: key,
            extensionName: server.extensionName || '',
          });
        }
        return isAllowed;
      }),
    );
  } else {
    blockedMcpServers.push(
      ...Object.entries(mcpServers).map(([key, server]) => ({
        name: key,
        extensionName: server.extensionName || '',
      })),
    );
    mcpServers = {};
  }
  return mcpServers;
}

function mergeMcpServers(settings: Settings, extensions: GeminiCLIExtension[]) {
  const mcpServers = { ...(settings.mcpServers || {}) };
  for (const extension of extensions) {
    Object.entries(extension.mcpServers || {}).forEach(([key, server]) => {
      if (mcpServers[key]) {
        logger.debug(
          () =>
            `WARNING: Skipping extension MCP config for server with key "${key}" as it already exists.`,
        );
        return;
      }
      mcpServers[key] = {
        ...server,
        extensionName: extension.name,
      };
    });
  }
  return mcpServers;
}

function mergeExcludeTools(
  settings: Settings,
  extensions: GeminiCLIExtension[],
  extraExcludes?: string[] | undefined,
): string[] {
  const allExcludeTools = new Set([
    ...(settings.excludeTools || []),
    ...(extraExcludes || []),
  ]);
  for (const extension of extensions) {
    for (const tool of extension.excludeTools || []) {
      allExcludeTools.add(tool);
    }
  }
  return [...allExcludeTools];
}

function findEnvFile(startDir: string): string | null {
  let currentDir = path.resolve(startDir);
  while (true) {
    // prefer gemini-specific .env under LLXPRT_DIR
    const geminiEnvPath = path.join(currentDir, LLXPRT_DIR, '.env');
    if (fs.existsSync(geminiEnvPath)) {
      return geminiEnvPath;
    }
    const envPath = path.join(currentDir, '.env');
    if (fs.existsSync(envPath)) {
      return envPath;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir || !parentDir) {
      // check .env under home as fallback, again preferring gemini-specific .env
      const homeGeminiEnvPath = path.join(os.homedir(), LLXPRT_DIR, '.env');
      if (fs.existsSync(homeGeminiEnvPath)) {
        return homeGeminiEnvPath;
      }
      const homeEnvPath = path.join(os.homedir(), '.env');
      if (fs.existsSync(homeEnvPath)) {
        return homeEnvPath;
      }
      return null;
    }
    currentDir = parentDir;
  }
}

export function loadEnvironment(): void {
  const envFilePath = findEnvFile(process.cwd());
  if (envFilePath) {
    dotenv.config({ path: envFilePath, quiet: true });
  }
}

export {
  getCliRuntimeConfig,
  getCliRuntimeServices,
  getCliProviderManager,
  getActiveProviderStatus,
  listProviders as listRuntimeProviders,
} from '../runtime/runtimeSettings.js';
