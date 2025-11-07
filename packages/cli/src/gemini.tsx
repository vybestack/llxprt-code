/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { ErrorInfo, useState, useEffect } from 'react';
import { render, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { AppWrapper } from './ui/App.js';
import { ErrorBoundary } from './ui/components/ErrorBoundary.js';
import { loadCliConfig, parseArguments } from './config/config.js';
import { readStdin } from './utils/readStdin.js';
import { basename } from 'node:path';
import v8 from 'node:v8';
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
  Config,
  sessionId,
  AuthType,
  getOauthClient,
  setGitStatsService,
  FatalConfigError,
  uiTelemetryService,
  // IDE connection logging removed - telemetry disabled in llxprt
  SettingsService,
} from '@vybestack/llxprt-code-core';
import { themeManager } from './ui/themes/theme-manager.js';
import { getStartupWarnings } from './utils/startupWarnings.js';
import { getUserStartupWarnings } from './utils/userStartupWarnings.js';
import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { runNonInteractive } from './nonInteractiveCli.js';
import { loadExtensions } from './config/extension.js';
import {
  cleanupCheckpoints,
  registerCleanup,
  runExitCleanup,
} from './utils/cleanup.js';
import { getCliVersion } from './utils/version.js';
import { validateAuthMethod } from './config/auth.js';
import { setMaxSizedBoxDebugging } from './ui/components/shared/MaxSizedBox.js';
import { createProviderManager } from './providers/providerManagerInstance.js';
import { validateNonInteractiveAuth } from './validateNonInterActiveAuth.js';
import { detectAndEnableKittyProtocol } from './ui/utils/kittyProtocolDetector.js';
import { checkForUpdates } from './ui/utils/updateCheck.js';
import { handleAutoUpdate } from './utils/handleAutoUpdate.js';
import { GitStatsServiceImpl } from './providers/logging/git-stats-service-impl.js';
import { appEvents, AppEvent } from './utils/events.js';
import { SettingsContext } from './ui/contexts/SettingsContext.js';
import {
  registerCliProviderInfrastructure,
  setCliRuntimeContext,
  switchActiveProvider,
  setActiveModel,
  setActiveModelParam,
  clearActiveModelParam,
  getActiveModelParams,
  loadProfileByName,
  applyCliArgumentOverrides,
} from './runtime/runtimeSettings.js';
import { writeFileSync } from 'node:fs';

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

  if (process.env.LLXPRT_CODE_NO_RELAUNCH) {
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
  const newEnv = { ...process.env, LLXPRT_CODE_NO_RELAUNCH: 'true' };

  const child = spawn(process.execPath, nodeArgs, {
    stdio: 'inherit',
    env: newEnv,
  });

  await new Promise((resolve) => child.on('close', resolve));
  process.exit(0);
}

const InitializingComponent = ({ initialTotal }: { initialTotal: number }) => {
  const [total, setTotal] = useState(initialTotal);
  const [connected, setConnected] = useState(0);

  useEffect(() => {
    const onStart = ({ count }: { count: number }) => setTotal(count);
    const onChange = () => {
      setConnected((val) => val + 1);
    };

    appEvents.on('mcp-servers-discovery-start', onStart);
    appEvents.on('mcp-server-connected', onChange);
    appEvents.on('mcp-server-error', onChange);

    return () => {
      appEvents.off('mcp-servers-discovery-start', onStart);
      appEvents.off('mcp-server-connected', onChange);
      appEvents.off('mcp-server-error', onChange);
    };
  }, []);

  const message = `Connecting to MCP servers... (${connected}/${total})`;

  return (
    <Box>
      <Text>
        <Spinner /> {message}
      </Text>
    </Box>
  );
};

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
      <ErrorBoundary onError={handleError}>
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
    { exitOnCtrlC: false },
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

  const hasPipedInput = !process.stdin.isTTY && !argv.experimentalAcp;
  let cachedStdinData: string | null = null;
  let stdinWasRead = false;

  const readStdinOnce = async () => {
    if (!stdinWasRead) {
      stdinWasRead = true;
      cachedStdinData = await readStdin();
    }
    return cachedStdinData ?? '';
  };

  const questionFromArgs =
    argv.promptInteractive || argv.prompt || (argv.promptWords || []).join(' ');

  await cleanupCheckpoints();

  if (hasPipedInput) {
    const stdinSnapshot = await readStdinOnce();
    if (!stdinSnapshot && !questionFromArgs) {
      console.error(
        `No input provided via stdin. Input can be provided by piping data into gemini or using the --prompt option.`,
      );
      process.exit(1);
    }
  }
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

  /**
   * @plan:PLAN-20250218-STATELESSPROVIDER.P06
   * @requirement:REQ-SP-005
   * Seed the CLI runtime context with a scoped SettingsService before Config
   * construction, mirroring pseudocode/cli-runtime.md:2-5.
   */
  const runtimeSettingsService = new SettingsService();
  setCliRuntimeContext(runtimeSettingsService, undefined, {
    metadata: { source: 'cli-bootstrap', stage: 'pre-config' },
  });

  const config = await loadCliConfig(
    settings.merged,
    extensions,
    sessionId,
    argv,
    process.cwd(),
    { settingsService: runtimeSettingsService },
  );
  setCliRuntimeContext(runtimeSettingsService, config, {
    metadata: { source: 'cli-bootstrap', stage: 'post-config' },
  });

  if (argv.sessionSummary) {
    registerCleanup(() => {
      const metrics = uiTelemetryService.getMetrics();
      writeFileSync(
        argv.sessionSummary!,
        JSON.stringify({ sessionMetrics: metrics }, null, 2),
      );
    });
  }

  const consolePatcher = new ConsolePatcher({
    stderr: true,
    debugMode: config.getDebugMode(),
  });
  consolePatcher.patch();
  registerCleanup(consolePatcher.cleanup);

  const { manager: providerManager, oauthManager } = createProviderManager(
    {
      settingsService: runtimeSettingsService,
      config,
      runtimeId: 'cli.providerManager',
      metadata: { source: 'cli.getProviderManager' },
    },
    { config, allowBrowserEnvironment: false, settings },
  );
  registerCliProviderInfrastructure(providerManager, oauthManager);

  const bootstrapProfileName =
    argv.profileLoad?.trim() ||
    (typeof process.env.LLXPRT_BOOTSTRAP_PROFILE === 'string'
      ? process.env.LLXPRT_BOOTSTRAP_PROFILE.trim()
      : '');
  if (
    !argv.provider &&
    bootstrapProfileName !== '' &&
    runtimeSettingsService.getCurrentProfileName?.() !== null
  ) {
    try {
      await loadProfileByName(bootstrapProfileName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[bootstrap] Failed to reapply profile '${bootstrapProfileName}' after provider manager initialization: ${message}`,
      );
    }
  }

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
    'setConfig' in serverToolsProvider &&
    typeof serverToolsProvider.setConfig === 'function'
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

  setMaxSizedBoxDebugging(config.getDebugMode());

  const mcpServers = config.getMcpServers();
  const mcpServersCount = mcpServers ? Object.keys(mcpServers).length : 0;

  let spinnerInstance;
  if (
    typeof config.isInteractive === 'function' &&
    config.isInteractive() &&
    mcpServersCount > 0
  ) {
    spinnerInstance = render(
      <InitializingComponent initialTotal={mcpServersCount} />,
    );
  }

  await config.initialize();

  if (spinnerInstance) {
    // Small UX detail to show the completion message for a bit before unmounting.
    await new Promise((f) => setTimeout(f, 100));
    spinnerInstance.clear();
    spinnerInstance.unmount();
  }

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
      // Apply CLI argument overrides BEFORE provider switch
      // This ensures --key, --keyfile, --baseurl, and --set are applied
      // at the correct time and override profile settings
      await applyCliArgumentOverrides(argv);

      await switchActiveProvider(configProvider);

      const activeProvider = providerManager.getActiveProvider();
      let configModel = config.getModel();

      if (
        (!configModel || configModel === 'placeholder-model') &&
        activeProvider.getDefaultModel
      ) {
        // No model specified or placeholder, get the provider's default
        configModel = activeProvider.getDefaultModel();
      }

      if (configModel && configModel !== 'placeholder-model') {
        await setActiveModel(configModel);
      }

      // Apply CLI and profile model params before first request
      const configWithParams = config as Config & {
        _profileModelParams?: Record<string, unknown>;
        _cliModelParams?: Record<string, unknown>;
      };
      const mergedModelParams: Record<string, unknown> = {};

      if (!argv.provider && configWithParams._profileModelParams) {
        Object.assign(mergedModelParams, configWithParams._profileModelParams);
      }

      if (configWithParams._cliModelParams) {
        Object.assign(mergedModelParams, configWithParams._cliModelParams);
      }

      if (activeProvider) {
        const existingParams = getActiveModelParams();

        for (const [key, value] of Object.entries(mergedModelParams)) {
          setActiveModelParam(key, value);
        }

        for (const key of Object.keys(existingParams)) {
          if (!(key in mergedModelParams)) {
            clearActiveModelParam(key);
          }
        }
      }

      // No need to set auth type when using a provider
      // CLI arguments have already been applied by applyCliArgumentOverrides() above
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
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
      if (hasPipedInput) {
        stdinData = await readStdinOnce();
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
    const providerManagerForAcp = config.getProviderManager();
    const configProvider = config.getProvider();

    if (configProvider && providerManagerForAcp) {
      try {
        // Set the active provider if not already set
        if (!providerManagerForAcp.hasActiveProvider()) {
          await providerManagerForAcp.setActiveProvider(configProvider);
        }
      } catch (_e) {
        // Non-fatal - continue without provider
        // Authentication can still happen via the ACP protocol
      }
    }

    return runZedIntegration(config, settings);
  }

  let input = config.getQuestion();
  const startupWarnings = [
    ...(await getStartupWarnings()),
    ...(await getUserStartupWarnings(workspaceRoot)),
  ];

  // Check if a provider is already active on startup
  providerManager.getActiveProvider();

  // Render UI, passing necessary config values. Check that there is no command line question.
  if (typeof config.isInteractive === 'function' && config.isInteractive()) {
    await startInteractiveUI(config, settings, startupWarnings, workspaceRoot);
    return;
  }
  // If not a TTY, read from stdin
  // This is for cases where the user pipes input directly into the command
  if (hasPipedInput) {
    const stdinData = await readStdinOnce();
    if (stdinData) {
      const existingInput = input ? `${input}` : '';
      input = `${stdinData}\n\n${existingInput}`;
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
  // Call cleanup before process.exit, which causes cleanup to not run
  await runExitCleanup();
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
