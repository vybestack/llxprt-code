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
} from '@google/gemini-cli-core';
import {
  Content,
  Part,
  FunctionCall,
  GenerateContentResponse,
} from '@google/genai';

import { parseAndFormatApiError } from './ui/utils/errorParsing.js';

function getResponseText(response: GenerateContentResponse): string | null {
  if (response.candidates && response.candidates.length > 0) {
    const candidate = response.candidates[0];
    if (
      candidate.content &&
      candidate.content.parts &&
      candidate.content.parts.length > 0
    ) {
      // We are running in headless mode so we don't need to return thoughts to STDOUT.
      const thoughtPart = candidate.content.parts[0];
      if (thoughtPart?.thought) {
        return null;
      }
      return candidate.content.parts
        .filter((part) => part.text)
        .map((part) => part.text)
        .join('');
    }
  }
  return null;
}

export async function runNonInteractive(
  config: Config,
  input: string,
  prompt_id: string,
): Promise<void> {
  console.log('[YOLO DEBUG] runNonInteractive started');
  console.log('[YOLO DEBUG] approvalMode:', config.getApprovalMode());

  console.log('[YOLO DEBUG] Initializing config...');
  try {
    await config.initialize();
    console.log('[YOLO DEBUG] Config initialized');
  } catch (error) {
    console.error('[YOLO DEBUG] Error initializing config:', error);
    throw error;
  }
  // Handle EPIPE errors when the output is piped to a command that closes early.
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      // Exit gracefully if the pipe is closed.
      process.exit(0);
    }
  });

  const geminiClient = config.getGeminiClient();
  console.log('[YOLO DEBUG] Got gemini client');

  const toolRegistry: ToolRegistry = await config.getToolRegistry();
  console.log(
    '[YOLO DEBUG] Available tools:',
    toolRegistry.getFunctionDeclarations().map((f) => f.name),
  );

  console.log('[YOLO DEBUG] Getting chat...');
  const chat = await geminiClient.getChat();
  console.log('[YOLO DEBUG] Got chat');

  const abortController = new AbortController();
  let currentMessages: Content[] = [{ role: 'user', parts: [{ text: input }] }];
  console.log('[YOLO DEBUG] Initial message:', input);

  try {
    while (true) {
      const functionCalls: FunctionCall[] = [];

      console.log('[YOLO DEBUG] Sending message to chat...');
      console.log('[YOLO DEBUG] Message parts:', currentMessages[0]?.parts);

      const responseStream = await chat.sendMessageStream(
        {
          message: currentMessages[0]?.parts || [], // Ensure parts are always provided
          config: {
            abortSignal: abortController.signal,
            tools: [
              { functionDeclarations: toolRegistry.getFunctionDeclarations() },
            ],
          },
        },
        prompt_id,
      );

      console.log('[YOLO DEBUG] Got response stream');

      for await (const resp of responseStream) {
        console.log(
          '[YOLO DEBUG] Response received:',
          JSON.stringify(resp, null, 2),
        );

        if (abortController.signal.aborted) {
          console.error('Operation cancelled.');
          return;
        }
        const textPart = getResponseText(resp);
        if (textPart) {
          console.log('[YOLO DEBUG] Text response:', textPart);
          process.stdout.write(textPart);
        }

        // Extract function calls from the response
        if (resp.candidates && resp.candidates.length > 0) {
          const candidate = resp.candidates[0];
          if (candidate.content && candidate.content.parts) {
            const extractedFunctionCalls = candidate.content.parts
              .filter((part) => !!part.functionCall)
              .map((part) => part.functionCall as FunctionCall);

            console.log(
              '[YOLO DEBUG] Extracted function calls:',
              extractedFunctionCalls,
            );

            if (extractedFunctionCalls.length > 0) {
              functionCalls.push(...extractedFunctionCalls);
              console.log(
                '[YOLO DEBUG] Total function calls so far:',
                functionCalls.length,
              );
            }
          }
        }

        // Also check the old way just in case
        if (resp.functionCalls) {
          console.log(
            '[YOLO DEBUG] Found resp.functionCalls (old way):',
            resp.functionCalls,
          );
          functionCalls.push(...resp.functionCalls);
        }
      }

      if (functionCalls.length > 0) {
        console.log(
          '[YOLO DEBUG] Function calls detected:',
          functionCalls.map((fc) => fc.name),
        );
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

          console.log(
            '[YOLO DEBUG] Executing tool:',
            fc.name,
            'with args:',
            fc.args,
          );

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
          } else {
            console.log('[YOLO DEBUG] Tool executed successfully:', fc.name);
            console.log(
              '[YOLO DEBUG] Tool response:',
              toolResponse.resultDisplay,
            );
          }

          if (toolResponse.responseParts) {
            const parts = Array.isArray(toolResponse.responseParts)
              ? toolResponse.responseParts
              : [toolResponse.responseParts];
            for (const part of parts) {
              if (typeof part === 'string') {
                toolResponseParts.push({ text: part });
              } else if (part) {
                toolResponseParts.push(part);
              }
            }
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
        config.getContentGeneratorConfig().authType,
      ),
    );
    process.exit(1);
  } finally {
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry();
    }
  }
}
