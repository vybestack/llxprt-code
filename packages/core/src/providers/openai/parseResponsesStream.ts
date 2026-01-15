/**
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */
import { type IContent } from '../../services/history/IContent.js';
import { createStreamInterruptionError } from '../../utils/retry.js';

// Types for Responses API events
interface ResponsesEvent {
  type: string;
  sequence_number?: number;
  output_index?: number;
  delta?: string;
  item?: {
    id: string;
    type: string;
    status?: string;
    arguments?: string;
    call_id?: string;
    name?: string;
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
                // Usage data
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
