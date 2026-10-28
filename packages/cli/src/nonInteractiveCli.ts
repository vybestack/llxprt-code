/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  EmojiFilter,
  ExitCodes,
  OutputFormat,
  JsonStreamEventType,
  StreamJsonFormatter,
  coreEvents,
  CoreEvent,
  type AgentRequestInput,
  type EmojiFilterMode,
  type UserFeedbackPayload,
} from '@vybestack/llxprt-code-core';
import readline from 'node:readline';
import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { runExitCleanup } from './utils/cleanup.js';

export interface TurnOutput {
  jsonOutput: boolean;
  streamJsonOutput: boolean;
  streamFormatter: StreamJsonFormatter | null;
  emojiFilter: EmojiFilter | undefined;
  startTime: number;
}
export interface NonInteractiveTurn {
  resolveInput: (
    input: string,
    signal: AbortSignal,
  ) => Promise<AgentRequestInput>;
  stream: (
    query: AgentRequestInput,
    promptId: string,
    signal: AbortSignal,
    output: TurnOutput,
  ) => Promise<void>;
  release: () => Promise<void>;
}
export function createProfileNameWriter(
  jsonOutput: boolean,
  streamFormatter: StreamJsonFormatter | null,
  resolveIdentity: () => string | null,
): () => void {
  let firstEventInTurn = true;
  return () => {
    if (firstEventInTurn && !jsonOutput && !streamFormatter) {
      const identity = resolveIdentity();
      if (identity) {
        process.stdout.write(`[${identity}]\n`);
      }
    }
    firstEventInTurn = false;
  };
}
export function createStdinCancellation(abortController: AbortController): {
  setup: () => void;
  cleanup: () => void;
} {
  let isAborting = false;
  let stdinWasRaw = false;
  let rl: readline.Interface | null = null;
  let listenerAttached = false;
  const keypressHandler = (
    str: string,
    key: { name?: string; ctrl?: boolean },
  ): void => {
    if ((key.ctrl === true && key.name === 'c') || str === '\u0003') {
      if (isAborting) {
        return;
      }
      isAborting = true;
      abortController.abort();
      process.stderr.write('\nCancelled.\n');
      process.exit(130);
    }
  };
  return {
    setup: () => {
      if (!process.stdin.isTTY) {
        return;
      }
      stdinWasRaw = process.stdin.isRaw || false;
      process.stdin.setRawMode(true);
      process.stdin.resume();
      rl = readline.createInterface({
        input: process.stdin,
        escapeCodeTimeout: 0,
      });
      readline.emitKeypressEvents(process.stdin, rl);
      process.stdin.on('keypress', keypressHandler);
      listenerAttached = true;
    },
    cleanup: () => {
      rl?.close();
      rl = null;
      if (listenerAttached) {
        process.stdin.removeListener('keypress', keypressHandler);
        listenerAttached = false;
      }
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(stdinWasRaw);
        process.stdin.pause();
      }
    },
  };
}

async function releaseResources(
  failures: unknown[],
  releases: ReadonlyArray<() => void | Promise<void>>,
): Promise<void> {
  for (const release of releases) {
    const cleanup = await Promise.allSettled([Promise.resolve().then(release)]);
    failures.push(
      ...cleanup.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      ),
    );
  }
}
function throwFailures(failures: unknown[], message: string): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}
async function resolveAndStream(
  input: string,
  promptId: string,
  controller: AbortController,
  resolveSlash: (
    input: string,
    controller: AbortController,
  ) => Promise<AgentRequestInput | undefined>,
  acquireTurn: () => Promise<NonInteractiveTurn>,
  output: TurnOutput,
): Promise<void> {
  const slashQuery = await resolveSlash(input, controller);
  const turn = await acquireTurn();
  const failures: unknown[] = [];
  try {
    const query =
      slashQuery ?? (await turn.resolveInput(input, controller.signal));
    output.streamFormatter?.emitEvent({
      type: JsonStreamEventType.MESSAGE,
      timestamp: new Date().toISOString(),
      role: 'user',
      content: input,
    });
    await turn.stream(query, promptId, controller.signal, output);
  } catch (error) {
    failures.push(error);
  } finally {
    await releaseResources(failures, [turn.release]);
  }
  throwFailures(failures, 'Noninteractive execution and Agent disposal failed');
}
function makeEmojiFilter(mode: unknown): EmojiFilter | undefined {
  const selected: EmojiFilterMode =
    mode === 'allowed' || mode === 'warn' || mode === 'error' ? mode : 'auto';
  return selected === 'allowed'
    ? undefined
    : new EmojiFilter({ mode: selected });
}
export async function runNonInteractive(
  input: string,
  promptId: string,
  isConfigured: () => boolean,
  reportUnconfigured: () => void,
  readOutputFormat: () => OutputFormat,
  readDebugMode: () => boolean,
  readSessionId: () => string,
  readModel: () => string,
  onFeedback: (payload: UserFeedbackPayload) => void,
  readEmojiMode: () => unknown,
  resolveSlash: (
    input: string,
    controller: AbortController,
  ) => Promise<AgentRequestInput | undefined>,
  acquireTurn: () => Promise<NonInteractiveTurn>,
  reportError: (error: unknown) => void,
  flush: () => void | Promise<void>,
): Promise<void> {
  if (!isConfigured()) {
    reportUnconfigured();
    try {
      await runExitCleanup();
    } finally {
      process.exit(ExitCodes.FATAL_CONFIG_ERROR);
    }
  }
  const outputFormat = readOutputFormat();
  const jsonOutput = outputFormat === OutputFormat.JSON;
  const streamJsonOutput = outputFormat === OutputFormat.STREAM_JSON;
  const startTime = Date.now();
  const streamFormatter = streamJsonOutput ? new StreamJsonFormatter() : null;
  const patcher = new ConsolePatcher({
    stderr: !jsonOutput,
    debugMode: jsonOutput ? false : readDebugMode(),
  });
  const controller = new AbortController();
  const stdin = createStdinCancellation(controller);
  const failures: unknown[] = [];
  try {
    patcher.patch();
    coreEvents.on(CoreEvent.UserFeedback, onFeedback);
    coreEvents.drainFeedbackBacklog();
    installPipeExit();
    streamFormatter?.emitEvent({
      type: JsonStreamEventType.INIT,
      timestamp: new Date().toISOString(),
      session_id: readSessionId(),
      model: readModel(),
    });
    stdin.setup();
    await resolveAndStream(
      input,
      promptId,
      controller,
      resolveSlash,
      acquireTurn,
      {
        jsonOutput,
        streamJsonOutput,
        streamFormatter,
        emojiFilter: makeEmojiFilter(readEmojiMode()),
        startTime,
      },
    );
  } catch (error) {
    if (!jsonOutput) reportError(error);
    failures.push(error);
  } finally {
    await releaseResources(failures, [
      () => stdin.cleanup(),
      () => patcher.cleanup(),
      () => {
        coreEvents.off(CoreEvent.UserFeedback, onFeedback);
      },
      flush,
    ]);
  }
  throwFailures(failures, 'Noninteractive execution and cleanup failed');
}

function installPipeExit(): void {
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0);
  });
}
