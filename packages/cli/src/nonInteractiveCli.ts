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
  type EmojiFilterMode,
  type IContent,
} from '@vybestack/llxprt-code-core';
import { Content, Part, FunctionCall } from '@google/genai';

import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { handleAtCommand } from './ui/hooks/atCommandProcessor.js';

function partsToPlainText(parts: Part[]): string {
  return parts
    .map((part) => {
      if (part && typeof part === 'object' && 'text' in part) {
        const textValue = (part as { text?: unknown }).text;
        return typeof textValue === 'string' ? textValue : '';
      }
      return '';
    })
    .join('');
}

export async function runNonInteractive(
  config: Config,
  input: string,
  prompt_id: string,
): Promise<void> {
  const consolePatcher = new ConsolePatcher({
    stderr: true,
    debugMode: config.getDebugMode(),
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

    const providerManager = config.getProviderManager?.();
    const activeProvider =
      providerManager && typeof providerManager.getActiveProvider === 'function'
        ? providerManager.getActiveProvider()
        : null;
    const useGeminiPipeline =
      !activeProvider || activeProvider.name === 'gemini';

    if (!useGeminiPipeline) {
      const userText = partsToPlainText(processedQuery as Part[]);
      const humanContent: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: userText }],
      };

      const pendingToolCalls: FunctionCall[] = [];
      const responseIterator = activeProvider.generateChatCompletion([
        humanContent,
      ]);

      for await (const content of responseIterator) {
        for (const block of content.blocks ?? []) {
          if (block.type === 'text') {
            let outputValue = block.text ?? '';
            if (emojiFilter) {
              const filterResult = emojiFilter.filterStreamChunk(outputValue);
              if (filterResult.blocked) {
                process.stderr.write(
                  '[Error: Response blocked due to emoji detection]\n',
                );
                continue;
              }

              outputValue =
                typeof filterResult.filtered === 'string'
                  ? (filterResult.filtered as string)
                  : '';

              if (filterResult.systemFeedback) {
                process.stderr.write(
                  `Warning: ${filterResult.systemFeedback}\n`,
                );
              }
            }

            if (outputValue) {
              process.stdout.write(outputValue);
            }
          } else if (block.type === 'tool_call') {
            pendingToolCalls.push({
              name: block.name,
              args: block.parameters as Record<string, unknown>,
              id: block.id,
            });
          }
        }
      }

      const remainingBuffered = emojiFilter?.flushBuffer?.();
      if (remainingBuffered) {
        process.stdout.write(remainingBuffered);
      }

      if (pendingToolCalls.length > 0) {
        console.warn(
          '[bootstrap] Tool calls returned during non-interactive execution are not yet supported; ignoring.',
        );
      }

      process.stdout.write('\n');
      return;
    }

    let currentMessages: Content[] = [
      { role: 'user', parts: processedQuery as Part[] },
    ];

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

        if (event.type === GeminiEventType.Content) {
          // Apply emoji filtering to content output
          let outputValue = event.value;
          if (emojiFilter) {
            const filterResult = emojiFilter.filterStreamChunk(event.value);

            if (filterResult.blocked) {
              // In error mode: output error message and continue
              process.stderr.write(
                '[Error: Response blocked due to emoji detection]\n',
              );
              continue;
            }

            outputValue =
              typeof filterResult.filtered === 'string'
                ? (filterResult.filtered as string)
                : '';

            // Output system feedback if needed
            if (filterResult.systemFeedback) {
              process.stderr.write(`Warning: ${filterResult.systemFeedback}\n`);
            }
          }

          process.stdout.write(outputValue);
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
        process.stdout.write(remainingBuffered);
      }

      if (functionCalls.length > 0) {
        const toolResponseParts: Part[] = [];

        for (const requestFromModel of functionCalls) {
          const callId =
            requestFromModel.callId ?? `${requestFromModel.name}-${Date.now()}`;
          const requestInfo: ToolCallRequestInfo = {
            callId,
            name: requestFromModel.name,
            args: (requestFromModel.args ?? {}) as Record<string, unknown>,
            isClientInitiated: false,
            prompt_id: requestFromModel.prompt_id ?? prompt_id,
            agentId: requestFromModel.agentId ?? 'primary',
          };

          const toolResponse = await executeToolCall(
            config,
            requestInfo,
            abortController.signal,
          );

          if (toolResponse.error) {
            console.error(
              `Error executing tool ${requestFromModel.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
            );
          }

          if (toolResponse.responseParts) {
            toolResponseParts.push(...toolResponse.responseParts);
          }
        }
        currentMessages = [{ role: 'user', parts: toolResponseParts }];
      } else {
        process.stdout.write('\n'); // Ensure a final newline
        return;
      }
    }
  } catch (error) {
    console.error(
      parseAndFormatApiError(
        error,
        config.getContentGeneratorConfig()?.authType,
      ),
    );
    throw error;
  } finally {
    consolePatcher.cleanup();
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry(config);
    }
  }
}
