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
 * and dispatch helpers live in ./cliSessionDispatch.tsx. This file no longer
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
import {
  patchStdio,
  ExitCodes,
  debugLogger,
} from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-settings';
import { runStartupMigration } from './config/pathMigration.js';
import {
  cleanupCheckpoints,
  runExitCleanup,
  registerSyncCleanup,
} from './utils/cleanup.js';
import { setMaxSizedBoxDebugging } from './ui/components/shared/MaxSizedBox.js';
import { runZedIntegration } from './zed-integration/zedIntegration.js';
import { cleanupExpiredSessions } from './utils/sessionCleanup.js';
import { existsSync, mkdirSync } from 'fs';
import { firstNonEmptyString } from './utils/coalesce.js';
import {
  activateConfiguredProvider,
  configureEarlyDebugLogging,
  configureProvidersAndServices,
  connectIdeClientIfEnabled,
  createMemoizedStdinReader,
  ensureAcpProviderActivated,
  ensureStdinOrPromptProvided,
  handleVersionAndHelpFlags,
  initializeConfigWithSpinner,
  maybeHopIntoSandbox,
  maybeRelaunchForMemory,
  prepareTerminalSession,
  redirectConsoleForAcp,
  rejectPromptInteractiveWithPipedStdin,
  throwIfSettingsErrors,
} from './cliBootstrap.js';
import {
  bootstrapRuntimeAndConfig,
  setupSessionRecording,
} from './cliSessionBootstrap.js';
import {
  dispatchInteractiveOrNonInteractive,
  formatNonInteractiveError,
  initializeOutputListenersAndFlush,
  installNonInteractiveSigintHandler,
  setupUnhandledRejectionHandler,
  startInteractiveUI,
} from './cliSessionDispatch.js';

// Re-exported to preserve the public module API consumed by tests and tooling.
export { validateDnsResolutionOrder } from './cliBootstrap.js';
export {
  formatNonInteractiveError,
  installNonInteractiveSigintHandler,
  setupUnhandledRejectionHandler,
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
  const migrationResult = runStartupMigration();
  if (!migrationResult.migrated && migrationResult.error === true) {
    const legacyDir = Storage.getLegacyLlxprtDir();
    process.stderr.write(
      `Warning: configuration migration failed (${migrationResult.reason}). ` +
        `Falling back to legacy directory ${legacyDir} for this session.\n`,
    );
    process.env['LLXPRT_CONFIG_HOME'] = legacyDir;
  }
  const llxprtDir = Storage.getGlobalConfigDir();
  if (!existsSync(llxprtDir)) {
    mkdirSync(llxprtDir, { recursive: true });
  }
  return cleanupStdio;
}

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

  const questionFromArgs =
    firstNonEmptyString(argv.promptInteractive, argv.prompt) ??
    (argv.promptWords ?? []).join(' ');

  await cleanupCheckpoints();

  await ensureStdinOrPromptProvided(
    hasPipedInput,
    readStdinOnce,
    questionFromArgs,
  );
  throwIfSettingsErrors(settings);
  redirectConsoleForAcp(argv);

  const { config, sessionMessageBus, runtimeSettingsService } =
    await bootstrapRuntimeAndConfig(settings, argv, workspaceRoot);

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

  setMaxSizedBoxDebugging(config.getDebugMode());

  await initializeConfigWithSpinner(config, sessionMessageBus);
  await connectIdeClientIfEnabled(config);

  // If a provider is specified, activate it after initialization
  const initialAuthFailed = await activateConfiguredProvider(
    config,
    providerManager,
    argv,
  );

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

  // Cleanup sessions after config initialization
  await cleanupExpiredSessions(config, settings.merged);

  const recording = await setupSessionRecording(config, argv);

  if (config.getExperimentalZedIntegration()) {
    // Restore real stdout/stderr — ACP uses stdout as its protocol pipe
    cleanupStdio();
    ensureAcpProviderActivated(config);
    await runZedIntegration(config, settings);
    return;
  }

  await dispatchInteractiveOrNonInteractive({
    config,
    settings,
    workspaceRoot,
    sessionMessageBus,
    recording,
    hasPipedInput,
    readStdinData: readStdinOnce,
  });
}
