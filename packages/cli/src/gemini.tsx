/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const wantWarningSuppression =
  process.env.LLXPRT_SUPPRESS_NODE_WARNINGS !== 'false';
if (wantWarningSuppression && !process.env.NODE_NO_WARNINGS) {
  process.env.NODE_NO_WARNINGS = '1';
  const suppressedWarningCodes = new Set(['DEP0040', 'DEP0169']);
  type WarningMessage =
    | string
    | {
        code?: string;
        stack?: string;
        message?: string;
        [key: string]: unknown;
      };
  process.removeAllListeners('warning');
  process.on('warning', (warning: WarningMessage) => {
    const warningCode =
      typeof warning === 'string'
        ? undefined
        : typeof warning?.code === 'string'
          ? warning.code
          : undefined;
    if (warningCode && suppressedWarningCodes.has(warningCode)) {
      return;
    }
    const message =
      typeof warning === 'string'
        ? warning
        : (warning?.stack ?? warning?.message ?? String(warning));
    console.warn(message);
  });
}

import React, { ErrorInfo, useState, useEffect } from 'react';
import { render, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { AppWrapper } from './ui/App.js';
import { ErrorBoundary } from './ui/components/ErrorBoundary.js';
import { loadCliConfig, parseArguments } from './config/config.js';
import { readStdin } from './utils/readStdin.js';
import { basename } from 'node:path';
import dns from 'node:dns';
import { start_sandbox } from './utils/sandbox.js';
import { shouldRelaunchForMemory, isDebugMode } from './utils/bootstrap.js';
import { relaunchAppInChildProcess } from './utils/relaunch.js';
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
// createProviderManager removed - provider manager now created in loadCliConfig()
import { validateNonInteractiveAuth } from './validateNonInterActiveAuth.js';
import { detectAndEnableKittyProtocol } from './ui/utils/kittyProtocolDetector.js';
import { checkForUpdates } from './ui/utils/updateCheck.js';
import { handleAutoUpdate } from './utils/handleAutoUpdate.js';
import { GitStatsServiceImpl } from './providers/logging/git-stats-service-impl.js';
import { appEvents, AppEvent } from './utils/events.js';
import { SettingsContext } from './ui/contexts/SettingsContext.js';
import {
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

  if (settings.merged.autoConfigureMaxOldSpaceSize && !process.env.SANDBOX) {
    // Only relaunch with a larger heap when the autosizing setting is enabled.
    const debugMode = isDebugMode();
    const memoryArgs = shouldRelaunchForMemory(debugMode);
    if (memoryArgs.length > 0) {
      const exitCode = await relaunchAppInChildProcess(memoryArgs);
      process.exit(exitCode);
    }
  }

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
    workspaceRoot,
    { settingsService: runtimeSettingsService },
  );
  setCliRuntimeContext(runtimeSettingsService, config, {
    metadata: { source: 'cli-bootstrap', stage: 'post-config' },
  });

  // Check for invalid input combinations early to prevent crashes
  if (argv.promptInteractive && !process.stdin.isTTY) {
    console.error(
      'Error: The --prompt-interactive flag cannot be used when input is piped from stdin.',
    );
    process.exit(1);
  }

  const wasRaw = process.stdin.isRaw;
  if (config.isInteractive() && !wasRaw && process.stdin.isTTY) {
    // Set this as early as possible to avoid spurious characters from
    // input showing up in the output.
    process.stdin.setRawMode(true);

    // This cleanup isn't strictly needed but may help in certain situations.
    process.on('SIGTERM', async () => {
      process.stdin.setRawMode(wasRaw);
      await runExitCleanup();
      process.exit(0);
    });
    process.on('SIGINT', async () => {
      process.stdin.setRawMode(wasRaw);
      await runExitCleanup();
      process.exit(130); // Standard exit code for SIGINT
    });

    // Detect and enable Kitty keyboard protocol once at startup.
    detectAndEnableKittyProtocol();
  }
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

  // Note: loadCliConfig() already creates and configures the provider manager with CLI args
  // We just need to retrieve it from the config, not recreate it (which would lose CLI arg auth)
  const providerManager = config.getProviderManager();
  if (!providerManager) {
    throw new Error(
      '[cli] Provider manager should have been initialized by loadCliConfig',
    );
  }

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
      // Extract bootstrap args from config if available (for bundle compatibility)
      const configWithBootstrapArgs = config as Config & {
        _bootstrapArgs?: {
          keyOverride?: string | null;
          keyfileOverride?: string | null;
          setOverrides?: string[] | null;
          baseurlOverride?: string | null;
        };
      };

      // Apply CLI argument overrides BEFORE provider switch
      // This ensures --key, --keyfile, --baseurl, and --set are applied
      // at the correct time and override profile settings
      await applyCliArgumentOverrides(
        argv,
        configWithBootstrapArgs._bootstrapArgs,
      );

      await switchActiveProvider(configProvider);

      const activeProvider = providerManager.getActiveProvider();
      const configWithCliOverride = config as Config & {
        _cliModelOverride?: string;
      };
      const cliModelFromBootstrap =
        typeof configWithCliOverride._cliModelOverride === 'string'
          ? configWithCliOverride._cliModelOverride.trim()
          : undefined;
      let configModel =
        cliModelFromBootstrap && cliModelFromBootstrap.length > 0
          ? cliModelFromBootstrap
          : config.getModel();

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
    // Memory relaunch was already handled at the top of main() before config loading
    // Now only handle sandbox entry, which needs memory args passed to the sandbox process
    const sandboxMemoryArgs = settings.merged.autoConfigureMaxOldSpaceSize
      ? shouldRelaunchForMemory(config.getDebugMode())
      : [];
    const sandboxConfig = config.getSandbox();
    if (sandboxConfig) {
      // We intentionally omit the list of extensions here because extensions
      // should not impact auth or setting up the sandbox.
      // TODO(jacobr): refactor loadCliConfig so there is a minimal version
      // that only initializes enough config to enable refreshAuth or find
      // another way to decouple refreshAuth from requiring a config.
      const partialConfig = await loadCliConfig(
        settings.merged,
        [],
        sessionId,
        argv,
        workspaceRoot,
        { settingsService: runtimeSettingsService },
      );

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
          await partialConfig.refreshAuth(settings.merged.selectedAuthType);

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

      await start_sandbox(
        sandboxConfig,
        sandboxMemoryArgs,
        partialConfig,
        sandboxArgs,
      );
      process.exit(0);
    }
    // Note: Non-sandbox memory relaunch is now handled at the top of main()
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

  try {
    await runNonInteractive(nonInteractiveConfig, settings, input, prompt_id);
  } catch (error) {
    const printableError =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`Non-interactive run failed: ${printableError}`);
    // Call cleanup before process.exit, which causes cleanup to not run
    await runExitCleanup();
    // Non-interactive mode should exit with error code 1 for API errors
    process.exit(1);
  }
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
