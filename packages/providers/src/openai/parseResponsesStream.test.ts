import { describe, it, expect } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  parseResponsesStream,
  parseErrorResponse,
} from './parseResponsesStream.js';

function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < chunks.length) {
        const chunk = chunks[index++];
        controller.enqueue(encoder.encode(chunk));
      } else {
        controller.close();
      }
    },
  });
}

async function captureStreamError(chunks: string[]): Promise<unknown> {
  try {
    for await (const message of parseResponsesStream(createSSEStream(chunks))) {
      void message;
    }
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('parseResponsesStream', () => {
  it('should parse content chunks correctly', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: {"type":"response.output_text.delta","delta":" world"}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    expect(messages).toHaveLength(2);
    expect(messages[0]).toStrictEqual({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello' }],
    });
    expect(messages[1]).toStrictEqual({
      speaker: 'ai',
      blocks: [{ type: 'text', text: ' world' }],
    });
  });

  it('should parse tool calls correctly', async () => {
    const chunks = [
      'data: {"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"id":"fc_123","type":"function_call","status":"in_progress","arguments":"","call_id":"call_123","name":"search"}}\n\n',
      'data: {"type":"response.function_call_arguments.delta","sequence_number":2,"item_id":"fc_123","output_index":0,"delta":"{\\"query\\":\\"test\\"}"}\n\n',
      'data: {"type":"response.output_item.done","sequence_number":3,"output_index":0,"item":{"id":"fc_123","type":"function_call","status":"completed","arguments":"{\\"query\\":\\"test\\"}","call_id":"call_123","name":"search"}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    const toolCallMessage = messages.find((m) =>
      m.blocks.some((block) => block.type === 'tool_call'),
    );
    expect(toolCallMessage).toBeDefined();
    const toolCallBlock = toolCallMessage!.blocks.find(
      (b) => b.type === 'tool_call',
    );
    expect(toolCallBlock).toStrictEqual({
      type: 'tool_call',
      id: 'call_123',
      name: 'search',
      parameters: { query: 'test' },
    });
  });

  it('should parse usage data correctly', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Test response"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp-123","object":"response","model":"gpt-4o","status":"completed","usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    expect(messages.length).toBeGreaterThanOrEqual(2);
    const usageMessage = messages.find((m) => m.metadata?.usage);
    expect(usageMessage).toBeDefined();
    expect(usageMessage?.metadata?.usage).toStrictEqual({
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
      cachedTokens: 0,
    });
  });

  it('should handle split chunks correctly', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delt',
      'a":"Hello world"}\n\ndata: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    expect(messages).toHaveLength(1);
    const textBlock = messages[0].blocks.find((b) => b.type === 'text');
    expect(textBlock).toBeDefined();
    expect((textBlock as { type: 'text'; text: string }).text).toBe(
      'Hello world',
    );
  });

  it('should skip invalid JSON chunks', async () => {
    const chunks = [
      'data: invalid json\n\n',
      'data: {"type":"response.output_text.delta","delta":"Valid"}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    expect(messages).toHaveLength(1);
    const textBlock = messages[0].blocks.find((b) => b.type === 'text');
    expect(textBlock).toBeDefined();
    expect((textBlock as { type: 'text'; text: string }).text).toBe('Valid');
  });
});

describe('parseErrorResponse', () => {
  it('should parse 409 conflict error', () => {
    const error = parseErrorResponse(
      409,
      '{"error":{"message":"Conversation already exists"}}',
      'Responses',
    );
    expect(error.message).toBe('Conflict: Conversation already exists');
  });

  it('should parse 410 gone error', () => {
    const error = parseErrorResponse(
      410,
      '{"error":{"message":"Conversation expired"}}',
      'Responses',
    );
    expect(error.message).toBe('Gone: Conversation expired');
  });

  it('should parse 429 rate limit error', () => {
    const error = parseErrorResponse(
      429,
      '{"error":{"message":"Too many requests"}}',
      'Responses',
    );
    expect(error.message).toBe('Rate limit exceeded: Too many requests');
  });

  it('should parse 5xx server errors', () => {
    const error500 = parseErrorResponse(
      500,
      '{"error":{"message":"Internal error"}}',
      'Responses',
    );
    expect(error500.message).toBe('Server error: Internal error');

    const error503 = parseErrorResponse(
      503,
      '{"error":{"message":"Service unavailable"}}',
      'Responses',
    );
    expect(error503.message).toBe('Server error: Service unavailable');
  });

  it('should handle invalid JSON in error response', () => {
    const error = parseErrorResponse(500, 'Not JSON', 'Responses');
    expect(error.message).toContain('Server error');
    expect(error.message).toContain('Status: 500');
    expect(error.message).toContain('Not JSON');
  });

  it('should handle unknown status codes', () => {
    const error = parseErrorResponse(
      418,
      '{"error":{"message":"I am a teapot"}}',
      'Responses',
    );
    expect(error.message).toBe('I am a teapot');
  });

  it('should include status and empty-body indication for empty 400 body @issue:2137', () => {
    const error = parseErrorResponse(400, '', 'Responses');
    expect(error.message).toContain('Status: 400');
    expect(error.message).toContain('empty response body');
    expect(error.message).not.toBe('Client error: Unknown error');
  });

  it('should include status and body snippet for empty JSON object 400 @issue:2137', () => {
    const error = parseErrorResponse(400, '{}', 'Responses');
    expect(error.message).toContain('Status: 400');
    expect(error.message).toContain('body:');
    expect(error.message).not.toBe('Client error: Unknown error');
  });

  it('should include status and body snippet for JSON with empty error object @issue:2137', () => {
    const error = parseErrorResponse(400, '{"error":{}}', 'Responses');
    expect(error.message).toContain('Status: 400');
    expect(error.message).toContain('body:');
    expect(error.message).not.toBe('Client error: Unknown error');
  });

  it('should include status and body snippet for plain-text 400 body @issue:2137', () => {
    const error = parseErrorResponse(400, 'Bad Request', 'Responses');
    expect(error.message).toContain('Status: 400');
    expect(error.message).toContain('Bad Request');
  });

  it('should still extract standard error messages for structured 400s @issue:2137', () => {
    const error = parseErrorResponse(
      400,
      '{"error":{"message":"Invalid prompt"}}',
      'Responses',
    );
    expect(error.message).toBe('Client error: Invalid prompt');
  });

  it('should parse cached_tokens from response.completed usage data', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp-123","object":"response","model":"o3-mini","status":"completed","usage":{"input_tokens":100,"output_tokens":20,"total_tokens":120,"input_tokens_details":{"cached_tokens":50}}}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    expect(messages.length).toBeGreaterThanOrEqual(2);
    const usageMessage = messages.find((m) => m.metadata?.usage);
    expect(usageMessage).toBeDefined();
    expect(usageMessage?.metadata?.usage).toStrictEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cachedTokens: 50,
    });
  });

  it('should default cachedTokens to 0 when not present in usage data', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp-123","object":"response","model":"o3-mini","status":"completed","usage":{"input_tokens":100,"output_tokens":20,"total_tokens":120}}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    expect(messages.length).toBeGreaterThanOrEqual(2);
    const usageMessage = messages.find((m) => m.metadata?.usage);
    expect(usageMessage).toBeDefined();
    expect(usageMessage?.metadata?.usage).toStrictEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cachedTokens: 0,
    });
  });
});

describe('parseResponsesStream terminal events (issue #2333)', () => {
  /**
   * response.failed events must throw so server-side failures propagate
   * instead of being silently swallowed (root cause of masked empty summaries).
   */
  it('throws on response.failed event with provider error message', async () => {
    const chunks = [
      'data: {"type":"response.failed","response":{"id":"r1","object":"response","model":"gpt-4o","status":"failed","error":{"message":"Internal server error","type":"server_error"}}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const iterator = parseResponsesStream(stream);

    await expect(
      (async () => {
        for await (const _message of iterator) {
          // drain
        }
      })(),
    ).rejects.toThrow('Internal server error');
  });

  /**
   * Top-level error events (e.g. rate limit) must also throw.
   */
  it('throws on top-level error event with error message', async () => {
    const chunks = [
      'data: {"type":"error","error":{"message":"rate limit exceeded","type":"rate_limit_error"}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const iterator = parseResponsesStream(stream);

    await expect(
      (async () => {
        for await (const _message of iterator) {
          // drain
        }
      })(),
    ).rejects.toThrow('rate limit exceeded');
  });

  /**
   * Real OpenAI ResponseErrorEvent carries message/code/param at the top level
   * of the event, not nested under error (issue #3034 review finding 3).
   */
  it('throws on real top-level error event shape with message and code', async () => {
    const chunks = [
      'data: {"type":"error","code":"overloaded","message":"server overloaded","param":null,"sequence_number":7}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    let caught: Error | undefined;
    try {
      for await (const _message of parseResponsesStream(stream)) {
        void _message;
      }
    } catch (error) {
      if (error instanceof Error) caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toBe('server overloaded');
    expect(caught).toMatchObject({
      details: {
        providerError: {
          message: 'server overloaded',
          code: 'overloaded',
          param: null,
        },
      },
    });
  });

  /**
   * When both top-level and nested error fields are present, the top-level
   * (documented protocol) shape wins.
   */
  it('prefers top-level message over nested error when both are present', async () => {
    const chunks = [
      'data: {"type":"error","message":"top-level wins","code":"err_code","error":{"message":"nested loses"}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const iterator = parseResponsesStream(stream);

    await expect(
      (async () => {
        for await (const _message of iterator) {
          // drain
        }
      })(),
    ).rejects.toThrow('top-level wins');
  });

  /**
   * Top-level and nested error fields must both reach diagnostics: the
   * documented top-level message/code/param win (including an explicit null
   * param) while the nested type survives (issue #3034 review).
   */
  it('preserves nested error.type alongside winning top-level message/code', async () => {
    const chunks = [
      'data: {"type":"error","message":"top message","code":"err_code","param":null,"error":{"message":"nested message","type":"rate_limit_error","code":"nested_code","param":"nested_param"}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    let caught: Error | undefined;
    try {
      for await (const _message of parseResponsesStream(stream)) {
        void _message;
      }
    } catch (error) {
      if (error instanceof Error) caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toBe('top message');
    expect(caught).toMatchObject({
      details: {
        providerError: {
          message: 'top message',
          code: 'err_code',
          param: null,
          type: 'rate_limit_error',
        },
      },
    });
  });

  /**
   * response.failed events without an error object must still throw using
   * the fallback message.
   */
  it('throws fallback message on response.failed event with no error payload', async () => {
    const chunks = [
      'data: {"type":"response.failed","response":{"id":"r1","object":"response","model":"gpt-4o","status":"failed"}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const iterator = parseResponsesStream(stream);

    await expect(
      (async () => {
        for await (const _message of iterator) {
          // drain
        }
      })(),
    ).rejects.toThrow('OpenAI Responses API stream failed');
  });
  it('preserves a response.failed context-window error as an actionable client failure', async () => {
    const providerError = {
      message:
        "This model's maximum context length is 4096 tokens, but the input contained 5000 tokens.",
      type: 'invalid_request_error',
      code: 'context_length_exceeded',
      param: 'input',
    };
    const error = await captureStreamError([
      `data: ${JSON.stringify({
        type: 'response.failed',
        response: {
          id: 'resp_context',
          object: 'response',
          model: 'gpt-5',
          status: 'failed',
          error: providerError,
        },
      })}\n\n`,
    ]);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      message: providerError.message,
      status: 413,
      code: providerError.code,
      providerErrorType: providerError.type,
      details: {
        providerError,
        responseStatus: 'failed',
      },
    });
    expect(error).not.toMatchObject({ code: 'STREAM_INTERRUPTED' });
  });

  it('classifies a failed terminal response with invalid-request metadata as non-retryable client input', async () => {
    const providerError = {
      message: 'The input field must contain at least one item.',
      type: 'invalid_request_error',
      code: 'invalid_prompt',
      param: 'input',
    };
    const error = await captureStreamError([
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          id: 'resp_invalid',
          object: 'response',
          model: 'gpt-5',
          status: 'failed',
          error: providerError,
        },
      })}\n\n`,
    ]);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      message: providerError.message,
      status: 400,
      code: providerError.code,
      providerErrorType: providerError.type,
      details: {
        providerError,
        responseStatus: 'failed',
      },
    });
    expect(error).not.toMatchObject({ code: 'STREAM_INTERRUPTED' });
  });

  it('preserves documented top-level input error fields as non-retryable client input', async () => {
    const error = await captureStreamError([
      `data: ${JSON.stringify({
        type: 'error',
        code: 'invalid_prompt',
        message: 'The input field is invalid.',
        param: 'input',
        sequence_number: 3,
      })}\n\n`,
    ]);

    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty('message', 'The input field is invalid.');
    expect(error).toHaveProperty('status', 400);
    expect(error).toHaveProperty('code', 'invalid_prompt');
    expect(error).toHaveProperty('providerErrorType', 'error');
    expect(error).toHaveProperty(
      'details.providerError.message',
      'The input field is invalid.',
    );
    expect(error).toHaveProperty('details.providerError.type', 'error');
    expect(error).toHaveProperty(
      'details.providerError.code',
      'invalid_prompt',
    );
    expect(error).toHaveProperty('details.providerError.param', 'input');
    expect(error).not.toMatchObject({ code: 'STREAM_INTERRUPTED' });
  });

  /**
   * response.incomplete events should NOT throw — partial content may be
   * useful. Instead, terminal metadata (usage, stopReason) is yielded.
   * The `incomplete` status maps to `max_tokens` stopReason.
   */
  it('yields metadata for response.incomplete with stopReason max_tokens', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
      'data: {"type":"response.incomplete","response":{"id":"r1","object":"response","model":"gpt-4o","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"usage":{"input_tokens":10,"output_tokens":5000,"total_tokens":5010}}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    const usageMessage = messages.find((m) => m.metadata?.usage);
    expect(usageMessage).toBeDefined();
    expect(usageMessage?.metadata?.stopReason).toBe('max_tokens');
    expect(usageMessage?.metadata?.finishReason).toBe('incomplete');
  });

  /**
   * response.incomplete without usage should NOT throw. Since the event
   * carries a response.id, the stream now yields a metadata chunk carrying
   * that id so stateful conversations can thread it as previous_response_id.
   */
  it('completes normally for response.incomplete with no usage object', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
      'data: {"type":"response.incomplete","response":{"id":"r1","object":"response","model":"gpt-4o","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    // The text delta plus a metadata chunk carrying the response id.
    expect(messages).toHaveLength(2);
    expect(messages[0].blocks).toStrictEqual([
      { type: 'text', text: 'partial' },
    ]);
    expect(messages.find((m) => m.metadata?.usage)).toBeUndefined();
    expect(messages.find((m) => m.metadata?.id === 'r1')).toBeDefined();
  });
});

describe('parseErrorResponse quota-aware 429 and response attachment @issue:3140', () => {
  it('uses quota-exhaustion wording for a 429 with insufficient_quota code', () => {
    const error = parseErrorResponse(
      429,
      '{"error":{"code":"insufficient_quota","message":"You exhausted your quota"}}',
      'Responses',
    );
    expect(error.message).not.toContain('Rate limit exceeded');
    expect(error.message.toLowerCase()).toContain('quota');
    expect(error.message.toLowerCase()).toContain('exhaust');
    expect(error.message.toLowerCase()).toContain('will not');
  });

  it('uses quota-exhaustion wording for a 429 with billing_hard_limit_reached', () => {
    const error = parseErrorResponse(
      429,
      '{"error":{"code":"billing_hard_limit_reached","message":"Billing hard limit reached"}}',
      'Responses',
    );
    expect(error.message).not.toContain('Rate limit exceeded');
    expect(error.message.toLowerCase()).toContain('billing');
    expect(error.message.toLowerCase()).toContain('will not');
  });

  /**
   * OpenAI reports the same condition under `type` on some payloads and `code`
   * on others. Both the message and the classification-bearing fields must
   * agree, otherwise a quota 429 reads as terminal but is still retried.
   */
  it('classifies and words a 429 carrying insufficient_quota only under type', () => {
    const error = parseErrorResponse(
      429,
      '{"error":{"type":"insufficient_quota","message":"You exhausted your quota"}}',
      'Responses',
    );
    expect(error.message).not.toContain('Rate limit exceeded');
    expect(error.message.toLowerCase()).toContain('quota');
    expect((error as { providerErrorType?: string }).providerErrorType).toBe(
      'insufficient_quota',
    );
  });

  it('lifts a top-level code and type onto the thrown error', () => {
    const error = parseErrorResponse(
      429,
      '{"code":"insufficient_quota","type":"insufficient_quota","message":"exhausted"}',
      'Responses',
    );
    expect((error as { code?: string }).code).toBe('insufficient_quota');
    expect((error as { providerErrorType?: string }).providerErrorType).toBe(
      'insufficient_quota',
    );
  });

  /**
   * `isOverloadError` in core reads a bare `type` key and treats `api_error`,
   * `rate_limit_error`, and `overloaded_error` as retryable. Writing the
   * provider's body-level type to that key would make a Responses 403 or 404
   * retryable and reverse the "403 is never retried" invariant (issue #2917).
   */
  it('never writes the body error type to a bare `type` key', () => {
    const error = parseErrorResponse(
      403,
      '{"error":{"type":"api_error","message":"Forbidden"}}',
      'Responses',
    );
    expect((error as { type?: string }).type).toBeUndefined();
    expect((error as { providerErrorType?: string }).providerErrorType).toBe(
      'api_error',
    );
  });

  it('reads the Codex detail envelope for code and type', () => {
    const error = parseErrorResponse(
      429,
      '{"detail":{"code":"insufficient_quota","type":"insufficient_quota","message":"exhausted"}}',
      'Responses',
    );
    expect((error as { code?: string }).code).toBe('insufficient_quota');
    expect(error.message).toContain('Quota or billing limit exhausted');
  });

  /**
   * OpenAI returns billing_hard_limit_reached as an HTTP 400, not a 429. The
   * retry decision is unchanged (400 was already terminal), but the user must
   * still be told this is a billing problem rather than a bad request.
   */
  it('uses quota wording for a 400 billing_hard_limit_reached', () => {
    const error = parseErrorResponse(
      400,
      '{"error":{"code":"billing_hard_limit_reached","message":"Billing hard limit has been reached"}}',
      'Responses',
    );
    expect(error.message).not.toContain('Client error');
    expect(error.message).toContain('Quota or billing limit exhausted');
    expect(error.message.toLowerCase()).toContain('will not');
  });

  /**
   * A 5xx is still retried by both retry layers, so it must never claim that
   * retrying will not help — even if the body echoes a terminal quota code.
   */
  it('keeps server-error wording for a 5xx echoing a terminal quota code', () => {
    const error = parseErrorResponse(
      503,
      '{"error":{"code":"insufficient_quota","message":"upstream said quota"}}',
      'Responses',
    );
    expect(error.message).toBe('Server error: upstream said quota');
    expect(error.message.toLowerCase()).not.toContain('will not help');
  });

  it('keeps the exact Rate limit exceeded wording for a throttling 429', () => {
    const error = parseErrorResponse(
      429,
      '{"error":{"code":"rate_limit_exceeded","message":"Too many requests"}}',
      'Responses',
    );
    expect(error.message).toBe('Rate limit exceeded: Too many requests');
  });

  it('keeps the exact Rate limit exceeded wording for a bare 429 with no code', () => {
    const error = parseErrorResponse(
      429,
      '{"error":{"message":"Too many requests"}}',
      'Responses',
    );
    expect(error.message).toBe('Rate limit exceeded: Too many requests');
  });

  it('attaches response.headers when headers are passed', () => {
    const error = parseErrorResponse(
      429,
      '{"error":{"code":"insufficient_quota"}}',
      'Responses',
      { 'retry-after': '5' },
    );
    const response = (error as { response?: unknown }).response as {
      status?: number;
      headers?: Record<string, string>;
      body?: string;
    };
    expect(response).toBeDefined();
    expect(response.headers?.['retry-after']).toBe('5');
    expect(response.status).toBe(429);
    expect(response.body).toBe('{"error":{"code":"insufficient_quota"}}');
  });

  it('attaches response with undefined headers when no headers are passed', () => {
    const error = parseErrorResponse(
      500,
      '{"error":{"message":"boom"}}',
      'Responses',
    );
    const response = (error as { response?: unknown }).response as {
      status?: number;
      headers?: Record<string, string>;
      body?: string;
    };
    expect(response).toBeDefined();
    expect(response.headers).toBeUndefined();
    expect(response.status).toBe(500);
    expect(response.body).toBe('{"error":{"message":"boom"}}');
  });

  it('attaches response on the invalid-JSON catch branch so headers survive', () => {
    const error = parseErrorResponse(429, 'Not JSON at all', 'Responses', {
      'retry-after': '3',
    });
    const response = (error as { response?: unknown }).response as {
      status?: number;
      headers?: Record<string, string>;
      body?: string;
    };
    expect(response).toBeDefined();
    expect(response.headers?.['retry-after']).toBe('3');
    expect(response.status).toBe(429);
    expect(response.body).toBe('Not JSON at all');
  });
});
