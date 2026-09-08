/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 *
 * Thin CLI orchestrator (issue #2204). main() is an ordered sequence of
 * delegated calls: bootstrap → config → provider activation → sandbox hop →
 * session dispatch. The interactive-UI render, non-interactive session driving,
 * and dispatch helpers live in the ./session/ modules. This file no longer
 * co-architects runtime construction — it consumes the public Agent/runtime
 * surface via the bootstrap modules.
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
      typeof warning !== 'string' && typeof warning.code === 'string'
        ? warning.code
        : undefined;
    if (warningCode && suppressedWarningCodes.has(warningCode)) {
      return;
    }
    const message =
      typeof warning === 'string'
        ? warning
        : (warning.stack ?? warning.message ?? String(warning));
    debugLogger.warn(message);
  });
}

import { wireMcpHostServices } from './mcpHostWiring.js';
import { parseArguments } from './config/cliArgParser.js';
import { loadSettings, type LoadedSettings } from './config/settings.js';
import {
  type Config,
  patchStdio,
  ExitCodes,
} from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import { createTokenStore } from '@vybestack/llxprt-code-providers/auth.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import { applySandboxBashrc } from './utils/sandbox-bashrc.js';
import {
  runStartupMigration,
  reportStartupResult,
} from './config/pathMigration.js';
import {
  cleanupCheckpoints,
  runExitCleanup,
  registerSyncCleanup,
} from './utils/cleanup.js';
import { runZedIntegration } from '@vybestack/llxprt-code-zed-acp';
import { cleanupExpiredSessions } from './utils/sessionCleanup.js';
import { existsSync, mkdirSync } from 'fs';
import { firstNonEmptyString } from './utils/coalesce.js';
import {
  configureEarlyDebugLogging,
  createMemoizedStdinReader,
  ensureStdinOrPromptProvided,
  handleVersionAndHelpFlags,
  maybeRelaunchForMemory,
  redirectConsoleForAcp,
  rejectPromptInteractiveWithPipedStdin,
  throwIfSettingsErrors,
  type ParsedCliArgs,
} from './cliBootstrap.js';
import {
  activateConfiguredProvider,
  configureProvidersAndServices,
  connectIdeClientIfEnabled,
  ensureAcpProviderActivated,
  type ConfiguredProviderActivationResult,
} from './cliProviderInit.js';
import { guardUnconfiguredProvider } from './unconfiguredProviderGuard.js';
import {
  constructAgentWithSpinner,
  prepareTerminalSession,
} from './cliTerminalSession.js';
import { maybeHopIntoSandbox } from './cliSandbox.js';
import {
  bootstrapRuntimeAndConfig,
  setupSessionRecording,
} from './cliSessionBootstrap.js';
import {
  captureBootstrapEnvPath,
  resolveBootstrapSelection,
  type BootstrapSelection,
} from './observation/jspWiring.js';
import { dispatchInteractiveOrNonInteractive } from './session/nonInteractiveSession.js';
import { formatNonInteractiveError } from './session/errorReporting.js';
import {
  runDirectImageModeAndExit,
  buildImageModeFlags,
} from './config/imageModeDispatch.js';
import { isImageModeActive } from './config/imageMode.js';
import { initializeOutputListenersAndFlush } from './session/outputListeners.js';
import {
  installNonInteractiveSigintHandler,
  setupUnhandledRejectionHandler,
  __resetUnhandledRejectionStateForTesting,
} from './session/signalHandlers.js';
import { startInteractiveUI } from './session/interactiveUI.js';
import { configureUnicodeSupport } from './ui/utils/unicodeSupport.js';

// Re-exported to preserve the public module API consumed by tests and tooling.
export { validateDnsResolutionOrder } from './cliBootstrap.js';
export {
  formatNonInteractiveError,
  installNonInteractiveSigintHandler,
  setupUnhandledRejectionHandler,
  __resetUnhandledRejectionStateForTesting,
  startInteractiveUI,
  initializeOutputListenersAndFlush,
};

/**
 * Patch stdio, register flush-on-exit, install the unhandled-rejection handler,
 * and ensure the platform-standard config directory (or legacy fallback) exists. Returns the stdio cleanup.
 */
function setupProcessLifecycle(): () => void {
  const cleanupStdio = patchStdio();
  registerSyncCleanup(() => {
    // This is needed to ensure we don't lose any buffered output.
    initializeOutputListenersAndFlush();
    cleanupStdio();
  });

  // Install the process-wide unhandled-rejection handler. It is a
  // process-lifetime singleton — never disposed in production because the
  // process exits shortly after. The disposer is ignored here intentionally.
  setupUnhandledRejectionHandler();

  // Migrate legacy ~/.llxprt/ to platform-standard path (if needed),
  // then ensure the platform directory exists.
  const startupResult = runStartupMigration();
  const legacyDir = Storage.getLegacyLlxprtDir();
  const report = reportStartupResult(startupResult, legacyDir);
  for (const message of report.messages) {
    process.stderr.write(message + '\n');
  }
  if (report.needsLegacyFallback) {
    process.env['LLXPRT_CONFIG_HOME'] = legacyDir;
  }
  const llxprtDir = Storage.getGlobalConfigDir();
  if (!existsSync(llxprtDir)) {
    mkdirSync(llxprtDir, { recursive: true });
  }
  return cleanupStdio;
}

/**
 * Zed/ACP runs its own runtime; it constructs per-session Agents via fromConfig
 * internally, so the foreground Agent is NOT built in the main flow. Returns
 * true when the Zed/ACP path was taken (main should return immediately).
 */
async function handleZedAcpIntegration(
  config: Config,
  cleanupStdio: () => void,
): Promise<boolean> {
  if (!config.getExperimentalZedIntegration()) {
    return false;
  }
  cleanupStdio();
  ensureAcpProviderActivated(config);
  await runZedIntegration(config, { onExitCleanup: runExitCleanup });
  return true;
}

function hasExplicitProviderProfileSelector(argv: ParsedCliArgs): boolean {
  return [argv.provider, argv.profile, argv.profileLoad].some(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
}

/**
 * Construct the SINGLE foreground Agent (#2378) and dispatch the interactive or
 * non-interactive session. The spinner wraps agent construction, which (via
 * fromConfig) owns Config.initialize() and the one session MessageBus. IDE
 * connection and session recording run AFTER because they depend on the
 * initialize() the Agent performs.
 */
async function constructForegroundAgentAndDispatch(
  config: Config,
  settings: LoadedSettings,
  argv: ParsedCliArgs,
  workspaceRoot: string,
  providerActivation: ConfiguredProviderActivationResult,
  hasPipedInput: boolean,
  readStdinData: () => Promise<string>,
  bootstrapSelection: BootstrapSelection | null,
): Promise<void> {
  // Configure Unicode rendering before any Ink render (including the MCP
  // initialization spinner inside constructAgentWithSpinner) so that Windows
  // consoles with non-UTF-8 codepages fall back to ASCII borders/spinners.
  configureUnicodeSupport(settings.merged.ui.unicode ?? 'auto');
  const agent = await constructAgentWithSpinner(
    config,
    providerActivation.token,
    providerActivation.intent,
  );
  await connectIdeClientIfEnabled(config);

  const recording = await setupSessionRecording(
    config,
    argv,
    bootstrapSelection,
  );

  await dispatchInteractiveOrNonInteractive({
    config,
    agent,
    settings,
    workspaceRoot,
    recording,
    hasPipedInput,
    readStdinData,
    suppressStartupWelcome: hasExplicitProviderProfileSelector(argv),
  });
}

/**
 * CLI entry point — four-step flow (#2378). The CLI is a THIN CLIENT: it
 * parses/resolves declarative data and drives the public agent-bootstrap
 * surface. It does NOT own runtime assembly (MessageBus construction,
 * Config.initialize, or the provider-activation primitive) — those live behind
 * the core/providers/agents public APIs.
 * 1. Parse/resolve: argv, settings, profiles, extensions → resolved Config
 *    data (`bootstrapRuntimeAndConfig`). No MessageBus and no Config.initialize
 *    happen here — both are owned by agent construction. The pre-Config
 *    provider-runtime assembly (identity, session bus, provider/OAuth managers)
 *    is owned by the providers package (`assembleCliProviderRuntime`).
 * 2. Declarative preflight (pre-agent): the CLI assembles a declarative
 *    activation intent and calls the public `preflightAgentActivation`
 *    agent-bootstrap entrypoint (via `activateConfiguredProvider`), which OWNS
 *    the provider-activation primitive and returns the typed auth outcome the
 *    CLI needs for the sandbox-hop + FATAL_AUTHENTICATION_ERROR decisions. The
 *    sandbox hop runs here too. Config.initialize() does NOT run here, and the
 *    CLI never executes the activation primitive itself.
 * 3. Agent construction (fromConfig): `constructAgentWithSpinner(config)` builds
 *    the SINGLE foreground Agent via `createForegroundAgent` → `fromConfig`,
 *    which OWNS Config.initialize() and the one session MessageBus (built from
 *    the Config's policy engine, exposed via `agent.getMessageBus()`) and
 *    ADOPTS the preflight activation state without re-running a second
 *    activation sequence. Runtime state/context seeding, provider wiring, policy
 *    engine, and scheduler singletons all live behind that public API, not in
 *    CLI code. IDE connect and session recording run just after (they depend on
 *    initialize()).
 * 4. Render/Run: the ONE Agent is threaded into the interactive UI or reused by
 *    the non-interactive stream; consumers read the session bus from
 *    `agent.getMessageBus()` instead of a separately-threaded bus.
 *
 * Zed/ACP is the exception: it runs its own runtime and constructs per-session
 * Agents via `fromConfig` internally, so no foreground Agent is built for it.
 */
function prepareSandboxCredentialStartup(workspaceRoot: string): void {
  const sandboxSocket = process.env.LLXPRT_CREDENTIAL_SOCKET;
  const capabilityFd = process.env.LLXPRT_CAPABILITY_FD;
  if (sandboxSocket !== undefined || capabilityFd !== undefined) {
    createTokenStore();
  }
  if (sandboxSocket !== undefined) {
    applySandboxBashrc(
      `${workspaceRoot}/.llxprt/sandbox.bashrc`,
      workspaceRoot,
    );
  }
}

/**
 * Detect whether direct image mode is active from parsed argv flags.
 *
 * Shares `buildImageModeFlags` with `resolveDirectImageMode` so the stdin-guard
 * bypass below and the later dispatch can never disagree about whether image
 * mode is active.
 */
function detectImageModeFromArgv(argv: ParsedCliArgs): boolean {
  return isImageModeActive(buildImageModeFlags(argv));
}

/**
 * Resolve the JSP bootstrap selection immediately after parsing. The env was
 * already captured and scrubbed at the first line of `main()` by
 * `captureBootstrapEnvPath`; this resolves the final selection from public
 * flag > transported env path > captured env path > disabled (AC10–AC13). File
 * validation happens later at observation setup (fail-fast).
 */
function preparePostParseStartup(
  argv: ParsedCliArgs,
  capturedEnvPath: string | undefined,
): {
  bootstrapSelection: BootstrapSelection | null;
  hasPipedInput: boolean;
  readStdinOnce: () => Promise<string>;
} {
  return {
    bootstrapSelection: resolveBootstrapSelection(
      argv.jspBootstrap,
      argv.jspBootstrapInternalEnvPath,
      capturedEnvPath,
    ),
    hasPipedInput: !process.stdin.isTTY && argv.experimentalAcp !== true,
    readStdinOnce: createMemoizedStdinReader(),
  };
}

/**
 * Runs the post-parse startup steps that main() delegates out to keep its own
 * body under the max-lines-per-function limit. Performs checkpoint cleanup
 * only — stdin guard, settings, config, terminal setup, and provider work
 * stay in main() to preserve the ordering contract.
 */
async function runPostParseStartup(): Promise<void> {
  await cleanupCheckpoints();
}

/** Guard stdin-or-prompt unless image mode is active (bypasses the guard). */
async function ensureStdinOrPrompt(
  argv: ParsedCliArgs,
  hasPipedInput: boolean,
  readStdinOnce: () => Promise<string>,
): Promise<void> {
  if (!detectImageModeFromArgv(argv)) {
    await ensureStdinOrPromptProvided(
      hasPipedInput,
      readStdinOnce,
      firstNonEmptyString(argv.promptInteractive, argv.prompt) ??
        (argv.promptWords ?? []).join(' '),
    );
  }
}

export async function main() {
  // Capture and scrub LLXPRT_JSP_BOOTSTRAP_FILE before any child-capable
  // startup. No file I/O; resolved later, validated at observation setup.
  const capturedEnvPath = captureBootstrapEnvPath();

  wireMcpHostServices();
  configureEarlyDebugLogging();

  await handleVersionAndHelpFlags(process.argv.slice(2));

  const cleanupStdio = setupProcessLifecycle();

  const workspaceRoot = process.cwd();
  prepareSandboxCredentialStartup(workspaceRoot);

  const settings = loadSettings(workspaceRoot);

  await maybeRelaunchForMemory(settings, capturedEnvPath);

  const argv = await parseArguments(settings.merged);

  const { bootstrapSelection, hasPipedInput, readStdinOnce } =
    preparePostParseStartup(argv, capturedEnvPath);

  await runPostParseStartup();

  await ensureStdinOrPrompt(argv, hasPipedInput, readStdinOnce);
  throwIfSettingsErrors(settings);
  redirectConsoleForAcp(argv);

  const { config, runtimeSettingsService } = await bootstrapRuntimeAndConfig(
    settings,
    argv,
    workspaceRoot,
  );

  await rejectPromptInteractiveWithPipedStdin(argv);

  await prepareTerminalSession(config, settings, argv);

  const providerManager = await configureProvidersAndServices(
    config,
    settings,
    argv,
    runtimeSettingsService,
  );

  if (config.getListExtensions()) {
    process.exit(0);
  }

  // ACP/Zed runs its own runtime and constructs per-session Agents via
  // fromConfig internally; it must be handled BEFORE the general
  // non-interactive unconfigured-provider guard.
  if (await handleZedAcpIntegration(config, cleanupStdio)) {
    return;
  }

  // Non-interactive unconfigured-provider gate: exit FATAL_CONFIG_ERROR (52)
  // BEFORE any provider activation or Agent construction when no provider is
  // active and we are NOT in interactive mode. Uses the shared
  // guardUnconfiguredProvider helper (single message, single exit code).
  await guardUnconfiguredProvider(config, runExitCleanup);

  // Declarative provider-activation PREFLIGHT runs PRE-AGENT (#2374/#2378).
  const providerActivation = await activateConfiguredProvider(
    config,
    providerManager,
    argv,
  );
  const initialAuthFailed = providerActivation.authFailed;

  // hop into sandbox if outside and sandboxing is enabled
  await maybeHopIntoSandbox({
    config,
    settings,
    argv,
    workspaceRoot,
    runtimeSettingsService,
    initialAuthFailed,
    readStdin: readStdinOnce,
    hasPipedInput,
    bootstrapSelection,
  });

  if (initialAuthFailed) {
    await runExitCleanup();
    process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
  }

  // Direct image mode: detect after config/auth but BEFORE conversational
  // dispatch. Image mode runs the image-operation service directly and exits.
  const imageExitCode = await runDirectImageModeAndExit(argv, config);
  if (imageExitCode !== null) {
    await runExitCleanup();
    process.exit(imageExitCode);
  }

  // Cleanup sessions before agent construction.
  await cleanupExpiredSessions(config, settings.merged);

  await constructForegroundAgentAndDispatch(
    config,
    settings,
    argv,
    workspaceRoot,
    providerActivation,
    hasPipedInput,
    readStdinOnce,
    bootstrapSelection,
  );
}
