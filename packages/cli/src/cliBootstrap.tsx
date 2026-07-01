/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { loadCliConfig } from './config/config.js';
import { parseArguments } from './config/cliArgParser.js';
import { parseBootstrapArgs } from './config/profileBootstrap.js';
import { coerceDebugFlag } from './config/yargsOptions.js';
import {
  dynamicSettingsRegistry,
  generateDynamicToolSettings,
} from './utils/dynamicSettings.js';
import type { SettingDefinition } from './config/settingsSchema.js';
import { readStdin } from './utils/readStdin.js';
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
import type { DnsResolutionOrder, LoadedSettings } from './config/settings.js';
import {
  type Config,
  sessionId,
  setGitStatsService,
  FatalConfigError,
  OutputFormat,
  uiTelemetryService,
  DebugLogger,
  writeToStderr,
  writeToStdout,
  ExitCodes,
  type MessageBus,
  debugLogger,
  ConfigurationManager,
} from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { ExtensionStorage } from './config/extension.js';
import { registerCleanup, runExitCleanup } from './utils/cleanup.js';
import { getCliVersion } from './utils/version.js';
import { setupTerminalAndTheme } from './utils/terminalTheme.js';
import { drainStdinBuffer } from './ui/utils/terminalContract.js';
import { StdinRawModeManager } from './utils/stdinSafety.js';
import { GitStatsServiceImpl } from './providers/logging/git-stats-service-impl.js';
import { appEvents, AppEvent } from './utils/events.js';
import {
  switchActiveProvider,
  setActiveModel,
  setActiveModelParam,
  clearActiveModelParam,
  getActiveModelParams,
  loadProfileByName,
  applyCliArgumentOverrides,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { writeFileSync } from 'node:fs';
import { ExtensionEnablementManager } from './config/extensions/extensionEnablement.js';

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
  debugLogger.warn(
    `Invalid value for dnsResolutionOrder in settings: "${order}". Using default "${defaultValue}".`,
  );
  return defaultValue;
}

export function configureEarlyDebugLogging(): void {
  // Handle debug mode as early as possible so that early logs are captured.
  // Reuse the shared yargs coercion so the bootstrap path normalizes false-like
  // values (false, 0, no, off) identically to the parsed `--debug` flag.
  const bootstrapParsed = parseBootstrapArgs();
  const debugArg = coerceDebugFlag(
    bootstrapParsed.bootstrapArgs.debug ?? undefined,
  );
  const isDebugEnabled = debugArg === true || typeof debugArg === 'string';
  if (!isDebugEnabled) {
    return;
  }
  const namespaces = typeof debugArg === 'string' ? debugArg : 'llxprt:*';
  ConfigurationManager.getInstance().setCliConfig({
    enabled: true,
    namespaces: namespaces
      .split(',')
      .map((ns) => ns.trim())
      .filter((ns) => ns.length > 0),
  });
}

// Handle --version and --help before patchStdio() redirects stdout.
// patchStdio() redirects process.stdout.write to an internal event bus,
// but no listeners are registered yet, so yargs output would be lost.
// Returns true if a flag was handled and the process is exiting.
export async function handleVersionAndHelpFlags(
  rawArgs: string[],
): Promise<void> {
  if (rawArgs.includes('--version') || rawArgs.includes('-v')) {
    writeToStdout(`${await getCliVersion()}
`);
    process.exit(0);
  }
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    // Show help without loading settings — help should always work even if
    // the user's configuration file is invalid (fixes #1667).
    await parseArguments({});
    process.exit(0);
  }
}

export type ParsedCliArgs = Awaited<ReturnType<typeof parseArguments>>;

export type CliProviderManager = NonNullable<
  ReturnType<Config['getProviderManager']>
>;

/**
 * Resolve the model to activate for the configured provider, honoring a CLI
 * bootstrap override and falling back to the provider's default model.
 */
export function resolveProviderModel(
  config: Config,
  activeProvider: ReturnType<CliProviderManager['getActiveProvider']>,
): string | undefined {
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

  if (!configModel || configModel === 'placeholder-model') {
    // No model specified or placeholder, get the provider's default
    configModel = activeProvider?.getDefaultModel?.() ?? configModel;
  }
  return configModel;
}

/**
 * Compute the merged model params (profile + CLI) that should be applied
 * before the first request for the configured provider.
 */
export function collectProviderModelParams(
  config: Config,
  argv: ParsedCliArgs,
): Record<string, unknown> {
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
  return mergedModelParams;
}

/**
 * Activate the provider that the resolved config points at (or the default
 * provider when none was explicitly requested). Returns true if the initial
 * authentication attempt failed.
 */
export async function activateConfiguredProvider(
  config: Config,
  providerManager: CliProviderManager,
  argv: ParsedCliArgs,
): Promise<boolean> {
  const configProvider = config.getProvider();
  if (!configProvider) {
    // No explicit provider specified - ensure default provider (gemini) is
    // activated so contentGeneratorConfig is initialized for the first request.
    try {
      const defaultProvider =
        providerManager.getActiveProviderName() ?? 'gemini';
      await switchActiveProvider(defaultProvider);
      await config.refreshAuth();
    } catch (e) {
      // Log but don't exit - auth will be triggered lazily on first API call
      const logger = new DebugLogger('llxprt:gemini');
      logger.debug(
        () => `Default provider activation skipped: ${(e as Error).message}`,
      );
    }
    return false;
  }

  try {
    // Extract bootstrap args from config if available (for bundle compatibility)
    const configWithBootstrapArgs = config as Config & {
      _bootstrapArgs?: {
        keyOverride?: string | null;
        keyfileOverride?: string | null;
        keyNameOverride?: string | null;
        setOverrides?: string[] | null;
        baseurlOverride?: string | null;
      };
    };

    // Apply CLI argument overrides BEFORE provider switch so --key, --keyfile,
    // --baseurl, and --set are applied at the right time and beat profile values.
    await applyCliArgumentOverrides(
      argv,
      configWithBootstrapArgs._bootstrapArgs,
    );

    await switchActiveProvider(configProvider);
    await config.refreshAuth();

    const activeProvider = providerManager.getActiveProvider();
    const configModel = resolveProviderModel(config, activeProvider);
    if (configModel && configModel !== 'placeholder-model') {
      await setActiveModel(configModel);
    }

    const mergedModelParams = collectProviderModelParams(config, argv);
    const existingParams = getActiveModelParams();
    for (const [key, value] of Object.entries(mergedModelParams)) {
      setActiveModelParam(key, value);
    }
    for (const key of Object.keys(existingParams)) {
      if (!(key in mergedModelParams)) {
        clearActiveModelParam(key);
      }
    }
    // No need to set auth type when using a provider; CLI arguments were
    // already applied by applyCliArgumentOverrides() above.
    return false;
  } catch (e) {
    debugLogger.error(chalk.red((e as Error).message));
    return true;
  }
}

/**
 * Resolve the container memory (in MB) requested via sandbox-related env vars.
 * Preserves the historical empty-string-is-absent behavior.
 */
export function resolveContainerMemoryMB(): number | undefined {
  const containerMemoryStr =
    process.env.LLXPRT_SANDBOX_MEMORY ?? process.env.SANDBOX_MEMORY;
  if (typeof containerMemoryStr === 'string' && containerMemoryStr.length > 0) {
    return parseDockerMemoryToMB(containerMemoryStr);
  }
  const sandboxFlags = process.env.SANDBOX_FLAGS;
  if (typeof sandboxFlags === 'string' && sandboxFlags.length > 0) {
    const match = sandboxFlags.match(/--memory[= ](\S+)/);
    if (match !== null) {
      return parseDockerMemoryToMB(match[1]);
    }
  }
  return undefined;
}

/**
 * Compute the memory args to pass when relaunching into the sandbox.
 * Always returns args (the sandbox starts fresh with Node's default heap),
 * unlike the host-relaunch heuristic at the top of main().
 */
export function computeSandboxMemoryArgsFromEnv(
  config: Config,
  settings: LoadedSettings,
): string[] {
  if (settings.merged.ui.autoConfigureMaxOldSpaceSize !== true) {
    return [];
  }
  return computeSandboxMemoryArgs(
    config.getDebugMode(),
    resolveContainerMemoryMB(),
    settings.merged.ui.maxHeapSizeMB,
  );
}

/**
 * Locate the first positional argument (one not consumed as a flag value),
 * scanning from index 2 (after `node` and the script path). Returns -1 when
 * there are no positional arguments.
 */
export function findFirstPositionalArgIndex(args: string[]): number {
  let i = 2;
  while (i < args.length) {
    const arg = args[i];
    if (!arg.startsWith('-')) {
      return i;
    }
    // Combined flag like --model=gpt4 carries its value inline; otherwise the
    // following non-flag token is this flag's value and must be skipped.
    const consumesNextValue =
      !arg.includes('=') &&
      Boolean(args[i + 1]) &&
      !args[i + 1].startsWith('-');
    i += consumesNextValue ? 2 : 1;
  }
  return -1;
}

/**
 * Inject stdin data into args for the sandbox by prepending it to the existing
 * prompt (positional or --prompt flag). Avoids the "Cannot use both positional
 * and --prompt" conflict.
 */
export function injectStdinIntoArgs(
  args: string[],
  stdinData?: string,
): string[] {
  if (!stdinData) {
    return [...args];
  }

  const finalArgs = [...args];

  // Check for --prompt or -p flag first
  const promptFlagIndex = finalArgs.findIndex(
    (arg) => arg === '--prompt' || arg === '-p',
  );
  if (promptFlagIndex > -1 && finalArgs.length > promptFlagIndex + 1) {
    finalArgs[promptFlagIndex + 1] = `${stdinData}

${finalArgs[promptFlagIndex + 1]}`;
    return finalArgs;
  }

  const positionalStartIndex = findFirstPositionalArgIndex(finalArgs);
  if (positionalStartIndex > -1) {
    finalArgs[positionalStartIndex] = `${stdinData}

${finalArgs[positionalStartIndex]}`;
    return finalArgs;
  }

  // No existing prompt - add stdin as a positional argument (not --prompt)
  finalArgs.push(stdinData);
  return finalArgs;
}

/** Throw a FatalConfigError if any settings files failed to load/parse. */
export function throwIfSettingsErrors(settings: LoadedSettings): void {
  if (settings.errors.length === 0) {
    return;
  }
  const errorMessages = settings.errors.map(
    (error) => `Error in ${error.path}: ${error.message}`,
  );
  throw new FatalConfigError(
    `${errorMessages.join('\n')}\nPlease fix the configuration file(s) and try again.`,
  );
}

/**
 * In ACP mode, redirect console output to stderr IMMEDIATELY so config loading
 * cannot corrupt the stdout protocol pipe.
 */
export function redirectConsoleForAcp(argv: ParsedCliArgs): void {
  if (argv.experimentalAcp === true) {
    globalThis.console.log = globalThis.console.error;
    globalThis.console.info = globalThis.console.error;
    globalThis.console.debug = globalThis.console.error;
  }
}

/**
 * When heap autosizing is enabled (and not sandboxed), relaunch the CLI in a
 * child process with a larger old-space size. Exits the current process when a
 * relaunch occurs; otherwise returns so startup can continue.
 */
export async function maybeRelaunchForMemory(
  settings: LoadedSettings,
): Promise<void> {
  if (
    settings.merged.ui.autoConfigureMaxOldSpaceSize !== true ||
    process.env.SANDBOX
  ) {
    return;
  }
  const debugMode = isDebugMode();
  const maxHeapSizeMB = settings.merged.ui.maxHeapSizeMB;
  const memoryArgs = shouldRelaunchForMemory(debugMode, maxHeapSizeMB);
  if (memoryArgs.length > 0) {
    const exitCode = await relaunchAppInChildProcess(memoryArgs);
    process.exit(exitCode);
  }
}

/**
 * Reapply a bootstrap profile (from --profile-load or LLXPRT_BOOTSTRAP_PROFILE)
 * after provider-manager initialization, unless a provider was given on the CLI
 * or a profile was already loaded during config construction.
 */
export async function reapplyBootstrapProfile(
  argv: ParsedCliArgs,
  runtimeSettingsService: SettingsService,
): Promise<void> {
  const envProfile = process.env.LLXPRT_BOOTSTRAP_PROFILE;
  const bootstrapProfileName =
    argv.profileLoad?.trim() ??
    (typeof envProfile === 'string' ? envProfile.trim() : '');
  // Only reload profile if it wasn't already loaded in config.ts. If the
  // profile was already loaded, don't reload - especially important for load
  // balancer profiles where reloading advances the round-robin counter.
  const currentProfileName = runtimeSettingsService.getCurrentProfileName();
  if (
    argv.provider ||
    bootstrapProfileName === '' ||
    currentProfileName !== null
  ) {
    return;
  }
  try {
    await loadProfileByName(bootstrapProfileName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debugLogger.warn(
      `[bootstrap] Failed to reapply profile '${bootstrapProfileName}' after provider manager initialization: ${message}`,
    );
  }
}

/**
 * Ensure the Gemini server-tools provider has the active Config attached even
 * when it is not the active provider.
 */
export function configureServerToolsProvider(
  providerManager: CliProviderManager,
  config: Config,
): void {
  const serverToolsProvider = providerManager.getServerToolsProvider();
  if (
    serverToolsProvider &&
    serverToolsProvider.name === 'gemini' &&
    'setConfig' in serverToolsProvider &&
    typeof serverToolsProvider.setConfig === 'function'
  ) {
    serverToolsProvider.setConfig(config);
  }
}

/** Register per-tool dynamic settings once Config is fully initialized. */
export function registerDynamicToolSettings(config: Config): void {
  try {
    const dynamicToolSettings = generateDynamicToolSettings(config);
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
    debugLogger.error('[gemini] Failed to register dynamic settings:', error);
  }
}

/**
 * Reject the invalid combination of --prompt-interactive with piped stdin,
 * which would otherwise crash. Exits the process on violation.
 */
export async function rejectPromptInteractiveWithPipedStdin(
  argv: ParsedCliArgs,
): Promise<void> {
  if (argv.promptInteractive && !process.stdin.isTTY) {
    writeToStderr(
      'Error: The --prompt-interactive flag cannot be used when input is piped from stdin.\n',
    );
    await runExitCleanup();
    process.exit(ExitCodes.FATAL_INPUT_ERROR);
  }
}

/** Register a cleanup hook that writes session metrics to --session-summary. */
export function registerSessionSummaryWriter(argv: ParsedCliArgs): void {
  const summaryPath = argv.sessionSummary;
  if (!summaryPath) {
    return;
  }
  registerCleanup(() => {
    const metrics = uiTelemetryService.getMetrics();
    writeFileSync(
      summaryPath,
      JSON.stringify({ sessionMetrics: metrics }, null, 2),
    );
  });
}

/** Install the console patcher for this run and register its cleanup. */
export function patchConsoleForRun(config: Config): void {
  const isJsonNonInteractive =
    config.getOutputFormat() === OutputFormat.JSON && !config.isInteractive();
  const consolePatcher = new ConsolePatcher({
    stderr: !isJsonNonInteractive,
    debugMode: isJsonNonInteractive ? false : config.getDebugMode(),
  });
  consolePatcher.patch();
  registerCleanup(consolePatcher.cleanup);
}

/**
 * Create a memoized stdin reader that reads the piped input at most once and
 * returns the cached value (empty string when nothing was piped) thereafter.
 */
export function createMemoizedStdinReader(): () => Promise<string> {
  let cachedStdinData: string | null = null;
  let stdinWasRead = false;
  return async () => {
    if (!stdinWasRead) {
      stdinWasRead = true;
      cachedStdinData = await readStdin();
    }
    return cachedStdinData ?? '';
  };
}

/**
 * For piped (non-TTY) input, ensure either stdin data or a prompt argument is
 * present; otherwise emit guidance and exit. No-op when input is interactive.
 */
export async function ensureStdinOrPromptProvided(
  hasPipedInput: boolean,
  readStdinData: () => Promise<string>,
  questionFromArgs: string,
): Promise<void> {
  if (!hasPipedInput) {
    return;
  }
  const stdinSnapshot = await readStdinData();
  if (!stdinSnapshot && !questionFromArgs) {
    writeToStderr(
      `No input provided via stdin. Input can be provided by piping data into llxprt or using the --prompt option.
`,
    );
    process.exit(1);
  }
}

/**
 * Initialize Config, showing an MCP initialization spinner when interactive and
 * MCP servers are configured. Registers dynamic tool settings afterwards.
 */
async function renderInitializingSpinner(initialTotal: number): Promise<
  | {
      clear(): void;
      unmount(): void;
    }
  | undefined
> {
  try {
    const [reactModule, inkModule, spinnerModule, colorsModule] =
      await Promise.all([
        import('react'),
        import('ink'),
        import('ink-spinner'),
        import('./ui/colors.js'),
      ]);
    const React = reactModule.default;
    const { Box, Text, render } = inkModule;
    const Spinner = spinnerModule.default;
    const { theme } = colorsModule;

    const InitializingComponent = () => {
      const [total, setTotal] = React.useState(initialTotal);
      const [connected, setConnected] = React.useState(0);

      React.useEffect(() => {
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

      return React.createElement(
        Box,
        null,
        React.createElement(
          Text,
          { color: theme.text.primary },
          React.createElement(Spinner),
          ' ',
          message,
        ),
      );
    };

    return render(React.createElement(InitializingComponent));
  } catch (error) {
    debugLogger.warn('MCP initialization spinner unavailable', error);
    return undefined;
  }
}

export async function initializeConfigWithSpinner(
  config: Config,
  sessionMessageBus: MessageBus,
): Promise<void> {
  const mcpServers = config.getMcpServers();
  const mcpServersCount = mcpServers ? Object.keys(mcpServers).length : 0;

  const showSpinner =
    typeof config.isInteractive === 'function' &&
    config.isInteractive() &&
    mcpServersCount > 0;
  const spinnerInstance = showSpinner
    ? await renderInitializingSpinner(mcpServersCount)
    : undefined;

  try {
    await (
      config as typeof config & {
        initialize(dependencies?: { messageBus?: MessageBus }): Promise<void>;
      }
    ).initialize({ messageBus: sessionMessageBus });
  } finally {
    if (spinnerInstance) {
      // Small UX detail to show the completion message for a bit before unmounting.
      await new Promise((f) => setTimeout(f, 100));
      spinnerInstance.clear();
      spinnerInstance.unmount();
    }
  }

  registerDynamicToolSettings(config);
}

/**
 * Retrieve the provider manager created by loadCliConfig, re-apply the bootstrap
 * profile, initialize the git stats service when conversation logging is on,
 * configure the server-tools provider, and set the DNS resolution order.
 */
export async function configureProvidersAndServices(
  config: Config,
  settings: LoadedSettings,
  argv: ParsedCliArgs,
  runtimeSettingsService: SettingsService,
): Promise<CliProviderManager> {
  // Note: loadCliConfig() already creates and configures the provider manager with CLI args
  // We just need to retrieve it from the config, not recreate it (which would lose CLI arg auth)
  const providerManager = config.getProviderManager();
  if (!providerManager) {
    throw new Error(
      '[cli] Provider manager should have been initialized by loadCliConfig',
    );
  }

  await reapplyBootstrapProfile(argv, runtimeSettingsService);

  // Initialize git stats service for tracking file changes when logging is enabled
  if (config.getConversationLoggingEnabled()) {
    const gitStatsService = new GitStatsServiceImpl(config);
    setGitStatsService(gitStatsService);
  }

  configureServerToolsProvider(providerManager, config);

  // Set DNS resolution order (prefer IPv4 by default)
  dns.setDefaultResultOrder(
    validateDnsResolutionOrder(settings.merged.dnsResolutionOrder),
  );

  return providerManager;
}

/**
 * Prepare the interactive terminal session: enable raw mode when needed, set up
 * the terminal title/theme, register the session-summary writer, and patch the
 * console for the run.
 */
export async function prepareTerminalSession(
  config: Config,
  settings: LoadedSettings,
  argv: ParsedCliArgs,
): Promise<void> {
  const wasRaw = process.stdin.isRaw;
  // Issue #1020: Create stdin manager with error handling to prevent EIO crashes
  const stdinManager = new StdinRawModeManager({
    debug: config.getDebugMode(),
  });
  await enableInteractiveRawModeIfNeeded(config, stdinManager, wasRaw);

  await setupTerminalAndTheme(config, settings);

  registerSessionSummaryWriter(argv);
  patchConsoleForRun(config);
}

/** Connect the IDE companion client when IDE mode is enabled. */
export async function connectIdeClientIfEnabled(config: Config): Promise<void> {
  if (!config.getIdeMode()) {
    return;
  }
  const ideClient = config.getIdeClient();
  if (ideClient) {
    await ideClient.connect();
    // IDE connection logging removed - telemetry disabled in llxprt
  }
}

export interface SandboxHopOptions {
  config: Config;
  settings: LoadedSettings;
  argv: ParsedCliArgs;
  workspaceRoot: string;
  runtimeSettingsService: SettingsService;
  initialAuthFailed: boolean;
  readStdin: () => Promise<string>;
  hasPipedInput: boolean;
}

/**
 * When running outside the sandbox and sandboxing is configured, relaunch the
 * CLI inside the sandbox (forwarding stdin/prompt). Exits the current process
 * when a hop occurs; returns otherwise so startup can continue in-process.
 */
export async function maybeHopIntoSandbox(
  options: SandboxHopOptions,
): Promise<void> {
  const {
    config,
    settings,
    argv,
    workspaceRoot,
    runtimeSettingsService,
    initialAuthFailed,
    readStdin: readStdinData,
    hasPipedInput,
  } = options;

  if (process.env.SANDBOX) {
    return;
  }
  const sandboxConfig = config.getSandbox();
  if (!sandboxConfig) {
    return;
  }
  if (initialAuthFailed) {
    await runExitCleanup();
    process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
  }

  const sandboxMemoryArgs = computeSandboxMemoryArgsFromEnv(config, settings);
  // We intentionally omit the list of extensions here because extensions
  // should not impact auth or setting up the sandbox.
  // Follow-up (#1569, jacobr): refactor loadCliConfig so there is a minimal
  // version that only initializes enough config to enable refreshAuth or find
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

  const stdinData = hasPipedInput ? await readStdinData() : '';
  const sandboxArgs = injectStdinIntoArgs(process.argv, stdinData);

  const exitCode = await start_sandbox(
    sandboxConfig,
    sandboxMemoryArgs,
    partialConfig,
    sandboxArgs,
  );
  process.exit(exitCode);
}

/**
 * In ACP/Zed mode authentication happens through the protocol; just ensure the
 * configured provider is set as active when one is available. Best-effort.
 */
export function ensureAcpProviderActivated(config: Config): void {
  const providerManagerForAcp = config.getProviderManager();
  const configProvider = config.getProvider();
  if (!configProvider || !providerManagerForAcp) {
    return;
  }
  try {
    if (!providerManagerForAcp.hasActiveProvider()) {
      void providerManagerForAcp.setActiveProvider(configProvider);
    }
  } catch {
    // Non-fatal - continue without provider; auth can still happen via ACP.
  }
}

export async function enableInteractiveRawModeIfNeeded(
  config: Config,
  stdinManager: StdinRawModeManager,
  wasRaw: boolean,
): Promise<void> {
  if (!(config.isInteractive() && !wasRaw && process.stdin.isTTY)) {
    return;
  }
  // Drain any garbage ANSI sequences that may be in the stdin buffer
  // before we start processing input. This addresses #199 where garbage
  // ANSI on startup can disrupt theme selection on some terminals (e.g., OCI).
  await drainStdinBuffer(process.stdin, 50);

  // Set this as early as possible to avoid spurious characters from
  // input showing up in the output.
  // Use stdinManager to safely enable raw mode with EIO error handling (Issue #1020)
  stdinManager.enable();

  // This cleanup isn't strictly needed but may help in certain situations.
  process.on('SIGTERM', () => {
    stdinManager.disable(true); // Restore to wasRaw
    void (async () => {
      await runExitCleanup();
      process.exit(0);
    })();
  });
  process.on('SIGINT', () => {
    stdinManager.disable(true); // Restore to wasRaw
    void (async () => {
      await runExitCleanup();
      process.exit(130); // Standard exit code for SIGINT
    })();
  });

  // Register cleanup for the stdin manager to ensure error handler is removed
  registerCleanup(() => {
    stdinManager.disable(true);
  });
}
