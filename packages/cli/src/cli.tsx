import {
  parseBootstrapArgs,
  prepareRuntimeForProfile,
} from './config/profileBootstrap.js';
import { resolveProxy } from './config/configBuilder.js';
import type {
  AgentForegroundHost,
  AgentProfilePreflight,
} from '@vybestack/llxprt-code-agents';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  HostCredentialOwner,
  type CredentialAuthority,
} from '@vybestack/llxprt-code-providers/auth.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';
import { createOAuthSettingsAdapter } from './auth/oauth-settings-adapter.js';
import {
  type ImageOperationRunner,
  patchStdio,
  ExitCodes,
  type LlxprtExtension,
  type WorkspaceSkillOperations,
  type RuntimeProviderManager,
  type Config,
} from '@vybestack/llxprt-code-core';
import { SettingsService, Storage } from '@vybestack/llxprt-code-settings';

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
import { loadSettings, type LoadedSettings } from './config/settings.js';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
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
import {
  runZedIntegration,
  type ZedSessionProviderInputs,
} from '@vybestack/llxprt-code-zed-acp';
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
  exitAfterSessionListOrDelete,
  hasSessionManagementFlag,
} from './cliSessionListAndDelete.js';
import {
  discoverCliProviderContributions,
  bootstrapRuntimeAndConfig as bootstrap,
  setupOwnerSessionRecording,
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

/**
 * Hands the ACP client the contributions this process already loaded and the
 * same OAuth settings surface the CLI's own provider manager uses, so ACP
 * sessions do not re-discover plugins or read OAuth settings from a different
 * source.
 */
function createZedProviderInputs(
  providerContributions: ProviderContributionRegistry,
  credentialAuthority: CredentialAuthority,
): ZedSessionProviderInputs {
  const oauthSettings = createOAuthSettingsAdapter();
  return {
    credentialAuthority,
    providerContributions,
    ...(oauthSettings !== undefined ? { oauthSettings } : {}),
  };
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
  preflight: AgentProfilePreflight,
  hasPipedInput: boolean,
  readStdinData: () => Promise<string>,
  bootstrapSelection: BootstrapSelection | null,
  getMcpAuthProviderFactory: NonNullable<
    AgentForegroundHost['mcpHost']
  >['getAuthProviderFactory'],
  credentialAuthority: CredentialAuthority,
): Promise<void> {
  // Configure Unicode rendering before any Ink render (including the MCP
  // initialization spinner inside constructAgentWithSpinner) so that Windows
  // consoles with non-UTF-8 codepages fall back to ASCII borders/spinners.
  configureUnicodeSupport(settings.merged.ui.unicode ?? 'auto');
  let restartExtension:
    | ((extension: LlxprtExtension) => Promise<void>)
    | undefined;
  let skillOperations:
    | Pick<
        WorkspaceSkillOperations,
        'list' | 'find' | 'reload' | 'isAdminEnabled'
      >
    | undefined;
  const receipt = providerActivation.token;
  if (receipt === undefined)
    throw new Error('Missing foreground activation receipt');
  const agent = await constructAgentWithSpinner(
    config,
    preflight,
    receipt,
    providerActivation.intent ?? {},
    credentialAuthority,
    getMcpAuthProviderFactory,
    (skills) => {
      skillOperations = skills;
    },
    (restart) => {
      restartExtension = restart;
    },
    argv,
  );
  await connectIdeClientIfEnabled(agent.ide);

  const recordingStartupWarnings: string[] = [];
  const resumedHistory = await setupOwnerSessionRecording(
    config,
    agent,
    argv,
    bootstrapSelection,
    recordingStartupWarnings,
  );

  await dispatchInteractiveOrNonInteractive({
    skillOperations,
    restartExtension,
    config,
    agent,
    settings,
    workspaceRoot,
    recordingOwner: 'agent',
    runtimeSettings: preflight,
    resumedHistory,
    recordingStartupWarnings,
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
 *    is owned by agents (`prepareAgentPreflight`).
 * 2. Declarative preflight (pre-agent): the CLI assembles a declarative
 *    activation intent and calls the operation’s `preflight`
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
function prepareSandboxCredentialStartup(
  workspaceRoot: string,
): HostCredentialOwner {
  const sandboxSocket = process.env.LLXPRT_CREDENTIAL_SOCKET;
  const credentialOwner = new HostCredentialOwner(process.env);
  if (sandboxSocket !== undefined) {
    applySandboxBashrc(
      `${workspaceRoot}/.llxprt/sandbox.bashrc`,
      workspaceRoot,
    );
  }
  return credentialOwner;
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

/**
 * Guard stdin-or-prompt unless image mode is active or a session-management
 * flag is present (both bypass the guard: neither takes a prompt).
 */
async function ensureStdinOrPrompt(
  argv: ParsedCliArgs,
  hasPipedInput: boolean,
  readStdinOnce: () => Promise<string>,
): Promise<void> {
  if (!detectImageModeFromArgv(argv) && !hasSessionManagementFlag(argv)) {
    await ensureStdinOrPromptProvided(
      hasPipedInput,
      readStdinOnce,
      firstNonEmptyString(argv.promptInteractive, argv.prompt) ??
        (argv.promptWords ?? []).join(' '),
    );
  }
}

async function exitIfDirectImage(
  argv: ParsedCliArgs,
  imageClient: { readonly runImageOperation: ImageOperationRunner },
): Promise<void> {
  const imageExitCode = await runDirectImageModeAndExit(argv, (input) =>
    imageClient.runImageOperation(input),
  );
  if (imageExitCode !== null) {
    await runExitCleanup();
    process.exit(imageExitCode);
  }
}

async function exitIfAuthenticationFailed(authFailed: boolean): Promise<void> {
  if (authFailed) {
    await runExitCleanup();
    process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
  }
}

async function stopIfUnconfigured(
  config: Config,
  manager: Pick<RuntimeProviderManager, 'hasActiveProvider'>,
): Promise<void> {
  await guardUnconfiguredProvider(config, runExitCleanup, manager);
}

async function prepareForegroundPreflight(
  argv: ParsedCliArgs,
  authority: CredentialAuthority,
  providerContributions: Awaited<
    ReturnType<typeof discoverCliProviderContributions>
  >['providerContributions'],
): Promise<AgentProfilePreflight> {
  const parsed = parseBootstrapArgs();
  const preflight = await prepareRuntimeForProfile(
    {
      ...parsed,
      runtimeMetadata: {
        ...parsed.runtimeMetadata,
        proxy: resolveProxy(argv.proxy),
      },
    },
    authority,
    undefined,
    undefined,
    providerContributions,
  );
  return preflight;
}

async function handleSandboxHop(
  config: Config,
  settings: LoadedSettings,
  argv: ParsedCliArgs,
  workspaceRoot: string,
  preflight: AgentProfilePreflight,
  authority: CredentialAuthority,
  authFailed: boolean,
  readStdinOnce: () => Promise<string>,
  hasPipedInput: boolean,
  bootstrapSelection: Parameters<
    typeof maybeHopIntoSandbox
  >[0]['bootstrapSelection'],
): Promise<void> {
  await maybeHopIntoSandbox({
    config,
    settings,
    argv,
    workspaceRoot,
    prepareSandboxPreflight: () => preflight.forkSandboxPreflight(),
    credentialAuthority: authority,
    initialAuthFailed: authFailed,
    readStdin: readStdinOnce,
    hasPipedInput,
    bootstrapSelection,
  });
}

async function activateForegroundProvider(
  config: Config,
  argv: ParsedCliArgs,
  preflight: AgentProfilePreflight,
): Promise<ConfiguredProviderActivationResult> {
  await stopIfUnconfigured(config, preflight);
  return activateConfiguredProvider(config, preflight, argv, preflight);
}

async function prepareConfiguredTerminalSession(
  config: Config,
  settings: LoadedSettings,
  argv: ParsedCliArgs,
  readProfile: () => string | null,
  loadProfile: AgentProfilePreflight['load'],
): Promise<void> {
  await exitAfterSessionListOrDelete(argv, config, () => config.dispose());
  await rejectPromptInteractiveWithPipedStdin(argv);
  await prepareTerminalSession(config, settings, argv);
  await configureProvidersAndServices(
    config,
    settings,
    argv,
    readProfile,
    loadProfile,
  );
}

export async function main() {
  const capturedEnvPath = captureBootstrapEnvPath();
  configureEarlyDebugLogging();
  await handleVersionAndHelpFlags(process.argv.slice(2));

  const { cleanupStdio, workspaceRoot, settings, argv, credentialOwner } =
    await prepareCliStartupInput(capturedEnvPath);

  const { bootstrapSelection, hasPipedInput, readStdinOnce } =
    await prepareValidatedStartup(argv, capturedEnvPath, settings);

  const authority = credentialOwner.authority;
  const { providerContributions, authFactories } =
    await discoverCliProviderContributions();
  const preflight = await prepareForegroundPreflight(
    argv,
    authority,
    providerContributions,
  );
  const config = await bootstrap(
    settings,
    argv,
    workspaceRoot,
    authority,
    preflight,
  );

  try {
    await prepareConfiguredTerminalSession(
      config,
      settings,
      argv,
      () => preflight.getCurrentProfileName(),
      (name) => preflight.load(name),
    );

    await exitAfterExtensionList(config.getListExtensions(), preflight);

    // ACP/Zed runs its own runtime and constructs per-session Agents via
    // fromConfig internally; it must be handled BEFORE the general
    // non-interactive unconfigured-provider guard.
    if (
      await handleActivatedZedIntegration(
        config,
        cleanupStdio,
        preflight,
        providerContributions,
        authority,
      )
    )
      return;

    // Non-interactive unconfigured-provider gate: exit FATAL_CONFIG_ERROR (52)
    // BEFORE any provider activation or Agent construction when no provider is
    // active and we are NOT in interactive mode. Uses the shared
    // guardUnconfiguredProvider helper (single message, single exit code).
    const providerActivation = await activateForegroundProvider(
      config,
      argv,
      preflight,
    );
    // hop into sandbox if outside and sandboxing is enabled
    await handleSandboxHop(
      config,
      settings,
      argv,
      workspaceRoot,
      preflight,
      authority,
      providerActivation.authFailed,
      readStdinOnce,
      hasPipedInput,
      bootstrapSelection,
    );

    await exitBeforeAgent(providerActivation.authFailed, argv, preflight);

    // Cleanup sessions before agent construction.
    await cleanupExpiredSessions(config, settings.merged, undefined, () =>
      preflight.captureHistory(),
    );

    await constructForegroundAgentAndDispatch(
      config,
      settings,
      argv,
      workspaceRoot,
      providerActivation,
      preflight,
      hasPipedInput,
      readStdinOnce,
      bootstrapSelection,
      (type) => authFactories.getAuthProviderFactory(type),
      authority,
    );
  } finally {
    await preflight.dispose();
  }
}

async function exitAfterExtensionList(
  listRequested: boolean,
  activationOperation: { dispose(): void | Promise<void> },
): Promise<void> {
  if (!listRequested) return;
  await activationOperation.dispose();
  process.exit(0);
}

async function prepareValidatedStartup(
  argv: Awaited<ReturnType<typeof parseArguments>>,
  envPath: string | undefined,
  settings: LoadedSettings,
): Promise<ReturnType<typeof preparePostParseStartup>> {
  const startup = preparePostParseStartup(argv, envPath);
  await runPostParseStartup();
  await ensureStdinOrPrompt(argv, startup.hasPipedInput, startup.readStdinOnce);
  throwIfSettingsErrors(settings);
  redirectConsoleForAcp(argv);
  return startup;
}

async function handleActivatedZedIntegration(
  config: Config,
  cleanupStdio: () => void,
  preflight: AgentProfilePreflight,
  providerContributions: ProviderContributionRegistry,
  credentialAuthority: CredentialAuthority,
): Promise<boolean> {
  if (!config.getExperimentalZedIntegration()) return false;
  cleanupStdio();
  ensureAcpProviderActivated(config, preflight);
  await runZedIntegration(config, preflight, {
    profileDefinitions: { listProfiles: () => preflight.listProfiles() },
    trustPort: preflight,
    onExitCleanup: runExitCleanup,
    providerInputs: createZedProviderInputs(
      providerContributions,
      credentialAuthority,
    ),
    createSessionSettings: () => {
      const session = new SettingsService();
      session.restoreFromStateSnapshot(preflight.captureSettingsSnapshot());
      return session;
    },
  });
  return true;
}

async function prepareCliStartupInput(capturedEnvPath: string | undefined) {
  const cleanupStdio = setupProcessLifecycle();
  const workspaceRoot = process.cwd();
  const credentialOwner = prepareSandboxCredentialStartup(workspaceRoot);
  const settings = loadSettings(workspaceRoot);
  await maybeRelaunchForMemory(settings, capturedEnvPath);
  const argv = await parseArguments(settings.merged);
  return { cleanupStdio, workspaceRoot, settings, argv, credentialOwner };
}

async function exitBeforeAgent(
  authFailed: boolean,
  argv: Parameters<typeof exitIfDirectImage>[0],
  preflight: Parameters<typeof exitIfDirectImage>[1],
): Promise<void> {
  await exitIfAuthenticationFailed(authFailed);
  await exitIfDirectImage(argv, preflight);
}
