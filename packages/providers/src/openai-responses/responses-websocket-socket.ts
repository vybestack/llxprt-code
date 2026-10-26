/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import WebSocket from 'ws';
import type {
  SocketCloseInfo,
  TransportSocket,
} from './openAIResponsesWebSocketTransport.js';

export class ResponsesWebSocketFragmentError extends Error {
  constructor(message: string, cause?: unknown) {
    super(`Codex Responses WebSocket fragmented send failed: ${message}`, {
      cause,
    });
    this.name = 'ResponsesWebSocketFragmentError';
  }
}

export class WsTransportSocket implements TransportSocket {
  readonly CONNECTING = WebSocket.CONNECTING;
  readonly OPEN = WebSocket.OPEN;

  constructor(private readonly socket: WebSocket) {}

  get readyState(): number {
    return this.socket.readyState;
  }

  sendFragment(data: Uint8Array, fin: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.send(
        data,
        { binary: true, fin, compress: false },
        (error) => {
          if (error)
            reject(new ResponsesWebSocketFragmentError(error.message, error));
          else resolve();
        },
      );
    });
  }

  close(): void {
    this.socket.close();
  }

  terminate(): void {
    this.socket.terminate();
  }

  onOpen(listener: () => void): () => void {
    this.socket.on('open', listener);
    return () => this.socket.off('open', listener);
  }

  onMessage(listener: (data: unknown) => void): () => void {
    const handler = (data: WebSocket.RawData, binary: boolean): void =>
      listener(binary ? data : data.toString());
    this.socket.on('message', handler);
    return () => this.socket.off('message', handler);
  }

  onClose(listener: (info: SocketCloseInfo) => void): () => void {
    const handler = (code: number, reason: Buffer): void =>
      listener({ code, reason: reason.toString(), wasClean: code === 1000 });
    this.socket.on('close', handler);
    return () => this.socket.off('close', handler);
  }

  onError(listener: () => void): () => void {
    this.socket.on('error', listener);
    return () => this.socket.off('error', listener);
  }
}

export function openWsSocket(
  url: string,
  headers: Readonly<Record<string, string>>,
): TransportSocket {
  return new WsTransportSocket(
    new WebSocket(url, { headers, perMessageDeflate: false }),
  );
}
