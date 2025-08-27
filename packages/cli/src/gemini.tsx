/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { ErrorInfo } from 'react';
import { render } from 'ink';
import { AppWrapper } from './ui/App.js';
import { ErrorBoundary } from './ui/components/ErrorBoundary.js';
import { loadCliConfig, parseArguments } from './config/config.js';
import { readStdin } from './utils/readStdin.js';
import { basename } from 'node:path';
import v8 from 'node:v8';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import dns from 'node:dns';
import { spawn } from 'node:child_process';
import { start_sandbox } from './utils/sandbox.js';
import chalk from 'chalk';
import {
  DnsResolutionOrder,
  LoadedSettings,
  loadSettings,
  SettingScope,
} from './config/settings.js';
import {
  getSettingsService,
  Config,
  sessionId,
  AuthType,
  getOauthClient,
  setGitStatsService,
  logUserPrompt,
  logIdeConnection,
  IdeConnectionEvent,
  IdeConnectionType,
  FatalConfigError,
  // IDE connection logging removed - telemetry disabled in llxprt
} from '@vybestack/llxprt-code-core';
import { themeManager } from './ui/themes/theme-manager.js';
import { getStartupWarnings } from './utils/startupWarnings.js';
import { getUserStartupWarnings } from './utils/userStartupWarnings.js';
import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { runNonInteractive } from './nonInteractiveCli.js';
import { loadExtensions } from './config/extension.js';
import { cleanupCheckpoints, registerCleanup } from './utils/cleanup.js';
import { getCliVersion } from './utils/version.js';
import { validateAuthMethod } from './config/auth.js';
import { setMaxSizedBoxDebugging } from './ui/components/shared/MaxSizedBox.js';
import { getProviderManager } from './providers/providerManagerInstance.js';
import {
  setProviderApiKey,
  setProviderBaseUrl,
} from './providers/providerConfigUtils.js';
import { validateNonInteractiveAuth } from './validateNonInterActiveAuth.js';
import { detectAndEnableKittyProtocol } from './ui/utils/kittyProtocolDetector.js';
import { checkForUpdates } from './ui/utils/updateCheck.js';
import { handleAutoUpdate } from './utils/handleAutoUpdate.js';
import { GitStatsServiceImpl } from './providers/logging/git-stats-service-impl.js';
import { appEvents, AppEvent } from './utils/events.js';
import { SettingsContext } from './ui/contexts/SettingsContext.js';

export function validateDnsResolutionOrder(
  order: string | undefined,
): DnsResolutionOrder {
  const defaultValue: DnsResolutionOrder = 'ipv4first';
  if (order === undefined) {
    return defaultValue;
  }
  if (order === 'ipv4first' || order === 'verbatim') {
    return order;
  }
  // We don't want to throw here, just warn and use the default.
  console.warn(
    `Invalid value for dnsResolutionOrder in settings: "${order}". Using default "${defaultValue}".`,
  );
  return defaultValue;
}

function getNodeMemoryArgs(config: Config): string[] {
  const totalMemoryMB = os.totalmem() / (1024 * 1024);
  const heapStats = v8.getHeapStatistics();
  const currentMaxOldSpaceSizeMb = Math.floor(
    heapStats.heap_size_limit / 1024 / 1024,
  );

  // Set target to 50% of total memory
  const targetMaxOldSpaceSizeInMB = Math.floor(totalMemoryMB * 0.5);
  if (config.getDebugMode()) {
    console.debug(
      `Current heap size ${currentMaxOldSpaceSizeMb.toFixed(2)} MB`,
    );
  }

  if (process.env.LLXPRT_CLI_NO_RELAUNCH) {
    return [];
  }

  if (targetMaxOldSpaceSizeInMB > currentMaxOldSpaceSizeMb) {
    if (config.getDebugMode()) {
      console.debug(
        `Need to relaunch with more memory: ${targetMaxOldSpaceSizeInMB.toFixed(2)} MB`,
      );
    }
    return [`--max-old-space-size=${targetMaxOldSpaceSizeInMB}`];
  }

  return [];
}

async function relaunchWithAdditionalArgs(additionalArgs: string[]) {
  const nodeArgs = [...additionalArgs, ...process.argv.slice(1)];
  const newEnv = { ...process.env, LLXPRT_CLI_NO_RELAUNCH: 'true' };

  const child = spawn(process.execPath, nodeArgs, {
    stdio: 'inherit',
    env: newEnv,
  });

  await new Promise((resolve) => child.on('close', resolve));
  process.exit(0);
}
import { runZedIntegration } from './zed-integration/zedIntegration.js';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export function setupUnhandledRejectionHandler() {
  let unhandledRejectionOccurred = false;
  process.on('unhandledRejection', (reason, _promise) => {
    const errorMessage = `=========================================
This is an unexpected error. Please file a bug report using the /bug tool.
CRITICAL: Unhandled Promise Rejection!
=========================================
Reason: ${reason}${
      reason instanceof Error && reason.stack
        ? `
Stack trace:
${reason.stack}`
        : ''
    }`;
    appEvents.emit(AppEvent.LogError, errorMessage);
    if (!unhandledRejectionOccurred) {
      unhandledRejectionOccurred = true;
      appEvents.emit(AppEvent.OpenDebugConsole);
    }
  });
}

function handleError(error: Error, errorInfo: ErrorInfo) {
  // Log to console for debugging
  console.error('Application Error:', error);
  console.error('Component Stack:', errorInfo.componentStack);

  // Special handling for maximum update depth errors
  if (error.message.includes('Maximum update depth exceeded')) {
    console.error('\nCRITICAL: RENDER LOOP DETECTED!');
    console.error('This is likely caused by:');
    console.error('- State updates during render');
    console.error('- Incorrect useEffect dependencies');
    console.error('- Non-memoized props causing re-renders');
    console.error('\nCheck recent changes to React components and hooks.');
  }
}

export async function startInteractiveUI(
  config: Config,
  settings: LoadedSettings,
  startupWarnings: string[],
  workspaceRoot: string,
) {
  const version = await getCliVersion();
  // Detect and enable Kitty keyboard protocol once at startup
  await detectAndEnableKittyProtocol();
  setWindowTitle(basename(workspaceRoot), settings);
  
  // Initialize authentication before rendering to ensure geminiClient is available
  if (settings.merged.selectedAuthType) {
    try {
      const err = validateAuthMethod(settings.merged.selectedAuthType);
      if (err) {
        console.error('Error validating authentication method:', err);
        process.exit(1);
      }
    } catch (err) {
      console.error('Error authenticating:', err);
      process.exit(1);
    }
  }
  
  const instance = render(
    <React.StrictMode>
      <ErrorBoundary
        // eslint-disable-next-line react/jsx-no-bind
        onError={handleError}
      >
        <SettingsContext.Provider value={settings}>
          <AppWrapper
            config={config}
            settings={settings}
            startupWarnings={startupWarnings}
            version={version}
          />
        </SettingsContext.Provider>
      </ErrorBoundary>
    </React.StrictMode>,
    { exitOnCtrlC: false, isScreenReaderEnabled: config.getScreenReader() },
  );

  checkForUpdates()
    .then((info) => {
      handleAutoUpdate(info, settings, config.getProjectRoot());
    })
    .catch((err) => {
      // Silently ignore update check errors.
      if (config.getDebugMode()) {
        console.error('Update check failed:', err);
      }
    });

  registerCleanup(() => instance.unmount());
}

export async function main() {
  setupUnhandledRejectionHandler();

  // Create .llxprt directory if it doesn't exist
  const llxprtDir = join(homedir(), '.llxprt');
  if (!existsSync(llxprtDir)) {
    mkdirSync(llxprtDir, { recursive: true });
  }
  const workspaceRoot = process.cwd();
  const settings = loadSettings(workspaceRoot);
  const argv = await parseArguments(settings.merged);

  await cleanupCheckpoints();
  if (settings.errors.length > 0) {
    const errorMessages = settings.errors.map(
      (error) => `Error in ${error.path}: ${error.message}`,
    );
    throw new FatalConfigError(
      `${errorMessages.join('\n')}\nPlease fix the configuration file(s) and try again.`,
    );
  }

  // If we're in ACP mode, redirect console output IMMEDIATELY
  // before any config loading that might write to stdout
  if (argv.experimentalAcp) {
    console.log = console.error;
    console.info = console.error;
    console.debug = console.error;
  }
  const extensions = loadExtensions(workspaceRoot);
  const config = await loadCliConfig(
    settings.merged,
    extensions,
    sessionId,
    argv,
  );

  const consolePatcher = new ConsolePatcher({
    stderr: true,
    debugMode: config.getDebugMode(),
  });
  consolePatcher.patch();
  registerCleanup(consolePatcher.cleanup);

  const providerManager = getProviderManager(config, false, settings);
  config.setProviderManager(providerManager);

  // Initialize git stats service for tracking file changes when logging is enabled
  if (config.getConversationLoggingEnabled()) {
    const gitStatsService = new GitStatsServiceImpl(config);
    setGitStatsService(gitStatsService);
  }

  // Ensure serverToolsProvider (Gemini) has config set if it's not the active provider
  const serverToolsProvider = providerManager.getServerToolsProvider();
  if (
    serverToolsProvider &&
    serverToolsProvider.name === 'gemini' &&
    serverToolsProvider.setConfig
  ) {
    serverToolsProvider.setConfig(config);
  }

  // Set DNS resolution order (prefer IPv4 by default)
  dns.setDefaultResultOrder(
    validateDnsResolutionOrder(settings.merged.dnsResolutionOrder),
  );

  if (argv.promptInteractive && !process.stdin.isTTY) {
    console.error(
      'Error: The --prompt-interactive flag is not supported when piping input from stdin.',
    );
    process.exit(1);
  }

  if (config.getListExtensions()) {
    for (const _extension of extensions) {
      // List extensions without console.log
    }
    process.exit(0);
  }

  // Set a default auth type if one isn't set.
  if (!settings.merged.selectedAuthType) {
    if (process.env.CLOUD_SHELL === 'true') {
      settings.setValue(
        SettingScope.User,
        'selectedAuthType',
        AuthType.CLOUD_SHELL,
      );
    } else if (process.env.LLXPRT_AUTH_TYPE === 'none') {
      settings.setValue(
        SettingScope.User,
        'selectedAuthType',
        AuthType.USE_NONE,
      );
    }
  }
  // Empty key causes issues with the GoogleGenAI package.
  if (process.env['GEMINI_API_KEY']?.trim() === '') {
    delete process.env['GEMINI_API_KEY'];
  }

  if (process.env['GOOGLE_API_KEY']?.trim() === '') {
    delete process.env['GOOGLE_API_KEY'];
  }

  setMaxSizedBoxDebugging(config.getDebugMode());

  await config.initialize();

  if (config.getIdeMode()) {
    const ideClient = config.getIdeClient();
    if (ideClient) {
      await ideClient.connect();
      // IDE connection logging removed - telemetry disabled in llxprt
    }
  }

  // Load custom themes from settings
  themeManager.loadCustomThemes(settings.merged.customThemes);

  // If a provider is specified, activate it after initialization
  const configProvider = config.getProvider();
  if (configProvider) {
    try {
      await providerManager.setActiveProvider(configProvider);

      // Set the model after activating provider
      // If no model specified, use the provider's default
      const activeProvider = providerManager.getActiveProvider();
      let configModel = config.getModel();

      if (
        (!configModel || configModel === 'placeholder-model') &&
        activeProvider.getDefaultModel
      ) {
        // No model specified or placeholder, get the provider's default
        configModel = activeProvider.getDefaultModel();
      }

      if (configModel && activeProvider.setModel) {
        activeProvider.setModel(configModel);
        // Also update the config with the resolved model
        const settingsService = getSettingsService();
        settingsService.setProviderSetting(
          configProvider,
          'model',
          configModel,
        );
      }

      // Apply profile model params if loaded AND provider was NOT specified via CLI
      const configWithProfile = config as Config & {
        _profileModelParams?: Record<string, unknown>;
      };
      if (
        !argv.provider &&
        configWithProfile._profileModelParams &&
        activeProvider
      ) {
        if (
          'setModelParams' in activeProvider &&
          activeProvider.setModelParams
        ) {
          activeProvider.setModelParams(configWithProfile._profileModelParams);
        }
      }

      // Apply ephemeral settings from profile ONLY if provider was NOT specified via CLI
      if (!argv.provider) {
        const authKey = config.getEphemeralSetting('auth-key') as string;
        const authKeyfile = config.getEphemeralSetting(
          'auth-keyfile',
        ) as string;
        const baseUrl = config.getEphemeralSetting('base-url') as string;

        // Only apply profile auth settings if no CLI auth args were provided
        if (!argv.key && !argv.keyfile) {
          if (authKey && activeProvider.setApiKey) {
            activeProvider.setApiKey(authKey);
          } else if (authKeyfile && activeProvider.setApiKey) {
            // Load API key from file
            try {
              const apiKey = (
                await fs.readFile(
                  authKeyfile.replace(/^~/, os.homedir()),
                  'utf-8',
                )
              ).trim();
              if (apiKey) {
                activeProvider.setApiKey(apiKey);
              }
            } catch (error) {
              console.error(
                chalk.red(
                  `Failed to load keyfile ${authKeyfile}: ${error instanceof Error ? error.message : String(error)}`,
                ),
              );
            }
          }
        }

        // Only apply profile base URL if not overridden by CLI
        if (
          !argv.baseurl &&
          baseUrl &&
          baseUrl !== 'none' &&
          activeProvider.setBaseUrl
        ) {
          activeProvider.setBaseUrl(baseUrl);
        }
      }

      // No need to set auth type when using a provider
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  }

  // Apply ephemeral settings from profile if provider came from profile (not CLI)
  // This handles the case where profile was loaded via --profile-load
  if (!argv.provider && (argv.profileLoad || settings.merged.defaultProfile)) {
    const activeProvider = providerManager.getActiveProvider();
    if (activeProvider) {
      // Apply ephemeral settings from profile to the provider
      // BUT only if not overridden by CLI arguments
      const authKey = config.getEphemeralSetting('auth-key') as string;
      const authKeyfile = config.getEphemeralSetting('auth-keyfile') as string;
      const baseUrl = config.getEphemeralSetting('base-url') as string;

      // Only apply profile auth settings if no CLI auth args were provided
      if (!argv.key && !argv.keyfile) {
        if (authKey && activeProvider.setApiKey) {
          activeProvider.setApiKey(authKey);
        } else if (authKeyfile && activeProvider.setApiKey) {
          // Load API key from file
          try {
            const apiKey = (
              await fs.readFile(
                authKeyfile.replace(/^~/, os.homedir()),
                'utf-8',
              )
            ).trim();
            if (apiKey) {
              activeProvider.setApiKey(apiKey);
            }
          } catch (error) {
            console.error(
              chalk.red(
                `Failed to load keyfile ${authKeyfile}: ${error instanceof Error ? error.message : String(error)}`,
              ),
            );
          }
        }
      }

      // Only apply profile base URL if not overridden by CLI
      if (
        !argv.baseurl &&
        baseUrl &&
        baseUrl !== 'none' &&
        activeProvider.setBaseUrl
      ) {
        activeProvider.setBaseUrl(baseUrl);
      }

      // Apply profile model params if loaded
      const configWithProfile = config as Config & {
        _profileModelParams?: Record<string, unknown>;
      };
      if (
        configWithProfile._profileModelParams &&
        'setModelParams' in activeProvider &&
        activeProvider.setModelParams
      ) {
        activeProvider.setModelParams(configWithProfile._profileModelParams);
      }
    }
  }

  // Process CLI-provided credentials (--key, --keyfile, --baseurl)
  if (argv.key || argv.keyfile || argv.baseurl) {
    // Provider-specific credentials are now handled directly

    // Handle --key
    if (argv.key) {
      const result = await setProviderApiKey(
        providerManager,
        settings,
        argv.key,
        config,
      );
      if (!result.success) {
        console.error(chalk.red(result.message));
        process.exit(1);
      }
      if (config.getDebugMode()) {
        console.debug(result.message);
      }
    }

    // Handle --keyfile
    if (argv.keyfile) {
      try {
        // Read the API key from file
        const resolvedPath = argv.keyfile.replace(/^~/, os.homedir());
        const apiKey = await fs.readFile(resolvedPath, 'utf-8');
        const trimmedKey = apiKey.trim();

        if (!trimmedKey) {
          console.error(chalk.red('The specified file is empty'));
          process.exit(1);
        }

        const result = await setProviderApiKey(
          providerManager,
          settings,
          trimmedKey,
          config,
        );

        if (!result.success) {
          console.error(chalk.red(result.message));
          process.exit(1);
        }

        // Store the keyfile path in ephemeral settings for reference
        // This helps track that we're using a keyfile vs direct key
        config.setEphemeralSetting('auth-keyfile', resolvedPath);
        // Don't clear auth-key - setProviderApiKey already sets it in settings
        // The auth-key will be used immediately, and auth-keyfile is stored
        // for future reference (e.g., when reloading profiles)

        const message = `API key loaded from ${resolvedPath} for provider '${providerManager.getActiveProviderName()}'`;
        if (config.getDebugMode()) {
          console.debug(message);
        }
      } catch (error) {
        console.error(
          chalk.red(
            `Failed to process keyfile: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        process.exit(1);
      }
    }

    // Handle --baseurl
    if (argv.baseurl) {
      const result = await setProviderBaseUrl(
        providerManager,
        settings,
        argv.baseurl,
      );
      if (!result.success) {
        console.error(chalk.red(result.message));
        process.exit(1);
      }
      if (config.getDebugMode()) {
        console.debug(result.message);
      }
    }
  }

  if (settings.merged.theme) {
    if (!themeManager.setActiveTheme(settings.merged.theme)) {
      // If the theme is not found during initial load, log a warning and continue.
      // The useThemeCommand hook in App.tsx will handle opening the dialog.
      console.warn(`Warning: Theme "${settings.merged.theme}" not found.`);
    }
  }

  // Verify theme colors at startup for debugging
  if (process.env.DEBUG_THEME) {
    const activeTheme = themeManager.getActiveTheme();
    console.log('Active theme:', activeTheme.name);
    console.log('Theme colors:', {
      AccentCyan: activeTheme.colors.AccentCyan,
      AccentBlue: activeTheme.colors.AccentBlue,
      AccentGreen: activeTheme.colors.AccentGreen,
      Gray: activeTheme.colors.Gray,
    });
  }

  // hop into sandbox if we are outside and sandboxing is enabled
  if (!process.env.SANDBOX) {
    const memoryArgs = settings.merged.autoConfigureMaxOldSpaceSize
      ? getNodeMemoryArgs(config)
      : [];
    const sandboxConfig = config.getSandbox();
    if (sandboxConfig) {
      if (
        settings.merged.selectedAuthType &&
        !settings.merged.useExternalAuth
      ) {
        // Validate authentication here because the sandbox will interfere with the Oauth2 web redirect.
        try {
          const err = validateAuthMethod(settings.merged.selectedAuthType);
          if (err) {
            throw new Error(err);
          }
          await config.refreshAuth(settings.merged.selectedAuthType);

          // Compression settings are already applied via ephemeral settings in Config
          // and will be read directly by geminiChat.ts during compression
        } catch (err) {
          console.error('Error authenticating:', err);
          process.exit(1);
        }
      }
      let stdinData = '';
      if (!process.stdin.isTTY) {
        stdinData = await readStdin();
      }

      // This function is a copy of the one from sandbox.ts
      // It is moved here to decouple sandbox.ts from the CLI's argument structure.
      const injectStdinIntoArgs = (
        args: string[],
        stdinData?: string,
      ): string[] => {
        const finalArgs = [...args];
        if (stdinData) {
          const promptIndex = finalArgs.findIndex(
            (arg) => arg === '--prompt' || arg === '-p',
          );
          if (promptIndex > -1 && finalArgs.length > promptIndex + 1) {
            // If there's a prompt argument, prepend stdin to it
            finalArgs[promptIndex + 1] =
              `${stdinData}\n\n${finalArgs[promptIndex + 1]}`;
          } else {
            // If there's no prompt argument, add stdin as the prompt
            finalArgs.push('--prompt', stdinData);
          }
        }
        return finalArgs;
      };

      const sandboxArgs = injectStdinIntoArgs(process.argv, stdinData);

      await start_sandbox(sandboxConfig, memoryArgs, config, sandboxArgs);
      process.exit(0);
    } else {
      // Not in a sandbox and not entering one, so relaunch with additional
      // arguments to control memory usage if needed.
      if (memoryArgs.length > 0) {
        await relaunchWithAdditionalArgs(memoryArgs);
        process.exit(0);
      }
    }
  }

  if (
    settings.merged.selectedAuthType === AuthType.LOGIN_WITH_GOOGLE &&
    config.isBrowserLaunchSuppressed()
  ) {
    // Do oauth before app renders to make copying the link possible.
    await getOauthClient(settings.merged.selectedAuthType, config);
  }

  if (config.getExperimentalZedIntegration()) {
    // In ACP mode, authentication happens through the protocol
    // Just ensure the provider manager is set up if configured
    const providerManager = config.getProviderManager();
    const configProvider = config.getProvider();

    if (configProvider && providerManager) {
      try {
        // Set the active provider if not already set
        if (!providerManager.hasActiveProvider()) {
          await providerManager.setActiveProvider(configProvider);
        }
      } catch (_e) {
        // Non-fatal - continue without provider
        // Authentication can still happen via the ACP protocol
      }
    }

    await runZedIntegration(config, settings);
    return;
  }

  let input = config.getQuestion();
  const startupWarnings = [
    ...(await getStartupWarnings()),
    ...(await getUserStartupWarnings(workspaceRoot)),
  ];

  // Check if a provider is already active on startup
  providerManager.getActiveProvider();

  // Render UI, passing necessary config values. Check that there is no command line question.
  if (config.isInteractive()) {
    await startInteractiveUI(config, settings, startupWarnings, workspaceRoot);
    return;
  }
  // If not a TTY, read from stdin
  // This is for cases where the user pipes input directly into the command
  if (!process.stdin.isTTY) {
    const stdinData = await readStdin();
    if (stdinData) {
      input = `${stdinData}\n\n${input}`;
    }
  }
  if (!input) {
    console.error(
      `No input provided via stdin. Input can be provided by piping data into gemini or using the --prompt option.`,
    );
    process.exit(1);
  }

  const prompt_id = Math.random().toString(16).slice(2);

  const nonInteractiveConfig = await validateNonInteractiveAuth(
    settings.merged.selectedAuthType,
    settings.merged.useExternalAuth,
    config,
  );

  await runNonInteractive(nonInteractiveConfig, input, prompt_id);
  process.exit(0);
}

function setWindowTitle(title: string, settings: LoadedSettings) {
  if (!settings.merged.hideWindowTitle) {
    const windowTitle = (process.env.CLI_TITLE || `LLxprt - ${title}`).replace(
      // eslint-disable-next-line no-control-regex
      /[\x00-\x1F\x7F]/g,
      '',
    );
    process.stdout.write(`\x1b]2;${windowTitle}\x07`);

    process.on('exit', () => {
      process.stdout.write(`\x1b]2;\x07`);
    });
  }
}
