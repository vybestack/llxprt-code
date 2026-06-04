/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  parseAndFormatApiError,
  FatalInputError,
  EmojiFilter,
  OutputFormat,
  JsonStreamEventType,
  StreamJsonFormatter,
  uiTelemetryService,
  coreEvents,
  CoreEvent,
  setActiveProviderRuntimeContext,
  type UserFeedbackPayload,
  type EmojiFilterMode,
  type MessageBus,
  debugLogger,
} from '@vybestack/llxprt-code-core';
import { type Part } from '@google/genai';
import readline from 'node:readline';
import { isSlashCommand } from './ui/utils/commandUtils.js';
import type { LoadedSettings } from './config/settings.js';

import { handleSlashCommand } from './nonInteractiveCliCommands.js';
import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { handleAtCommand } from './ui/hooks/atCommandProcessor.js';
import { processResponseTurns } from './nonInteractiveCliSupport.js';

interface RunNonInteractiveParams {
  config: Config;
  settings: LoadedSettings;
  input: string;
  prompt_id: string;
  runtimeMessageBus?: MessageBus;
  deferTelemetryShutdown?: boolean;
}

function createProfileNameWriter(
  config: Config,
  jsonOutput: boolean,
  streamFormatter: StreamJsonFormatter | null,
): () => void {
  let firstEventInTurn = true;
  return () => {
    if (firstEventInTurn && !jsonOutput && !streamFormatter) {
      const settingsService = config.getSettingsService() as Omit<
        ReturnType<Config['getSettingsService']>,
        'getCurrentProfileName'
      > & {
        getCurrentProfileName?: () => string | null;
      };
      const activeProfileName = settingsService.getCurrentProfileName?.();
      if (activeProfileName) {
        process.stdout.write(`[${activeProfileName}]
`);
      }
    }
    firstEventInTurn = false;
  };
}
function createUserFeedbackHandler(
  config: Config,
): (payload: UserFeedbackPayload) => void {
  return (payload) => {
    const prefix = payload.severity.toUpperCase();
    process.stderr.write(`[${prefix}] ${payload.message}\n`);
    if (
      payload.error !== undefined &&
      payload.error !== null &&
      config.getDebugMode()
    ) {
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty stack should fall back to message */
      const errorToLog =
        payload.error instanceof Error
          ? payload.error.stack || payload.error.message
          : String(payload.error);
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
      process.stderr.write(`${errorToLog}\n`);
    }
  };
}

function createStdinCancellation(abortController: AbortController): {
  setup: () => void;
  cleanup: () => void;
} {
  let isAborting = false;
  let cancelMessageTimer: NodeJS.Timeout | null = null;
  let stdinWasRaw = false;
  let rl: readline.Interface | null = null;
  const keypressHandler = (
    str: string,
    key: { name?: string; ctrl?: boolean },
  ): void => {
    if ((key.ctrl === true && key.name === 'c') || str === '\u0003') {
      if (isAborting) {
        return;
      }
      isAborting = true;
      cancelMessageTimer = setTimeout(() => {
        process.stderr.write('\nCancelling...\n');
      }, 200);
      abortController.abort();
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
    },
    cleanup: () => {
      if (cancelMessageTimer) {
        clearTimeout(cancelMessageTimer);
        cancelMessageTimer = null;
      }
      rl?.close();
      rl = null;
      process.stdin.removeAllListeners('keypress');
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(stdinWasRaw);
        process.stdin.pause();
      }
    },
  };
}

function emitStreamInit(
  streamFormatter: StreamJsonFormatter | null,
  config: Config,
): void {
  streamFormatter?.emitEvent({
    type: JsonStreamEventType.INIT,
    timestamp: new Date().toISOString(),
    session_id: config.getSessionId(),
    model: config.getModel(),
  });
}

function createEmojiFilter(config: Config): EmojiFilter | undefined {
  const configuredEmojiFilterMode = config.getEphemeralSetting(
    'emojifilter',
  ) as EmojiFilterMode | undefined;
  const emojiFilterMode: EmojiFilterMode =
    configuredEmojiFilterMode === 'allowed' ||
    configuredEmojiFilterMode === 'warn' ||
    configuredEmojiFilterMode === 'error'
      ? configuredEmojiFilterMode
      : 'auto';
  return emojiFilterMode !== 'allowed'
    ? new EmojiFilter({ mode: emojiFilterMode })
    : undefined;
}

async function resolveNonInteractiveQuery(
  input: string,
  abortController: AbortController,
  config: Config,
  settings: LoadedSettings,
): Promise<Part[]> {
  if (isSlashCommand(input)) {
    const slashCommandResult = await handleSlashCommand(
      input,
      abortController,
      config,
      settings,
    );
    if (
      slashCommandResult !== undefined &&
      (typeof slashCommandResult !== 'string' || slashCommandResult.length > 0)
    ) {
      return slashCommandResult as Part[];
    }
  }
  const { processedQuery, error } = await handleAtCommand({
    query: input,
    config,
    addItem: (_item, _timestamp) => 0,
    onDebugMessage: () => {},
    messageId: Date.now(),
    signal: abortController.signal,
  });
  if (error !== undefined || processedQuery === null) {
    const fatalMessage =
      error !== undefined && error !== ''
        ? error
        : 'Exiting due to an error processing the @ command.';
    throw new FatalInputError(fatalMessage);
  }
  return processedQuery as Part[];
}

function emitUserMessage(
  streamFormatter: StreamJsonFormatter | null,
  input: string,
): void {
  streamFormatter?.emitEvent({
    type: JsonStreamEventType.MESSAGE,
    timestamp: new Date().toISOString(),
    role: 'user',
    content: input,
  });
}

async function processQuery(
  query: Part[],
  params: RunNonInteractiveParams,
  options: {
    abortController: AbortController;
    jsonOutput: boolean;
    streamJsonOutput: boolean;
    streamFormatter: StreamJsonFormatter | null;
    emojiFilter: EmojiFilter | undefined;
    startTime: number;
  },
): Promise<void> {
  await processResponseTurns(
    query,
    {
      config: params.config,
      abortController: options.abortController,
      prompt_id: params.prompt_id,
      jsonOutput: options.jsonOutput,
      streamJsonOutput: options.streamJsonOutput,
      streamFormatter: options.streamFormatter,
      emojiFilter: options.emojiFilter,
      runtimeMessageBus: params.runtimeMessageBus,
      createProfileNameWriter: () =>
        createProfileNameWriter(
          params.config,
          options.jsonOutput,
          options.streamFormatter,
        ),
      maxSessionTurns: params.config.getMaxSessionTurns(),
    },
    options.startTime,
    () => uiTelemetryService.getMetrics(),
  );
}

export async function runNonInteractive(
  params: RunNonInteractiveParams,
): Promise<void> {
  const { config, input, settings, deferTelemetryShutdown = false } = params;
  const outputFormat = config.getOutputFormat();
  const jsonOutput = outputFormat === OutputFormat.JSON;
  const streamJsonOutput = outputFormat === OutputFormat.STREAM_JSON;
  const startTime = Date.now();
  const streamFormatter = streamJsonOutput ? new StreamJsonFormatter() : null;
  const consolePatcher = new ConsolePatcher({
    stderr: !jsonOutput,
    debugMode: jsonOutput ? false : config.getDebugMode(),
  });
  const handleUserFeedback = createUserFeedbackHandler(config);
  const abortController = new AbortController();
  const stdinCancellation = createStdinCancellation(abortController);
  try {
    consolePatcher.patch();
    coreEvents.on(CoreEvent.UserFeedback, handleUserFeedback);
    coreEvents.drainFeedbackBacklog();
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        process.exit(0);
      }
    });
    setActiveProviderRuntimeContext({
      settingsService: config.getSettingsService(),
      config,
      runtimeId: config.getSessionId(),
      metadata: { source: 'nonInteractiveCli' },
    });
    emitStreamInit(streamFormatter, config);
    stdinCancellation.setup();
    const query = await resolveNonInteractiveQuery(
      input,
      abortController,
      config,
      settings,
    );
    emitUserMessage(streamFormatter, input);
    await processQuery(query, params, {
      abortController,
      jsonOutput,
      streamJsonOutput,
      streamFormatter,
      emojiFilter: createEmojiFilter(config),
      startTime,
    });
  } catch (error) {
    if (!jsonOutput) {
      debugLogger.error(parseAndFormatApiError(error));
    }
    throw error;
  } finally {
    stdinCancellation.cleanup();
    consolePatcher.cleanup();
    coreEvents.off(CoreEvent.UserFeedback, handleUserFeedback);
    if (!deferTelemetryShutdown && isTelemetrySdkInitialized()) {
      await shutdownTelemetry(config);
    }
  }
}
