/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Codex Responses WebSocket transport.
 *
 * One serialized, identity-keyed reusable connection per transport. The
 * backend retires each connection at its lifecycle limit (about sixty
 * minutes) by sending a top-level error frame whose nested code is
 * {@link WEBSOCKET_CONNECTION_LIMIT_CODE} (#2771). That verdict is scoped to
 * the connection, not the request, so `streamResponse` closes the retired
 * socket and replays the SAME request exactly once on a brand-new
 * connection. The retry is bounded by three invariants: it never happens
 * after any IContent has been yielded (the turn is no longer safely
 * replayable), it never happens more than once per request (a second
 * lifecycle-limit rejection fails the turn with a terminal
 * StreamInterruptionError), and an abort at any point — including while
 * reconnecting — rejects with AbortError. A successful retry is transport
 * health: it does not trigger the provider's sticky HTTP fallback, and later
 * requests keep using the WebSocket.
 */

import { WebSocket } from 'undici';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  parseResponsesStream,
  type ParseResponsesStreamOptions,
} from '../openai/parseResponsesStream.js';
import {
  ACCEPTED_TERMINAL_EVENT_TYPES,
  isTerminalEventType,
} from '../openai/responsesTerminalEvents.js';
import { createStreamInterruptionError } from '@vybestack/llxprt-code-core/utils/retry.js';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import type { OpenAIResponsesRequest } from './OpenAIResponsesTypes.js';

export const CODEX_WEBSOCKET_BETA_HEADER = 'responses_websockets=2026-02-06';

/**
 * The documented WebSocket connection-lifecycle signal: the server closes a
 * connection that has been open for its sixty-minute lifecycle limit. Only this
 * exact code is a connection lifecycle event eligible for reconnect-and-retry.
 */
export const WEBSOCKET_CONNECTION_LIMIT_CODE =
  'websocket_connection_limit_reached';

/**
 * True only for a stream-interruption error whose nested provider error carries the
 * documented connection-limit code. No message substrings and no other codes.
 */
export function isWebSocketConnectionLimitError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const details = (error as { details?: unknown }).details;
  if (typeof details !== 'object' || details === null) return false;
  const providerError = (details as { providerError?: unknown }).providerError;
  if (typeof providerError !== 'object' || providerError === null) return false;
  return (
    (providerError as { code?: unknown }).code ===
    WEBSOCKET_CONNECTION_LIMIT_CODE
  );
}

/**
 * Per-request lifecycle state shared between {@link streamResponse} and its
 * single attempt helper so the #2771 retry decision sees what has already
 * been yielded and whether the one allowed retry was spent.
 */
interface LifecycleAttemptState {
  completed: boolean;
  retryUsed: boolean;
  contentYielded: boolean;
}

type LifecycleRetryOutcome =
  | { readonly retry: true }
  | { readonly retry: false; readonly error: unknown };

/**
 * #2771 retry policy: the connection-limit verdict is scoped to the
 * connection, not the request, so the same request may be retried exactly
 * once on a brand-new connection. Aborts always surface unchanged, any other
 * error surfaces unchanged once IContent has been yielded (the turn is no
 * longer safely replayable), and a second lifecycle-limit rejection fails
 * the turn with a terminal StreamInterruptionError instead of looping.
 */
function decideLifecycleRetry(
  error: unknown,
  state: LifecycleAttemptState,
): LifecycleRetryOutcome {
  if (error instanceof Error && error.name === 'AbortError') {
    return { retry: false, error };
  }
  if (!isWebSocketConnectionLimitError(error) || state.contentYielded) {
    return { retry: false, error };
  }
  if (state.retryUsed) {
    // Preserve the original providerError payload and cause so generic
    // classification (details.providerError) and diagnostics survive the
    // terminal wrap; nothing outside this module retries on this code.
    const providerError = (error as { details?: { providerError?: unknown } })
      .details?.providerError;
    return {
      retry: false,
      error: createStreamInterruptionError(
        'Codex Responses WebSocket reached the connection lifecycle ' +
          `limit (${WEBSOCKET_CONNECTION_LIMIT_CODE}) and the single ` +
          'retry was also rejected',
        providerError !== undefined ? { providerError } : undefined,
        error,
      ),
    };
  }
  return { retry: true };
}

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

export interface SocketCloseInfo {
  readonly code?: number;
  readonly reason?: string;
  readonly wasClean?: boolean;
}

export interface TransportSocket {
  readonly readyState: number;
  readonly CONNECTING: number;
  readonly OPEN: number;
  send(data: string): void;
  close(): void;
  onOpen(listener: () => void): () => void;
  onMessage(listener: (data: unknown) => void): () => void;
  onClose(listener: (info: SocketCloseInfo) => void): () => void;
  onError(listener: () => void): () => void;
}

export type OpenTransportSocket = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => TransportSocket;

interface WebSocketTransportConfig {
  readonly logger?: TransportLogger;
  readonly openSocket?: OpenTransportSocket;
  /**
   * Per-connection handshake (open) timeout. Defaults to
   * {@link HANDSHAKE_TIMEOUT_MS}. Exposed so tests can exercise the timeout
   * path without waiting the full production duration.
   */
  readonly handshakeTimeoutMs?: number;
}

// Matches the Codex client's default WebSocket connect timeout
// (websocket_connect_timeout_ms in codex-rs/model-provider-info/src/lib.rs).
const HANDSHAKE_TIMEOUT_MS = 15_000;

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

function throwIfAborted(abortSignal: AbortSignal | undefined): void {
  if (abortSignal?.aborted === true) {
    throw createAbortError(abortSignal.reason);
  }
}

async function waitForTurn(
  turn: Promise<void>,
  abortSignal: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(abortSignal);
  if (abortSignal === undefined) {
    await turn;
    return;
  }
  let onAbort = (): void => undefined;
  try {
    await Promise.race([
      turn,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(createAbortError(abortSignal.reason));
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    abortSignal.removeEventListener('abort', onAbort);
  }
  throwIfAborted(abortSignal);
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

  onClose(listener: (info: SocketCloseInfo) => void): () => void {
    const handler = (event: {
      readonly code: number;
      readonly reason: string;
      readonly wasClean: boolean;
    }): void =>
      listener({
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
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
  private receivedTerminal = false;
  private acceptedTerminal = false;
  private readonly detachListeners: () => void;
  private readonly detachAbort: () => void;
  private readonly logger: TransportLogger | undefined;

  constructor(
    socket: TransportSocket,
    abortSignal: AbortSignal | undefined,
    onResponseEvent: (() => void) | undefined,
    logger: TransportLogger | undefined,
  ) {
    this.logger = logger;
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
      this.queue.push(frame.data);
      if (isTerminalEventType(frame.type)) {
        this.receivedTerminal = true;
        if (
          frame.type !== undefined &&
          ACCEPTED_TERMINAL_EVENT_TYPES.has(frame.type)
        ) {
          this.acceptedTerminal = true;
        }
        this.ended = true;
      }
      this.drain();
      this.notifyResponseEvent(onResponseEvent);
    });
    const detachClose = socket.onClose((info) => {
      this.logger?.debug(
        () =>
          `Codex Responses WebSocket closed: code=${info.code ?? 'n/a'}, reason=${info.reason ?? 'n/a'}, wasClean=${info.wasClean ?? 'n/a'}`,
      );
      this.fail(
        createStreamInterruptionError(
          'Codex Responses WebSocket closed before response.completed',
          { closeInfo: info },
        ),
      );
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
      this.detachAbort = () =>
        abortSignal.removeEventListener('abort', onAbort);
      if (abortSignal.aborted) onAbort();
      else abortSignal.addEventListener('abort', onAbort, { once: true });
    } else {
      this.detachAbort = () => undefined;
    }
  }

  didReceiveAcceptedTerminal(): boolean {
    return this.acceptedTerminal;
  }

  // Observational only: invoked after the frame is committed and the waiter is
  // settled, so a throwing or aborting callback cannot corrupt internal state.
  private notifyResponseEvent(onResponseEvent: (() => void) | undefined): void {
    if (onResponseEvent === undefined) return;
    try {
      onResponseEvent();
    } catch (error) {
      this.logger?.debug(
        () =>
          `Codex Responses onResponseEvent callback failed: ${String(error)}`,
      );
    }
  }

  // Throws a recorded failure before each yield so a failure observed while
  // the parser worked cannot cross the output boundary.
  throwIfFailed(): void {
    if (this.failure !== undefined) throw this.failure;
  }

  next(): Promise<FrameResult> {
    // Failure takes precedence over queued frames. Failure and terminal are
    // mutually exclusive: fail() is a no-op once a terminal arrived, and
    // intake ends on either outcome.
    if (this.failure !== undefined) return Promise.reject(this.failure);
    const value = this.queue.shift();
    if (value !== undefined) return Promise.resolve({ done: false, value });
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
    // First outcome wins: a terminal frame or recorded failure cannot be
    // replaced by a later close/error/abort.
    if (this.receivedTerminal || this.failure !== undefined) return;
    this.failure = error;
    this.ended = true;
    this.drain();
  }

  private drain(): void {
    if (this.waiting === undefined) return;
    if (this.failure === undefined && this.queue.length === 0 && !this.ended) {
      return;
    }
    const waiting = this.waiting;
    this.waiting = undefined;
    if (this.failure !== undefined) {
      waiting.reject(this.failure);
      return;
    }
    const value = this.queue.shift();
    if (value !== undefined) waiting.resolve({ done: false, value });
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

class CodexResponsesWebSocketTransport implements WebSocketTransport {
  private active: LiveConnection | undefined;
  private requestQueue: Promise<void> = Promise.resolve();

  private readonly openSocket: OpenTransportSocket;
  private readonly handshakeTimeoutMs: number;

  constructor(private readonly config: WebSocketTransportConfig) {
    this.openSocket = config.openSocket ?? openUndiciSocket;
    this.handshakeTimeoutMs = config.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  }

  async *streamResponse(
    request: OpenAIResponsesRequest,
    options: StreamResponseOptions,
  ): AsyncIterableIterator<IContent> {
    const resolveTurn = await this.acquireRequestTurn(options.abortSignal);
    const state: LifecycleAttemptState = {
      completed: false,
      retryUsed: false,
      contentYielded: false,
    };
    let socket: TransportSocket | undefined;
    try {
      // #2771: at most one fresh-connection retry per request.
      for (;;) {
        throwIfAborted(options.abortSignal);
        socket = await this.acquireConnection(options);
        throwIfAborted(options.abortSignal);
        const result = yield* this.attemptResponse(
          socket,
          request,
          options,
          state,
        );
        if (result !== 'retry') return;
        socket = undefined;
      }
    } finally {
      if (!state.completed && socket !== undefined) this.invalidate(socket);
      resolveTurn();
    }
  }

  /**
   * Streams one request over `socket`. Returns 'retry' when the attempt
   * failed with the connection-lifecycle verdict and the #2771 retry budget
   * is still available (the retired socket has already been invalidated);
   * throws or returns 'completed' otherwise.
   */
  private async *attemptResponse(
    socket: TransportSocket,
    request: OpenAIResponsesRequest,
    options: StreamResponseOptions,
    state: LifecycleAttemptState,
  ): AsyncGenerator<IContent, 'completed' | 'retry'> {
    const source = new RequestFrameSource(
      socket,
      options.abortSignal,
      options.onResponseEvent,
      this.config.logger,
    );
    try {
      if (socket.readyState !== socket.OPEN) {
        throw createStreamInterruptionError(
          'Codex Responses WebSocket closed before the request was sent',
        );
      }
      throwIfAborted(options.abortSignal);
      socket.send(JSON.stringify({ ...request, type: 'response.create' }));
      for await (const message of parseResponsesStream(
        createResponseByteStream(source),
        {
          includeThinkingInResponse: options.includeThinkingInResponse,
          responsesStored: options.responsesStored,
          onStreamLiveness: options.onStreamLiveness,
        },
      )) {
        source.throwIfFailed();
        state.contentYielded = true;
        yield message;
      }
      if (!source.didReceiveAcceptedTerminal()) {
        throw createStreamInterruptionError(
          'Codex Responses WebSocket ended before a terminal response event',
        );
      }
      state.completed = true;
      return 'completed';
    } catch (error) {
      const outcome = decideLifecycleRetry(error, state);
      if (!outcome.retry) throw outcome.error;
      state.retryUsed = true;
      this.invalidate(socket);
      this.config.logger?.debug(
        () =>
          'Codex Responses WebSocket reported the connection lifecycle ' +
          'limit; retrying the request once on a fresh connection',
      );
      return 'retry';
    } finally {
      source.detach();
    }
  }

  close(): void {
    if (this.active !== undefined) this.closeSocket(this.active.socket);
    this.active = undefined;
  }

  private async acquireRequestTurn(
    abortSignal: AbortSignal | undefined,
  ): Promise<() => void> {
    const previous = this.requestQueue;
    let resolveTurn = (): void => undefined;
    const current = new Promise<void>((resolve) => (resolveTurn = resolve));
    this.requestQueue = previous.then(() => current);
    try {
      await waitForTurn(previous, abortSignal);
      return resolveTurn;
    } catch (error) {
      resolveTurn();
      throw error;
    }
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
        // Settle before closing so a synchronous close dispatch cannot win.
        finish({ error });
        this.closeSocket(socket);
      };
      const timeout = setTimeout(
        () =>
          fail(
            createStreamInterruptionError(
              'Codex Responses WebSocket handshake timed out',
            ),
          ),
        this.handshakeTimeoutMs,
      );
      const onAbort = (): void => fail(createAbortError(abortSignal?.reason));
      removers.push(socket.onOpen(() => finish({ socket })));
      removers.push(
        socket.onError(() =>
          fail(
            createStreamInterruptionError(
              'Codex Responses WebSocket handshake failed',
            ),
          ),
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
      if (abortSignal !== undefined) {
        abortSignal.addEventListener('abort', onAbort, { once: true });
        // Per the DOM spec, a listener added to an ALREADY-aborted signal is
        // never invoked, so this is not a double-invocation. The re-check
        // covers an abort that lands between the early `aborted` check at the
        // top of open() and listener registration above.
        if (abortSignal.aborted) onAbort();
      }
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
  onSuccess: (() => void) | undefined = undefined,
): AsyncIterableIterator<IContent> {
  // The only safe recovery boundary is the point at which an IContent is
  // yielded downstream.
  let contentYielded = false;
  try {
    for await (const message of transport.streamResponse(
      request,
      streamOptions,
    )) {
      contentYielded = true;
      yield message;
    }
    // A clean completion means the WebSocket served the whole response, so the
    // provider can reset its consecutive-failure counter (mirrors the Codex
    // client treating a successful stream as proof the transport is healthy).
    onSuccess?.();
  } catch (error) {
    // Abort always wins and never falls back, regardless of yielded content.
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    // Never replay after any IContent has reached the consumer.
    if (contentYielded) {
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
