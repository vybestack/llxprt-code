/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ToolCallRequestInfo,
  executeToolCall,
  ToolRegistry,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
} from '@vybestack/llxprt-code-core';
import { Content, Part, FunctionCall, PartListUnion } from '@google/genai';

import { parseAndFormatApiError } from './ui/utils/errorParsing.js';

export async function runNonInteractive(
  config: Config,
  input: string,
  prompt_id: string,
): Promise<void> {
  await config.initialize();
  // Handle EPIPE errors when the output is piped to a command that closes early.
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      // Exit gracefully if the pipe is closed.
      process.exit(0);
    }
  });

  const geminiClient = config.getGeminiClient();
  const toolRegistry: ToolRegistry = await config.getToolRegistry();

  const abortController = new AbortController();
  // Add context about current working directory
  const contextMessage = `The current working directory is: ${process.cwd()}`;
  let currentMessages: Content[] = [
    { role: 'user', parts: [{ text: `${contextMessage}\n\n${input}` }] },
  ];
  let turnCount = 0;
  try {
    while (true) {
      turnCount++;
      if (
        config.getMaxSessionTurns() > 0 &&
        turnCount > config.getMaxSessionTurns()
      ) {
        console.error(
          '\n Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
        );
        return;
      }
      const functionCalls: FunctionCall[] = [];

      // For tool responses, send the parts directly; otherwise send just the parts array
      let messageToSend: Part[] | PartListUnion;

      if (process.env.DEBUG) {
        console.log(
          'DEBUG [nonInteractiveCli]: ===== MESSAGE PROCESSING START =====',
        );
        console.log('DEBUG [nonInteractiveCli]: Model:', config.getModel());
        console.log(
          'DEBUG [nonInteractiveCli]: Provider:',
          config.getProvider(),
        );
        console.log(
          'DEBUG [nonInteractiveCli]: Current messages count:',
          currentMessages.length,
        );
        console.log(
          'DEBUG [nonInteractiveCli]: Full currentMessages:',
          JSON.stringify(currentMessages, null, 2),
        );
      }

      if (currentMessages[0]?.parts?.[0]?.functionResponse) {
        // Send tool response parts directly
        messageToSend = currentMessages[0].parts;
        if (process.env.DEBUG) {
          console.log('DEBUG [nonInteractiveCli]: Message type: TOOL RESPONSE');
          console.log(
            'DEBUG [nonInteractiveCli]: Sending tool response parts:',
            JSON.stringify(messageToSend, null, 2),
          );
        }
      } else {
        // Send just the parts array from the first message
        // This matches what interactive mode does when it sends req (PartListUnion)
        messageToSend = currentMessages[0]?.parts || [];
        if (process.env.DEBUG) {
          console.log(
            'DEBUG [nonInteractiveCli]: Message type: REGULAR MESSAGE',
          );
          console.log(
            'DEBUG [nonInteractiveCli]: Sending message parts:',
            JSON.stringify(messageToSend, null, 2),
          );
          console.log(
            'DEBUG [nonInteractiveCli]: Parts array length:',
            messageToSend.length,
          );
          console.log(
            'DEBUG [nonInteractiveCli]: Parts array types:',
            messageToSend.map((p: Part) => Object.keys(p)),
          );
        }
      }
      if (process.env.DEBUG) {
        console.log(
          'DEBUG [nonInteractiveCli]: ===== MESSAGE PROCESSING END =====',
        );
      }

      if (process.env.DEBUG) {
        console.log(
          'DEBUG [nonInteractiveCli]: Model being used:',
          config.getModel(),
        );
        console.log(
          'DEBUG [nonInteractiveCli]: About to call sendMessageStream with messageToSend',
        );
      }

      const responseStream = geminiClient.sendMessageStream(
        messageToSend,
        abortController.signal,
        prompt_id,
      );

      for await (const event of responseStream) {
        if (abortController.signal.aborted) {
          console.error('Operation cancelled.');
          return;
        }

        // Handle different event types
        switch (event.type) {
          case 'content':
            process.stdout.write(event.value);
            break;

          case 'tool_call_request':
            // Store the tool call request for processing
            functionCalls.push({
              name: event.value.name,
              args: event.value.args,
              id: event.value.callId,
            });
            break;

          case 'error':
            console.error('\nError:', event.value.error.message);
            return;

          case 'max_session_turns':
            console.error('\nReached max session turns for this session.');
            return;

          case 'loop_detected':
            console.error('\nLoop detected in conversation.');
            return;

          default:
            // Handle any unexpected event types
            break;
        }
      }

      if (functionCalls.length > 0) {
        const toolResponseParts: Part[] = [];

        for (const fc of functionCalls) {
          const callId = fc.id ?? `${fc.name}-${Date.now()}`;
          const requestInfo: ToolCallRequestInfo = {
            callId,
            name: fc.name as string,
            args: (fc.args ?? {}) as Record<string, unknown>,
            isClientInitiated: false,
            prompt_id,
          };

          const toolResponse = await executeToolCall(
            config,
            requestInfo,
            toolRegistry,
            abortController.signal,
          );

          if (toolResponse.error) {
            const isToolNotFound = toolResponse.error.message.includes(
              'not found in registry',
            );
            console.error(
              `Error executing tool ${fc.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
            );
            if (!isToolNotFound) {
              process.exit(1);
            }
          }

          // Emit resultDisplay to stdout exactly as produced when available (string only)
          if (typeof toolResponse.resultDisplay === 'string') {
            process.stdout.write(toolResponse.resultDisplay);
          }

          if (toolResponse.responseParts) {
            // Handle responseParts as PartListUnion (can be Part, Part[], or string)
            const parts = toolResponse.responseParts;

            if (Array.isArray(parts)) {
              // Handle each part in the array
              for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (typeof part === 'string') {
                  toolResponseParts.push({ text: part });
                } else {
                  toolResponseParts.push(part as Part);
                }
              }
            } else if (typeof parts === 'string') {
              toolResponseParts.push({ text: parts });
            } else {
              toolResponseParts.push(parts as Part);
            }
          }
        }

        // Don't wrap in Content structure - send parts directly like interactive mode
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
    process.exit(1);
  } finally {
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry();
    }
  }
}
