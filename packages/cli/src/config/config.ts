/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import process from 'node:process';
import {
  Config,
  loadServerHierarchicalMemory,
  setLlxprtMdFilename as setServerGeminiMdFilename,
  getCurrentLlxprtMdFilename,
  ApprovalMode,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
  FileDiscoveryService,
  TelemetryTarget,
  FileFilteringOptions,
  IdeClient,
  ProfileManager,
} from '@vybestack/llxprt-code-core';
import { Settings } from './settings.js';

import { Extension, annotateActiveExtensions } from './extension.js';
import { getCliVersion } from '../utils/version.js';
import { loadSandboxConfig } from './sandboxConfig.js';
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const LLXPRT_DIR = '.llxprt';

// Simple console logger for now - replace with actual logger if available
const logger = {
  debug: (...args: unknown[]) => console.debug('[DEBUG]', ...args),
  warn: (...args: unknown[]) => console.warn('[WARN]', ...args),
  error: (...args: unknown[]) => console.error('[ERROR]', ...args),
};

export interface CliArgs {
  model: string | undefined;
  sandbox: boolean | string | undefined;
  sandboxImage: string | undefined;
  debug: boolean | undefined;
  prompt: string | undefined;
  promptInteractive: string | undefined;
  allFiles: boolean | undefined;
  all_files: boolean | undefined;
  showMemoryUsage: boolean | undefined;
  show_memory_usage: boolean | undefined;
  yolo: boolean | undefined;
  telemetry: boolean | undefined;
  checkpointing: boolean | undefined;
  telemetryTarget: string | undefined;
  telemetryOtlpEndpoint: string | undefined;
  telemetryLogPrompts: boolean | undefined;
  telemetryOutfile: string | undefined;
  allowedMcpServerNames: string[] | undefined;
  experimentalAcp: boolean | undefined;
  extensions: string[] | undefined;
  listExtensions: boolean | undefined;
  provider: string | undefined;
  ideMode: boolean | undefined;
  ideModeFeature: boolean | undefined;
  key: string | undefined;
  keyfile: string | undefined;
  baseurl: string | undefined;
  proxy: string | undefined;
  includeDirectories: string[] | undefined;
  profileLoad: string | undefined;
}

export async function parseArguments(): Promise<CliArgs> {
  const yargsInstance = yargs(hideBin(process.argv))
    .scriptName('gemini')
    .usage(
      '$0 [options]',
      'Gemini CLI - Launch an interactive CLI, use -p/--prompt for non-interactive mode',
    )
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
    .option('all_files', {
      type: 'boolean',
      description: 'Include ALL files in context?',
      default: false,
    })
    .deprecateOption(
      'all_files',
      'Use --all-files instead. We will be removing --all_files in the coming weeks.',
    )
    .option('show-memory-usage', {
      type: 'boolean',
      description: 'Show memory usage in status bar',
      default: false,
    })
    .option('show_memory_usage', {
      type: 'boolean',
      description: 'Show memory usage in status bar',
      default: false,
    })
    .deprecateOption(
      'show_memory_usage',
      'Use --show-memory-usage instead. We will be removing --show_memory_usage in the coming weeks.',
    )
    .option('yolo', {
      alias: 'y',
      type: 'boolean',
      description:
        'Automatically accept all actions (aka YOLO mode, see https://www.youtube.com/watch?v=xvFZjo5PgG0 for more details)?',
      default: false,
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
      type: 'boolean',
      description: 'Run in IDE mode?',
    })
    .option('ide-mode-feature', {
      type: 'boolean',
      description: 'Enable IDE mode feature flag?',
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
    .option('profile-load', {
      type: 'string',
      description: 'Load a saved profile configuration on startup',
    })
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
  const result = yargsInstance.parseSync();

  // The import format is now only controlled by settings.memoryImportFormat
  // We no longer accept it as a CLI argument
  return result as CliArgs;
}

// This function is now a thin wrapper around the server's implementation.
// It's kept in the CLI for now as App.tsx directly calls it for memory refresh.
// TODO: Consider if App.tsx should get memory via a server call or if Config should refresh itself.
export async function loadHierarchicalLlxprtMemory(
  currentWorkingDirectory: string,
  debugMode: boolean,
  fileService: FileDiscoveryService,
  settings: Settings,
  extensionContextFilePaths: string[] = [],
  memoryImportFormat: 'flat' | 'tree' = 'tree',
  fileFilteringOptions?: FileFilteringOptions,
): Promise<{ memoryContent: string; fileCount: number }> {
  if (debugMode) {
    logger.debug(
      `CLI: Delegating hierarchical memory load to server for CWD: ${currentWorkingDirectory} (memoryImportFormat: ${memoryImportFormat})`,
    );
  }

  // Directly call the server function.
  // The server function will use its own homedir() for the global path.
  return loadServerHierarchicalMemory(
    currentWorkingDirectory,
    debugMode,
    fileService,
    extensionContextFilePaths,
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
): Promise<Config> {
  // Handle --load flag early to apply profile settings
  let effectiveSettings = settings;
  let profileModel: string | undefined;
  let profileProvider: string | undefined;
  let profileModelParams: Record<string, unknown> | undefined;

  // Check for profile to load - either from CLI arg or default profile setting
  const profileToLoad = argv.profileLoad || settings.defaultProfile;

  if (profileToLoad) {
    try {
      const profileManager = new ProfileManager();
      const profile = await profileManager.loadProfile(profileToLoad);

      // Store profile values to apply after Config creation
      profileProvider = profile.provider;
      profileModel = profile.model;
      profileModelParams = profile.modelParams;

      // Merge ephemeral settings into the settings object
      effectiveSettings = {
        ...settings,
        ...profile.ephemeralSettings,
      } as Settings;

      const tempDebugMode =
        argv.debug ||
        [process.env.DEBUG, process.env.DEBUG_MODE].some(
          (v) => v === 'true' || v === '1',
        ) ||
        false;

      if (tempDebugMode) {
        logger.debug(
          `Loaded profile '${profileToLoad}' with provider: ${profileProvider}, model: ${profileModel}`,
        );
      }
    } catch (error) {
      logger.error(`Failed to load profile '${profileToLoad}': ${error}`);
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

  const ideMode =
    (argv.ideMode ?? effectiveSettings.ideMode ?? false) &&
    process.env.TERM_PROGRAM === 'vscode' &&
    !process.env.SANDBOX;

  const ideModeFeature =
    (argv.ideModeFeature ?? effectiveSettings.ideModeFeature ?? false) &&
    !process.env.SANDBOX;

  const ideClient = IdeClient.getInstance(ideMode && ideModeFeature);

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

  const fileService = new FileDiscoveryService(process.cwd());

  const fileFiltering = {
    ...DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
    ...effectiveSettings.fileFiltering,
  };

  // Call the (now wrapper) loadHierarchicalLlxprtMemory which calls the server's version
  const { memoryContent, fileCount } = await loadHierarchicalLlxprtMemory(
    process.cwd(),
    debugMode,
    fileService,
    effectiveSettings,
    extensionContextFilePaths,
    memoryImportFormat,
    fileFiltering,
  );

  let mcpServers = mergeMcpServers(effectiveSettings, activeExtensions);
  const excludeTools = mergeExcludeTools(effectiveSettings, activeExtensions);
  const blockedMcpServers: Array<{ name: string; extensionName: string }> = [];

  if (!argv.allowedMcpServerNames) {
    if (effectiveSettings.allowMCPServers) {
      const allowedNames = new Set(
        effectiveSettings.allowMCPServers.filter(Boolean),
      );
      if (allowedNames.size > 0) {
        mcpServers = Object.fromEntries(
          Object.entries(mcpServers).filter(([key]) => allowedNames.has(key)),
        );
      }
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
    const allowedNames = new Set(argv.allowedMcpServerNames.filter(Boolean));
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
  }

  const sandboxConfig = await loadSandboxConfig(effectiveSettings, argv);

  // Handle model selection with proper precedence
  const finalModel =
    argv.model ||
    profileModel ||
    effectiveSettings.defaultModel ||
    process.env.LLXPRT_DEFAULT_MODEL ||
    process.env.GEMINI_MODEL ||
    DEFAULT_GEMINI_MODEL;

  // Handle provider selection with proper precedence
  const finalProvider =
    argv.provider ||
    profileProvider ||
    process.env.LLXPRT_DEFAULT_PROVIDER ||
    'gemini';

  const config = new Config({
    sessionId,
    embeddingModel: DEFAULT_GEMINI_EMBEDDING_MODEL,
    sandbox: sandboxConfig,
    targetDir: process.cwd(),
    includeDirectories: argv.includeDirectories,
    debugMode,
    question: argv.promptInteractive || argv.prompt || '',
    fullContext: argv.allFiles || argv.all_files || false,
    coreTools: effectiveSettings.coreTools || undefined,
    excludeTools,
    toolDiscoveryCommand: effectiveSettings.toolDiscoveryCommand,
    toolCallCommand: effectiveSettings.toolCallCommand,
    mcpServerCommand: effectiveSettings.mcpServerCommand,
    mcpServers,
    userMemory: memoryContent,
    llxprtMdFileCount: fileCount,
    approvalMode: argv.yolo ? ApprovalMode.YOLO : ApprovalMode.DEFAULT,
    showMemoryUsage:
      argv.showMemoryUsage ||
      argv.show_memory_usage ||
      effectiveSettings.showMemoryUsage ||
      false,
    accessibility: effectiveSettings.accessibility,
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
    },
    usageStatisticsEnabled: effectiveSettings.usageStatisticsEnabled ?? true,
    // Git-aware file filtering settings
    fileFiltering: {
      respectGitIgnore: effectiveSettings.fileFiltering?.respectGitIgnore,
      respectLlxprtIgnore: effectiveSettings.fileFiltering?.respectLlxprtIgnore,
      enableRecursiveFileSearch:
        effectiveSettings.fileFiltering?.enableRecursiveFileSearch,
    },
    checkpointing:
      argv.checkpointing || effectiveSettings.checkpointing?.enabled,
    proxy:
      argv.proxy ||
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy,
    cwd: process.cwd(),
    fileDiscoveryService: fileService,
    bugCommand: effectiveSettings.bugCommand,
    model: finalModel,
    extensionContextFilePaths,
    maxSessionTurns: effectiveSettings.maxSessionTurns ?? -1,
    experimentalAcp: argv.experimentalAcp || false,
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
    ideModeFeature,
    ideClient,
  });

  const enhancedConfig = config;

  // Apply ephemeral settings from profile if loaded
  if (profileToLoad && effectiveSettings) {
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
    ];

    for (const key of ephemeralKeys) {
      const value = (effectiveSettings as Record<string, unknown>)[key];
      if (value !== undefined) {
        enhancedConfig.setEphemeralSetting(key, value);
      }
    }
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

function mergeMcpServers(settings: Settings, extensions: Extension[]) {
  const mcpServers = { ...(settings.mcpServers || {}) };
  for (const extension of extensions) {
    Object.entries(extension.config.mcpServers || {}).forEach(
      ([key, server]) => {
        if (mcpServers[key]) {
          logger.warn(
            `Skipping extension MCP config for server with key "${key}" as it already exists.`,
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
): string[] {
  const allExcludeTools = new Set(settings.excludeTools || []);
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
