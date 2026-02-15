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
import {
  dynamicSettingsRegistry,
  generateDynamicToolSettings,
} from './utils/dynamicSettings.js';
import type { SettingDefinition } from './config/settingsSchema.js';
import { readStdin } from './utils/readStdin.js';
import { basename } from 'node:path';
import dns from 'node:dns';
import { start_sandbox } from './utils/sandbox.js';
import {
  shouldRelaunchForMemory,
  isDebugMode,
  computeSandboxMemoryArgs,
  parseDockerMemoryToMB,
} from './utils/bootstrap.js';
import { relaunchAppInChildProcess } from './utils/relaunch.js';
import chalk from 'chalk';
import {
  DnsResolutionOrder,
  LoadedSettings,
  loadSettings,
} from './config/settings.js';
import {
  Config,
  sessionId,
  setGitStatsService,
  FatalConfigError,
  JsonFormatter,
  OutputFormat,
  uiTelemetryService,
  // IDE connection logging removed - telemetry disabled in llxprt
  SettingsService,
  DebugLogger,
  ProfileManager,
  SessionPersistenceService,
  type PersistedSession,
  parseAndFormatApiError,
  coreEvents,
  CoreEvent,
  type OutputPayload,
  type ConsoleLogPayload,
  patchStdio,
  writeToStderr,
  writeToStdout,
} from '@vybestack/llxprt-code-core';
import { themeManager } from './ui/themes/theme-manager.js';
import { theme } from './ui/colors.js';
import { getStartupWarnings } from './utils/startupWarnings.js';
import { getUserStartupWarnings } from './utils/userStartupWarnings.js';
import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { runNonInteractive } from './nonInteractiveCli.js';
import { ExtensionStorage, loadExtensions } from './config/extension.js';
import {
  cleanupCheckpoints,
  registerCleanup,
  registerSyncCleanup,
  runExitCleanup,
} from './utils/cleanup.js';
import { getCliVersion } from './utils/version.js';
import { setMaxSizedBoxDebugging } from './ui/components/shared/MaxSizedBox.js';
// createProviderManager removed - provider manager now created in loadCliConfig()
import { runZedIntegration } from './zed-integration/zedIntegration.js';
import { cleanupExpiredSessions } from './utils/sessionCleanup.js';
import { validateNonInteractiveAuth } from './validateNonInterActiveAuth.js';
import { detectAndEnableKittyProtocol } from './ui/utils/kittyProtocolDetector.js';
import { disableMouseEvents, enableMouseEvents } from './ui/utils/mouse.js';
import { drainStdinBuffer } from './ui/utils/terminalContract.js';
import { restoreTerminalProtocolsSync } from './ui/utils/terminalProtocolCleanup.js';
import {
  DISABLE_BRACKETED_PASTE,
  DISABLE_FOCUS_TRACKING,
  SHOW_CURSOR,
} from './ui/utils/terminalSequences.js';
import { StdinRawModeManager } from './utils/stdinSafety.js';
import { checkForUpdates } from './ui/utils/updateCheck.js';
import { handleAutoUpdate } from './utils/handleAutoUpdate.js';
import { GitStatsServiceImpl } from './providers/logging/git-stats-service-impl.js';
import { appEvents, AppEvent } from './utils/events.js';
import { computeWindowTitle } from './utils/windowTitle.js';
import { SettingsContext } from './ui/contexts/SettingsContext.js';
import { inkRenderOptions } from './ui/inkRenderOptions.js';
import { isMouseEventsEnabled } from './ui/mouseEventsEnabled.js';
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

export function formatNonInteractiveError(error: unknown): string {
  const formatted = parseAndFormatApiError(error);
  if (formatted && !formatted.includes('[object Object]')) {
    return formatted;
  }

  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

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

    appEvents.on(AppEvent.McpServersDiscoveryStart, onStart);
    appEvents.on(AppEvent.McpServerConnected, onChange);
    appEvents.on(AppEvent.McpServerError, onChange);

    return () => {
      appEvents.off(AppEvent.McpServersDiscoveryStart, onStart);
      appEvents.off(AppEvent.McpServerConnected, onChange);
      appEvents.off(AppEvent.McpServerError, onChange);
    };
  }, []);

  const message = `Connecting to MCP servers... (${connected}/${total})`;

  return (
    <Box>
      <Text color={theme.text.primary}>
        <Spinner /> {message}
      </Text>
    </Box>
  );
};

import { existsSync, mkdirSync } from 'fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'os';
import { dirname, join } from 'path';
import commandExists from 'command-exists';
import { ExtensionEnablementManager } from './config/extensions/extensionEnablement.js';

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

  // Load previous session if --continue flag was used
  let restoredSession: PersistedSession | null = null;
  const initialPrompt = config.getQuestion();

  if (config.isContinueSession()) {
    const persistence = new SessionPersistenceService(
      config.storage,
      config.getSessionId(),
    );
    restoredSession = await persistence.loadMostRecent();

    if (restoredSession) {
      const formattedTime =
        SessionPersistenceService.formatSessionTime(restoredSession);

      if (initialPrompt) {
        // User provided both --continue and --prompt
        console.log(chalk.cyan(`Resuming session from ${formattedTime}`));
        const truncatedPrompt =
          initialPrompt.length > 50
            ? `${initialPrompt.slice(0, 50)}...`
            : initialPrompt;
        console.log(
          chalk.dim(
            `Your prompt "${truncatedPrompt}" will be submitted after session loads.`,
          ),
        );
      } else {
        console.log(chalk.green(`Resumed session from ${formattedTime}`));
      }
    } else {
      if (initialPrompt) {
        console.log(
          chalk.yellow(
            'No previous session found. Starting fresh with your prompt.',
          ),
        );
      } else {
        console.log(chalk.yellow('No previous session found. Starting fresh.'));
      }
    }
  }

  // Detect and enable Kitty keyboard protocol once at startup
  await detectAndEnableKittyProtocol();
  setWindowTitle(basename(workspaceRoot), settings);

  const renderOptions = inkRenderOptions(config, settings);
  const mouseEventsEnabled = isMouseEventsEnabled(renderOptions, settings);
  if (mouseEventsEnabled) {
    enableMouseEvents();
    // Use process.on('exit') instead of registerCleanup because registerCleanup
    // includes instance.waitUntilExit() which would deadlock on quit.
    // The 'exit' event fires synchronously during process.exit(). (fixes #959)
    process.on('exit', () => {
      disableMouseEvents();
      if (process.stdout.isTTY) {
        writeToStdout(
          DISABLE_BRACKETED_PASTE + DISABLE_FOCUS_TRACKING + SHOW_CURSOR,
        );
      }
    });
  }

  process.on('exit', restoreTerminalProtocolsSync);
  registerSyncCleanup(restoreTerminalProtocolsSync);

  const instance = render(
    <React.StrictMode>
      <ErrorBoundary onError={handleError}>
        <SettingsContext.Provider value={settings}>
          <AppWrapper
            config={config}
            settings={settings}
            startupWarnings={startupWarnings}
            version={version}
            restoredSession={restoredSession ?? undefined}
          />
        </SettingsContext.Provider>
      </ErrorBoundary>
    </React.StrictMode>,
    renderOptions,
  );

  checkForUpdates(settings)
    .then((info) => {
      handleAutoUpdate(info, settings, config.getProjectRoot());
    })
    .catch((err) => {
      // Silently ignore update check errors.
      if (config.getDebugMode()) {
        console.error('Update check failed:', err);
      }
    });

  registerCleanup(async () => {
    await instance.waitUntilExit();
    instance.clear();
    instance.unmount();
  });
}

export async function main() {
  const cleanupStdio = patchStdio();
  registerSyncCleanup(() => {
    // This is needed to ensure we don't lose any buffered output.
    initializeOutputListenersAndFlush();
    cleanupStdio();
  });

  setupUnhandledRejectionHandler();

  // Create .llxprt directory if it doesn't exist
  const llxprtDir = join(homedir(), '.llxprt');
  if (!existsSync(llxprtDir)) {
    mkdirSync(llxprtDir, { recursive: true });
  }

  const workspaceRoot = process.cwd();
  const settings = loadSettings(workspaceRoot);

  if (
    settings.merged.ui?.autoConfigureMaxOldSpaceSize &&
    !process.env.SANDBOX
  ) {
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
      writeToStderr(
        `No input provided via stdin. Input can be provided by piping data into llxprt or using the --prompt option.\n`,
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

  const extensionEnablementManager = new ExtensionEnablementManager(
    ExtensionStorage.getUserExtensionsDir(),
    argv.extensions,
  );
  const extensions = loadExtensions(extensionEnablementManager, workspaceRoot);

  const config = await loadCliConfig(
    settings.merged,
    extensions,
    extensionEnablementManager,
    sessionId,
    argv,
    workspaceRoot,
    { settingsService: runtimeSettingsService },
  );
  const profileManager = new ProfileManager();
  setCliRuntimeContext(runtimeSettingsService, config, {
    metadata: { source: 'cli-bootstrap', stage: 'post-config' },
    profileManager,
  });

  // Check for invalid input combinations early to prevent crashes
  if (argv.promptInteractive && !process.stdin.isTTY) {
    writeToStderr(
      'Error: The --prompt-interactive flag cannot be used when input is piped from stdin.\n',
    );
    process.exit(1);
  }

  const wasRaw = process.stdin.isRaw;
  // Issue #1020: Create stdin manager with error handling to prevent EIO crashes
  const stdinManager = new StdinRawModeManager({
    debug: config.getDebugMode(),
  });
  if (
    config.isInteractive() &&
    !argv.experimentalUi &&
    !wasRaw &&
    process.stdin.isTTY
  ) {
    // Drain any garbage ANSI sequences that may be in the stdin buffer
    // before we start processing input. This addresses #199 where garbage
    // ANSI on startup can disrupt theme selection on some terminals (e.g., OCI).
    await drainStdinBuffer(process.stdin, 50);

    // Set this as early as possible to avoid spurious characters from
    // input showing up in the output.
    // Use stdinManager to safely enable raw mode with EIO error handling (Issue #1020)
    stdinManager.enable();

    // This cleanup isn't strictly needed but may help in certain situations.
    process.on('SIGTERM', async () => {
      stdinManager.disable(true); // Restore to wasRaw
      await runExitCleanup();
      process.exit(0);
    });
    process.on('SIGINT', async () => {
      stdinManager.disable(true); // Restore to wasRaw
      await runExitCleanup();
      process.exit(130); // Standard exit code for SIGINT
    });

    // Register cleanup for the stdin manager to ensure error handler is removed
    registerCleanup(() => {
      stdinManager.disable(true);
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
    stderr: !(
      config.getOutputFormat?.() === OutputFormat.JSON &&
      !config.isInteractive()
    ),
    debugMode:
      config.getOutputFormat?.() === OutputFormat.JSON &&
      !config.isInteractive()
        ? false
        : config.getDebugMode(),
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
  // Only reload profile if it wasn't already loaded in config.ts
  // (checking if currentProfileName is null means no profile was loaded yet)
  // If the profile was already loaded, don't reload - especially important for
  // load balancer profiles where reloading advances the round-robin counter
  const currentProfileName = runtimeSettingsService.getCurrentProfileName();
  if (
    !argv.provider &&
    bootstrapProfileName !== '' &&
    currentProfileName === null
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

  // Register dynamic settings after config is fully initialized
  try {
    const dynamicToolSettings = generateDynamicToolSettings(config);

    // Convert to full path settings
    const fullDynamicSettings: Record<string, SettingDefinition> = {};
    for (const [toolName, definition] of Object.entries(dynamicToolSettings)) {
      fullDynamicSettings[`coreToolSettings.${toolName}`] = definition;
    }

    dynamicSettingsRegistry.register(fullDynamicSettings);
    const logger = new DebugLogger('llxprt:gemini');
    logger.log(
      `Registered ${Object.keys(fullDynamicSettings).length} dynamic settings`,
    );
  } catch (error) {
    console.error('[gemini] Failed to register dynamic settings:', error);
  }

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
  themeManager.loadCustomThemes(settings.merged.ui?.customThemes || {});

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
      await config.refreshAuth();

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
  } else {
    // No explicit provider specified - ensure default provider (gemini) is activated
    // This initializes contentGeneratorConfig to avoid runtime errors on first request
    try {
      const defaultProvider =
        providerManager.getActiveProviderName() || 'gemini';
      await switchActiveProvider(defaultProvider);
      await config.refreshAuth();
    } catch (e) {
      // Log but don't exit - auth will be triggered lazily on first API call
      const logger = new DebugLogger('llxprt:gemini');
      logger.debug(
        () => `Default provider activation skipped: ${(e as Error).message}`,
      );
    }
  }

  if (settings.merged.ui?.theme) {
    if (!themeManager.setActiveTheme(settings.merged.ui.theme)) {
      // If the theme is not found during initial load, log a warning and continue.
      // The useThemeCommand hook in App.tsx will handle opening the dialog.
      console.warn(`Warning: Theme "${settings.merged.ui.theme}" not found.`);
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
    // For sandbox, always compute memory args for the new process.
    // Unlike shouldRelaunchForMemory() which compares against the host's current heap,
    // computeSandboxMemoryArgs() always returns args because the sandbox starts fresh
    // with Node.js default ~950MB heap.
    let sandboxMemoryArgs: string[] = [];
    if (settings.merged.ui?.autoConfigureMaxOldSpaceSize) {
      const containerMemoryStr =
        process.env.LLXPRT_SANDBOX_MEMORY ?? process.env.SANDBOX_MEMORY;
      let containerMemoryMB: number | undefined;
      if (containerMemoryStr) {
        containerMemoryMB = parseDockerMemoryToMB(containerMemoryStr);
      } else if (process.env.SANDBOX_FLAGS) {
        const match = process.env.SANDBOX_FLAGS.match(/--memory[= ](\S+)/);
        if (match) {
          containerMemoryMB = parseDockerMemoryToMB(match[1]);
        }
      }
      sandboxMemoryArgs = computeSandboxMemoryArgs(
        config.getDebugMode(),
        containerMemoryMB,
      );
    }
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
        new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
        sessionId,
        argv,
        workspaceRoot,
        { settingsService: runtimeSettingsService },
      );

      let stdinData = '';
      if (hasPipedInput) {
        stdinData = await readStdinOnce();
      }

      // Inject stdin data into args for the sandbox.
      // We prepend stdin to the existing prompt (positional or --prompt flag).
      // This avoids the "Cannot use both positional and --prompt" conflict.
      const injectStdinIntoArgs = (
        args: string[],
        stdinData?: string,
      ): string[] => {
        if (!stdinData) {
          return [...args];
        }

        const finalArgs = [...args];

        // Check for --prompt or -p flag first
        const promptFlagIndex = finalArgs.findIndex(
          (arg) => arg === '--prompt' || arg === '-p',
        );
        if (promptFlagIndex > -1 && finalArgs.length > promptFlagIndex + 1) {
          // Prepend stdin to the --prompt value
          finalArgs[promptFlagIndex + 1] =
            `${stdinData}\n\n${finalArgs[promptFlagIndex + 1]}`;
          return finalArgs;
        }

        // Find positional arguments (args after all flags).
        // Flags can be:
        // - Boolean flags: --debug, --yolo, --sandbox (no value)
        // - Value flags: --model gpt4, --key xyz (separate value)
        // - Combined flags: --model=gpt4, --allowed-tools=run_shell_command(ls) (value in same arg)
        // Positional args are anything after the last flag that doesn't start with '-'.

        // Start scanning from index 2 (after 'node' and script path).
        // Find the first argument after index 1 that doesn't start with '-'
        // and isn't a value for a preceding flag.
        let positionalStartIndex = -1;
        for (let i = 2; i < finalArgs.length; i++) {
          const arg = finalArgs[i];
          if (arg.startsWith('-')) {
            // This is a flag. Check if it's a combined flag (contains '=')
            if (arg.includes('=')) {
              // Combined flag like --model=gpt4, no separate value to skip
              continue;
            }
            // Check if next arg is a value for this flag (doesn't start with '-')
            const nextArg = finalArgs[i + 1];
            if (nextArg && !nextArg.startsWith('-')) {
              // Skip the value
              i++;
            }
          } else {
            // This is a positional argument
            positionalStartIndex = i;
            break;
          }
        }

        if (positionalStartIndex > -1) {
          // There are positional arguments - prepend stdin to the first one
          finalArgs[positionalStartIndex] =
            `${stdinData}\n\n${finalArgs[positionalStartIndex]}`;
          return finalArgs;
        }

        // No existing prompt - add stdin as a positional argument (not --prompt)
        finalArgs.push(stdinData);
        return finalArgs;
      };

      const sandboxArgs = injectStdinIntoArgs(process.argv, stdinData);

      const exitCode = await start_sandbox(
        sandboxConfig,
        sandboxMemoryArgs,
        partialConfig,
        sandboxArgs,
      );
      process.exit(exitCode);
    }
    // Note: Non-sandbox memory relaunch is now handled at the top of main()
  }

  // Cleanup sessions after config initialization
  await cleanupExpiredSessions(config, settings.merged);

  if (config.getListExtensions()) {
    console.log('Installed extensions:');
    for (const extension of extensions) {
      console.log(`- ${extension.name}`);
    }
    process.exit(0);
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

  // Check for experimental UI flag
  if (argv.experimentalUi) {
    if (!commandExists.sync('bun')) {
      console.error('--experimental-ui requires Bun to be installed.');
      console.error(
        'Install bun from https://bun.sh or via your package manager.',
      );
      process.exit(1);
    }

    const resolveImportMeta = (
      import.meta as unknown as {
        resolve?: (specifier: string, parent?: string) => string;
      }
    ).resolve;
    if (typeof resolveImportMeta !== 'function') {
      console.error(
        '--experimental-ui requires a Node version that supports import.meta.resolve.',
      );
      process.exit(1);
    }

    let uiEntryPath: string;
    try {
      const uiEntryUrl = resolveImportMeta('@vybestack/llxprt-ui');
      uiEntryPath = fileURLToPath(uiEntryUrl);
    } catch (e: unknown) {
      const error = e as { code?: string };
      if (
        error.code === 'MODULE_NOT_FOUND' ||
        error.code === 'ERR_MODULE_NOT_FOUND'
      ) {
        console.error(
          '--experimental-ui requires @vybestack/llxprt-ui to be installed',
        );
        console.error('Run: npm install -g @vybestack/llxprt-ui');
        process.exit(1);
      }
      throw e;
    }

    // If we enabled raw mode earlier, restore cooked mode before handing
    // the terminal to bun/OpenTUI.
    if (process.stdin.isTTY && process.stdin.isRaw && !wasRaw) {
      try {
        stdinManager.disable(true); // Restore to wasRaw
      } catch {
        // ignore
      }
    }
    // Ensure the parent process isn't consuming stdin while bun runs
    // (inherited stdio means both processes share the same TTY fd).
    if (process.stdin.isTTY) {
      process.stdin.pause();
    }

    let uiRoot = dirname(uiEntryPath);
    while (
      uiRoot !== dirname(uiRoot) &&
      !existsSync(join(uiRoot, 'package.json'))
    ) {
      uiRoot = dirname(uiRoot);
    }
    if (!existsSync(join(uiRoot, 'package.json'))) {
      console.error(
        `Unable to locate @vybestack/llxprt-ui package root from: ${uiEntryPath}`,
      );
      process.exit(1);
    }

    const uiEntry = join(uiRoot, 'src', 'main.tsx');
    const rawArgs = process.argv.slice(2);
    const filteredArgs: string[] = [];
    for (let i = 0; i < rawArgs.length; i += 1) {
      const arg = rawArgs[i];
      if (arg === '--experimental-ui') {
        const next = rawArgs[i + 1];
        if (next === 'true' || next === 'false') {
          i += 1;
        }
        continue;
      }
      if (arg.startsWith('--experimental-ui=')) {
        continue;
      }
      filteredArgs.push(arg);
    }

    const child = spawn('bun', ['run', uiEntry, ...filteredArgs], {
      stdio: 'inherit',
      cwd: workspaceRoot,
      env: { ...process.env },
    });

    const forwardSignal = (signal: NodeJS.Signals) => {
      if (!child.killed) {
        child.kill(signal);
      }
      const killTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 800);
      killTimer.unref();

      const exitTimer = setTimeout(async () => {
        await runExitCleanup();
        process.exit(signal === 'SIGINT' ? 130 : 143);
      }, 1200);
      exitTimer.unref();
    };

    ['SIGINT', 'SIGTERM'].forEach((signal) => {
      process.on(signal, () => forwardSignal(signal as NodeJS.Signals));
    });

    child.on('error', async (err) => {
      console.error('Failed to launch experimental UI via bun:', err);
      await runExitCleanup();
      process.exit(1);
    });

    child.on('close', async (code, signal) => {
      if (process.stdin.isTTY && process.stdin.isRaw !== wasRaw) {
        try {
          stdinManager.disable(true); // Restore to wasRaw
        } catch {
          // ignore
        }
      }
      await runExitCleanup();

      if (signal === 'SIGINT') {
        process.exit(130);
        return;
      }
      if (signal === 'SIGTERM') {
        process.exit(143);
        return;
      }
      process.exit(code ?? 0);
    });

    return;
  }

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
    writeToStderr(
      `No input provided via stdin. Input can be provided by piping data into llxprt or using the --prompt option.\n`,
    );
    process.exit(1);
  }

  const prompt_id = Math.random().toString(16).slice(2);

  const nonInteractiveConfig = await validateNonInteractiveAuth(
    settings.merged.useExternalAuth,
    config,
    settings,
  );

  initializeOutputListenersAndFlush();

  try {
    await runNonInteractive({
      config: nonInteractiveConfig,
      settings,
      input,
      prompt_id,
    });
  } catch (error) {
    if (nonInteractiveConfig.getOutputFormat() === OutputFormat.JSON) {
      const formatter = new JsonFormatter();
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      writeToStderr(`${formatter.formatError(normalizedError, 1)}\n`);
    } else {
      const printableError = formatNonInteractiveError(error);
      console.error(`Non-interactive run failed: ${printableError}`);
    }
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
  if (!settings.merged.ui?.hideWindowTitle) {
    const windowTitle = computeWindowTitle(title);
    writeToStdout(`\x1b]2;${windowTitle}\x07`);

    process.on('exit', () => {
      writeToStdout(`\x1b]2;\x07`);
    });
  }
}

function initializeOutputListenersAndFlush() {
  // If there are no listeners for output, make sure we flush so output is not
  // lost.
  if (coreEvents.listenerCount(CoreEvent.Output) === 0) {
    // In non-interactive mode, ensure we drain any buffered output or logs to stderr
    coreEvents.on(CoreEvent.Output, (payload: OutputPayload) => {
      if (payload.isStderr) {
        writeToStderr(payload.chunk, payload.encoding);
      } else {
        writeToStdout(payload.chunk, payload.encoding);
      }
    });

    coreEvents.on(CoreEvent.ConsoleLog, (payload: ConsoleLogPayload) => {
      if (payload.type === 'error' || payload.type === 'warn') {
        writeToStderr(payload.content);
      } else {
        writeToStdout(payload.content);
      }
    });
  }
  coreEvents.drainBacklogs();
}
