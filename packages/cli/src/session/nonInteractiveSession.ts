/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomBytes } from 'node:crypto';
import {
  writeToStderr,
  SessionEndReason,
  OutputFormat,
} from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import {
  getStartupWarnings,
  getSandboxHandoffWarning,
} from '../utils/startupWarnings.js';
import { runExitCleanup } from '../utils/cleanup.js';
import { initializeOutputListenersAndFlush } from './outputListeners.js';
import { installNonInteractiveSigintHandler } from './signalHandlers.js';

export interface ValidatedNonInteractiveRun {
  run: (input: string, promptId: string) => Promise<void>;
  report: (error: unknown) => void;
}
type SessionStart = () => Promise<{
  systemMessage?: string;
  additionalContext?: string;
}>;
type SessionEnd = (reason: SessionEndReason) => Promise<unknown>;
function safeReport(report: (error: unknown) => void, error: unknown): void {
  try {
    report(error);
  } catch (reportError) {
    debugLogger.error('Failed to report non-interactive error:', reportError);
  }
}
export async function dispatchInteractiveOrNonInteractive(
  input: string | undefined,
  isInteractive: () => boolean,
  recordingOwner: 'agent' | undefined,
  recordingWarnings: readonly string[],
  readUserWarnings: () => Promise<string[]>,
  launchInteractive: (warnings: string[]) => Promise<void>,
  readOutputFormat: () => OutputFormat,
  launchHeadless: (input: string | undefined) => Promise<void>,
): Promise<void> {
  const handoff = getSandboxHandoffWarning(process.env);
  if (isInteractive()) {
    if (recordingOwner !== 'agent')
      throw new Error('Interactive Agent recording owner was not initialized');
    const [systemWarnings, userWarnings] = await Promise.all([
      getStartupWarnings(),
      readUserWarnings(),
    ]);
    await launchInteractive([
      ...(handoff !== undefined ? [handoff] : []),
      ...systemWarnings,
      ...userWarnings,
      ...recordingWarnings,
    ]);
    return;
  }
  if (handoff !== undefined && readOutputFormat() === OutputFormat.TEXT)
    writeToStderr(handoff);
  for (const warning of recordingWarnings) writeToStderr(warning + '\n');
  await launchHeadless(input);
}
export async function runPipedOrPromptSession(
  initialInput: string | undefined,
  hasPipedInput: boolean,
  readStdinData: () => Promise<string>,
  validate: () => Promise<ValidatedNonInteractiveRun>,
  triggerStart: SessionStart,
  triggerEnd: SessionEnd,
  reportOriginal: (error: unknown) => void,
  flush: () => void | Promise<void>,
): Promise<never> {
  let input = initialInput;
  if (hasPipedInput) {
    const stdinData = await readStdinData();
    if (stdinData) {
      const existing = input ?? '';
      input = existing ? stdinData + '\n\n' + existing : stdinData;
    }
  }
  if (!input) {
    writeToStderr(
      'No input provided via stdin. Input can be provided by piping data into llxprt or using the --prompt option.\n',
    );
    await runExitCleanup();
    process.exit(1);
  }
  const promptId = randomBytes(8).toString('hex');
  let code = 0;
  const setupFailures: unknown[] = [];
  let cleanupFailures: unknown[] = [];
  try {
    code = await runNonInteractiveSession(
      input,
      promptId,
      validate,
      triggerStart,
      triggerEnd,
      reportOriginal,
    );
  } catch (error) {
    setupFailures.push(error);
    code = 1;
    debugLogger.error(
      'Non-interactive session setup failed (prompt_id=' + promptId + '):',
      error,
    );
    safeReport(reportOriginal, error);
  } finally {
    const exported = await Promise.allSettled([Promise.resolve().then(flush)]);
    const cleaned = await Promise.allSettled([
      Promise.resolve().then(() => runExitCleanup()),
    ]);
    cleanupFailures = [...exported, ...cleaned].flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
  }
  if (cleanupFailures.length > 0) {
    const failures = [...setupFailures, ...cleanupFailures];
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(
      failures,
      'Noninteractive telemetry and exit cleanup failed',
    );
  }
  process.exit(code);
}
async function runNonInteractiveSession(
  input: string,
  promptId: string,
  validate: () => Promise<ValidatedNonInteractiveRun>,
  triggerStart: SessionStart,
  triggerEnd: SessionEnd,
  reportOriginal: (error: unknown) => void,
): Promise<number> {
  let validated: ValidatedNonInteractiveRun;
  try {
    validated = await validate();
  } catch (error) {
    await triggerEnd(SessionEndReason.Other);
    safeReport(reportOriginal, error);
    return 1;
  }
  const removeSigint = installNonInteractiveSigintHandler();
  let code = 0;
  try {
    initializeOutputListenersAndFlush();
    const output = await triggerStart();
    if (output.systemMessage) writeToStderr(output.systemMessage + '\n');
    const finalInput = output.additionalContext
      ? output.additionalContext + '\n\n' + input
      : input;
    await validated.run(finalInput, promptId);
    await triggerEnd(SessionEndReason.Exit);
  } catch (error) {
    code = 1;
    debugLogger.error(
      'Non-interactive run failed (prompt_id=' + promptId + '):',
      error,
    );
    await triggerEnd(SessionEndReason.Other);
    safeReport(validated.report, error);
  } finally {
    removeSigint();
  }
  return code;
}
