/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { loadCliConfig } from './config/config.js';
import chalk from 'chalk';
import type { LoadedSettings } from './config/settings.js';
import {
  type Config,
  SessionRecordingService,
  RecordingIntegration,
  SessionDiscovery,
  SessionTransitionService,
  resumeSession,
  listSessions,
  deleteSession,
  getProjectHash,
  type ContinueTarget,
  type IContent,
  type LockHandle,
} from '@vybestack/llxprt-code-core';
import { sessionId, debugLogger } from '@vybestack/llxprt-code-telemetry';
import {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import { ExtensionStorage, loadExtensions } from './config/extension.js';
import { registerCleanup } from './utils/cleanup.js';
import { setCliRuntimeContext } from '@vybestack/llxprt-code-providers/runtime.js';
import { promises as fsPromises } from 'fs';
import { basename, join } from 'path';
import { ExtensionEnablementManager } from './config/extensions/extensionEnablement.js';
import { resolveForegroundRuntimeId } from './config/profileBootstrap.js';
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

/**
 * Handle the --list-sessions and --delete-session flags. Both perform their
 * own process.exit, so this returns only when neither flag was supplied.
 */
export async function handleSessionListAndDelete(
  argv: ParsedCliArgs,
  chatsDir: string,
  projectHash: string,
): Promise<void> {
  if (argv.listSessions === true) {
    const { sessions } = await listSessions(chatsDir, projectHash);
    if (sessions.length === 0) {
      debugLogger.log('No recorded sessions for this project.');
    } else {
      debugLogger.log(`Sessions for this project (${sessions.length}):
`);
      sessions.forEach((session, i) => {
        debugLogger.log(formatSessionSummaryLine(session, i));
      });
    }
    process.exit(0);
  }

  // Preserve old empty-string falsy behavior: only process non-empty strings
  if (typeof argv.deleteSession === 'string' && argv.deleteSession.length > 0) {
    const result = await deleteSession(
      argv.deleteSession,
      chatsDir,
      projectHash,
    );
    if (result.ok) {
      debugLogger.log(
        chalk.green(`Deleted session ${result.deletedSessionId.slice(0, 8)}`),
      );
      process.exit(0);
    }
    debugLogger.error(chalk.red(result.error));
    process.exit(1);
  }
}

export interface ResolvedRecording {
  recordingService: SessionRecordingService;
  resumedHistory: IContent[] | null;
  resumedLockHandle: LockHandle | null;
  /** The resumed session's ID, or null for new/fallback sessions. */
  resumedSessionId: string | null;
}

export interface SessionRecordingSetup extends ResolvedRecording {
  recordingIntegration: RecordingIntegration;
}

export interface RuntimeConfigBootstrap {
  config: Config;
  extensions: ReturnType<typeof loadExtensions>;
  runtimeSettingsService: SettingsService;
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
export async function bootstrapRuntimeAndConfig(
  settings: LoadedSettings,
  argv: ParsedCliArgs,
  workspaceRoot: string,
): Promise<RuntimeConfigBootstrap> {
  // Single source of truth for the foreground runtime id — the same id
  // prepareRuntimeForProfile() uses inside loadCliConfig — so the write-once
  // default pointer is claimed idempotently across every bootstrap phase
  // (issue #2300).
  const runtimeId = resolveForegroundRuntimeId();
  const runtimeSettingsService = new SettingsService();
  setCliRuntimeContext(runtimeSettingsService, undefined, {
    runtimeId,
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
    runtimeId,
    metadata: { source: 'cli-bootstrap', stage: 'post-config' },
    profileManager,
  });

  return { config, extensions, runtimeSettingsService };
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
): void {
  registerCleanup(async () => {
    // Observation is ancillary; a failed telemetry shutdown must not skip
    // recording disposal or lock release.
    try {
      await stopObservationProducer();
    } catch {
      // Telemetry-only failure.
    }
    recordingIntegration.dispose();
    try {
      await recordingService.dispose();
    } finally {
      await lockHandle?.release();
    }
  });
}

export async function setupSessionRecording(
  config: Config,
  argv: ParsedCliArgs,
  bootstrapSelection: BootstrapSelection | null,
): Promise<SessionRecordingSetup> {
  const projectHash = getProjectHash(config.getProjectRoot());
  const chatsDir = join(config.getProjectTempDir(), 'chats');
  await fsPromises.mkdir(chatsDir, { recursive: true });

  // --list-sessions / --delete-session: handle early exits.
  await handleSessionListAndDelete(argv, chatsDir, projectHash);

  const {
    recordingService,
    resumedHistory,
    resumedLockHandle,
    resumedSessionId,
  } = await createOrResumeRecording(config, projectHash, chatsDir);

  let activeRecordingService = recordingService;
  let activeLockHandle = resumedLockHandle;
  let didFallback = false;

  if (resumedHistory && resumedHistory.length > 0) {
    const agentClient = config.getAgentClient();
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
      debugLogger.warn(
        chalk.yellow(
          `Could not restore conversation history (session ${resumedSessionId ?? 'unknown'}): ${messageText}. ` +
            'Falling back to a new session.',
        ),
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
      try {
        activeRecordingService = await buildNewRecordingService(
          config,
          projectHash,
          chatsDir,
        );
      } catch (buildErr) {
        throw new Error(
          `Failed to create fallback recording service: ${
            buildErr instanceof Error ? buildErr.message : String(buildErr)
          }`,
        );
      }
      activeLockHandle = null;
      didFallback = true;
    }
  } else if (resumedSessionId !== null) {
    // Resume succeeded with no restorable content — still adopt the session ID
    // so future events append to the resumed session's file.
    config.adoptSessionId(resumedSessionId);
  }

  const recordingIntegration = new RecordingIntegration(activeRecordingService);
  // Register cleanup before observation setup. An explicitly invalid bootstrap
  // is meant to fail startup, but it must not strand the recording service or
  // the already-acquired lock handle on the way out.
  registerRecordingCleanup(
    recordingIntegration,
    activeRecordingService,
    activeLockHandle,
  );
  setupObservation(config, bootstrapSelection);

  return {
    recordingService: activeRecordingService,
    recordingIntegration,
    resumedHistory: didFallback ? null : resumedHistory,
    resumedLockHandle: activeLockHandle,
    resumedSessionId: didFallback ? null : resumedSessionId,
  };
}

/** Build and lock a fresh SessionRecordingService for the current run. */
export function buildNewRecordingService(
  config: Config,
  projectHash: string,
  chatsDir: string,
): Promise<SessionRecordingService> {
  return SessionRecordingService.createLocked({
    sessionId: config.getSessionId(),
    projectHash,
    chatsDir,
    workspaceDirs: [...config.getWorkspaceContext().getDirectories()],
    provider: config.getProvider() ?? 'unknown',
    model: config.getModel(),
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
): Promise<ResolvedRecording> {
  const result = await new SessionTransitionService().forkFromCheckpoint(
    target,
    chatsDir,
    projectHash,
    config.getProvider() ?? 'unknown',
    config.getModel(),
    [...config.getWorkspaceContext().getDirectories()],
  );
  if (!result.ok) {
    throw new Error(`Failed to fork checkpoint: ${result.error}`);
  }
  return {
    recordingService: result.recording,
    resumedHistory: result.history,
    resumedLockHandle: result.lockHandle,
    resumedSessionId: result.metadata.sessionId,
  };
}

/**
 * Resume a recording session if --continue was supplied, otherwise create a
 * new one. Falls back to a new session when resume fails.
 */
export async function createOrResumeRecording(
  config: Config,
  projectHash: string,
  chatsDir: string,
): Promise<ResolvedRecording> {
  const continueRef = config.getContinueSessionRef();
  if (!continueRef) {
    return {
      recordingService: await buildNewRecordingService(
        config,
        projectHash,
        chatsDir,
      ),
      resumedHistory: null,
      resumedLockHandle: null,
      resumedSessionId: null,
    };
  }

  const targets = await SessionDiscovery.listContinueTargets(
    chatsDir,
    projectHash,
  );
  const checkpointTarget = startupCheckpointTarget(continueRef, targets);
  if (checkpointTarget !== null) {
    return forkStartupCheckpoint(
      checkpointTarget,
      config,
      projectHash,
      chatsDir,
    );
  }

  const resumeResult = await resumeSession({
    continueRef,
    projectHash,
    chatsDir,
    currentProvider: config.getProvider() ?? 'unknown',
    currentModel: config.getModel(),
    workspaceDirs: [...config.getWorkspaceContext().getDirectories()],
  });

  if (!resumeResult.ok) {
    debugLogger.warn(
      chalk.yellow(
        `Could not resume session (ref: ${continueRef}): ${resumeResult.error}`,
      ),
    );
    return {
      recordingService: await buildNewRecordingService(
        config,
        projectHash,
        chatsDir,
      ),
      resumedHistory: null,
      resumedLockHandle: null,
      resumedSessionId: null,
    };
  }

  for (const warning of resumeResult.warnings) {
    debugLogger.warn(chalk.yellow(warning));
  }
  return {
    recordingService: resumeResult.recording,
    resumedHistory: resumeResult.history,
    resumedLockHandle: resumeResult.lockHandle,
    resumedSessionId: resumeResult.metadata.sessionId,
  };
}
