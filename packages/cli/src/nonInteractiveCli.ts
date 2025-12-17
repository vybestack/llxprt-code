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
  uiTelemetryService,
  type EmojiFilterMode,
  type ServerGeminiThoughtEvent,
} from '@vybestack/llxprt-code-core';
import { Content, Part } from '@google/genai';
import { isSlashCommand } from './ui/utils/commandUtils.js';
import type { LoadedSettings } from './config/settings.js';

import { handleSlashCommand } from './nonInteractiveCliCommands.js';
import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { handleAtCommand } from './ui/hooks/atCommandProcessor.js';

export async function runNonInteractive(
  config: Config,
  settings: LoadedSettings,
  input: string,
  prompt_id: string,
): Promise<void> {
  const outputFormat =
    typeof config.getOutputFormat === 'function'
      ? config.getOutputFormat()
      : OutputFormat.TEXT;
  const jsonOutput = outputFormat === OutputFormat.JSON;

  const consolePatcher = new ConsolePatcher({
    stderr: !jsonOutput,
    debugMode: jsonOutput ? false : config.getDebugMode(),
  });

  try {
    consolePatcher.patch();
    // Handle EPIPE errors when the output is piped to a command that closes early.
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        // Exit gracefully if the pipe is closed.
        process.exit(0);
      }
    });

    const geminiClient = config.getGeminiClient();

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

    const abortController = new AbortController();

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

    let currentMessages: Content[] = [{ role: 'user', parts: query }];

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

      const responseStream = geminiClient.sendMessageStream(
        currentMessages[0]?.parts || [],
        abortController.signal,
        prompt_id,
      );

      for await (const event of responseStream) {
        if (abortController.signal.aborted) {
          console.error('Operation cancelled.');
          return;
        }

        if (event.type === GeminiEventType.Thought) {
          // Output thinking/reasoning content with <think> tags
          // Check if reasoning.includeInResponse is enabled
          if (jsonOutput) {
            continue;
          }
          const includeThinking =
            typeof config.getEphemeralSetting === 'function'
              ? (config.getEphemeralSetting('reasoning.includeInResponse') ??
                true)
              : true;

          if (includeThinking) {
            const thoughtEvent = event as ServerGeminiThoughtEvent;
            const thought = thoughtEvent.value;
            // Format thought with subject and description
            const thoughtText =
              thought.subject && thought.description
                ? `${thought.subject}: ${thought.description}`
                : thought.subject || thought.description || '';

            if (thoughtText.trim()) {
              process.stdout.write(`<think>${thoughtText}</think>\n`);
            }
          }
        } else if (event.type === GeminiEventType.Content) {
          // Apply emoji filtering to content output
          // Note: <think> tags are preserved in output to show thinking vs non-thinking content
          let outputValue = event.value;

          if (emojiFilter) {
            const filterResult = emojiFilter.filterStreamChunk(outputValue);

            if (filterResult.blocked) {
              // In error mode: output error message and continue
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

            // Output system feedback if needed
            if (filterResult.systemFeedback) {
              if (!jsonOutput) {
                process.stderr.write(
                  `Warning: ${filterResult.systemFeedback}\n`,
                );
              }
            }
          }

          if (jsonOutput) {
            jsonResponseText += outputValue;
          } else {
            process.stdout.write(outputValue);
          }
        } else if (event.type === GeminiEventType.ToolCallRequest) {
          const toolCallRequest = event.value;
          const normalizedRequest: ToolCallRequestInfo = {
            ...toolCallRequest,
            agentId: toolCallRequest.agentId ?? 'primary',
          };
          functionCalls.push(normalizedRequest);
        }
      }

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

          if (toolResponse.error) {
            if (!jsonOutput) {
              console.error(
                `Error executing tool ${requestFromModel.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
              );
            }
          }

          if (toolResponse.responseParts) {
            toolResponseParts.push(...toolResponse.responseParts);
          }
        }
        currentMessages = [{ role: 'user', parts: toolResponseParts }];
      } else {
        if (jsonOutput) {
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
      console.error(
        parseAndFormatApiError(
          error,
          config.getContentGeneratorConfig()?.authType,
        ),
      );
    }
    throw error;
  } finally {
    consolePatcher.cleanup();
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry(config);
    }
  }
}
