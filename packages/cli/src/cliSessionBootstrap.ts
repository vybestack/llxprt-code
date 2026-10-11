import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';
import {
  SessionSettingsOwner,
  type RuntimePolicyOwner,
  type RuntimeProviderManager,
  type Config,
  type AgentClientContract,
  SessionRecordingService,
  RecordingIntegration,
  SessionDiscovery,
  SessionTransitionService,
  resumeSession,
  listSessions,
  deleteSession,
  writeToStdout,
  writeToStderr,
  getProjectHash,
  CONTINUE_LATEST,
  type ContinueTarget,
  type IContent,
  type LockHandle,
  clientMediaStore,
} from '@vybestack/llxprt-code-core';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Agent,
  AgentActivationOperation,
  AgentProfileApplication,
} from '@vybestack/llxprt-code-agents';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-providers/runtime/providerSwitch.js';

import {
  buildMcpAuthFactoryRegistry,
  type McpAuthProviderFactory,
} from '@vybestack/llxprt-code-mcp/auth/mcp-auth-factory.js';
import { loadCliConfig } from './config/config.js';
import chalk from 'chalk';
import type { LoadedSettings } from './config/settings.js';
import { sessionId, debugLogger } from '@vybestack/llxprt-code-telemetry';
import { CliSessionPersistence } from './cliSessionPersistence.js';
import {
  classifyContinueRef,
  describeUnreadableRecordings,
  recordStartupWarning,
  warnSkippedRecordings,
} from './startupResumeWarnings.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ExtensionStorage, loadExtensions } from './config/extension.js';
import { registerCleanup, runExitCleanup } from './utils/cleanup.js';
import { promises as fsPromises } from 'fs';
import { basename, join } from 'path';
import { ExtensionEnablementManager } from './config/extensions/extensionEnablement.js';
import type { ParsedCliArgs } from './cliBootstrap.js';
import {
  initializeObservationProducer,
  stopObservationProducer,
  type BootstrapSelection,
} from './observation/jspWiring.js';

/** Format a single recorded-session summary line for --list-sessions output. */
export function formatSessionSummaryLine(
  session: Awaited<ReturnType<typeof listSessions>>['sessions'][number],
  index: number,
): string {
  const modified = session.lastModified.toLocaleString();
  const sizeKb = (session.fileSize / 1024).toFixed(1);
  return `  ${index + 1}. ${session.sessionId.slice(0, 8)}  ${modified}  ${sizeKb} KB  ${session.provider}/${session.model}`;
}

/** Handle session flags before starting or resuming a recording. */
export async function handleSessionListAndDelete(
  argv: Pick<ParsedCliArgs, 'listSessions' | 'deleteSession'>,
  chatsDir: string,
  projectHash: string,
  config: Config,
): Promise<void> {
  const deleteRef = argv.deleteSession;
  const shouldDelete = typeof deleteRef === 'string' && deleteRef.length > 0;
  if (argv.listSessions !== true && !shouldDelete) return;

  let exitCode = 0;
  try {
    await fsPromises.mkdir(chatsDir, { recursive: true });
    if (argv.listSessions === true) {
      const { sessions } = await listSessions(chatsDir, projectHash);
      if (sessions.length === 0) {
        writeToStdout('No recorded sessions for this project.\n');
      } else {
        writeToStdout(`Sessions for this project (${sessions.length}):\n`);
        sessions.forEach((session, i) => {
          writeToStdout(`${formatSessionSummaryLine(session, i)}\n`);
        });
      }
    } else if (shouldDelete) {
      const result = await deleteSession(deleteRef, chatsDir, projectHash);
      if (result.ok) {
        writeToStdout(
          `${chalk.green(`Deleted session ${result.deletedSessionId.slice(0, 8)}`)}\n`,
        );
      } else {
        writeToStderr(`${chalk.red(result.error)}\n`);
        exitCode = 1;
      }
    }
  } finally {
    registerCleanup(() => config.dispose());
    await runExitCleanup();
  }
  process.exit(exitCode);
}

type RecordingClientOwner = {
  getAgentClient(): AgentClientContract;
  workspaceDirectories(): readonly string[];
};

export interface ResolvedRecording {
  recordingService: SessionRecordingService;
  resumedHistory: IContent[] | null;
  resumedLockHandle: LockHandle | null;
  /** The resumed session's ID, or null for new/fallback sessions. */
  resumedSessionId: string | null;
  /**
   * Plain-text warnings raised while resuming (unreadable recordings skipped,
   * resume failures, history-restore fallback). The caller surfaces them to the
   * user; they must not depend on debug logging being enabled.
   */
  startupWarnings: string[];
}

export interface SessionRecordingSetup extends ResolvedRecording {
  recordingIntegration: RecordingIntegration;
  sessionPersistence: CliSessionPersistence;
}

export interface RuntimeConfigBootstrap {
  readonly oauthManager?: OAuthManager;
  readonly providerFileLifecycle: ProviderFileLifecycle;
  readonly policyOwner?: RuntimePolicyOwner;
  readonly providerManager: RuntimeProviderManager;
  /** The installed provider contributions loaded once for this CLI process. */
  readonly providerContributions: ProviderContributionRegistry;
  getMcpAuthProviderFactory: (
    type: string,
  ) => McpAuthProviderFactory | undefined;
  activationOperation: AgentActivationOperation;
  switchProvider: ProviderSwitcher;
  profileApplication: AgentProfileApplication;
  config: Config;
  extensions: ReturnType<typeof loadExtensions>;
  runtimeSettingsService: SettingsService;
  runtimeSettingsOwner: SessionSettingsOwner;
}

/**
 * @plan:PLAN-20250218-STATELESSPROVIDER.P06
 * @requirement:REQ-SP-005
 * @plan:PLAN-20270110-ISSUE2378.P02
 * @requirement:REQ-2378-002
 * Seed the CLI runtime context with a scoped SettingsService, load extensions,
 * construct Config, and re-seed the runtime context post-config with a
 * ProfileManager. Per #2378 this NO LONGER constructs the session MessageBus —
 * agent construction (fromConfig/createForegroundAgent) now owns the single
 * session bus (built from the Config's policy engine) and exposes it via
 * agent.getMessageBus(); Config.initialize() likewise runs behind agent
 * construction rather than here.
 */
function requireCliProviderFiles(
  files: ProviderFileLifecycle | undefined,
): ProviderFileLifecycle {
  if (files === undefined)
    throw new Error('CLI provider files were not assembled');
  return files;
}

function loadBootstrapExtensions(
  selected: ConstructorParameters<typeof ExtensionEnablementManager>[1],
  workspaceRoot: string,
) {
  const extensionEnablementManager = new ExtensionEnablementManager(
    ExtensionStorage.getUserExtensionsDir(),
    selected,
  );
  return {
    extensionEnablementManager,
    extensions: loadExtensions(extensionEnablementManager, workspaceRoot),
  };
}

function requireAssembled<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`CLI ${what} was not assembled.`);
  return value;
}

export async function bootstrapRuntimeAndConfig(
  settings: LoadedSettings,
  argv: ParsedCliArgs,
  workspaceRoot: string,
): Promise<RuntimeConfigBootstrap> {
  const runtimeSettingsService = new SettingsService();
  const runtimeSettingsOwner = new SessionSettingsOwner(runtimeSettingsService);

  const { extensionEnablementManager, extensions } = loadBootstrapExtensions(
    argv.extensions,
    workspaceRoot,
  );

  // Discover installed provider plugins once, before any provider manager is
  // constructed, so alias construction can dispatch through the resulting
  // registry (issue #2758). Installing a package is what makes a provider
  // available; there is nothing to configure. A broken plugin fails startup
  // here rather than being skipped.
  const { providerContributions, authFactories } =
    await discoverCliProviderContributions();

  let oauthManager: OAuthManager | undefined;
  let providerFileLifecycle: ProviderFileLifecycle | undefined;
  let policyOwner: RuntimePolicyOwner | undefined;
  let providerManager: RuntimeProviderManager | undefined;
  let activationOperation: AgentActivationOperation | undefined;
  let profileApplication: AgentProfileApplication | undefined;
  let switchProvider: ProviderSwitcher | undefined;
  try {
    const config = await loadCliConfig(
      settings.merged,
      extensions,
      extensionEnablementManager,
      sessionId,
      argv,
      workspaceRoot,
      {
        settingsService: runtimeSettingsService,
        sessionSettingsOwner: runtimeSettingsOwner,
        providerContributions,
        onRuntimeRegistrationReady: (registration) => {
          registerCleanup(() => registration.dispose());
        },
        onPolicyOwnerReady: (owner) => (policyOwner = ownCliPolicy(owner)),
        onOAuthManagerReady: (manager) => (oauthManager = manager),
        onProviderFilesReady: (lifecycle) =>
          (providerFileLifecycle = lifecycle),
        onProviderManagerReady: (manager) => (providerManager = manager),
        onActivationBootstrapReady: (operation) => {
          activationOperation = operation;
          registerCleanup(() => operation.dispose());
        },
        onProfileApplicationReady: (operation) => {
          profileApplication = operation;
        },
        onProviderSwitchReady: (operation) => {
          switchProvider = operation;
        },
      },
    );
    return {
      oauthManager,
      providerFileLifecycle: requireCliProviderFiles(providerFileLifecycle),
      providerManager: requireAssembled(providerManager, 'provider manager'),
      providerContributions,
      policyOwner,
      getMcpAuthProviderFactory: (type) =>
        authFactories.getAuthProviderFactory(type),
      config,
      extensions,
      runtimeSettingsService,
      runtimeSettingsOwner,
      switchProvider: requireAssembled(switchProvider, 'provider switch'),
      profileApplication: requireAssembled(
        profileApplication,
        'profile application',
      ),
      activationOperation: requireAssembled(
        activationOperation,
        'activation bootstrap',
      ),
    };
  } catch (error) {
    await activationOperation?.dispose();
    throw error;
  }
}

/**
 * Release resumed recording and lock after a failed restoreHistory. Each
 * step is independently caught so cleanup failures never prevent the
 * fresh-session fallback (issue #1873).
 */
async function releaseResumedResources(
  recordingService: SessionRecordingService,
  lockHandle: LockHandle | null,
): Promise<void> {
  try {
    await recordingService.dispose();
  } catch (err) {
    debugLogger.warn(
      chalk.yellow(
        `Failed to dispose resumed recording during fallback: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );
  }
  try {
    await lockHandle?.release();
  } catch (err) {
    debugLogger.warn(
      chalk.yellow(
        `Failed to release session lock during fallback: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );
  }
}

/**
 * @plan:PLAN-20260211-SESSIONRECORDING.P26
 * @pseudocode recording-integration.md lines 115-132
 *
 * Wire observation from the already-consumed bootstrap selection. The
 * selection (and its env scrub) happened immediately after argument parsing in
 * the CLI entry point; this only performs the deferred fail-fast file
 * validation and producer construction. Exported so AC15 coverage can drive
 * the real cliSessionBootstrap → observation seam without the full
 * recording-suite weight.
 */
export function setupObservation(
  config: Config,
  selection: BootstrapSelection | null,
): void {
  const projectRoot = config.getProjectRoot();
  // loadBootstrap disables observation (one stderr warning, startup continues)
  // when the bootstrap file cannot be read, but still fails fast
  // (FatalConfigError, exit 52) on a file that reads but is malformed,
  // insecure, or version-mismatched. Recording cleanup is registered above,
  // so the process exits cleanly on either path.
  initializeObservationProducer(
    {
      repository: basename(projectRoot),
      path: projectRoot,
      agentKind: 'llxprt',
      displayName: basename(projectRoot),
    },
    selection,
  );
}

function registerRecordingCleanup(
  recordingIntegration: RecordingIntegration,
  recordingService: SessionRecordingService,
  lockHandle: LockHandle | null,
  sessionPersistence: CliSessionPersistence,
): void {
  registerCleanup(async () => {
    const failures: unknown[] = [];
    for (const operation of [
      () => stopObservationProducer(),
      () => recordingIntegration.dispose(),
      () => recordingService.dispose(),
      () => lockHandle?.release() ?? Promise.resolve(),
      () => Promise.resolve(sessionPersistence.close()),
    ]) {
      try {
        await operation();
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Session recording cleanup failed');
    }
  });
}

function activateRecording(
  config: Config,
  recordingService: SessionRecordingService,
  lockHandle: LockHandle | null,
  bootstrapSelection: BootstrapSelection | null,
  sessionPersistence: CliSessionPersistence,
): RecordingIntegration {
  const integration = new RecordingIntegration(
    recordingService,
    sessionPersistence.forRecording(recordingService.getSessionId()),
  );
  registerRecordingCleanup(
    integration,
    recordingService,
    lockHandle,
    sessionPersistence,
  );
  setupObservation(config, bootstrapSelection);
  return integration;
}

function createCliSessionPersistence(
  config: Config,
  sessionClient: RecordingClientOwner,
): CliSessionPersistence {
  return new CliSessionPersistence(
    { projectRoot: config.storageRoot, chatsDir: config.projectChatsDir },
    {
      mediaStore: clientMediaStore(sessionClient.getAgentClient()),
      maxQueueBytes: config.getSessionPersistenceQueueByteLimit(),
    },
  );
}

async function prepareLegacyRecording(
  config: Config,
  argv: Pick<ParsedCliArgs, 'listSessions' | 'deleteSession'>,
  sessionClient: RecordingClientOwner,
): Promise<
  ResolvedRecording & {
    projectHash: string;
    chatsDir: string;
    sessionPersistence: CliSessionPersistence;
  }
> {
  const projectHash = getProjectHash(config.getProjectRoot());
  const chatsDir = join(config.getProjectTempDir(), 'chats');
  // --list-sessions / --delete-session: handle early exits.
  await handleSessionListAndDelete(argv, chatsDir, projectHash, config);
  await fsPromises.mkdir(chatsDir, { recursive: true });
  const sessionPersistence = createCliSessionPersistence(config, sessionClient);
  const recording = await createOrResumeRecording(
    config,
    projectHash,
    chatsDir,
    sessionClient,
  );
  return { ...recording, projectHash, chatsDir, sessionPersistence };
}

export async function setupSessionRecording(
  config: Config,
  argv: Pick<ParsedCliArgs, 'listSessions' | 'deleteSession'>,
  bootstrapSelection: BootstrapSelection | null,
  sessionClient: RecordingClientOwner,
): Promise<SessionRecordingSetup> {
  const {
    projectHash,
    chatsDir,
    sessionPersistence,
    recordingService,
    resumedHistory,
    resumedLockHandle,
    resumedSessionId,
    startupWarnings,
  } = await prepareLegacyRecording(config, argv, sessionClient);
  let activeRecordingService = recordingService;
  let activeLockHandle = resumedLockHandle;
  let didFallback = false;

  if (resumedHistory && resumedHistory.length > 0) {
    const agentClient = sessionClient.getAgentClient();
    try {
      await agentClient.restoreHistory(resumedHistory);
      // Adoption happens here — AFTER a successful restoreHistory — so a
      // corrupted session's ID is never adopted. TodoStore and other
      // session-scoped services see only a successfully-resumed session ID.
      if (resumedSessionId !== null) {
        config.adoptSessionId(resumedSessionId);
      }
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      recordStartupWarning(
        startupWarnings,
        `Could not restore conversation history (session ${resumedSessionId ?? 'unknown'}): ${messageText}. ` +
          'Falling back to a new session.',
      );
      // Release resources FIRST so cleanup runs even if resetChat or
      // buildNewRecordingService throw (issue #1873).
      await releaseResumedResources(recordingService, resumedLockHandle);
      // restoreHistory is not atomic — it may have partially populated the
      // AgentClient's history before throwing. Reset so no half-restored
      // items persist into the fresh session.
      try {
        await agentClient.resetChat();
      } catch (resetErr) {
        debugLogger.warn(
          chalk.yellow(
            `Failed to reset chat after restoreHistory failure: ${
              resetErr instanceof Error ? resetErr.message : String(resetErr)
            }`,
          ),
        );
      }
      // Rebuild the configured session recording after the failed resume.
      // Lock acquisition and file materialization remain fail-fast.
      activeRecordingService = await buildFallbackRecording(
        config,
        projectHash,
        chatsDir,
        sessionClient,
      );
      activeLockHandle = null;
      didFallback = true;
    }
  } else if (resumedSessionId !== null) {
    // Resume succeeded with no restorable content — still adopt the session ID
    // so future events append to the resumed session's file.
    config.adoptSessionId(resumedSessionId);
  }

  // Register cleanup before observation setup. An explicitly invalid bootstrap
  // is meant to fail startup, but it must not strand the recording service or
  // the already-acquired lock handle on the way out.
  const recordingIntegration = activateRecording(
    config,
    activeRecordingService,
    activeLockHandle,
    bootstrapSelection,
    sessionPersistence,
  );

  return {
    recordingService: activeRecordingService,
    recordingIntegration,
    sessionPersistence,
    resumedHistory: didFallback ? null : resumedHistory,
    resumedLockHandle: activeLockHandle,
    resumedSessionId: didFallback ? null : resumedSessionId,
    startupWarnings,
  };
}

async function resumeOwnerRecording(
  session: Agent['session'],
  mediaStore: ReturnType<typeof clientMediaStore>,
  continueRef: string,
  location: { chatsDir: string; projectHash: string },
  startupWarnings: string[],
): Promise<IContent[] | null> {
  // Discovery here only classifies the reference against unreadable recordings
  // so they can be reported to the user; the owner performs the actual resume.
  const { targets, unreadableRecordings } =
    await SessionDiscovery.listContinueTargetsDetailed(
      location.chatsDir,
      location.projectHash,
      mediaStore,
    );
  const { resumeRef, namedUnreadable } = classifyContinueRef(
    continueRef,
    targets,
    unreadableRecordings,
  );
  warnSkippedRecordings(
    unreadableRecordings.filter(
      (recording) => !namedUnreadable.includes(recording),
    ),
    startupWarnings,
  );
  if (namedUnreadable.length > 0) {
    recordStartupWarning(
      startupWarnings,
      `Could not resume session (ref: ${continueRef}): the recording is unreadable:\n` +
        describeUnreadableRecordings(namedUnreadable),
    );
    await session.setRecording({ enabled: true });
    return null;
  }
  let resumed: readonly IContent[];
  try {
    resumed = await session.resume(
      resumeRef === CONTINUE_LATEST ? 'latest' : resumeRef,
    );
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error.message.includes('Ambiguous continue target name') ||
        error.message.startsWith('Cannot adopt recording session '))
    ) {
      throw error;
    }
    recordStartupWarning(
      startupWarnings,
      `Could not resume session (ref: ${continueRef}): ${
        error instanceof Error ? error.message : String(error)
      }. Falling back to a new session.`,
    );
    await session.setRecording({ enabled: true });
    return null;
  }
  return [...resumed];
}

export async function setupOwnerSessionRecording(
  config: Config,
  agent: Agent,
  argv: Pick<ParsedCliArgs, 'listSessions' | 'deleteSession'>,
  bootstrapSelection: BootstrapSelection | null,
  startupWarnings: string[] = [],
): Promise<IContent[] | null> {
  const projectHash = getProjectHash(config.getProjectRoot());
  const chatsDir = config.projectChatsDir;
  await handleSessionListAndDelete(argv, chatsDir, projectHash, config);
  await fsPromises.mkdir(chatsDir, { recursive: true });

  try {
    const continueRef = config.getContinueSessionRef();
    let history: IContent[] | null;
    if (continueRef) {
      history = await resumeOwnerRecording(
        agent.session,
        clientMediaStore(agent.agentClient),
        continueRef,
        { chatsDir, projectHash },
        startupWarnings,
      );
    } else {
      await agent.session.setRecording({ enabled: true });
      history = null;
    }

    registerCleanup(() => stopObservationProducer());
    setupObservation(config, bootstrapSelection);
    return history;
  } catch (error: unknown) {
    if (agent.session.getRecording().enabled) {
      try {
        await agent.session.setRecording({ enabled: false });
      } catch (cleanupError: unknown) {
        throw new AggregateError(
          [error, cleanupError],
          'Recording bootstrap and cleanup failed',
        );
      }
    }
    throw error;
  }
}

/** Build and lock a fresh SessionRecordingService for the current run. */
export function buildNewRecordingService(
  config: Config,
  projectHash: string,
  chatsDir: string,
  sessionClient: RecordingClientOwner,
): Promise<SessionRecordingService> {
  return SessionRecordingService.createLocked({
    sessionId: config.getSessionId(),
    projectHash,
    chatsDir,
    workspaceDirs: [...sessionClient.workspaceDirectories()],
    provider: config.getProvider() ?? 'unknown',
    model: config.getModel(),
    // The provider can change (profile load, model picker) before the first
    // message materializes the file, so the header reads the live Config then.
    resolveProviderModel: () => ({
      provider: config.getProvider() ?? 'unknown',
      model: config.getModel(),
    }),
    mediaStore: clientMediaStore(sessionClient.getAgentClient()),
    maxQueueBytes: config.getSessionRecordingQueueByteLimit(),
  });
}

function startupCheckpointTarget(
  continueRef: string,
  targets: readonly ContinueTarget[],
): Extract<ContinueTarget, { kind: 'checkpoint' }> | null {
  const resolved = SessionDiscovery.resolveContinueRef(continueRef, targets);
  if ('error' in resolved) {
    const matchesCheckpoint = targets.some(
      (target) =>
        target.kind === 'checkpoint' &&
        (target.checkpointId === continueRef ||
          target.checkpointName === continueRef),
    );
    if (matchesCheckpoint) throw new Error(resolved.error);
    return null;
  }
  if (resolved.target.kind !== 'checkpoint') return null;
  return resolved.target;
}

async function forkStartupCheckpoint(
  target: Extract<ContinueTarget, { kind: 'checkpoint' }>,
  config: Config,
  projectHash: string,
  chatsDir: string,
  sessionClient: RecordingClientOwner,
): Promise<ResolvedRecording> {
  const result = await new SessionTransitionService({
    mediaStore: clientMediaStore(sessionClient.getAgentClient()),
    maxQueueBytes: config.getSessionRecordingQueueByteLimit(),
  }).forkFromCheckpoint(
    target,
    chatsDir,
    projectHash,
    config.getProvider() ?? 'unknown',
    config.getModel(),
    [...sessionClient.workspaceDirectories()],
  );
  if (!result.ok) {
    throw new Error(`Failed to fork checkpoint: ${result.error}`);
  }
  return {
    recordingService: result.recording,
    resumedHistory: result.history,
    resumedLockHandle: result.lockHandle,
    resumedSessionId: result.metadata.sessionId,
    startupWarnings: [],
  };
}

async function freshSessionRecording(
  config: Config,
  projectHash: string,
  chatsDir: string,
  sessionClient: RecordingClientOwner,
  startupWarnings: string[],
): Promise<ResolvedRecording> {
  return {
    recordingService: await buildNewRecordingService(
      config,
      projectHash,
      chatsDir,
      sessionClient,
    ),
    resumedHistory: null,
    resumedLockHandle: null,
    resumedSessionId: null,
    startupWarnings,
  };
}

/** Resume the readable session a startup --continue reference resolved to. */
async function resumeReadableSession(
  config: Config,
  projectHash: string,
  chatsDir: string,
  sessionClient: RecordingClientOwner,
  refs: { continueRef: string; resumeRef: string },
  startupWarnings: string[],
): Promise<ResolvedRecording> {
  const resumeResult = await resumeSession({
    continueRef: refs.resumeRef,
    projectHash,
    chatsDir,
    currentProvider: config.getProvider() ?? 'unknown',
    currentModel: config.getModel(),
    workspaceDirs: [...sessionClient.workspaceDirectories()],
    mediaStore: clientMediaStore(sessionClient.getAgentClient()),
    maxQueueBytes: config.getSessionRecordingQueueByteLimit(),
  });

  if (!resumeResult.ok) {
    recordStartupWarning(
      startupWarnings,
      `Could not resume session (ref: ${refs.continueRef}): ${resumeResult.error}`,
    );
    return freshSessionRecording(
      config,
      projectHash,
      chatsDir,
      sessionClient,
      startupWarnings,
    );
  }

  for (const warning of resumeResult.warnings) {
    recordStartupWarning(startupWarnings, warning);
  }
  return {
    recordingService: resumeResult.recording,
    resumedHistory: resumeResult.history,
    resumedLockHandle: resumeResult.lockHandle,
    resumedSessionId: resumeResult.metadata.sessionId,
    startupWarnings,
  };
}

async function buildFallbackRecording(
  config: Config,
  projectHash: string,
  chatsDir: string,
  sessionClient: RecordingClientOwner,
): Promise<SessionRecordingService> {
  try {
    return await buildNewRecordingService(
      config,
      projectHash,
      chatsDir,
      sessionClient,
    );
  } catch (error) {
    throw new Error(
      `Failed to create fallback recording service: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function ownCliPolicy(owner: RuntimePolicyOwner): RuntimePolicyOwner {
  registerCleanup(() => owner.dispose());
  return owner;
}

async function discoverCliProviderContributions() {
  const { loadInstalledRuntimePlugins } = await import(
    '@vybestack/llxprt-code-providers/composition.js'
  );
  const providerContributions = await loadInstalledRuntimePlugins();
  const authFactories = buildMcpAuthFactoryRegistry(
    providerContributions
      .getMcpAuthFactories()
      .map((entry) => entry.contribution),
  );

  return { providerContributions, authFactories };
}

/**
 * Resume a recording session if --continue was supplied, otherwise create a
 * new one. Falls back to a new session when resume fails. Recordings that
 * cannot be replayed never block healthy sessions; they are reported in one
 * warning (or, when the reference names one, in the resume failure warning).
 */
export async function createOrResumeRecording(
  config: Config,
  projectHash: string,
  chatsDir: string,
  sessionClient: RecordingClientOwner,
): Promise<ResolvedRecording> {
  const continueRef = config.getContinueSessionRef();
  if (!continueRef) {
    return freshSessionRecording(
      config,
      projectHash,
      chatsDir,
      sessionClient,
      [],
    );
  }
  const startupWarnings: string[] = [];

  const { targets, unreadableRecordings } =
    await SessionDiscovery.listContinueTargetsDetailed(
      chatsDir,
      projectHash,
      clientMediaStore(sessionClient.getAgentClient()),
    );
  const { resumeRef, namedUnreadable } = classifyContinueRef(
    continueRef,
    targets,
    unreadableRecordings,
  );
  warnSkippedRecordings(
    unreadableRecordings.filter(
      (recording) => !namedUnreadable.includes(recording),
    ),
    startupWarnings,
  );
  if (namedUnreadable.length > 0) {
    recordStartupWarning(
      startupWarnings,
      `Could not resume session (ref: ${continueRef}): the recording is unreadable:\n` +
        describeUnreadableRecordings(namedUnreadable),
    );
    return freshSessionRecording(
      config,
      projectHash,
      chatsDir,
      sessionClient,
      startupWarnings,
    );
  }

  const checkpointTarget = startupCheckpointTarget(continueRef, targets);
  if (checkpointTarget !== null) {
    const forked = await forkStartupCheckpoint(
      checkpointTarget,
      config,
      projectHash,
      chatsDir,
      sessionClient,
    );
    return { ...forked, startupWarnings };
  }

  return resumeReadableSession(
    config,
    projectHash,
    chatsDir,
    sessionClient,
    { continueRef, resumeRef },
    startupWarnings,
  );
}
