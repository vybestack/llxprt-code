import type { InteractiveApplicationInputs } from './interactiveApplicationInputs.js';
import { ObservationContext } from '../observation/ObservationContext.js';
import type { ObservationCallbacks } from '../observation/jspWiring.js';
import type { TerminalHost } from './terminalHost.js';
import { bindDebugCommand } from '../ui/commands/debugCommandHost.js';
import { InteractiveApplication } from './interactiveApplication.js';
import type { SessionSettingsOperations } from '../runtime/createRuntimeOwnerFeatures.js';

import {
  type LlxprtExtension,
  type WorkspaceSkillOperations,
  type Config,
  type SessionRecordingPort,
  type RecordingIntegration,
  type ResumeBootHandle,
  type LockHandle,
  type TelemetrySettings,
  resolvePerfSettings,
  getProjectHash,
  writeToStdout,
} from '@vybestack/llxprt-code-core';
import type { ProviderKeyStorageLike } from '@vybestack/llxprt-code-storage';
import type { BucketFailoverRuntime } from '../ui/cliUiRuntime.js';

import React, { type ErrorInfo } from 'react';
import { render as inkRender } from 'ink';

/**
 * Test-injectable render function. Defaults to the real ink render.
 * Tests that need to capture render calls (without module-level mocking,
 * which is unsupported under Bun's native test runner) can replace this
 * via the exported __setRenderForTesting seam.
 */

let render: typeof inkRender = inkRender;

export function __setRenderForTesting(fn: typeof inkRender | null): void {
  render = fn ?? inkRender;
}
import { AppWrapper } from '../ui/App.js';
import { ErrorBoundary } from '../ui/components/ErrorBoundary.js';
import { basename } from 'node:path';
import { type LoadedSettings } from '../config/settings.js';
import {
  debugLogger,
  type ConfigurationManager,
  DebugLogger,
} from '@vybestack/llxprt-code-telemetry';
import { getCliVersion } from '../utils/version.js';
import { enableMouseEvents, disableMouseEvents } from '../ui/utils/mouse.js';
import { restoreTerminalProtocolsSync } from '../ui/utils/terminalProtocolCleanup.js';
import { checkForUpdates } from '../ui/utils/updateCheck.js';
import { handleAutoUpdate } from '../utils/handleAutoUpdate.js';
import { SettingsContext } from '../ui/contexts/SettingsContext.js';
import { inkRenderOptions } from '../ui/inkRenderOptions.js';
import {
  createInteractivePerfRuntime,
  createIdentityProviderFromGetters,
  resolveRenderMode,
  resolveRuntimeVersion,
  resolvePlatformArch,
} from '../ui/hooks/perf/interactivePerfRuntime.js';
import type { InteractivePerfRuntime } from '../ui/hooks/perf/interactivePerfRuntime.js';
import { getGitCommitInfo } from '../utils/gitCommitInfo.js';
import { isMouseEventsEnabled } from '../ui/mouseEventsEnabled.js';
import { computeTerminalTitle } from '../utils/windowTitle.js';
import { StreamingState } from '../ui/types.js';
import { registerCleanup, registerSyncCleanup } from '../utils/cleanup.js';
import type { CliSessionPersistencePort } from '../cliSessionPersistence.js';
import { appendInteractiveUiDebug } from './debugLog.js';
import { mouseEventsExitHandler } from './terminalCleanup.js';
import {
  rollbackInteractiveFailure,
  type InteractiveInstanceCapability,
  type InteractiveOwnerCapability,
  type InteractiveMouseTeardown,
  type InteractiveTerminalRestore,
} from './interactiveUiLifecycle.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { InteractiveContextHost } from '../runtime/InteractiveContextHost.js';
import { buildInteractiveUiPorts } from './interactiveUiPorts.js';
import { type InteractiveCommandPorts } from '../ui/cliCommandPorts.js';

function handleError(
  error: Error,
  errorInfo: ErrorInfo,
  logger: Pick<DebugLogger, 'error'>,
) {
  appendInteractiveUiDebug(
    `error-boundary ${error.message}\n${error.stack ?? ''}\n${errorInfo.componentStack}`,
  );
  // Log to console for debugging
  logger.error('Application Error:', error);
  logger.error('Component Stack:', errorInfo.componentStack);

  // Special handling for maximum update depth errors
  if (error.message.includes('Maximum update depth exceeded')) {
    logger.error('\nCRITICAL: RENDER LOOP DETECTED!');
    logger.error('This is likely caused by:');
    logger.error('- State updates during render');
    logger.error('- Incorrect useEffect dependencies');
    logger.error('- Non-memoized props causing re-renders');
    logger.error('\nCheck recent changes to React components and hooks.');
  }
}

function resetTitleExitHandler() {
  writeToStdout(`\x1b]0;\x07`);
}

export function setWindowTitle(
  title: string,
  settings: LoadedSettings,
  terminalHost: TerminalHost,
) {
  if (settings.merged.ui.hideWindowTitle !== true) {
    // Initial state before React loop starts
    const windowTitle = computeTerminalTitle({
      streamingState: StreamingState.Idle,
      isConfirming: false,
      folderName: title,
      showThoughts: settings.merged.ui.showStatusInTitle === true,
      useDynamicTitle: settings.merged.ui.dynamicWindowTitle ?? true,
    });
    writeToStdout(`\x1b]0;${windowTitle}\x07`);

    // Register the title-reset listener only once per process; multiple
    // interactive sessions in the same process would otherwise accumulate
    // duplicate exit listeners.
    if (!terminalHost.titleResetExitListenerRegistered) {
      terminalHost.titleResetExitListenerRegistered = true;
      process.off('exit', resetTitleExitHandler);
      process.on('exit', resetTitleExitHandler);
    }
  }
}

/**
 * Narrow Pick-style config capability for {@link buildAndStartPerfOwner}.
 * Exposes only the methods the composition reads so a Bun behavior test can
 * call the real composition function with a minimal instrumented config.
 */
export interface PerfOwnerConfigCapability {
  getTelemetrySettings(): TelemetrySettings;
  getSessionId(): string;
  getProjectRoot(): string;
  getScreenReader(): boolean;
}

/**
 * Narrow Pick-style agent capability for {@link buildAndStartPerfOwner}.
 * Exposes only the methods the composition reads so a Bun behavior test can
 * instrument provider/model/runtimeId getters and prove they are read fresh
 * at each operation boundary.
 */
export interface PerfOwnerAgentCapability {
  getRuntimeId(): string;
  getProvider(): string;
  getModel(): string;
}

/**
 * P12: Constructs and starts the interactive perf runtime owner from real
 * runtime/config/build APIs. Returns null when perf is disabled (before any
 * construction — zero side effects). Extracted from startInteractiveUI to
 * keep the composition function within the max-lines-per-function limit.
 *
 * Accepts a narrow Pick-style capability so a Bun behavior test can call the
 * real composition function with perf disabled and instrument every
 * identity/hash/provider/model/timing/memory/timer-related seam.
 */
export async function buildAndStartPerfOwner(
  config: PerfOwnerConfigCapability,
  agent: PerfOwnerAgentCapability,
  settings: LoadedSettings,
  version: string,
): Promise<InteractivePerfRuntime | null> {
  const perfSettings = resolvePerfSettings(config.getTelemetrySettings());
  if (!perfSettings.enabled) return null;
  const owner = createInteractivePerfRuntime({
    enabled: true,
    memoryEnabled: perfSettings.memory,
    identityProvider: createIdentityProviderFromGetters(
      {
        sessionId: config.getSessionId(),
        runtimeId: agent.getRuntimeId(),
        projectHash: getProjectHash(config.getProjectRoot()),
        cliVersion: version,
        gitSha: getGitCommitInfo(),
        runtime: resolveRuntimeVersion(),
        platform: resolvePlatformArch(),
      },
      {
        provider: () => agent.getProvider(),
        model: () => agent.getModel(),
        terminalCols: () => extractTerminalCols(process.stdout),
        terminalRows: () => extractTerminalRows(process.stdout),
        renderMode: () =>
          resolveRenderMode(
            config.getScreenReader(),
            settings.merged.ui.useAlternateBuffer === true &&
              !config.getScreenReader(),
            settings.merged.ui.useAlternateBuffer === true &&
              !config.getScreenReader() &&
              settings.merged.ui.incrementalRendering !== false,
          ),
      },
    ),
  });
  if (owner === null) {
    throw new Error(
      'buildAndStartPerfOwner: createInteractivePerfRuntime returned null ' +
        'despite enabled=true (impossible state)',
    );
  }
  await owner.start();
  return owner;
}

/**
 * Reads stdout columns safely. process.stdout.columns is typed as `number`
 * but can be undefined when stdout is not a TTY; the optional-property
 * parameter type avoids an unnecessary-condition lint without a type assertion.
 */
function extractTerminalCols(stream: { columns?: number }): number {
  return stream.columns ?? 0;
}

function extractTerminalRows(stream: { rows?: number }): number {
  return stream.rows ?? 0;
}

/**
 * Builds the root JSX element tree for Ink render. Extracted from
 * startInteractiveUI to keep the composition function within the
 * max-lines-per-function limit.
 */
function buildRenderElement(
  commandPorts: InteractiveCommandPorts,
  agent: Agent,
  runtimeSettings: SessionSettingsOperations,
  settings: LoadedSettings,
  startupWarnings: string[],
  version: string,
  recordingIntegration: RecordingIntegration | undefined,
  resumedBoot: Pick<ResumeBootHandle, 'streamRows'> | undefined,
  initialRecordingService: SessionRecordingPort | undefined,
  initialLockHandle: LockHandle | null | undefined,
  suppressStartupWelcome: boolean | undefined,
  perfOwner: InteractivePerfRuntime | null,
  recordingOwner?: 'agent' | 'raw',
): React.ReactElement {
  const contextHost = new InteractiveContextHost(agent, () =>
    runtimeSettings.readDefaultProfileName(),
  );
  return (
    <AppWrapper
      {...new InteractiveApplication({
        containerApp: commandPorts.containerApp,
        containerSession: commandPorts.containerSession,
        containerTerminal: commandPorts.containerTerminal,
        containerMemory: commandPorts.containerMemory,
        containerInput: commandPorts.containerInput,
        inputPolicy: commandPorts.inputPolicy,
        commandRegistry: commandPorts.commandRegistry,
        fileCommands: commandPorts.fileCommands,
        workspaceCommands: commandPorts.workspaceCommands,
        chatCommands: commandPorts.chatCommands,
        keyCommands: commandPorts.keyCommands,
        approval: commandPorts.approval,
        browserSession: commandPorts.browserSession,
        emojiFilter: commandPorts.emojiFilter,
        containerRuntime: commandPorts.containerRuntime,
        slashCommandPorts: commandPorts.slashCommandPorts,
        layoutRuntime: commandPorts.layoutRuntime,
        dialogsRuntime: commandPorts.dialogsRuntime,
        ...bindApplicationOperations(agent),
        ...bindJournalOperations(agent),
        renderRuntime: contextHost.renderRuntime,
        detectProviderQuota: contextHost.detectProviderQuota,
        fetch: contextHost.fetch,
        getActiveModelName: contextHost.getActiveModelName,
        getActiveProviderAliasConfig: contextHost.getActiveProviderAliasConfig,
        getActiveProviderName: contextHost.getActiveProviderName,
        getActiveToolFormatState: contextHost.getActiveToolFormatState,
        getEphemeralSetting: contextHost.getEphemeralSetting,
        getEphemeralSettings: contextHost.getEphemeralSettings,
        listSavedProfiles: contextHost.listSavedProfiles,
        providerStatus: contextHost.providerStatus,
        saveLoadBalancerProfile: contextHost.saveLoadBalancerProfile,
        setActiveModel: contextHost.setActiveModel,
        setActiveToolFormatOverride: contextHost.setActiveToolFormatOverride,
        setEphemeralSetting: contextHost.setEphemeralSetting,
        updateActiveProviderApiKey: contextHost.updateActiveProviderApiKey,
        providerAliasRefresh: agent.providerReads.refreshAliases,
        oauthControl: agent.authentication,
        settings,
        startupWarnings,
        version,
        terminalBackgroundColor:
          commandPorts.containerTerminal.getTerminalBackground(),
        ...(recordingOwner === 'agent'
          ? { recordingOwner, resumedBoot, suppressStartupWelcome }
          : {
              recordingIntegration,
              recordingOwner,
              resumedBoot,
              initialRecordingService,
              initialLockHandle,
              suppressStartupWelcome,
            }),
        operationLifecycle: perfOwner?.registry,
        memoryController: perfOwner?.memoryController ?? undefined,
      }).createAppProps()}
    />
  );
}

/**
 * Enables mouse events and registers terminal-protocol exit handlers.
 * Idempotent across repeated startInteractiveUI calls. Extracted to keep
 * startInteractiveUI within the max-lines-per-function limit.
 */
function setupTerminalExitHandlers(
  renderOptions: ReturnType<typeof inkRenderOptions>,
  settings: LoadedSettings,
): void {
  const mouseEventsEnabled = isMouseEventsEnabled(renderOptions, settings);
  if (mouseEventsEnabled) {
    enableMouseEvents();
    // mouseEventsExitHandler is module-level; process.off+on keeps exactly one
    // listener across repeated calls. process.on('exit') avoids deadlocking on
    // waitUntilExit during runExitCleanup (fixes #959).
    process.off('exit', mouseEventsExitHandler);
    process.on('exit', mouseEventsExitHandler);
  }
  process.off('exit', restoreTerminalProtocolsSync);
  process.on('exit', restoreTerminalProtocolsSync);
}

/**
 * The key storage handle created for one interactive UI root by the credential
 * authority. It is released by exactly one owner at a time: the pre-commit
 * catch in {@link startInteractiveUI}, then the rollback of
 * {@link commitInteractiveStartup}, then the published instance's teardown.
 */
export type InteractiveProviderKeys = ProviderKeyStorageLike & {
  close(): void;
};

export interface OwnerInteractiveStartup {
  readonly terminalHost: TerminalHost;
  readonly observation: ObservationCallbacks;
  readonly debugConfiguration: ConfigurationManager;
  readonly providerKeys: InteractiveProviderKeys;
  readonly runtimeSettings: SessionSettingsOperations;
  readonly restartExtension?: (extension: LlxprtExtension) => Promise<void>;
  readonly skillOperations?: Pick<
    WorkspaceSkillOperations,
    'list' | 'find' | 'reload' | 'isAdminEnabled'
  >;
  readonly recordingOwner: 'agent';
  readonly resumedBoot?: Pick<ResumeBootHandle, 'streamRows'>;
  readonly suppressStartupWelcome?: boolean;
}

export interface RawInteractiveStartup {
  readonly terminalHost: TerminalHost;
  readonly observation: ObservationCallbacks;
  readonly debugConfiguration: ConfigurationManager;
  readonly providerKeys: InteractiveProviderKeys;
  readonly recordingOwner: 'raw';
  readonly runtimeSettings: SessionSettingsOperations;
  readonly sessionPersistence: CliSessionPersistencePort | undefined;
  readonly recordingIntegration?: RecordingIntegration;
  readonly resumedBoot?: Pick<ResumeBootHandle, 'streamRows'>;
  readonly initialRecordingService?: SessionRecordingPort;
  readonly initialLockHandle?: LockHandle | null;
  readonly suppressStartupWelcome?: boolean;
}
export async function startInteractiveUI(
  config: Config,
  agent: Agent,
  settings: LoadedSettings,
  startupWarnings: string[],
  workspaceRoot: string,
  startup: OwnerInteractiveStartup | RawInteractiveStartup,
): Promise<InteractiveInstanceCapability> {
  const { version, perfOwner } = await prepareInteractiveStartup(
    config,
    agent,
    settings,
    workspaceRoot,
    startup,
  );
  return commitInteractiveStartup({
    config,
    agent,
    settings,
    perfOwner,
    version,
    startupWarnings,
    ...startup,
  });
}

/**
 * Runs the stages before {@link commitInteractiveStartup} takes the key handle,
 * including the raw-startup persistence requirement.
 * Until the commit starts, this function is the handle's only owner, so a
 * failure in any stage closes it once and rethrows the stage's error; a close
 * failure is joined behind the primary error.
 */
async function prepareInteractiveStartup(
  config: Config,
  agent: Agent,
  settings: LoadedSettings,
  workspaceRoot: string,
  startup: OwnerInteractiveStartup | RawInteractiveStartup,
): Promise<{ version: string; perfOwner: InteractivePerfRuntime | null }> {
  try {
    if (
      startup.recordingOwner === 'raw' &&
      startup.sessionPersistence === undefined
    )
      throw new Error(
        'Raw interactive startup requires its own CLI session persistence',
      );
    const version = await initializeInteractivePresentation(
      workspaceRoot,
      settings,
      startup.terminalHost,
    );
    await startup.terminalHost.cleanup();
    const perfOwner = await buildAndStartPerfOwner(
      config,
      agent,
      settings,
      version,
    );
    return { version, perfOwner };
  } catch (primaryError) {
    try {
      startup.providerKeys.close();
    } catch (closeError) {
      throw new AggregateError(
        [primaryError, closeError],
        'interactive startup failed and its key handle did not close',
      );
    }
    throw primaryError;
  }
}

/**
 * Builds the mouse/terminal teardown capabilities for a rollback path. Mouse
 * disable uses the raw disableMouseEvents (not the swallowing exit handler) so
 * a failure surfaces rather than being silently swallowed. Shared by the
 * render-failure and setup-failure rollback paths.
 */
function buildTerminalRollbackCapabilities(mouseEventsEnabled: boolean): {
  mouse: InteractiveMouseTeardown | null;
  restore: InteractiveTerminalRestore;
} {
  const mouse: InteractiveMouseTeardown | null = mouseEventsEnabled
    ? {
        disable: disableMouseEvents,
        removeListener: () => process.off('exit', mouseEventsExitHandler),
      }
    : null;
  const restore: InteractiveTerminalRestore = {
    restore: restoreTerminalProtocolsSync,
    removeListener: () => process.off('exit', restoreTerminalProtocolsSync),
  };
  return { mouse, restore };
}

/**
 * Injectable startup stage ports. Each port defaults to the real production
 * function; tests override individual stages to inject failures at meaningful
 * pre-render boundaries without mock-theater reimplementation. Narrow
 * package-private seam introduced for {@link commitInteractiveStartup}.
 */
export interface InteractiveStartupPorts {
  readonly renderOptions: typeof inkRenderOptions;
  readonly buildCommandPorts: typeof buildInteractiveUiPorts;
  readonly debugAppend: (line: string) => void;
  readonly setupTerminal: typeof setupTerminalExitHandlers;
  readonly isMouseEnabled: typeof isMouseEventsEnabled;
  readonly render: (
    node: React.ReactElement,
    options: ReturnType<typeof inkRenderOptions>,
  ) => InteractiveInstanceCapability;
  readonly registerSync: typeof registerSyncCleanup;
  readonly setupLifecycle: typeof setupInstanceLifecycle;
}

/**
 * Default production ports. `render` wraps the module-level `render` variable
 * (which `__setRenderForTesting` can override) so both the test seam and the
 * explicit port override work.
 */
const defaultStartupPorts: InteractiveStartupPorts = {
  renderOptions: inkRenderOptions,
  buildCommandPorts: buildInteractiveUiPorts,
  debugAppend: appendInteractiveUiDebug,
  setupTerminal: setupTerminalExitHandlers,
  isMouseEnabled: isMouseEventsEnabled,
  render: (node, options) => render(node, options),
  registerSync: registerSyncCleanup,
  setupLifecycle: setupInstanceLifecycle,
};

/**
 * Transaction state tracking staged resources for rollback. `mouseStaged` is
 * false until {@link setupTerminalExitHandlers} runs and mouse is confirmed
 * enabled; stages before mouse activation must NOT falsely disable unstaged
 * mouse. `instance` is undefined until render succeeds.
 */
interface StartupTransactionState {
  readonly owner: InteractiveOwnerCapability;
  mouseStaged: boolean;
  instance: InteractiveInstanceCapability | undefined;
}

/**
 * Arguments for {@link commitInteractiveStartup}. Every fallible stage after a
 * perf owner successfully starts runs inside this one transaction.
 */
export type CommitInteractiveStartupArgs = {
  readonly terminalHost: TerminalHost;
  readonly observation: ObservationCallbacks;
  readonly debugConfiguration: ConfigurationManager;
  readonly restartExtension?: (extension: LlxprtExtension) => Promise<void>;
  readonly skillOperations?: Pick<
    WorkspaceSkillOperations,
    'list' | 'find' | 'reload' | 'isAdminEnabled'
  >;
  readonly runtimeSettings: SessionSettingsOperations;
  readonly config: Config;
  readonly agent: Agent;
  readonly settings: LoadedSettings;
  readonly perfOwner: InteractivePerfRuntime | null;
  readonly providerKeys: InteractiveProviderKeys;
  readonly version: string;
  readonly startupWarnings: string[];
  readonly ports?: Partial<InteractiveStartupPorts>;
  readonly resumedBoot?: Pick<ResumeBootHandle, 'streamRows'>;
  readonly suppressStartupWelcome?: boolean;
} & (
  | {
      readonly recordingOwner: 'agent';
      readonly recordingIntegration?: never;
      readonly initialRecordingService?: never;
      readonly initialLockHandle?: never;
    }
  | {
      readonly recordingOwner?: 'raw';
      readonly recordingIntegration?: RecordingIntegration;
      readonly initialRecordingService?: SessionRecordingPort;
      readonly initialLockHandle?: LockHandle | null;
      readonly sessionPersistence?: CliSessionPersistencePort;
    }
);

/**
 * Runs every fallible stage after a perf owner successfully starts as ONE
 * transaction: inkRenderOptions, the command-port
 * build, debug append, terminal/mouse staging, render,
 * sync-cleanup registration, and setupInstanceLifecycle.
 *
 * On ANY failure the single transactional rollback: preserves the primary
 * failure first, atomically clears tracked host resources (so no later
 * cleanup double-disposes), independently disposes the owner, clears/unmounts
 * any produced instance, disables staged mouse state + removes the listener,
 * and restores terminal protocols + removes the listener. Stages before mouse
 * activation do NOT falsely disable unstaged mouse. Internal cleanup errors
 * aggregate after the primary failure via {@link rollbackInteractiveFailure}.
 *
 * No nested/double rollback — one explicit try/catch with transaction state.
 */
function composeUiBucketOperations(
  config: Config,
  oauth: Agent['authentication'],
): BucketFailoverRuntime {
  const readProviderName = () => config.getProvider() ?? '';
  return oauth.isAvailable()
    ? {
        resetBuckets: () => oauth.resetBuckets(readProviderName(), false),
        resetBucketSession: () => oauth.resetBuckets(readProviderName(), true),
        ensureBucketsAuthenticated: () =>
          oauth.ensureBucketsAuthenticated(readProviderName()),
        readFailoverBuckets: () =>
          oauth.readFailoverBuckets(readProviderName()),
        readCurrentBucket: () => oauth.getSessionBucket(readProviderName()),
      }
    : {};
}

/**
 * The one owner capability a published interactive instance carries: the perf
 * owner (when perf is enabled) is disposed first, then the key handle is
 * closed. Both steps always run; their errors surface together.
 */
function composeInstanceOwner(
  perfOwner: InteractiveOwnerCapability | null,
  providerKeys: InteractiveProviderKeys,
): InteractiveOwnerCapability {
  return {
    dispose: async () => {
      const errors: unknown[] = [];
      if (perfOwner !== null) {
        try {
          await perfOwner.dispose();
        } catch (err) {
          errors.push(err);
        }
      }
      try {
        providerKeys.close();
      } catch (err) {
        errors.push(err);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, 'interactive owner disposal failed');
      }
    },
  };
}

function startupBucketOperations(args: CommitInteractiveStartupArgs) {
  return composeUiBucketOperations(args.config, args.agent.authentication);
}

function startupCommandRuntimes(
  args: CommitInteractiveStartupArgs,
  ports: InteractiveStartupPorts,
  operations: ReturnType<typeof startupBucketOperations>,
) {
  const commandPorts = ports.buildCommandPorts({
    debug: bindDebugCommand(args.debugConfiguration),
    source: args.config,
    appOperations: args.agent,
    modelOperations: args.agent,
    fileOperations: args.agent,
    memoryOperations: args.agent,
    hookOperations: args.agent.hooks,
    mcpOperations: args.agent.mcp,
    settingOperations: args.agent,
    approvalOperations: args.agent,
    checkpoints: args.agent.workspace.checkpoints,
    readEphemeralSetting: args.agent.getEphemeralSetting.bind(args.agent),
    bucketFailover: operations,
    telemetrySettings: args.runtimeSettings,
    providerKeys: args.providerKeys,
    describeToolConfiguration: () => args.agent.tools.describeConfiguration(),
    restartExtension: args.restartExtension,
    skillOperations: args.skillOperations,
    sessionPersistence:
      args.recordingOwner === 'agent' ? undefined : args.sessionPersistence,
    perfSnapshotCapability: args.perfOwner?.snapshotCapability ?? null,
  });
  return { commandPorts };
}

export async function commitInteractiveStartup(
  args: CommitInteractiveStartupArgs,
): Promise<InteractiveInstanceCapability> {
  const ports: InteractiveStartupPorts = {
    ...defaultStartupPorts,
    ...args.ports,
  };
  const state: StartupTransactionState = {
    owner: composeInstanceOwner(args.perfOwner, args.providerKeys),
    mouseStaged: false,
    instance: undefined,
  };

  try {
    const renderOptions = ports.renderOptions(args.config, args.settings);
    const operations = startupBucketOperations(args);
    const { commandPorts } = startupCommandRuntimes(args, ports, operations);
    ports.debugAppend(
      `renderOptions alternateBuffer=${String(renderOptions.alternateBuffer)} incrementalRendering=${String(renderOptions.incrementalRendering)} stdoutColumns=${String(renderOptions.stdout?.columns)} stdoutRows=${String(renderOptions.stdout?.rows)}`,
    );
    // Compute mouseStaged BEFORE setupTerminal so a terminal-setup failure
    // correctly rolls back staged mouse. Stages before this point (render-
    // options, runtime, slash-runtime, debug) leave mouseStaged=false so
    // unstaged mouse is NOT falsely disabled.
    state.mouseStaged = ports.isMouseEnabled(renderOptions, args.settings);
    ports.setupTerminal(renderOptions, args.settings);

    state.instance = ports.render(
      renderInteractiveShell(
        <ObservationContext.Provider value={args.observation}>
          {buildRenderElement(
            commandPorts,
            args.agent,
            args.runtimeSettings,
            args.settings,
            args.startupWarnings,
            args.version,
            args.recordingIntegration,
            args.resumedBoot,
            args.initialRecordingService,
            args.initialLockHandle,
            args.suppressStartupWelcome,
            args.perfOwner,
            args.recordingOwner,
          )}
        </ObservationContext.Provider>,
        args.settings,
        new DebugLogger('llxprt:interactive', args.debugConfiguration),
      ),
      renderOptions,
    );

    // Sync-cleanup registration (guarded against duplicate registration).
    if (!args.terminalHost.syncCleanupRegistered) {
      ports.registerSync(restoreTerminalProtocolsSync);
      args.terminalHost.syncCleanupRegistered = true;
    }

    await ports.setupLifecycle(
      state.instance,
      args.settings,
      {
        projectRoot: args.config.getProjectRoot(),
        debugMode: args.config.getDebugMode(),
      },
      state.owner,
      args.terminalHost,
    );

    return state.instance;
  } catch (primaryError) {
    // Single transactional rollback. Atomically clear tracked host resources so
    // the registered global cleanup cannot double-dispose the same
    // instance/owner. Then tear down staged instance/owner/mouse/terminal
    // independently. The primary failure is preserved first; every cleanup
    // error aggregates behind it. Stages before mouse activation leave
    // mouseStaged=false so unstaged mouse is NOT falsely disabled.
    args.terminalHost.release();
    const { mouse, restore } = buildTerminalRollbackCapabilities(
      state.mouseStaged,
    );
    return rollbackInteractiveFailure(primaryError, {
      instance: state.instance,
      owner: state.owner,
      mouse,
      restore,
    });
  }
}

async function setupInstanceLifecycle(
  instance: InteractiveInstanceCapability,
  settings: LoadedSettings,
  runtimeScalars: { projectRoot: string; debugMode: boolean },
  owner: InteractiveOwnerCapability,
  terminalHost: TerminalHost,
): Promise<void> {
  checkForUpdates(settings)
    .then((info) => {
      handleAutoUpdate(info, settings, runtimeScalars.projectRoot);
    })
    .catch((err: unknown) => {
      // Silently ignore update check errors.
      if (runtimeScalars.debugMode) {
        debugLogger.error('Update check failed:', err);
      }
    });

  terminalHost.publish(instance, owner);
  if (!terminalHost.cleanupRegistered) {
    terminalHost.cleanupRegistered = true;
    registerCleanup(() => terminalHost.cleanup());
  }
}

async function initializeInteractivePresentation(
  workspaceRoot: string,
  settings: LoadedSettings,
  terminalHost: TerminalHost,
): Promise<string> {
  const version = await getCliVersion();

  appendInteractiveUiDebug(
    `startInteractiveUI version=${version} stdoutTTY=${String(process.stdout.isTTY)} columns=${String(process.stdout.columns)} rows=${String(process.stdout.rows)} builtinOnly=${String(process.env.LLXPRT_CODE_BUILTIN_COMMANDS_ONLY)} suppressStatic=${String(process.env.LLXPRT_CODE_SUPPRESS_STATIC_HEADER)}`,
  );
  setWindowTitle(basename(workspaceRoot), settings, terminalHost);

  return version;
}

function renderInteractiveShell(
  element: React.ReactElement,
  settings: LoadedSettings,
  logger: Pick<DebugLogger, 'error'>,
): React.ReactElement {
  const errorHandler = {
    handle(error: Error, info: ErrorInfo): void {
      handleError(error, info, logger);
    },
  };
  return (
    <React.StrictMode>
      <ErrorBoundary onError={errorHandler.handle}>
        <SettingsContext.Provider value={settings}>
          {element}
        </SettingsContext.Provider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

function bindApplicationOperations(
  agent: Pick<
    InteractiveApplicationInputs,
    | 'addHistory'
    | 'streamHistory'
    | 'stream'
    | 'injectSteer'
    | 'getProviderContextLimit'
    | 'dispose'
    | 'getApprovalMode'
    | 'setApprovalMode'
    | 'generate'
    | 'getModel'
    | 'getProvider'
    | 'getCurrentSequenceModel'
    | 'getActiveProfileName'
    | 'addDirectoryContext'
    | 'compress'
    | 'setProvider'
    | 'saveProfileSnapshot'
    | 'deleteProfileByName'
    | 'setDefaultProfileName'
    | 'listProviders'
    | 'session'
    | 'providerReads'
    | 'policy'
    | 'ide'
    | 'hooks'
    | 'auth'
    | 'sessionClient'
    | 'profiles'
    | 'workspace'
    | 'tools'
    | 'mcp'
    | 'tasks'
    | 'metrics'
  >,
) {
  return {
    addHistory: agent.addHistory.bind(agent),
    streamHistory: agent.streamHistory.bind(agent),
    stream: agent.stream.bind(agent),
    injectSteer: agent.injectSteer.bind(agent),
    getProviderContextLimit: agent.getProviderContextLimit.bind(agent),
    dispose: agent.dispose.bind(agent),
    getApprovalMode: agent.getApprovalMode.bind(agent),
    setApprovalMode: agent.setApprovalMode.bind(agent),
    generate: agent.generate.bind(agent),
    getModel: agent.getModel.bind(agent),
    getProvider: agent.getProvider.bind(agent),
    getCurrentSequenceModel: agent.getCurrentSequenceModel.bind(agent),
    getActiveProfileName: agent.getActiveProfileName.bind(agent),
    addDirectoryContext: agent.addDirectoryContext.bind(agent),
    compress: agent.compress.bind(agent),
    setProvider: agent.setProvider.bind(agent),
    saveProfileSnapshot: agent.saveProfileSnapshot.bind(agent),
    deleteProfileByName: agent.deleteProfileByName.bind(agent),
    setDefaultProfileName: agent.setDefaultProfileName.bind(agent),
    listProviders: agent.listProviders.bind(agent),
    session: agent.session,
    providerReads: agent.providerReads,
    policy: agent.policy,
    ide: agent.ide,
    hooks: agent.hooks,
    auth: agent.auth,
    sessionClient: agent.sessionClient,
    profiles: agent.profiles,
    workspace: agent.workspace,
    tools: agent.tools,
    mcp: agent.mcp,
    tasks: agent.tasks,
    metrics: agent.metrics,
  };
}

function bindJournalOperations(
  agent: Agent,
): Pick<
  InteractiveApplicationInputs,
  | 'readJournal'
  | 'subscribeContextRange'
  | 'openDumpSnapshot'
  | 'replaceHistoryFromSource'
  | 'resumeHistory'
> {
  return {
    readJournal: () => ({
      appendDisplay: agent.session.appendDisplay.bind(agent.session),
      length: agent.session.getJournalLength.bind(agent.session),
    }),
    subscribeContextRange: agent.session.subscribeContextRange.bind(
      agent.session,
    ),
    openDumpSnapshot: agent.session.openDumpSnapshot.bind(agent.session),
    replaceHistoryFromSource: agent.session.replaceHistoryFromSource.bind(
      agent.session,
    ),
    resumeHistory: {
      adoptResumeBoot: agent.session.adoptResumeBoot.bind(agent.session),
      attachRecording: agent.session.attachRecording.bind(agent.session),
    },
  };
}
