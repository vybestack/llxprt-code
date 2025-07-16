import { IMessage } from '../IMessage.js';
import { ContentGeneratorRole } from '../types.js';

// Response API event types
interface ResponsesApiEvent {
  type: string;
  sequence_number?: number;
  item_id?: string;
  output_index?: number;
  content_index?: number;
  delta?: string;
  text?: string;
  arguments?: string;
  logprobs?: unknown[];
  response?: {
    id: string;
    object: string;
    model: string;
    status: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
    output?: Array<{
      id: string;
      type: string;
      status?: string;
      arguments?: string;
      call_id?: string;
      name?: string;
    }>;
  };
  item?: {
    id: string;
    type: string;
    status?: string;
    content?: Array<{
      type: string;
      text?: string;
    }>;
    role?: string;
    // Function call fields
    name?: string;
    call_id?: string;
    arguments?: string;
  };
  part?: {
    type: string;
    text?: string;
  };
}

export async function* parseResponsesStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterableIterator<IMessage> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = '';

  // Track function calls being assembled
  const functionCalls = new Map<
    string,
    {
      id: string;
      name: string;
      arguments: string;
      output_index: number;
    }
  >();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim() === '') continue;

        // Parse event type
        if (line.startsWith('event: ')) {
          continue;
        } else if (line.startsWith('data: ')) {
          const dataLine = line.slice(6);

          if (dataLine === '[DONE]') {
            continue;
          }

          try {
            const event: ResponsesApiEvent = JSON.parse(dataLine);

            // Debug logging for responses API (commented out for production)
            // console.log('[parseResponsesStream] Event:', currentEventType, '- Type:', event.type);

            // Handle different event types
            switch (event.type) {
              case 'response.output_text.delta':
                // Yield content delta
                if (event.delta) {
                  yield {
                    role: ContentGeneratorRole.ASSISTANT,
                    content: event.delta,
                  };
                }
                break;

              case 'response.output_item.added':
                // A new function call is starting
                if (event.item?.type === 'function_call' && event.item.id) {
                  functionCalls.set(event.item.id, {
                    id: event.item.call_id || event.item.id,
                    name: event.item.name || '',
                    arguments: event.item.arguments || '',
                    output_index: event.output_index || 0,
                  });
                }
                break;

              case 'response.function_call_arguments.delta':
                // Accumulate function call arguments
                if (
                  event.item_id &&
                  event.delta &&
                  functionCalls.has(event.item_id)
                ) {
                  const call = functionCalls.get(event.item_id)!;
                  call.arguments += event.delta;
                }
                break;

              case 'response.output_item.done':
                // Function call is complete, yield it
                if (
                  event.item?.type === 'function_call' &&
                  event.item.id &&
                  functionCalls.has(event.item.id)
                ) {
                  const call = functionCalls.get(event.item.id)!;

                  // Update with final data from the done event
                  if (event.item.arguments) {
                    call.arguments = event.item.arguments;
                  }

                  // Convert to tool_calls array format
                  yield {
                    role: ContentGeneratorRole.ASSISTANT,
                    content: '',
                    tool_calls: [
                      {
                        id: call.id,
                        type: 'function',
                        function: {
                          name: call.name,
                          arguments: call.arguments,
                        },
                      },
                    ],
                  };

                  // Remove the completed call
                  functionCalls.delete(event.item.id);
                }
                break;

              case 'response.completed':
                // Extract usage data and the final response ID
                if (event.response) {
                  const finalMessage: IMessage = {
                    id: event.response.id,
                    role: ContentGeneratorRole.ASSISTANT,
                    content: '',
                  };
                  if (event.response.usage) {
                    finalMessage.usage = {
                      prompt_tokens: event.response.usage.input_tokens || 0,
                      completion_tokens:
                        event.response.usage.output_tokens || 0,
                      total_tokens: event.response.usage.total_tokens || 0,
                    };
                  }
                  yield finalMessage;
                }
                break;

              default:
                // Ignore other event types for now
                break;
            }
          } catch (parseError) {
            console.error(
              '[parseResponsesStream] Failed to parse event:',
              parseError,
            );
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
  try {
    const errorData = JSON.parse(body);
    const message =
      errorData.error?.message || errorData.message || 'Unknown error';

    // Format error message based on status code
    let errorPrefix: string;
    if (status === 409) {
      errorPrefix = 'Conflict';
    } else if (status === 410) {
      errorPrefix = 'Gone';
    } else if (status === 429) {
      errorPrefix = 'Rate limit exceeded';
    } else if (status >= 500 && status < 600) {
      errorPrefix = 'Server error';
    } else {
      // For unknown status codes, just return the message without prefix
      const error = new Error(message);
      (error as { status?: number }).status = status;
      (error as { code?: string }).code =
        errorData.error?.code || errorData.code;
      return error;
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
