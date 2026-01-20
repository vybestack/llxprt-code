/**
 * Parses OpenAI Responses API server-sent events (SSE) and yields IContent messages.
 * Handles text output, tool calls, reasoning/thinking content, and usage metadata.
 *
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */
import { type IContent } from '../../services/history/IContent.js';
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

export async function* parseResponsesStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterableIterator<IContent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const functionCalls = new Map<string, FunctionCallState>();
  let reasoningText = '';
  let reasoningSummaryText = '';

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
            logger.debug(() => `SSE event: type=${event.type}, delta="${event.delta?.slice(0,50) ?? ''}", text="${event.text?.slice(0,50) ?? ''}", item_type=${event.item?.type ?? 'none'}, summary_index=${event.summary_index ?? 'none'}, content_index=${event.content_index ?? 'none'}`);
            // Extra debug for any reasoning-related events
            if (event.type.includes('reasoning') || event.item?.type === 'reasoning') {
              logger.debug(() => `REASONING SSE: ${JSON.stringify(event).slice(0, 500)}`);
            }

            // Debug: Log raw reasoning items
            if (event.item?.type === 'reasoning') {
              logger.debug(() => `Reasoning item received: summary=${JSON.stringify(event.item?.summary)}, content=${JSON.stringify(event.item?.content)}, encrypted_content_length=${event.item?.encrypted_content?.length ?? 0}`);
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

              case 'response.reasoning_text.delta':
                // Reasoning content chunk
                if (event.delta) {
                  reasoningText += event.delta;
                }
                break;

              case 'response.reasoning_summary_text.delta':
                // Reasoning summary content chunk (streamed from Codex API)
                if (event.delta) {
                  reasoningSummaryText += event.delta;
                }
                break;

              case 'response.reasoning_text.done':
                // Reasoning completed - yield accumulated reasoning
                if (reasoningText.trim()) {
                  yield {
                    speaker: 'ai',
                    blocks: [
                      {
                        type: 'thinking',
                        thought: event.text || reasoningText,
                        sourceField: 'reasoning_content',
                      },
                    ],
                  };
                }
                reasoningText = '';
                break;

              case 'response.reasoning_summary_text.done':
                // Reasoning summary completed - yield accumulated summary
                if (reasoningSummaryText.trim()) {
                  yield {
                    speaker: 'ai',
                    blocks: [
                      {
                        type: 'thinking',
                        thought: event.text || reasoningSummaryText,
                        sourceField: 'reasoning_content',
                      },
                    ],
                  };
                }
                reasoningSummaryText = '';
                break;

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
                  // First try summary text (from response.reasoning_summary_text.delta events)
                  let thoughtText =
                    event.item.summary
                      ?.map((s: { text?: string }) => s.text)
                      .filter(Boolean)
                      .join(' ') || '';

                  // If no summary, try content array (from response.reasoning_text.delta events)
                  if (!thoughtText && event.item.content) {
                    thoughtText = event.item.content
                      .map((c: { text?: string }) => c.text)
                      .filter(Boolean)
                      .join(' ');
                  }

                  // If still no text from item, use accumulated deltas
                  if (!thoughtText && reasoningSummaryText.trim()) {
                    thoughtText = reasoningSummaryText.trim();
                    reasoningSummaryText = '';
                  }
                  if (!thoughtText && reasoningText.trim()) {
                    thoughtText = reasoningText.trim();
                    reasoningText = '';
                  }

                  logger.debug(
                    () =>
                      `Reasoning item: thoughtText=${thoughtText.length} chars, summary=${event.item?.summary?.length ?? 0}, content=${event.item?.content?.length ?? 0}, encrypted=${event.item?.encrypted_content?.length ?? 0}`,
                  );

                  // Only yield if we have text to show
                  if (thoughtText) {
                    yield {
                      speaker: 'ai',
                      blocks: [
                        {
                          type: 'thinking',
                          thought: thoughtText,
                          sourceField: 'reasoning_content',
                        },
                      ],
                    };
                  }
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
              case 'response.done':
                // Yield any remaining reasoning before usage data
                if (reasoningText.trim()) {
                  yield {
                    speaker: 'ai',
                    blocks: [
                      {
                        type: 'thinking',
                        thought: reasoningText,
                        sourceField: 'reasoning_content',
                      },
                    ],
                  };
                  reasoningText = '';
                }
                if (reasoningSummaryText.trim()) {
                  yield {
                    speaker: 'ai',
                    blocks: [
                      {
                        type: 'thinking',
                        thought: reasoningSummaryText,
                        sourceField: 'reasoning_content',
                      },
                    ],
                  };
                  reasoningSummaryText = '';
                }

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
