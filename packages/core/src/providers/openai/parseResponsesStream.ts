/**
 * Parses OpenAI Responses API server-sent events (SSE) and yields IContent messages.
 * Handles text output, tool calls, reasoning/thinking content, and usage metadata.
 *
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */
import {
  type ContentBlock,
  type IContent,
} from '../../services/history/IContent.js';
import { createStreamInterruptionError } from '../../utils/retry.js';
import { DebugLogger } from '../../debug/index.js';

const logger = new DebugLogger('llxprt:providers:openai-responses:sse');

// Types for Responses API events
interface ResponsesEvent {
  type: string;
  sequence_number?: number;
  output_index?: number;
  delta?: string;
  text?: string;
  content_index?: number;
  summary_index?: number;
  item?: {
    id: string;
    type: string;
    status?: string;
    arguments?: string;
    call_id?: string;
    name?: string;
    summary?: Array<{ type: string; text?: string }>;
    content?: Array<{ type: string; text?: string }>;
    encrypted_content?: string;
  };
  item_id?: string;
  arguments?: string;
  response?: {
    id: string;
    object: string;
    model: string;
    status: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      input_tokens_details?: {
        cached_tokens?: number;
      };
    };
  };
}

// Track function calls as they are built up
interface FunctionCallState {
  id: string;
  call_id?: string;
  name: string;
  arguments: string;
}

function appendReasoningDelta(current: string, delta: string): string {
  if (!delta) {
    return current;
  }
  if (!current) {
    return delta;
  }
  const lastChar = current[current.length - 1] ?? '';
  const nextChar = delta[0] ?? '';
  const needsSpace =
    /[\w)]/.test(lastChar) && /[\w(]/.test(nextChar) && !/\s/.test(nextChar);
  return needsSpace ? `${current} ${delta}` : `${current}${delta}`;
}

/**
 * Options for parseResponsesStream.
 */
export interface ParseResponsesStreamOptions {
  /**
   * Whether to emit ThinkingBlock content in the output stream.
   * When false, reasoning content is still accumulated but not yielded.
   * Defaults to true.
   */
  includeThinkingInResponse?: boolean;
}

export async function* parseResponsesStream(
  stream: ReadableStream<Uint8Array>,
  options: ParseResponsesStreamOptions = {},
): AsyncIterableIterator<IContent> {
  const { includeThinkingInResponse = true } = options;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const functionCalls = new Map<string, FunctionCallState>();
  let reasoningText = '';
  let reasoningSummaryText = '';

  // Track emitted thinking content to prevent duplicates (fixes #922).
  // The API can send the same reasoning via multiple event types:
  // - response.reasoning_text.done / response.reasoning_summary_text.done
  // - response.output_item.done with item.type === 'reasoning'
  // - response.completed / response.done (fallback)
  // We use a Map to track both emission AND whether we've captured encrypted_content.
  // This handles the case where reasoning_text.done arrives before output_item.done:
  // - First event (reasoning_text.done): emit visible block, record hasEncrypted: false
  // - Second event (output_item.done with encrypted_content): re-emit hidden block WITH encrypted_content
  const emittedThoughts = new Map<string, { hasEncrypted: boolean }>();

  let lastLoggedType: string | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      // Decode chunk and add to buffer
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.substring(6);

          // Skip [DONE] marker
          if (data === '[DONE]') continue;

          try {
            const event: ResponsesEvent = JSON.parse(data);

            // SSE event visibility for debugging reasoning support.
            // We log to stderr directly so it shows up in debug logs even if
            // Track last logged type to avoid duplicate logs
            if (event.type !== lastLoggedType) {
              lastLoggedType = event.type;
            }

            // Debug: Log ALL events with full details
            logger.debug(
              () =>
                `SSE event: type=${event.type}, delta="${event.delta?.slice(0, 50) ?? ''}", text="${event.text?.slice(0, 50) ?? ''}", item_type=${event.item?.type ?? 'none'}, summary_index=${event.summary_index ?? 'none'}, content_index=${event.content_index ?? 'none'}`,
            );
            // Extra debug for any reasoning-related events
            if (
              event.type.includes('reasoning') ||
              event.item?.type === 'reasoning'
            ) {
              logger.debug(
                () => `REASONING SSE: ${JSON.stringify(event).slice(0, 500)}`,
              );
            }

            // Debug: Log raw reasoning items
            if (event.item?.type === 'reasoning') {
              logger.debug(
                () =>
                  `Reasoning item received: summary=${JSON.stringify(event.item?.summary)}, content=${JSON.stringify(event.item?.content)}, encrypted_content_length=${event.item?.encrypted_content?.length ?? 0}`,
              );
            }

            // Handle different event types
            switch (event.type) {
              case 'response.output_text.delta':
                // Text content chunk
                if (event.delta) {
                  yield {
                    speaker: 'ai',
                    blocks: [{ type: 'text', text: event.delta }],
                  };
                }
                break;

              case 'response.reasoning_text.delta': {
                if (event.delta) {
                  reasoningText = appendReasoningDelta(
                    reasoningText,
                    event.delta,
                  );
                }
                break;
              }

              case 'response.reasoning_summary_text.delta': {
                if (event.delta) {
                  reasoningSummaryText = appendReasoningDelta(
                    reasoningSummaryText,
                    event.delta,
                  );
                }
                break;
              }

              case 'response.reasoning_text.done': {
                // Yield accumulated reasoning as a single block (if not already emitted)
                // When includeThinkingInResponse is false, still emit but with isHidden: true
                // This preserves encrypted content for round-trip while hiding UI display
                const thoughtContent = (event.text || reasoningText).trim();
                if (thoughtContent && !emittedThoughts.has(thoughtContent)) {
                  // Mark as emitted without encrypted content - output_item.done may follow with it
                  emittedThoughts.set(thoughtContent, { hasEncrypted: false });
                  yield {
                    speaker: 'ai',
                    blocks: [
                      {
                        type: 'thinking',
                        thought: thoughtContent,
                        sourceField: 'reasoning_content',
                        isHidden: !includeThinkingInResponse,
                      },
                    ],
                  };
                }
                reasoningText = '';
                break;
              }

              case 'response.reasoning_summary_text.done': {
                // Yield accumulated summary as a single block (if not already emitted)
                // When includeThinkingInResponse is false, still emit but with isHidden: true
                // This preserves encrypted content for round-trip while hiding UI display
                const summaryContent = (
                  event.text || reasoningSummaryText
                ).trim();
                if (summaryContent && !emittedThoughts.has(summaryContent)) {
                  // Mark as emitted without encrypted content - output_item.done may follow with it
                  emittedThoughts.set(summaryContent, { hasEncrypted: false });
                  yield {
                    speaker: 'ai',
                    blocks: [
                      {
                        type: 'thinking',
                        thought: summaryContent,
                        sourceField: 'reasoning_content',
                        isHidden: !includeThinkingInResponse,
                      },
                    ],
                  };
                }
                reasoningSummaryText = '';
                break;
              }

              case 'response.output_item.added':
                // New function call started
                if (event.item?.type === 'function_call' && event.item.id) {
                  functionCalls.set(event.item.id, {
                    id: event.item.id,
                    call_id: event.item.call_id,
                    name: event.item.name || '',
                    arguments: event.item.arguments || '',
                  });
                }
                break;

              case 'response.function_call_arguments.delta':
                // Function call arguments chunk
                if (event.item_id && event.delta) {
                  const call = functionCalls.get(event.item_id);
                  if (call) {
                    call.arguments += event.delta;
                  }
                }
                break;

              case 'response.function_call_arguments.done':
              case 'response.output_item.done':
                // Handle reasoning items
                // Per codex-rs: thinking text comes from summary array and content array
                // The encrypted_content is NOT decoded client-side - it's stored and sent back to API
                if (event.item?.type === 'reasoning') {
                  let thoughtText =
                    event.item.summary
                      ?.map((s: { text?: string }) => s.text)
                      .filter(Boolean)
                      .join(' ') || '';

                  if (!thoughtText && event.item.content) {
                    thoughtText = event.item.content
                      .map((c: { text?: string }) => c.text)
                      .filter(Boolean)
                      .join(' ');
                  }

                  const itemText = thoughtText.trim();

                  if (!itemText) {
                    if (reasoningSummaryText.trim()) {
                      thoughtText = reasoningSummaryText.trim();
                    } else if (reasoningText.trim()) {
                      thoughtText = reasoningText.trim();
                    }
                  }

                  logger.debug(
                    () =>
                      `Reasoning item: thoughtText=${thoughtText.length} chars, summary=${event.item?.summary?.length ?? 0}, content=${event.item?.content?.length ?? 0}, encrypted=${event.item?.encrypted_content?.length ?? 0}`,
                  );

                  const finalThought = thoughtText.trim();
                  const hasEncryptedContent = Boolean(
                    event.item?.encrypted_content,
                  );
                  const prior = emittedThoughts.get(finalThought);

                  // Emit if:
                  // 1. Never emitted this thought before, OR
                  // 2. Previously emitted WITHOUT encrypted_content, but now we have it
                  //    (reasoning_text.done arrived before output_item.done)
                  const shouldEmit =
                    finalThought &&
                    (!prior || (hasEncryptedContent && !prior.hasEncrypted));

                  if (shouldEmit) {
                    // If re-emitting for encrypted_content, hide it so UI doesn't show duplicate
                    const shouldHide =
                      !includeThinkingInResponse || Boolean(prior);

                    const baseReasoningBlock: ContentBlock = {
                      type: 'thinking',
                      thought: finalThought,
                      sourceField: 'reasoning_content',
                      isHidden: shouldHide,
                    };
                    const reasoningBlock: ContentBlock = hasEncryptedContent
                      ? {
                          ...baseReasoningBlock,
                          encryptedContent: event.item?.encrypted_content,
                        }
                      : baseReasoningBlock;

                    yield {
                      speaker: 'ai',
                      blocks: [reasoningBlock],
                    };

                    // Update tracking
                    emittedThoughts.set(finalThought, {
                      hasEncrypted:
                        Boolean(prior?.hasEncrypted) || hasEncryptedContent,
                    });
                  }

                  // Clear buffers regardless of whether we emitted
                  reasoningText = '';
                  reasoningSummaryText = '';

                  break;
                }

                // Function call completed
                if (event.item?.type === 'function_call' || event.item_id) {
                  const itemId = event.item?.id || event.item_id;
                  if (itemId) {
                    const call = functionCalls.get(itemId);
                    if (call) {
                      // Use final arguments from event if available, otherwise use accumulated
                      const finalArguments = event.arguments || call.arguments;

                      let parsedArguments: unknown = {};
                      if (finalArguments) {
                        try {
                          parsedArguments = JSON.parse(finalArguments);
                        } catch (parseError) {
                          throw createStreamInterruptionError(
                            'Streaming tool call arguments were malformed JSON.',
                            {
                              itemId,
                              snippet: finalArguments.slice(0, 200),
                            },
                            parseError,
                          );
                        }
                      }

                      yield {
                        speaker: 'ai',
                        blocks: [
                          {
                            type: 'tool_call',
                            id: call.call_id || call.id,
                            name: call.name,
                            parameters: parsedArguments,
                          },
                        ],
                      };

                      // Clean up
                      functionCalls.delete(itemId);
                    }
                  }
                }
                break;

              case 'response.completed':
              case 'response.done': {
                // Fallback: emit any remaining reasoning that wasn't emitted via other events
                // When includeThinkingInResponse is false, still emit but with isHidden: true
                // This preserves encrypted content for round-trip while hiding UI display
                const remainingReasoning = reasoningText.trim();
                if (
                  remainingReasoning &&
                  !emittedThoughts.has(remainingReasoning)
                ) {
                  emittedThoughts.set(remainingReasoning, {
                    hasEncrypted: false,
                  });
                  yield {
                    speaker: 'ai',
                    blocks: [
                      {
                        type: 'thinking',
                        thought: remainingReasoning,
                        sourceField: 'reasoning_content',
                        isHidden: !includeThinkingInResponse,
                      },
                    ],
                  };
                }
                const remainingSummary = reasoningSummaryText.trim();
                if (
                  remainingSummary &&
                  !emittedThoughts.has(remainingSummary)
                ) {
                  emittedThoughts.set(remainingSummary, {
                    hasEncrypted: false,
                  });
                  yield {
                    speaker: 'ai',
                    blocks: [
                      {
                        type: 'thinking',
                        thought: remainingSummary,
                        sourceField: 'reasoning_content',
                        isHidden: !includeThinkingInResponse,
                      },
                    ],
                  };
                }
                reasoningText = '';
                reasoningSummaryText = '';

                // Usage data - handle both response.completed (OpenAI) and response.done (Codex)
                if (event.response?.usage) {
                  yield {
                    speaker: 'ai',
                    blocks: [],
                    metadata: {
                      usage: {
                        promptTokens: event.response.usage.input_tokens,
                        completionTokens: event.response.usage.output_tokens,
                        totalTokens: event.response.usage.total_tokens,
                        cachedTokens:
                          event.response.usage.input_tokens_details
                            ?.cached_tokens ?? 0,
                      },
                    },
                  };
                }
                break;
              }

              default:
                // Ignore unknown event types
                break;
            }
          } catch {
            // Skip malformed JSON events
            continue;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function parseErrorResponse(
  status: number,
  body: string,
  providerName: string,
): Error {
  // Try to parse JSON error response first
  try {
    const errorData = JSON.parse(body);

    // Handle various error response formats
    let message = 'Unknown error';
    if (errorData.error?.message) {
      message = errorData.error.message;
    } else if (errorData.error?.description) {
      message = errorData.error.description;
    } else if (errorData.message) {
      message = errorData.message;
    } else if (errorData.description) {
      message = errorData.description;
    } else if (typeof errorData === 'string') {
      message = errorData;
    }

    // Determine the error prefix based on specific status codes
    let errorPrefix = 'API Error';
    switch (status) {
      case 409:
        errorPrefix = 'Conflict';
        break;
      case 410:
        errorPrefix = 'Gone';
        break;
      case 418: {
        // For 418 I'm a teapot, just return the message without prefix
        const teapotError = new Error(message);
        (teapotError as { status?: number }).status = status;
        (teapotError as { code?: string }).code =
          errorData.error?.code || errorData.code;
        return teapotError;
      }
      case 429:
        errorPrefix = 'Rate limit exceeded';
        break;
      default:
        if (status >= 400 && status < 500) {
          errorPrefix = 'Client error';
        } else if (status >= 500 && status < 600) {
          errorPrefix = 'Server error';
        }
    }

    const error = new Error(`${errorPrefix}: ${message}`);
    (error as { status?: number }).status = status;
    (error as { code?: string }).code = errorData.error?.code || errorData.code;
    return error;
  } catch {
    // For invalid JSON, use a consistent format
    const errorPrefix =
      status >= 500 && status < 600 ? 'Server error' : 'API Error';
    const error = new Error(
      `${errorPrefix}: ${providerName} API error: ${status}`,
    );
    (error as { status?: number }).status = status;
    return error;
  }
}
