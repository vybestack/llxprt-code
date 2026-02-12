/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ToolCallRequestInfo,
  executeToolCall,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  GeminiEventType,
  parseAndFormatApiError,
  FatalInputError,
  FatalTurnLimitedError,
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
  type ServerGeminiThoughtEvent,
} from '@vybestack/llxprt-code-core';
import { Part } from '@google/genai';
import readline from 'node:readline';
import { isSlashCommand } from './ui/utils/commandUtils.js';
import type { LoadedSettings } from './config/settings.js';

import { handleSlashCommand } from './nonInteractiveCliCommands.js';
import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { handleAtCommand } from './ui/hooks/atCommandProcessor.js';

interface RunNonInteractiveParams {
  config: Config;
  settings: LoadedSettings;
  input: string;
  prompt_id: string;
}

export async function runNonInteractive({
  config,
  settings,
  input,
  prompt_id,
}: RunNonInteractiveParams): Promise<void> {
  const outputFormat =
    typeof config.getOutputFormat === 'function'
      ? config.getOutputFormat()
      : OutputFormat.TEXT;
  const jsonOutput = outputFormat === OutputFormat.JSON;
  const streamJsonOutput = outputFormat === OutputFormat.STREAM_JSON;

  const startTime = Date.now();
  const streamFormatter = streamJsonOutput ? new StreamJsonFormatter() : null;

  const consolePatcher = new ConsolePatcher({
    stderr: !jsonOutput,
    debugMode: jsonOutput ? false : config.getDebugMode(),
  });

  const handleUserFeedback = (payload: UserFeedbackPayload) => {
    const prefix = payload.severity.toUpperCase();
    process.stderr.write(`[${prefix}] ${payload.message}
`);
    if (payload.error && config.getDebugMode()) {
      const errorToLog =
        payload.error instanceof Error
          ? payload.error.stack || payload.error.message
          : String(payload.error);
      process.stderr.write(`${errorToLog}
`);
    }
  };

  const abortController = new AbortController();

  // Track cancellation state
  let isAborting = false;
  let cancelMessageTimer: NodeJS.Timeout | null = null;

  // Setup stdin listener for Ctrl+C detection
  let stdinWasRaw = false;
  let rl: readline.Interface | null = null;

  const setupStdinCancellation = () => {
    // Only setup if stdin is a TTY (user can interact)
    if (!process.stdin.isTTY) {
      return;
    }

    // Save original raw mode state
    stdinWasRaw = process.stdin.isRaw || false;

    // Enable raw mode to capture individual keypresses
    process.stdin.setRawMode(true);
    process.stdin.resume();

    // Setup readline to emit keypress events
    rl = readline.createInterface({
      input: process.stdin,
      escapeCodeTimeout: 0,
    });
    readline.emitKeypressEvents(process.stdin, rl);

    // Listen for Ctrl+C
    const keypressHandler = (
      str: string,
      key: { name?: string; ctrl?: boolean },
    ) => {
      // Detect Ctrl+C: either ctrl+c key combo or raw character code 3
      if ((key && key.ctrl && key.name === 'c') || str === '\u0003') {
        // Only handle once
        if (isAborting) {
          return;
        }

        isAborting = true;

        // Only show message if cancellation takes longer than 200ms
        // This reduces verbosity for fast cancellations
        cancelMessageTimer = setTimeout(() => {
          process.stderr.write('\nCancelling...\n');
        }, 200);

        abortController.abort();
        // Note: Don't exit here - let the abort flow through the system
        // and trigger handleCancellationError() which will exit with proper code
      }
    };

    process.stdin.on('keypress', keypressHandler);
  };

  const cleanupStdinCancellation = () => {
    // Clear any pending cancel message timer
    if (cancelMessageTimer) {
      clearTimeout(cancelMessageTimer);
      cancelMessageTimer = null;
    }

    // Cleanup readline and stdin listeners
    if (rl) {
      rl.close();
      rl = null;
    }

    // Remove keypress listener
    process.stdin.removeAllListeners('keypress');

    // Restore stdin to original state
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(stdinWasRaw);
      process.stdin.pause();
    }
  };

  try {
    consolePatcher.patch();
    coreEvents.on(CoreEvent.UserFeedback, handleUserFeedback);
    coreEvents.drainFeedbackBacklog();

    // Handle EPIPE errors when the output is piped to a command that closes early.
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        // Exit gracefully if the pipe is closed.
        process.exit(0);
      }
    });

    const geminiClient = config.getGeminiClient();
    setActiveProviderRuntimeContext({
      settingsService: config.getSettingsService(),
      config,
      runtimeId: config.getSessionId?.(),
      metadata: { source: 'nonInteractiveCli' },
    });

    // Emit init event for streaming JSON
    if (streamFormatter) {
      streamFormatter.emitEvent({
        type: JsonStreamEventType.INIT,
        timestamp: new Date().toISOString(),
        session_id: config.getSessionId(),
        model: config.getModel(),
      });
    }

    // Initialize emoji filter for non-interactive mode
    const emojiFilterMode =
      typeof config.getEphemeralSetting === 'function'
        ? (config.getEphemeralSetting('emojifilter') as EmojiFilterMode) ||
          'auto'
        : 'auto';
    const emojiFilter =
      emojiFilterMode !== 'allowed'
        ? new EmojiFilter({ mode: emojiFilterMode })
        : undefined;

    // Setup stdin cancellation listener
    setupStdinCancellation();

    let query: Part[] | undefined;

    if (isSlashCommand(input)) {
      const slashCommandResult = await handleSlashCommand(
        input,
        abortController,
        config,
        settings,
      );
      // If a slash command is found and returns a prompt, use it.
      // Otherwise, slashCommandResult fall through to the default prompt
      // handling.
      if (slashCommandResult) {
        query = slashCommandResult as Part[];
      }
    }

    if (!query) {
      const { processedQuery, shouldProceed } = await handleAtCommand({
        query: input,
        config,
        addItem: (_item, _timestamp) => 0,
        onDebugMessage: () => {},
        messageId: Date.now(),
        signal: abortController.signal,
      });

      if (!shouldProceed || !processedQuery) {
        // An error occurred during @include processing (e.g., file not found).
        // The error message is already logged by handleAtCommand.
        throw new FatalInputError(
          'Exiting due to an error processing the @ command.',
        );
      }
      query = processedQuery as Part[];
    }

    // Emit user message event for streaming JSON
    if (streamFormatter) {
      streamFormatter.emitEvent({
        type: JsonStreamEventType.MESSAGE,
        timestamp: new Date().toISOString(),
        role: 'user',
        content: input,
      });
    }

    let currentMessages: Part[] = query;

    let jsonResponseText = '';

    let turnCount = 0;
    while (true) {
      turnCount++;
      if (
        config.getMaxSessionTurns() >= 0 &&
        turnCount > config.getMaxSessionTurns()
      ) {
        throw new FatalTurnLimitedError(
          'Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
        );
      }
      const functionCalls: ToolCallRequestInfo[] = [];
      let thoughtBuffer = '';
      // Only emit thinking in plain text mode (not JSON or STREAM_JSON)
      // In STREAM_JSON mode, thinking would corrupt the JSON event stream
      const includeThinking =
        !jsonOutput &&
        !streamJsonOutput &&
        (typeof config.getEphemeralSetting === 'function'
          ? config.getEphemeralSetting('reasoning.includeInResponse') !== false
          : true);

      const flushThoughtBuffer = () => {
        if (!includeThinking) {
          thoughtBuffer = '';
          return;
        }
        if (!thoughtBuffer.trim()) {
          thoughtBuffer = '';
          return;
        }
        process.stdout.write(`<think>${thoughtBuffer.trim()}</think>\n`);
        thoughtBuffer = '';
      };

      const responseStream = geminiClient.sendMessageStream(
        currentMessages,
        abortController.signal,
        prompt_id,
      );

      for await (const event of responseStream) {
        if (abortController.signal.aborted) {
          console.error('Operation cancelled.');
          return;
        }

        if (event.type === GeminiEventType.Thought) {
          if (includeThinking) {
            const thoughtEvent = event as ServerGeminiThoughtEvent;
            const thought = thoughtEvent.value;
            // Format thought with subject and description
            let thoughtText =
              thought.subject && thought.description
                ? `${thought.subject}: ${thought.description}`
                : thought.subject || thought.description || '';

            if (thoughtText.trim()) {
              // Apply emoji filter if enabled
              if (emojiFilter) {
                const filterResult = emojiFilter.filterText(thoughtText);
                if (filterResult.blocked) {
                  continue;
                }
                if (typeof filterResult.filtered === 'string') {
                  thoughtText = filterResult.filtered;
                }
              }
              // Buffer thoughts to prevent duplicate/pyramid output
              thoughtBuffer = thoughtBuffer
                ? `${thoughtBuffer} ${thoughtText}`
                : thoughtText;
            }
          }
        } else if (event.type === GeminiEventType.Content) {
          flushThoughtBuffer();
          let outputValue = event.value;

          if (emojiFilter) {
            const filterResult = emojiFilter.filterStreamChunk(outputValue);

            if (filterResult.blocked) {
              if (!jsonOutput) {
                process.stderr.write(
                  '[Error: Response blocked due to emoji detection]\n',
                );
              }
              continue;
            }

            outputValue =
              typeof filterResult.filtered === 'string'
                ? (filterResult.filtered as string)
                : '';

            if (filterResult.systemFeedback) {
              if (!jsonOutput) {
                process.stderr.write(
                  `Warning: ${filterResult.systemFeedback}\n`,
                );
              }
            }
          }

          if (streamFormatter) {
            streamFormatter.emitEvent({
              type: JsonStreamEventType.MESSAGE,
              timestamp: new Date().toISOString(),
              role: 'assistant',
              content: outputValue,
              delta: true,
            });
          } else if (jsonOutput) {
            jsonResponseText += outputValue;
          } else {
            process.stdout.write(outputValue);
          }
        } else if (event.type === GeminiEventType.ToolCallRequest) {
          flushThoughtBuffer();
          const toolCallRequest = event.value;
          if (streamFormatter) {
            streamFormatter.emitEvent({
              type: JsonStreamEventType.TOOL_USE,
              timestamp: new Date().toISOString(),
              tool_name: toolCallRequest.name,
              tool_id:
                toolCallRequest.callId ??
                `${toolCallRequest.name}-${Date.now()}`,
              parameters: toolCallRequest.args ?? {},
            });
          }
          const normalizedRequest: ToolCallRequestInfo = {
            ...toolCallRequest,
            agentId: toolCallRequest.agentId ?? 'primary',
          };
          functionCalls.push(normalizedRequest);
        } else if (event.type === GeminiEventType.LoopDetected) {
          if (streamFormatter) {
            streamFormatter.emitEvent({
              type: JsonStreamEventType.ERROR,
              timestamp: new Date().toISOString(),
              severity: 'warning',
              message: 'Loop detected, stopping execution',
            });
          }
        } else if (event.type === GeminiEventType.MaxSessionTurns) {
          if (streamFormatter) {
            streamFormatter.emitEvent({
              type: JsonStreamEventType.ERROR,
              timestamp: new Date().toISOString(),
              severity: 'error',
              message: 'Maximum session turns exceeded',
            });
          }
        } else if (event.type === GeminiEventType.Error) {
          throw event.value.error;
        }
      }

      flushThoughtBuffer();

      const remainingBuffered = emojiFilter?.flushBuffer?.();
      if (remainingBuffered) {
        if (jsonOutput) {
          jsonResponseText += remainingBuffered;
        } else {
          process.stdout.write(remainingBuffered);
        }
      }

      if (functionCalls.length > 0) {
        const toolResponseParts: Part[] = [];

        for (const requestFromModel of functionCalls) {
          const callId =
            requestFromModel.callId ?? `${requestFromModel.name}-${Date.now()}`;
          const rawArgs = requestFromModel.args ?? {};
          let normalizedArgs: Record<string, unknown>;
          if (typeof rawArgs === 'string') {
            try {
              const parsed = JSON.parse(rawArgs);
              normalizedArgs =
                parsed && typeof parsed === 'object'
                  ? (parsed as Record<string, unknown>)
                  : {};
            } catch (error) {
              console.error(
                `Failed to parse tool arguments for ${requestFromModel.name}: ${error instanceof Error ? error.message : String(error)}`,
              );
              normalizedArgs = {};
            }
          } else if (Array.isArray(rawArgs)) {
            console.error(
              `Unexpected array arguments for tool ${requestFromModel.name}; coercing to empty object.`,
            );
            normalizedArgs = {};
          } else if (rawArgs && typeof rawArgs === 'object') {
            normalizedArgs = rawArgs as Record<string, unknown>;
          } else {
            normalizedArgs = {};
          }

          const requestInfo: ToolCallRequestInfo = {
            callId,
            name: requestFromModel.name,
            args: normalizedArgs,
            isClientInitiated: false,
            prompt_id: requestFromModel.prompt_id ?? prompt_id,
            agentId: requestFromModel.agentId ?? 'primary',
          };

          const completed = await executeToolCall(
            config,
            requestInfo,
            abortController.signal,
          );
          const toolResponse = completed.response;

          if (streamFormatter) {
            streamFormatter.emitEvent({
              type: JsonStreamEventType.TOOL_RESULT,
              timestamp: new Date().toISOString(),
              tool_id: requestInfo.callId,
              status: toolResponse.error ? 'error' : 'success',
              output:
                typeof toolResponse.resultDisplay === 'string'
                  ? toolResponse.resultDisplay
                  : undefined,
              error: toolResponse.error
                ? {
                    type: toolResponse.errorType || 'TOOL_EXECUTION_ERROR',
                    message: toolResponse.error.message,
                  }
                : undefined,
            });
          }

          if (toolResponse.error) {
            if (!jsonOutput && !streamJsonOutput) {
              console.error(
                `Error executing tool ${requestFromModel.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
              );
            }
          }

          if (toolResponse.responseParts) {
            toolResponseParts.push(...toolResponse.responseParts);
          }
        }
        currentMessages = toolResponseParts;
      } else {
        // Emit final result event for streaming JSON
        if (streamFormatter) {
          const metrics = uiTelemetryService.getMetrics();
          const durationMs = Date.now() - startTime;
          streamFormatter.emitEvent({
            type: JsonStreamEventType.RESULT,
            timestamp: new Date().toISOString(),
            status: 'success',
            stats: streamFormatter.convertToStreamStats(metrics, durationMs),
          });
        } else if (jsonOutput) {
          const payload = JSON.stringify(
            {
              response: jsonResponseText.trimEnd(),
              stats: uiTelemetryService.getMetrics(),
            },
            null,
            2,
          );
          process.stdout.write(`${payload}\n`);
        } else {
          process.stdout.write('\n'); // Ensure a final newline
        }
        return;
      }
    }
  } catch (error) {
    if (!jsonOutput) {
      console.error(parseAndFormatApiError(error));
    }
    throw error;
  } finally {
    // Cleanup stdin cancellation before other cleanup
    cleanupStdinCancellation();

    consolePatcher.cleanup();
    coreEvents.off(CoreEvent.UserFeedback, handleUserFeedback);
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry(config);
    }
  }
}
