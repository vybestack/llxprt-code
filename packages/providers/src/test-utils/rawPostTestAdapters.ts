/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

interface RawPostOptions {
  readonly body?: unknown;
  readonly headers?: HeadersInit;
  readonly signal?: AbortSignal;
  readonly stream?: boolean;
}

interface TransportCallOptions {
  readonly headers?: HeadersInit;
  readonly signal?: AbortSignal;
}

export type RawPostTestHandler = (
  request: Record<string, unknown>,
  options: TransportCallOptions,
) => unknown;

interface AnthropicRawPostResult {
  withResponse(): Promise<{
    readonly data: unknown;
    readonly response: Response | undefined;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReadableByteStream(
  value: unknown,
): value is ReadableStream<Uint8Array> {
  return value instanceof ReadableStream;
}

export async function readRawPostTestBody(body: unknown): Promise<string> {
  if (!isReadableByteStream(body)) {
    throw new TypeError('Raw-post test adapter requires a ReadableStream body');
  }
  return new Response(body).text();
}

async function readRequest(body: unknown): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readRawPostTestBody(body));
  if (!isRecord(parsed)) {
    throw new TypeError('Raw-post test adapter requires a JSON object body');
  }
  return parsed;
}

function callOptions(options: RawPostOptions): TransportCallOptions {
  return {
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}

function hasWithResponse(
  value: unknown,
): value is { withResponse: () => Promise<unknown> } {
  return (
    isRecord(value) && typeof Reflect.get(value, 'withResponse') === 'function'
  );
}

function isTransportResponse(
  value: unknown,
): value is { readonly data: unknown; readonly response?: unknown } {
  return isRecord(value) && 'data' in value;
}

function responseValue(value: unknown): Response | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Response) return value;
  if (isRecord(value) && value['headers'] instanceof Headers) {
    const status = value['status'];
    const statusText = value['statusText'];
    if (status !== undefined && typeof status !== 'number') {
      throw new TypeError(
        'Raw-post test adapter received an invalid HTTP status',
      );
    }
    if (statusText !== undefined && typeof statusText !== 'string') {
      throw new TypeError(
        'Raw-post test adapter received an invalid HTTP status text',
      );
    }
    return new Response(null, {
      headers: value['headers'],
      ...(status === undefined ? {} : { status }),
      ...(statusText === undefined ? {} : { statusText }),
    });
  }
  throw new TypeError(
    'Raw-post test adapter received an invalid HTTP response',
  );
}

export function createAnthropicRawPostTestAdapter(
  handler: RawPostTestHandler,
): {
  post(path: string, options: RawPostOptions): AnthropicRawPostResult;
} {
  return {
    post: (path, options) => ({
      withResponse: async () => {
        if (path !== '/v1/messages') {
          throw new Error(`Unexpected Anthropic raw-post path: ${path}`);
        }
        const request = await readRequest(options.body);
        const result = await handler(request, callOptions(options));
        if (!hasWithResponse(result)) {
          return { data: result, response: undefined };
        }
        const transported = await result.withResponse();
        if (!isTransportResponse(transported)) {
          throw new TypeError(
            'Anthropic test transport withResponse() returned an invalid result',
          );
        }
        return {
          data: transported.data,
          response: responseValue(transported.response),
        };
      },
    }),
  };
}

export function createOpenAIRawPostTestAdapter(handler: RawPostTestHandler): {
  post(path: string, options: RawPostOptions): Promise<unknown>;
} {
  return {
    post: async (path, options) => {
      if (path !== '/chat/completions') {
        throw new Error(`Unexpected OpenAI raw-post path: ${path}`);
      }
      const request = await readRequest(options.body);
      return Promise.resolve(handler(request, callOptions(options)));
    },
  };
}
