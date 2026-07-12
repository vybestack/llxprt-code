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
  type UserFeedbackPayload,
  type EmojiFilterMode,
  type MessageBus,
  debugLogger,
  type ContractPart,
  PLACEHOLDER_MODEL,
} from '@vybestack/llxprt-code-core';
import { activateSettingsRuntimeContext } from '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js';
import {
  fromConfig,
  type Agent,
  type AgentToolHandle,
  type ProviderActivationIntent,
} from '@vybestack/llxprt-code-agents';

import readline from 'node:readline';
import { isSlashCommand } from './ui/utils/commandUtils.js';
import type { LoadedSettings } from './config/settings.js';
import type { BootstrapProfileArgs } from './config/profileBootstrap.js';

import { handleSlashCommand } from './nonInteractiveCliCommands.js';
import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { handleAtCommand } from './ui/hooks/atCommandProcessor.js';
import { processAgentStream } from './nonInteractiveCliSupport.js';
import {
  getActiveProviderNameForApiError,
  getErrorFallbackModel,
} from './utils/apiErrorFormatting.js';
import { firstNonEmptyString } from './utils/coalesce.js';
import {
  resolveContentPrefixIdentity,
  createCliModelIdentityRuntime,
} from './ui/utils/modelIdentity.js';

interface RunNonInteractiveParams {
  config: Config;
  settings: LoadedSettings;
  input: string;
  prompt_id: string;
  runtimeMessageBus?: MessageBus;
  deferTelemetryShutdown?: boolean;
}

export function createProfileNameWriter(
  config: Config,
  jsonOutput: boolean,
  streamFormatter: StreamJsonFormatter | null,
  getIdentity: (() => string | null) | null = null,
): () => void {
  const resolveIdentity =
    getIdentity ??
    (() => {
      try {
        return resolveContentPrefixIdentity(createCliModelIdentityRuntime());
      } catch (error) {
        // Degraded path: fall back to the bare profile name (no model suffix)
        // so the prefix is still shown. Log so the format divergence is
        // observable to operators.
        debugLogger.debug(
          () =>
            `[nonInteractiveCli] resolveContentPrefixIdentity failed; using bare profile name: ${error}`,
        );
        const settingsService = config.getSettingsService() as Omit<
          ReturnType<Config['getSettingsService']>,
          'getCurrentProfileName'
        > & {
          getCurrentProfileName?: () => string | null;
        };
        return settingsService.getCurrentProfileName?.() ?? null;
      }
    });
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
      const errorToLog =
        payload.error instanceof Error
          ? firstNonEmptyString(payload.error.stack, payload.error.message)
          : String(payload.error);
      process.stderr.write(`${errorToLog}\n`);
    }
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

/**
 * Resolves a slash command to its submitted prompt parts, or undefined when
 * the input is not a slash command (or the command produced no content).
 * Runs BEFORE Agent construction (matching the pre-#2376 ordering) so a
 * slash-only input that fails or exits never requires provider setup.
 */
async function resolveSlashQuery(
  input: string,
  abortController: AbortController,
  config: Config,
  settings: LoadedSettings,
): Promise<ContractPart[] | undefined> {
  if (!isSlashCommand(input)) {
    return undefined;
  }
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
    return slashCommandResult as ContractPart[];
  }
  return undefined;
}

async function resolveAtQuery(
  input: string,
  abortController: AbortController,
  config: Config,
  getToolHandle: (name: string) => AgentToolHandle | undefined,
): Promise<ContractPart[]> {
  const { processedQuery, error } = await handleAtCommand({
    query: input,
    config,
    // Tool lookups resolve through the public Agent.tools API (issue #2376):
    // the caller supplies getToolHandle from the already-created Agent.
    getToolHandle,
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
  return processedQuery as ContractPart[];
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
type ConfigWithBootstrapArgs = Config & {
  readonly _bootstrapArgs?: BootstrapProfileArgs;
  readonly _profileModelParams?: Record<string, unknown>;
  readonly _cliModelParams?: Record<string, unknown>;
};

function readBootstrapArgs(config: Config): BootstrapProfileArgs | undefined {
  return (config as ConfigWithBootstrapArgs)._bootstrapArgs;
}

function buildActivationCliOverrides(
  config: Config,
): ProviderActivationIntent['cliOverrides'] | undefined {
  const bootstrapArgs = readBootstrapArgs(config);
  if (bootstrapArgs === undefined) {
    return undefined;
  }
  const overrides = {
    ...(bootstrapArgs.keyOverride !== null
      ? { key: bootstrapArgs.keyOverride }
      : {}),
    ...(bootstrapArgs.keyfileOverride !== null
      ? { keyfile: bootstrapArgs.keyfileOverride }
      : {}),
    ...(bootstrapArgs.keyNameOverride !== null
      ? { keyName: bootstrapArgs.keyNameOverride }
      : {}),
    ...(bootstrapArgs.baseurlOverride !== null
      ? { baseUrl: bootstrapArgs.baseurlOverride }
      : {}),
    ...(bootstrapArgs.setOverrides !== null
      ? { set: bootstrapArgs.setOverrides }
      : {}),
  };
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function collectActivationModelParams(
  config: Config,
): ProviderActivationIntent['modelParams'] | undefined {
  const configWithParams = config as ConfigWithBootstrapArgs;
  const mergedModelParams: Record<string, unknown> = {};

  // Profile model params apply regardless of provider source. A CLI provider
  // override suppresses the profile's provider/model selection, not its model
  // params (see profileResolution.ts contract).
  if (configWithParams._profileModelParams) {
    Object.assign(mergedModelParams, configWithParams._profileModelParams);
  }
  if (configWithParams._cliModelParams) {
    Object.assign(mergedModelParams, configWithParams._cliModelParams);
  }

  return Object.keys(mergedModelParams).length > 0
    ? mergedModelParams
    : undefined;
}

async function processQuery(
  query: ContractPart[],
  agent: Agent,
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
  const eventStream = agent.stream(query, {
    signal: options.abortController.signal,
    promptId: params.prompt_id,
    maxTurns: params.config.getMaxSessionTurns(),
  });
  await processAgentStream(
    eventStream,
    {
      config: params.config,
      jsonOutput: options.jsonOutput,
      streamJsonOutput: options.streamJsonOutput,
      streamFormatter: options.streamFormatter,
      emojiFilter: options.emojiFilter,
      createProfileNameWriter: () =>
        createProfileNameWriter(
          params.config,
          options.jsonOutput,
          options.streamFormatter,
        ),
    },
    options.startTime,
    () => uiTelemetryService.getMetrics(),
  );
}

function buildNonInteractiveActivationIntent(
  params: RunNonInteractiveParams,
): ProviderActivationIntent {
  const useExternalAuth = params.settings.merged.useExternalAuth === true;
  const cliOverrides = buildActivationCliOverrides(params.config);
  const bootstrapArgs = readBootstrapArgs(params.config);
  const modelParams = collectActivationModelParams(params.config);
  const configModel = params.config.getModel();
  const resolvedModel =
    bootstrapArgs?.modelOverride ??
    (configModel !== PLACEHOLDER_MODEL ? configModel : undefined);
  return {
    provider:
      params.config.getProvider() ??
      bootstrapArgs?.providerOverride ??
      undefined,
    defaultProvider: 'gemini',
    authMode: useExternalAuth ? 'none' : 'auto',
    ...(typeof resolvedModel === 'string' && resolvedModel.trim().length > 0
      ? { model: resolvedModel.trim() }
      : {}),
    ...(modelParams !== undefined ? { modelParams } : {}),
    ...(cliOverrides !== undefined ? { cliOverrides } : {}),
  };
}

/**
 * Resolves the query, streams the response, and disposes the agent. Extracted
 * from runNonInteractive to keep function length within lint limits.
 *
 * Slash commands are RESOLVED before the Agent is created so a slash command
 * that throws (e.g. a confirmation/validation failure) surfaces its error
 * before any provider/Agent setup runs. The Agent is then created
 * unconditionally because BOTH paths need it to stream: `processQuery` runs the
 * resolved query through `agent`, and the @-command fallback additionally uses
 * `agent.tools.get` for tool lookups (the public Agent.tools API, issue #2376).
 * If `resolveSlashQuery` returns content it becomes the query; otherwise the
 * input falls through to @-command/prompt handling. The Agent is always
 * disposed in the `finally` below.
 *
 * #2374: non-interactive auth is now performed by fromConfig's activation
 * intent, NOT by validateNonInteractiveAuth. The intent mirrors the previous
 * validateNonInteractiveAuth executor call: provider from config, fallback
 * 'gemini', authMode 'none' when useExternalAuth is true (skip auth refresh),
 * else 'auto' (provider auth refresh + fallback). At HEAD, the auth refresh
 * threw on failure -> runNonInteractiveSession caught -> SessionEnd + report +
 * exit 1. Now fromConfig throws AgentBootstrapError on authFailed and the same
 * handler emits the failure.
 */
async function resolveAndStream(
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
  const { config, input, settings } = params;
  const slashQuery = await resolveSlashQuery(
    input,
    options.abortController,
    config,
    settings,
  );
  const agent = await fromConfig({
    config,
    messageBus: params.runtimeMessageBus,
    sessionId: config.getSessionId(),
    activation: buildNonInteractiveActivationIntent(params),
  });
  try {
    const query =
      slashQuery ??
      (await resolveAtQuery(input, options.abortController, config, (name) =>
        agent.tools.get(name),
      ));
    emitUserMessage(options.streamFormatter, input);
    await processQuery(query, agent, params, options);
  } finally {
    try {
      await agent.dispose();
    } catch (disposeError) {
      debugLogger.error(
        `Failed to dispose agent: ${
          disposeError instanceof Error
            ? disposeError.message
            : String(disposeError)
        }`,
      );
    }
  }
}

export async function runNonInteractive(
  params: RunNonInteractiveParams,
): Promise<void> {
  const { config, deferTelemetryShutdown = false } = params;
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
    activateSettingsRuntimeContext(
      config.getSettingsService(),
      config.getSessionId(),
      {
        config,
        metadata: { source: 'nonInteractiveCli' },
      },
    );
    emitStreamInit(streamFormatter, config);
    stdinCancellation.setup();
    await resolveAndStream(params, {
      abortController,
      jsonOutput,
      streamJsonOutput,
      streamFormatter,
      emojiFilter: createEmojiFilter(config),
      startTime,
    });
  } catch (error) {
    if (!jsonOutput) {
      const providerName = getActiveProviderNameForApiError(config);
      debugLogger.error(
        parseAndFormatApiError(
          error,
          undefined,
          getErrorFallbackModel(config, providerName),
          providerName,
        ),
      );
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
