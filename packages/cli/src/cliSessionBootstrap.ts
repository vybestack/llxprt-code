import {
  CONTINUE_LATEST,
  type Config,
  type IContent,
  deleteSession,
  getProjectHash,
  listSessions,
  writeToStderr,
  writeToStdout,
} from '@vybestack/llxprt-code-core';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';

import { buildMcpAuthFactoryRegistry } from '@vybestack/llxprt-code-mcp/auth/mcp-auth-factory.js';
import { sessionId } from '@vybestack/llxprt-code-telemetry';
import chalk from 'chalk';
import type { ConfigBuildPreflight } from './config/config.js';
import { ignoreReady, loadCliConfig } from './config/config.js';
import type { LoadedSettings } from './config/settings.js';
import {
  classifyContinueRef,
  describeUnreadableRecordings,
  recordStartupWarning,
  warnSkippedRecordings,
} from './startupResumeWarnings.js';

import { promises as fsPromises } from 'fs';
import { basename } from 'path';
import type { ParsedCliArgs } from './cliBootstrap.js';
import { ExtensionStorage, loadExtensions } from './config/extension.js';
import {
  ExtensionEnablementManager,
  type ExtensionSelection,
} from './config/extensions/extensionEnablement.js';
import {
  type BootstrapSelection,
  createSessionObservation,
} from './observation/jspWiring.js';
import { registerCleanup, runExitCleanup } from './utils/cleanup.js';

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
  config: Pick<Config, 'dispose'>,
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
function loadBootstrapExtensions(
  selection: ExtensionSelection,
  workspaceRoot: string,
) {
  const extensionEnablementManager = new ExtensionEnablementManager(
    ExtensionStorage.getUserExtensionsDir(),
    selection,
  );
  return {
    extensionEnablementManager,
    extensions: loadExtensions(extensionEnablementManager, workspaceRoot),
  };
}

export async function bootstrapRuntimeAndConfig(
  settings: LoadedSettings,
  argv: ParsedCliArgs,
  workspaceRoot: string,
  preflight: ConfigBuildPreflight,
): Promise<Config> {
  registerCleanup(() => preflight.dispose());
  try {
    const { extensionEnablementManager, extensions } = loadBootstrapExtensions(
      {
        enabledOverride: argv.extensions,
        disabled: settings.merged.extensions.disabled,
      },
      workspaceRoot,
    );
    return await loadCliConfig(
      {
        settings: settings.merged,
        extensions,
        extensionEnablementManager,
        sessionId,
        argv,
        cwd: workspaceRoot,
        preflight,
      },
      ignoreReady,
    );
  } catch (primary) {
    try {
      await preflight.dispose();
    } catch (cleanup) {
      throw new AggregateError(
        [primary, cleanup],
        'CLI bootstrap cleanup failed',
      );
    }
    throw primary;
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
  config: Pick<Config, 'getProjectRoot' | 'getSessionId'>,
  selection: BootstrapSelection | null,
): ReturnType<typeof createSessionObservation> {
  const projectRoot = config.getProjectRoot();
  // loadBootstrap disables observation (one stderr warning, startup continues)
  // when the bootstrap file cannot be read, but still fails fast
  // (FatalConfigError, exit 52) on a file that reads but is malformed,
  // insecure, or version-mismatched. Recording cleanup is registered above,
  // so the process exits cleanly on either path.
  return createSessionObservation({
    context: {
      repository: basename(projectRoot),
      path: projectRoot,
      agentKind: 'llxprt',
      displayName: basename(projectRoot),
    },
    selection,
    sessionId: config.getSessionId(),
  });
}

async function resumeOwnerRecording(
  session: Pick<Agent['session'], 'resume' | 'setRecording'>,
  listTargets: Agent['session']['listBrowserTargetsDetailed'],
  continueRef: string,
  startupWarnings: string[],
): Promise<IContent[] | null> {
  // Discovery here only classifies the reference against unreadable recordings
  // so they can be reported to the user; the owner performs the actual resume.
  const { targets, unreadableRecordings } = await listTargets();
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
  let restoreWarning: string | undefined;
  try {
    resumed = await session.resume(
      resumeRef === CONTINUE_LATEST ? 'latest' : resumeRef,
      {
        startup: true,
        onStartupRestoreFailure: (sessionId, reason) => {
          restoreWarning = `Could not restore conversation history (session ${sessionId}): ${reason}. Falling back to a new session.`;
        },
      },
    );
  } catch (error: unknown) {
    if (
      error instanceof AggregateError ||
      (error instanceof Error &&
        (error.message.includes('Ambiguous continue target name') ||
          error.message.startsWith('Cannot adopt recording session ')))
    ) {
      throw error;
    }
    recordStartupWarning(
      startupWarnings,
      restoreWarning ??
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
  config: Pick<
    Config,
    | 'getProjectRoot'
    | 'getSessionId'
    | 'projectChatsDir'
    | 'getContinueSessionRef'
    | 'dispose'
  >,
  session: Pick<Agent['session'], 'getRecording' | 'setRecording' | 'resume'>,
  listTargets: Agent['session']['listBrowserTargetsDetailed'],
  argv: Pick<ParsedCliArgs, 'listSessions' | 'deleteSession'>,
  bootstrapSelection: BootstrapSelection | null,
  startupWarnings: string[] = [],
): Promise<{
  history: IContent[] | null;
  observation: ReturnType<typeof setupObservation>;
}> {
  const projectHash = getProjectHash(config.getProjectRoot());
  const chatsDir = config.projectChatsDir;
  await handleSessionListAndDelete(argv, chatsDir, projectHash, config);
  await fsPromises.mkdir(chatsDir, { recursive: true });

  try {
    const continueRef = config.getContinueSessionRef();
    let history: IContent[] | null;
    if (continueRef) {
      history = await resumeOwnerRecording(
        session,
        listTargets,
        continueRef,
        startupWarnings,
      );
    } else {
      await session.setRecording({ enabled: true });
      history = null;
    }

    const observation = setupObservation(config, bootstrapSelection);
    registerCleanup(() => observation.cleanup());
    return { history, observation };
  } catch (error: unknown) {
    if (session.getRecording().enabled) {
      try {
        await session.setRecording({ enabled: false });
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

export async function discoverCliProviderContributions() {
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
