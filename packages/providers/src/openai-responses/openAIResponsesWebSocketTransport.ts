/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WebSocket } from 'undici';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  parseResponsesStream,
  type ParseResponsesStreamOptions,
} from '../openai/parseResponsesStream.js';
import { createStreamInterruptionError } from '@vybestack/llxprt-code-core/utils/retry.js';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import type { OpenAIResponsesRequest } from './OpenAIResponsesTypes.js';

export const CODEX_WEBSOCKET_BETA_HEADER = 'responses_websockets=2026-02-06';
export interface TransportLogger {
  debug(messageFactory: (() => string) | string): void;
}
export interface StreamResponseOptions {
  readonly responsesURL: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly abortSignal?: AbortSignal;
  readonly includeThinkingInResponse?: boolean;
  readonly responsesStored?: boolean;
  readonly onStreamLiveness?: ParseResponsesStreamOptions['onStreamLiveness'];
  readonly onResponseEvent?: () => void;
}

export interface WebSocketTransport {
  streamResponse(
    request: OpenAIResponsesRequest,
    options: StreamResponseOptions,
  ): AsyncIterableIterator<IContent>;
  close(): void;
}

export interface TransportSocket {
  readonly readyState: number;
  readonly CONNECTING: number;
  readonly OPEN: number;
  send(data: string): void;
  close(): void;
  onOpen(listener: () => void): () => void;
  onMessage(listener: (data: unknown) => void): () => void;
  onClose(listener: () => void): () => void;
  onError(listener: () => void): () => void;
}

export type OpenTransportSocket = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => TransportSocket;

interface WebSocketTransportConfig {
  readonly logger?: TransportLogger;
  readonly openSocket?: OpenTransportSocket;
}

const HANDSHAKE_TIMEOUT_MS = 10_000;
const TERMINAL_EVENT_TYPES = new Set([
  'response.completed',
  'response.incomplete',
  'response.failed',
  'error',
]);

function eventType(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const type = Reflect.get(value, 'type');
  return typeof type === 'string' ? type : undefined;
}

function parseFrame(data: string): { type: string | undefined; data: string } {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch (error) {
    throw createStreamInterruptionError(
      'Codex Responses WebSocket received malformed JSON',
      undefined,
      error,
    );
  }
  return { type: eventType(value), data: JSON.stringify(value) };
}

function toWebSocketURL(responsesURL: string): string {
  const url = new URL(responsesURL);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
    throw new Error(
      `Unsupported Responses WebSocket protocol: ${url.protocol}`,
    );
  }
  return url.toString();
}

function connectionIdentity(
  url: string,
  headers: Readonly<Record<string, string>>,
): string {
  const headerIdentity = Object.entries(headers)
    .map(([name, value]) => ({ name: name.toLowerCase(), value }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return JSON.stringify([url, headerIdentity]);
}

class UndiciTransportSocket implements TransportSocket {
  readonly CONNECTING = WebSocket.CONNECTING;
  readonly OPEN = WebSocket.OPEN;

  constructor(private readonly socket: WebSocket) {}

  get readyState(): number {
    return this.socket.readyState;
  }

  send(data: string): void {
    this.socket.send(data);
  }

  close(): void {
    this.socket.close();
  }

  onOpen(listener: () => void): () => void {
    const handler = (): void => listener();
    this.socket.addEventListener('open', handler);
    return () => this.socket.removeEventListener('open', handler);
  }

  onMessage(listener: (data: unknown) => void): () => void {
    const handler = (event: { data?: unknown }): void => listener(event.data);
    this.socket.addEventListener('message', handler);
    return () => this.socket.removeEventListener('message', handler);
  }

  onClose(listener: () => void): () => void {
    const handler = (): void => listener();
    this.socket.addEventListener('close', handler);
    return () => this.socket.removeEventListener('close', handler);
  }

  onError(listener: () => void): () => void {
    const handler = (): void => listener();
    this.socket.addEventListener('error', handler);
    return () => this.socket.removeEventListener('error', handler);
  }
}

function openUndiciSocket(
  url: string,
  headers: Readonly<Record<string, string>>,
): TransportSocket {
  return new UndiciTransportSocket(new WebSocket(url, { headers }));
}

interface LiveConnection {
  readonly socket: TransportSocket;
  readonly identity: string;
}

interface FrameResult {
  readonly done: boolean;
  readonly value: string;
}

class RequestFrameSource {
  private readonly queue: string[] = [];
  private waiting:
    | {
        readonly resolve: (result: FrameResult) => void;
        readonly reject: (error: Error) => void;
      }
    | undefined;
  private ended = false;
  private failure: Error | undefined;
  private completed = false;
  private readonly detachListeners: () => void;
  private readonly detachAbort: () => void;

  constructor(
    socket: TransportSocket,
    abortSignal: AbortSignal | undefined,
    onResponseEvent: (() => void) | undefined,
  ) {
    const detachMessage = socket.onMessage((data) => {
      if (this.ended) return;
      if (typeof data !== 'string') {
        this.fail(
          createStreamInterruptionError(
            'Codex Responses WebSocket received a non-text frame',
          ),
        );
        return;
      }
      let frame: { type: string | undefined; data: string };
      try {
        frame = parseFrame(data);
      } catch (error) {
        this.fail(
          error instanceof Error
            ? error
            : createStreamInterruptionError(
                'Codex Responses WebSocket received an invalid frame',
              ),
        );
        return;
      }
      onResponseEvent?.();
      this.completed = frame.type === 'response.completed';
      this.queue.push(frame.data);
      if (frame.type !== undefined && TERMINAL_EVENT_TYPES.has(frame.type)) {
        this.ended = true;
      }
      this.drain();
    });
    const detachClose = socket.onClose(() => {
      if (!this.completed) {
        this.fail(
          createStreamInterruptionError(
            'Codex Responses WebSocket closed before response.completed',
          ),
        );
      }
    });
    const detachError = socket.onError(() => {
      this.fail(
        createStreamInterruptionError(
          'Codex Responses WebSocket stream failed before response.completed',
        ),
      );
    });
    this.detachListeners = () => {
      detachMessage();
      detachClose();
      detachError();
    };
    const onAbort = (): void =>
      this.fail(createAbortError(abortSignal?.reason));
    if (abortSignal !== undefined) {
      abortSignal.addEventListener('abort', onAbort, { once: true });
      this.detachAbort = () =>
        abortSignal.removeEventListener('abort', onAbort);
    } else {
      this.detachAbort = () => undefined;
    }
  }

  didComplete(): boolean {
    return this.completed;
  }

  next(): Promise<FrameResult> {
    const value = this.queue.shift();
    if (value !== undefined) return Promise.resolve({ done: false, value });
    if (this.failure !== undefined) return Promise.reject(this.failure);
    if (this.ended) return Promise.resolve({ done: true, value: '' });
    return new Promise<FrameResult>((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }

  detach(): void {
    this.detachListeners();
    this.detachAbort();
    this.ended = true;
    this.drain();
  }

  private fail(error: Error): void {
    if (this.ended && this.completed) return;
    this.failure = error;
    this.ended = true;
    this.drain();
  }

  private drain(): void {
    if (this.waiting === undefined) return;
    const waiting = this.waiting;
    this.waiting = undefined;
    const value = this.queue.shift();
    if (value !== undefined) waiting.resolve({ done: false, value });
    else if (this.failure !== undefined) waiting.reject(this.failure);
    else waiting.resolve({ done: true, value: '' });
  }
}

function createResponseByteStream(
  source: RequestFrameSource,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      try {
        const frame = await source.next();
        if (frame.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`data: ${frame.value}\n\n`));
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      source.detach();
    },
  });
}

function createResponseEventTracker(): {
  readonly observe: () => void;
  readonly wasObserved: () => boolean;
} {
  let observed = false;
  return {
    observe: () => {
      observed = true;
    },
    wasObserved: () => observed,
  };
}

class CodexResponsesWebSocketTransport implements WebSocketTransport {
  private active: LiveConnection | undefined;
  private requestQueue: Promise<void> = Promise.resolve();

  private readonly openSocket: OpenTransportSocket;

  constructor(private readonly config: WebSocketTransportConfig) {
    this.openSocket = config.openSocket ?? openUndiciSocket;
  }

  async *streamResponse(
    request: OpenAIResponsesRequest,
    options: StreamResponseOptions,
  ): AsyncIterableIterator<IContent> {
    const resolveTurn = await this.acquireRequestTurn();
    let socket: TransportSocket | undefined;
    let completed = false;
    try {
      socket = await this.acquireConnection(options);
      const source = new RequestFrameSource(
        socket,
        options.abortSignal,
        options.onResponseEvent,
      );
      try {
        socket.send(JSON.stringify({ ...request, type: 'response.create' }));
        for await (const message of parseResponsesStream(
          createResponseByteStream(source),
          {
            includeThinkingInResponse: options.includeThinkingInResponse,
            responsesStored: options.responsesStored,
            onStreamLiveness: options.onStreamLiveness,
          },
        )) {
          yield message;
        }
        if (!source.didComplete()) {
          throw createStreamInterruptionError(
            'Codex Responses WebSocket ended before response.completed',
          );
        }
        completed = true;
      } finally {
        source.detach();
      }
    } finally {
      if (!completed && socket !== undefined) this.invalidate(socket);
      resolveTurn();
    }
  }

  close(): void {
    if (this.active !== undefined) this.closeSocket(this.active.socket);
    this.active = undefined;
  }

  private async acquireRequestTurn(): Promise<() => void> {
    const previous = this.requestQueue;
    let resolveTurn = (): void => undefined;
    this.requestQueue = new Promise<void>((resolve) => (resolveTurn = resolve));
    await previous;
    return resolveTurn;
  }

  private async acquireConnection(
    options: StreamResponseOptions,
  ): Promise<TransportSocket> {
    const url = toWebSocketURL(options.responsesURL);
    const identity = connectionIdentity(url, options.headers);
    if (
      this.active !== undefined &&
      this.active.identity === identity &&
      this.active.socket.readyState === this.active.socket.OPEN
    ) {
      return this.active.socket;
    }
    this.close();
    const socket = await this.open(url, options.headers, options.abortSignal);
    this.active = { socket, identity };
    return socket;
  }

  private open(
    url: string,
    headers: Readonly<Record<string, string>>,
    abortSignal: AbortSignal | undefined,
  ): Promise<TransportSocket> {
    if (abortSignal?.aborted === true) {
      return Promise.reject(createAbortError(abortSignal.reason));
    }
    const socket = this.openSocket(url, headers);
    return new Promise<TransportSocket>((resolve, reject) => {
      let settled = false;
      const removers: Array<() => void> = [];
      const cleanup = (): void => {
        clearTimeout(timeout);
        for (const remove of removers) remove();
        if (abortSignal !== undefined) {
          abortSignal.removeEventListener('abort', onAbort);
        }
      };
      const finish = (
        result: { socket: TransportSocket } | { error: Error },
      ): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if ('socket' in result) resolve(result.socket);
        else reject(result.error);
      };
      const fail = (error: Error): void => {
        this.closeSocket(socket);
        finish({ error });
      };
      const timeout = setTimeout(
        () =>
          fail(
            createStreamInterruptionError(
              'Codex Responses WebSocket handshake timed out',
            ),
          ),
        HANDSHAKE_TIMEOUT_MS,
      );
      const onAbort = (): void => fail(createAbortError(abortSignal?.reason));
      removers.push(socket.onOpen(() => finish({ socket })));
      removers.push(
        socket.onError(() =>
          finish({
            error: createStreamInterruptionError(
              'Codex Responses WebSocket handshake failed',
            ),
          }),
        ),
      );
      removers.push(
        socket.onClose(() =>
          finish({
            error: createStreamInterruptionError(
              'Codex Responses WebSocket closed before opening',
            ),
          }),
        ),
      );
      abortSignal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private invalidate(socket: TransportSocket): void {
    if (this.active?.socket === socket) this.active = undefined;
    this.closeSocket(socket);
  }

  private closeSocket(socket: TransportSocket): void {
    if (
      socket.readyState !== socket.CONNECTING &&
      socket.readyState !== socket.OPEN
    ) {
      return;
    }
    try {
      socket.close();
    } catch (error) {
      this.config.logger?.debug(
        () => `Codex Responses WebSocket close failed: ${String(error)}`,
      );
    }
  }
}

export function createCodexResponsesWebSocketTransport(
  config: WebSocketTransportConfig = {},
): WebSocketTransport {
  return new CodexResponsesWebSocketTransport(config);
}

export async function* streamOverWebSocketOrFallback(
  transport: WebSocketTransport,
  request: OpenAIResponsesRequest,
  streamOptions: StreamResponseOptions,
  fallbackStream: () => AsyncIterableIterator<IContent>,
  onFallback: (() => void) | undefined,
  logger: TransportLogger | undefined,
): AsyncIterableIterator<IContent> {
  const responseEvents = createResponseEventTracker();
  try {
    yield* transport.streamResponse(request, {
      ...streamOptions,
      onResponseEvent: responseEvents.observe,
    });
  } catch (error) {
    if (
      responseEvents.wasObserved() ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      throw error;
    }
    onFallback?.();
    logger?.debug(
      () =>
        `Codex WebSocket unavailable; falling back to HTTP: ${String(error)}`,
    );
    yield* fallbackStream();
  }
}
