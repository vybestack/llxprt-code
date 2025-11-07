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
import { extensionsCommand } from '../commands/extensions.js';
import {
  Config,
  loadServerHierarchicalMemory,
  setLlxprtMdFilename as setServerGeminiMdFilename,
  getCurrentLlxprtMdFilename,
  ApprovalMode,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
  FileDiscoveryService,
  TelemetryTarget,
  FileFilteringOptions,
  ProfileManager,
  type Profile,
  ShellTool,
  EditTool,
  WriteFileTool,
  MCPServerConfig,
  SettingsService,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import { Settings } from './settings.js';

import { Extension, annotateActiveExtensions } from './extension.js';
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
} from './profileBootstrap.js';
import {
  applyProfileSnapshot,
  getCliRuntimeContext,
  registerCliProviderInfrastructure,
  setCliRuntimeContext,
  switchActiveProvider,
} from '../runtime/runtimeSettings.js';
import { applyCliSetArguments } from './cliEphemeralSettings.js';

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
      normalized.add(normalizeToolNameForPolicy(entry));
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
  useSmartEdit: boolean | undefined;
  sessionSummary: string | undefined;
  dumponerror: boolean | undefined;
  promptWords: string[] | undefined;
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
        .option('allowed-mcp-server-names', {
          type: 'array',
          string: true,
          description: 'Allowed MCP server names',
        })
        .option('allowed-tools', {
          type: 'array',
          string: true,
          description: 'Tools that are allowed to run without confirmation',
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
          default: false,
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

  const cliArgs: CliArgs = {
    model: result.model as string | undefined,
    sandbox: result.sandbox as boolean | string | undefined,
    sandboxImage: result.sandboxImage as string | undefined,
    debug: result.debug as boolean | undefined,
    prompt: result.prompt as string | undefined,
    promptInteractive: result.promptInteractive as string | undefined,
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
    useSmartEdit: result.useSmartEdit as boolean | undefined,
    sessionSummary: result.sessionSummary as string | undefined,
    dumponerror: result.dumponerror as boolean | undefined,
    allowedTools: result.allowedTools as string[] | undefined,
    promptWords: result.promptWords as string[] | undefined,
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
): Promise<{ memoryContent: string; fileCount: number }> {
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
    settings.memoryDiscoveryMaxDirs,
  );
}

export async function loadCliConfig(
  settings: Settings,
  extensions: Extension[],
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
  const runtimeState = await prepareRuntimeForProfile(parsedWithOverrides);
  const bootstrapArgs = parsedWithOverrides.bootstrapArgs;

  // Handle --load flag early to apply profile settings
  let effectiveSettings = settings;
  let profileModel: string | undefined;
  let profileProvider: string | undefined;
  let profileModelParams: Record<string, unknown> | undefined;
  let profileBaseUrl: string | undefined;
  let loadedProfile: Profile | null = null;
  const profileWarnings: string[] = [];

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
  const profileToLoad =
    normaliseProfileName(bootstrapArgs.profileName) ??
    normaliseProfileName(process.env.LLXPRT_PROFILE) ??
    (argv.provider === undefined
      ? normaliseProfileName(
          typeof settings.defaultProfile === 'string'
            ? settings.defaultProfile
            : undefined,
        )
      : undefined);

  if (profileToLoad) {
    try {
      const profileManager = new ProfileManager();
      const profile = await profileManager.loadProfile(profileToLoad);
      loadedProfile = profile;

      // Store profile values to apply after Config creation
      // Only use profile provider/model if --provider is not explicitly specified
      // Check for undefined specifically to avoid issues with empty strings
      profileProvider =
        argv.provider !== undefined ? undefined : profile.provider;
      profileModel = argv.provider !== undefined ? undefined : profile.model;
      profileModelParams = profile.modelParams;
      profileBaseUrl =
        typeof profile.ephemeralSettings?.['base-url'] === 'string'
          ? profile.ephemeralSettings['base-url']
          : undefined;

      const loadSummary = `Loaded profile ${profileToLoad}: provider=${profile.provider}, model=${profile.model}, hasEphemeralSettings=${!!profile.ephemeralSettings}`;
      logger.debug(() => loadSummary);

      // Check debug mode for logging
      const tempDebugMode =
        argv.debug ||
        [process.env.DEBUG, process.env.DEBUG_MODE].some(
          (v) => v === 'true' || v === '1',
        ) ||
        false;

      // Merge ephemeral settings into the settings object
      // But skip ALL ephemeral settings if --provider is explicitly specified
      // since profiles are provider-specific configurations
      if (argv.provider !== undefined) {
        // When --provider is specified, don't load ANY profile ephemeral settings
        // to avoid conflicts with the explicitly chosen provider
        effectiveSettings = settings;

        if (tempDebugMode) {
          const skipMessage =
            'Skipping profile ephemeral settings because --provider was specified';
          logger.debug(skipMessage);
          console.debug(`[DEBUG] ${skipMessage}`);
        }
      } else {
        effectiveSettings = {
          ...settings,
          ...profile.ephemeralSettings,
        } as Settings;
      }

      if (tempDebugMode) {
        console.debug(loadSummary);
        const detailedSummary = `Loaded profile '${profileToLoad}' with provider: ${profileProvider}, model: ${profileModel}`;
        logger.debug(detailedSummary);
        console.debug(detailedSummary);
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

  const memoryImportFormat = effectiveSettings.memoryImportFormat || 'tree';

  // Handle IDE mode: CLI flag overrides settings
  let ideMode: boolean;
  if (argv.ideMode === 'enable') {
    ideMode = true;
  } else if (argv.ideMode === 'disable') {
    ideMode = false;
  } else {
    // No CLI flag, use settings
    ideMode = effectiveSettings.ideMode ?? false;
  }

  if (debugMode) {
    console.debug('[DEBUG] IDE mode configuration:', {
      'argv.ideMode': argv.ideMode,
      'effectiveSettings.ideMode': effectiveSettings.ideMode,
      'final ideMode': ideMode,
    });
  }

  // ideModeFeature flag removed - now using ideMode directly

  // Folder trust feature flag removed - now using settings directly
  const folderTrust = settings.folderTrust ?? false;
  const trustedFolder = isWorkspaceTrusted(settings) ?? true;

  const allExtensions = annotateActiveExtensions(
    extensions,
    argv.extensions || [],
  );

  const activeExtensions = extensions.filter(
    (_, i) => allExtensions[i].isActive,
  );

  // Set the context filename in the server's memoryTool module BEFORE loading memory
  // TODO(b/343434939): This is a bit of a hack. The contextFileName should ideally be passed
  // directly to the Config constructor in core, and have core handle setLlxprtMdFilename.
  // However, loadHierarchicalLlxprtMemory is called *before* createServerConfig.
  if (effectiveSettings.contextFileName) {
    setServerGeminiMdFilename(effectiveSettings.contextFileName);
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
  const { memoryContent, fileCount } = await loadHierarchicalLlxprtMemory(
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

  const interactive =
    !!argv.promptInteractive || (process.stdin.isTTY && question.length === 0);
  // In non-interactive mode, exclude tools that require a prompt.
  const extraExcludes: string[] = [];
  if (!interactive && !argv.experimentalAcp) {
    switch (approvalMode) {
      case ApprovalMode.DEFAULT:
        // In default non-interactive mode, all tools that require approval are excluded.
        extraExcludes.push(ShellTool.Name, EditTool.Name, WriteFileTool.Name);
        break;
      case ApprovalMode.AUTO_EDIT:
        // In auto-edit non-interactive mode, only tools that still require a prompt are excluded.
        extraExcludes.push(ShellTool.Name);
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

  // Handle model selection with proper precedence
  // Only use DEFAULT_GEMINI_MODEL as fallback when provider is 'gemini'
  const finalModel: string =
    argv.model ||
    profileModel ||
    effectiveSettings.model ||
    process.env.LLXPRT_DEFAULT_MODEL ||
    process.env.GEMINI_MODEL ||
    // If no model specified and provider is gemini, use the Gemini default
    // For other providers, let them use their own default models (empty string means use provider default)
    (finalProvider === 'gemini' ? DEFAULT_GEMINI_MODEL : '');

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

  const config = new Config({
    sessionId,
    embeddingModel: DEFAULT_GEMINI_EMBEDDING_MODEL,
    sandbox: sandboxConfig,
    targetDir: cwd,
    includeDirectories,
    loadMemoryFromIncludeDirectories: resolvedLoadMemoryFromIncludeDirectories,
    debugMode,
    question,
    fullContext: argv.allFiles || false,
    coreTools: effectiveSettings.coreTools || undefined,
    allowedTools: argv.allowedTools || settings.allowedTools || undefined,
    excludeTools,
    toolDiscoveryCommand: effectiveSettings.toolDiscoveryCommand,
    toolCallCommand: effectiveSettings.toolCallCommand,
    mcpServerCommand: effectiveSettings.mcpServerCommand,
    mcpServers,
    userMemory: memoryContent,
    llxprtMdFileCount: fileCount,
    approvalMode,
    showMemoryUsage:
      argv.showMemoryUsage || effectiveSettings.showMemoryUsage || false,
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
    usageStatisticsEnabled: effectiveSettings.usageStatisticsEnabled ?? true,
    // Git-aware file filtering settings - fix from upstream: pass fileFiltering correctly
    fileFiltering: effectiveSettings.fileFiltering,
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
    maxSessionTurns: effectiveSettings.maxSessionTurns ?? -1,
    experimentalZedIntegration: argv.experimentalAcp || false,
    listExtensions: argv.listExtensions || false,
    activeExtensions: activeExtensions.map((e) => ({
      name: e.config.name,
      version: e.config.version,
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
    useSmartEdit: argv.useSmartEdit ?? effectiveSettings.useSmartEdit,
  });

  const enhancedConfig = config;

  const bootstrapRuntimeId =
    runtimeState.runtime.runtimeId ?? 'cli.runtime.bootstrap';
  const baseBootstrapMetadata = {
    ...(runtimeState.runtime.metadata ?? {}),
    stage: 'post-config',
  };

  setCliRuntimeContext(runtimeState.runtime.settingsService, enhancedConfig, {
    runtimeId: bootstrapRuntimeId,
    metadata: baseBootstrapMetadata,
  });
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
  if (loadedProfile && profileToLoad && argv.provider === undefined) {
    const applyMetadata = {
      ...baseBootstrapMetadata,
      stage: 'profile-apply',
      profileName: profileToLoad,
    };

    setCliRuntimeContext(runtimeState.runtime.settingsService, enhancedConfig, {
      runtimeId: bootstrapRuntimeId,
      metadata: applyMetadata,
    });
    if (runtimeState.oauthManager) {
      registerCliProviderInfrastructure(
        runtimeState.providerManager,
        runtimeState.oauthManager,
      );
    }

    appliedProfileResult = await applyProfileSnapshot(loadedProfile, {
      profileName: profileToLoad,
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
        `[bootstrap] Applied profile '${profileToLoad}' -> provider=${profileProvider}, model=${profileModel}, baseUrl=${profileBaseUrl ?? 'default'}`,
    );
  } else if (profileToLoad && argv.provider !== undefined) {
    logger.debug(
      () =>
        `[bootstrap] Skipping profile application for '${profileToLoad}' because --provider was specified.`,
    );
  }

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

  // Apply ephemeral settings from profile if loaded
  // BUT skip ALL profile ephemeral settings if --provider was explicitly specified
  if (profileToLoad && effectiveSettings && argv.provider === undefined) {
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

function mergeMcpServers(settings: Settings, extensions: Extension[]) {
  const mcpServers = { ...(settings.mcpServers || {}) };
  for (const extension of extensions) {
    Object.entries(extension.config.mcpServers || {}).forEach(
      ([key, server]) => {
        if (mcpServers[key]) {
          logger.debug(
            () =>
              `WARNING: Skipping extension MCP config for server with key "${key}" as it already exists.`,
          );
          return;
        }
        mcpServers[key] = {
          ...server,
          extensionName: extension.config.name,
        };
      },
    );
  }
  return mcpServers;
}

function mergeExcludeTools(
  settings: Settings,
  extensions: Extension[],
  extraExcludes?: string[] | undefined,
): string[] {
  const allExcludeTools = new Set([
    ...(settings.excludeTools || []),
    ...(extraExcludes || []),
  ]);
  for (const extension of extensions) {
    for (const tool of extension.config.excludeTools || []) {
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
