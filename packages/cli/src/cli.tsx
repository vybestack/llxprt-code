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

import { parseArguments } from './config/cliArgParser.js';
import { loadSettings } from './config/settings.js';
import { patchStdio, ExitCodes } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  runStartupMigration,
  reportStartupResult,
} from './config/pathMigration.js';
import {
  cleanupCheckpoints,
  runExitCleanup,
  registerSyncCleanup,
} from './utils/cleanup.js';
import { runZedIntegration } from './zed-integration/zedIntegration.js';
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
} from './cliBootstrap.js';
import {
  activateConfiguredProvider,
  configureProvidersAndServices,
  connectIdeClientIfEnabled,
  ensureAcpProviderActivated,
} from './cliProviderInit.js';
import {
  constructAgentWithSpinner,
  prepareTerminalSession,
} from './cliTerminalSession.js';
import { maybeHopIntoSandbox } from './cliSandbox.js';
import {
  bootstrapRuntimeAndConfig,
  setupSessionRecording,
} from './cliSessionBootstrap.js';
import { dispatchInteractiveOrNonInteractive } from './session/nonInteractiveSession.js';
import { formatNonInteractiveError } from './session/errorReporting.js';
import { initializeOutputListenersAndFlush } from './session/outputListeners.js';
import {
  installNonInteractiveSigintHandler,
  setupUnhandledRejectionHandler,
  __resetUnhandledRejectionStateForTesting,
} from './session/signalHandlers.js';
import { startInteractiveUI } from './session/interactiveUI.js';

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
export async function main() {
  configureEarlyDebugLogging();

  const rawArgs = process.argv.slice(2);
  await handleVersionAndHelpFlags(rawArgs);

  const cleanupStdio = setupProcessLifecycle();

  const workspaceRoot = process.cwd();
  const settings = loadSettings(workspaceRoot);

  await maybeRelaunchForMemory(settings);

  const argv = await parseArguments(settings.merged);

  const hasPipedInput = !process.stdin.isTTY && argv.experimentalAcp !== true;
  const readStdinOnce = createMemoizedStdinReader();

  await cleanupCheckpoints();

  await ensureStdinOrPromptProvided(
    hasPipedInput,
    readStdinOnce,
    firstNonEmptyString(argv.promptInteractive, argv.prompt) ??
      (argv.promptWords ?? []).join(' '),
  );
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

  // Declarative provider-activation PREFLIGHT runs PRE-AGENT (#2374/#2378): the
  // sandbox-hop decision and the FATAL_AUTHENTICATION_ERROR exit both need the
  // auth outcome BEFORE the Agent is constructed. activateConfiguredProvider
  // assembles a declarative intent and delegates to the public
  // `preflightAgentActivation` agent-bootstrap entrypoint (the CLI does not
  // execute the activation primitive itself). This establishes the active
  // provider/auth on the Config; the Agent's own (idempotent) fromConfig
  // activation then ADOPTS it without a second activation sequence. The
  // preflight does not require Config.initialize() — the agentClient factory is
  // bound at construction and the client is created lazily.
  const providerActivation = await activateConfiguredProvider(
    config,
    providerManager,
    argv,
  );
  const initialAuthFailed = providerActivation.authFailed;

  // hop into sandbox if we are outside and sandboxing is enabled
  await maybeHopIntoSandbox({
    config,
    settings,
    argv,
    workspaceRoot,
    runtimeSettingsService,
    initialAuthFailed,
    readStdin: readStdinOnce,
    hasPipedInput,
  });

  if (initialAuthFailed) {
    await runExitCleanup();
    process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
  }

  // Cleanup sessions before agent construction.
  await cleanupExpiredSessions(config, settings.merged);

  // Zed/ACP runs its own runtime; it constructs per-session Agents via
  // fromConfig internally, so the foreground Agent is NOT built here.
  if (config.getExperimentalZedIntegration()) {
    // Restore real stdout/stderr — ACP uses stdout as its protocol pipe
    cleanupStdio();
    ensureAcpProviderActivated(config);
    await runZedIntegration(config, settings);
    return;
  }

  // Construct the SINGLE foreground Agent (#2378). The spinner wraps agent
  // construction, which (via fromConfig) owns Config.initialize() and the one
  // session MessageBus. IDE connection and session recording run AFTER because
  // they depend on the initialize() the Agent performs (ideClient, agentClient
  // for history restore).
  const agent = await constructAgentWithSpinner(
    config,
    providerActivation.token,
    providerActivation.intent,
  );
  await connectIdeClientIfEnabled(config);

  const recording = await setupSessionRecording(config, argv);

  await dispatchInteractiveOrNonInteractive({
    config,
    agent,
    settings,
    workspaceRoot,
    recording,
    hasPipedInput,
    readStdinData: readStdinOnce,
  });
}
