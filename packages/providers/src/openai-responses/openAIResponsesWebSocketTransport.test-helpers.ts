/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared fake-socket harness and frame/script helpers for the Codex Responses
 * WebSocket transport tests. Drives the real transport/parser via an in-process
 * TransportSocket double so tests stay behavioral.
 */

import type {
  ContentMetadata,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { OpenAIResponsesRequest } from './OpenAIResponsesTypes.js';
import type {
  OpenTransportSocket,
  StreamResponseOptions,
  TransportSocket,
} from './openAIResponsesWebSocketTransport.js';

type Listener<T> = (value: T) => void;

export interface CloseInfo {
  readonly code?: number;
  readonly reason?: string;
  readonly wasClean?: boolean;
}

export class FakeSocket implements TransportSocket {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readyState = this.CONNECTING;
  readonly sent: string[] = [];
  closed = false;
  onSend: ((data: string) => void) | undefined;
  private readonly openListeners = new Set<Listener<void>>();
  private readonly messageListeners = new Set<Listener<unknown>>();
  private readonly closeListeners = new Set<Listener<CloseInfo>>();
  private readonly errorListeners = new Set<Listener<void>>();

  send(data: string): void {
    this.sent.push(data);
    this.onSend?.(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  onOpen(listener: Listener<void>): () => void {
    this.openListeners.add(listener);
    return () => this.openListeners.delete(listener);
  }

  onMessage(listener: Listener<unknown>): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onClose(listener: Listener<CloseInfo>): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  onError(listener: Listener<void>): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  open(): void {
    this.readyState = this.OPEN;
    for (const listener of this.openListeners) listener();
  }

  message(data: unknown): void {
    for (const listener of this.messageListeners) listener(data);
  }

  serverClose(info: CloseInfo = {}): void {
    this.readyState = 3;
    for (const listener of this.closeListeners) listener(info);
  }

  error(): void {
    for (const listener of this.errorListeners) listener();
  }
}

export class SocketHarness {
  readonly sockets: FakeSocket[] = [];
  readonly urls: string[] = [];
  readonly headers: Array<Readonly<Record<string, string>>> = [];

  constructor(
    private readonly scripts: ReadonlyArray<(socket: FakeSocket) => void>,
  ) {}

  readonly openSocket: OpenTransportSocket = (url, headers) => {
    const socket = new FakeSocket();
    this.sockets.push(socket);
    this.urls.push(url);
    this.headers.push(headers);
    const script = this.scripts[this.sockets.length - 1] ?? this.scripts[0];
    queueMicrotask(() => script(socket));
    return socket;
  };
}

export function request(): OpenAIResponsesRequest {
  return {
    model: 'gpt-5.6-sol',
    input: [{ role: 'user', content: 'Hello' }],
    stream: true,
  };
}

export function options(
  overrides: Partial<StreamResponseOptions> = {},
): StreamResponseOptions {
  return {
    responsesURL: 'https://chatgpt.com/backend-api/codex/responses',
    headers: {
      Authorization: 'Bearer token',
      'ChatGPT-Account-ID': 'account',
      'OpenAI-Beta': 'responses_websockets=2026-02-06',
    },
    ...overrides,
  };
}

export function frame(object: unknown): string {
  return JSON.stringify(object);
}

function deltaFrame(text: string): string {
  return frame({ type: 'response.output_text.delta', delta: text });
}

export function complete(socket: FakeSocket, text?: string): void {
  if (text !== undefined) socket.message(deltaFrame(text));
  socket.message(
    frame({
      type: 'response.completed',
      response: { id: 'response', status: 'completed' },
    }),
  );
}

export function completingScript(text?: string): (socket: FakeSocket) => void {
  return (socket) => {
    socket.open();
    socket.onSend = () => complete(socket, text);
  };
}

export function incompleteScript(
  text?: string,
  closeAfter = true,
): (socket: FakeSocket) => void {
  return (socket) => {
    socket.open();
    socket.onSend = () => {
      if (text !== undefined) socket.message(deltaFrame(text));
      socket.message(
        frame({
          type: 'response.incomplete',
          response: {
            id: 'resp_incomplete',
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            usage: {
              input_tokens: 4,
              output_tokens: 6,
              total_tokens: 10,
              input_tokens_details: { cached_tokens: 1 },
            },
          },
        }),
      );
      if (closeAfter) socket.serverClose();
    };
  };
}

export function doneScript(
  text?: string,
  closeAfter = true,
): (socket: FakeSocket) => void {
  return (socket) => {
    socket.open();
    socket.onSend = () => {
      if (text !== undefined) socket.message(deltaFrame(text));
      socket.message(
        frame({
          type: 'response.done',
          response: { id: 'resp_done', status: 'completed' },
        }),
      );
      if (closeAfter) socket.serverClose();
    };
  };
}

export function metadataOf(
  messages: readonly IContent[],
): ContentMetadata | undefined {
  return messages.find((message) => message.metadata)?.metadata;
}

export function textContent(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

export function fallbackStream(
  text: string,
  counter?: { calls: number },
): () => AsyncIterableIterator<IContent> {
  return async function* fallback() {
    if (counter !== undefined) counter.calls += 1;
    yield textContent(text);
  };
}

export async function drain(
  iterator: AsyncIterableIterator<IContent>,
): Promise<readonly IContent[]> {
  const messages: IContent[] = [];
  for await (const message of iterator) messages.push(message);
  return messages;
}

export function parsedObject(serialized: string): object {
  const value: unknown = JSON.parse(serialized);
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected serialized request object');
  }
  return value;
}
