/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import {
  SessionDiscovery,
  deleteSessionWithDiagnostics,
  writeToStderr,
  writeToStdout,
  type SessionSummary,
} from '@vybestack/llxprt-code-core';
import type { ParsedCliArgs } from './cliBootstrap.js';
import { formatSkippedRecordingsWarning } from './skippedRecordingsWarning.js';
import {
  resolveSessionStorageLocation,
  type ProjectStorageSource,
  type SessionStorageLocation,
} from './sessionStorageLocation.js';
import { runExitCleanup } from './utils/cleanup.js';

/** Format a single recorded-session summary line for --list-sessions output. */
export function formatSessionSummaryLine(
  session: SessionSummary,
  index: number,
): string {
  const modified = session.lastModified.toLocaleString();
  const sizeKb = (session.fileSize / 1024).toFixed(1);
  return `  ${index + 1}. ${session.sessionId.slice(0, 8)}  ${modified}  ${sizeKb} KB  ${session.provider}/${session.model}`;
}

async function listProjectSessions({
  chatsDir,
  projectHash,
}: SessionStorageLocation): Promise<number> {
  const { sessions, unreadableRecordings } =
    await SessionDiscovery.listSessionsDetailed(chatsDir, projectHash);
  if (sessions.length === 0) {
    writeToStdout('No recorded sessions for this project.\n');
  } else {
    const lines = sessions.map(formatSessionSummaryLine);
    writeToStdout(
      `Sessions for this project (${sessions.length}):\n\n${lines.join('\n')}\n`,
    );
  }
  if (unreadableRecordings.length > 0) {
    writeToStderr(`${formatSkippedRecordingsWarning(unreadableRecordings)}\n`);
  }
  return 0;
}

async function deleteProjectSession(
  ref: string,
  { chatsDir, projectHash }: SessionStorageLocation,
): Promise<number> {
  const { result, unreadableRecordings } = await deleteSessionWithDiagnostics(
    ref,
    chatsDir,
    projectHash,
  );
  if (result.ok) {
    writeToStdout(
      `${chalk.green(`Deleted session ${result.deletedSessionId.slice(0, 8)}`)}\n`,
    );
  } else {
    writeToStderr(`${chalk.red(result.error)}\n`);
  }
  if (unreadableRecordings.length > 0) {
    writeToStderr(`${formatSkippedRecordingsWarning(unreadableRecordings)}\n`);
  }
  return result.ok ? 0 : 1;
}

/** The --delete-session reference; an empty value counts as not supplied. */
function deleteSessionRef(argv: ParsedCliArgs): string | undefined {
  return typeof argv.deleteSession === 'string' && argv.deleteSession.length > 0
    ? argv.deleteSession
    : undefined;
}

/**
 * True when --list-sessions or --delete-session (with a non-empty value) was
 * supplied. This is the single definition of "a session-management
 * invocation": startup uses it to skip the prompt/stdin guard, and the runner
 * below acts on exactly the same flags.
 */
export function hasSessionManagementFlag(argv: ParsedCliArgs): boolean {
  return argv.listSessions === true || deleteSessionRef(argv) !== undefined;
}

/**
 * Run --list-sessions / --delete-session against the project's recordings.
 * Returns the process exit code, or null when neither flag was supplied.
 * --list-sessions wins when both are given. The storage location is only
 * resolved when a flag was actually supplied.
 */
export async function runSessionListOrDelete(
  argv: ParsedCliArgs,
  source: ProjectStorageSource,
): Promise<number | null> {
  if (argv.listSessions === true) {
    return listProjectSessions(resolveSessionStorageLocation(source));
  }
  const ref = deleteSessionRef(argv);
  if (ref !== undefined) {
    return deleteProjectSession(ref, resolveSessionStorageLocation(source));
  }
  return null;
}

/**
 * Startup handling of --list-sessions / --delete-session: prints the result
 * and exits the process. Returns only when neither flag was supplied.
 *
 * Runs once the Config is built and before terminal setup, provider
 * configuration/activation, the sandbox hop, agent construction and recording.
 * The recordings are located from the Config, the same source session
 * recording uses, so the directory can never differ (for example when a
 * user-global .env overrides the log home only at Config load).
 */
export async function exitAfterSessionListOrDelete(
  argv: ParsedCliArgs,
  config: ProjectStorageSource,
): Promise<void> {
  const exitCode = await runSessionListOrDelete(argv, config);
  if (exitCode === null) {
    return;
  }
  await runExitCleanup();
  process.exit(exitCode);
}
