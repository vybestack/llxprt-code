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
  sessionId,
  SessionRecordingService,
  RecordingIntegration,
  resumeSession,
  listSessions,
  deleteSession,
  getProjectHash,
  type IContent,
  type LockHandle,
  MessageBus,
  debugLogger,
} from '@vybestack/llxprt-code-core';
import {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import { ExtensionStorage, loadExtensions } from './config/extension.js';
import { registerCleanup } from './utils/cleanup.js';
import { setCliRuntimeContext } from '@vybestack/llxprt-code-providers/runtime/runtimeSettings.js';
import { promises as fsPromises } from 'fs';
import { join } from 'path';
import { ExtensionEnablementManager } from './config/extensions/extensionEnablement.js';
import type { ParsedCliArgs } from './cliBootstrap.js';

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
}

export interface SessionRecordingSetup extends ResolvedRecording {
  recordingIntegration: RecordingIntegration;
}

export interface RuntimeConfigBootstrap {
  config: Config;
  sessionMessageBus: MessageBus;
  extensions: ReturnType<typeof loadExtensions>;
  runtimeSettingsService: SettingsService;
}

/**
 * @plan:PLAN-20250218-STATELESSPROVIDER.P06
 * @requirement:REQ-SP-005
 * Seed the CLI runtime context with a scoped SettingsService, load extensions,
 * construct Config, create the session MessageBus, and re-seed the runtime
 * context post-config with a ProfileManager.
 */
export async function bootstrapRuntimeAndConfig(
  settings: LoadedSettings,
  argv: ParsedCliArgs,
  workspaceRoot: string,
): Promise<RuntimeConfigBootstrap> {
  const runtimeSettingsService = new SettingsService();
  setCliRuntimeContext(runtimeSettingsService, undefined, {
    runtimeId: 'cli.runtime.bootstrap',
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
  const sessionMessageBus = new MessageBus(
    config.getPolicyEngine(),
    config.getDebugMode(),
  );
  const profileManager = new ProfileManager();
  setCliRuntimeContext(runtimeSettingsService, config, {
    runtimeId: 'cli.runtime.bootstrap',
    metadata: { source: 'cli-bootstrap', stage: 'post-config' },
    profileManager,
  });

  return { config, sessionMessageBus, extensions, runtimeSettingsService };
}

/**
 * @plan:PLAN-20260211-SESSIONRECORDING.P26
 * @pseudocode recording-integration.md lines 115-132
 *
 * Set up session recording: compute project hash, create the chats directory,
 * handle --list-sessions / --delete-session early exits, create the recording
 * service (new or resumed), restore history when resuming, and register the
 * recording cleanup hook.
 */
export async function setupSessionRecording(
  config: Config,
  argv: ParsedCliArgs,
): Promise<SessionRecordingSetup> {
  const projectHash = getProjectHash(config.getProjectRoot());
  const chatsDir = join(config.getProjectTempDir(), 'chats');
  await fsPromises.mkdir(chatsDir, { recursive: true });

  // --list-sessions / --delete-session: handle early exits.
  await handleSessionListAndDelete(argv, chatsDir, projectHash);

  const { recordingService, resumedHistory, resumedLockHandle } =
    await createOrResumeRecording(config, projectHash, chatsDir);

  const recordingIntegration = new RecordingIntegration(recordingService);

  if (resumedHistory && resumedHistory.length > 0) {
    try {
      const agentClient = config.getAgentClient();
      await agentClient.restoreHistory(resumedHistory);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      debugLogger.warn(
        chalk.yellow('Could not restore conversation history: ' + messageText),
      );
    }
  }

  registerCleanup(async () => {
    recordingIntegration.dispose();
    try {
      await recordingService.dispose();
    } finally {
      await resumedLockHandle?.release();
    }
  });

  return {
    recordingService,
    recordingIntegration,
    resumedHistory,
    resumedLockHandle,
  };
}

/** Build a fresh SessionRecordingService for the current run. */
export function buildNewRecordingService(
  config: Config,
  projectHash: string,
  chatsDir: string,
): SessionRecordingService {
  return new SessionRecordingService({
    sessionId,
    projectHash,
    chatsDir,
    workspaceDirs: [...config.getWorkspaceContext().getDirectories()],
    provider: config.getProvider() ?? 'unknown',
    model: config.getModel(),
  });
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
      recordingService: buildNewRecordingService(config, projectHash, chatsDir),
      resumedHistory: null,
      resumedLockHandle: null,
    };
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
      recordingService: buildNewRecordingService(config, projectHash, chatsDir),
      resumedHistory: null,
      resumedLockHandle: null,
    };
  }

  // FIX-1336: Adopt the restored session's ID so TodoStore uses the correct file
  config.adoptSessionId(resumeResult.metadata.sessionId);
  for (const warning of resumeResult.warnings) {
    debugLogger.warn(chalk.yellow(warning));
  }
  return {
    recordingService: resumeResult.recording,
    resumedHistory: resumeResult.history,
    resumedLockHandle: resumeResult.lockHandle,
  };
}
