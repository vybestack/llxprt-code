/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TransportSocket } from './openAIResponsesWebSocketTransport.js';

export const WEBSOCKET_CONNECTION_LIMIT_CODE =
  'websocket_connection_limit_reached';
const CONNECTION_RENEWAL_MS = 55 * 60 * 1000;

export class ResponsesWebSocketLifetime {
  private readonly openedAt = Date.now();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly detachMessage: () => void;
  private closed = false;

  constructor(socket: TransportSocket, retire: () => void) {
    const retireIfOpen = (): void => {
      if (!this.closed) retire();
    };
    this.timer = setTimeout(retireIfOpen, CONNECTION_RENEWAL_MS);
    this.timer.unref();
    this.detachMessage = socket.onMessage((data) => {
      if (isConnectionLimitFrame(data)) retireIfOpen();
    });
  }

  isExpired(): boolean {
    return Date.now() - this.openedAt >= CONNECTION_RENEWAL_MS;
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.detachMessage();
  }
}

function isConnectionLimitFrame(data: unknown): boolean {
  if (typeof data !== 'string') return false;
  let event: unknown;
  try {
    event = JSON.parse(data);
  } catch {
    return false;
  }
  if (
    typeof event !== 'object' ||
    event === null ||
    Reflect.get(event, 'type') !== 'error'
  )
    return false;
  const error: unknown = Reflect.get(event, 'error');
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === WEBSOCKET_CONNECTION_LIMIT_CODE
  );
}

export function isWebSocketConnectionLimitError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const details: unknown = Reflect.get(error, 'details');
  if (typeof details !== 'object' || details === null) return false;
  const providerError: unknown = Reflect.get(details, 'providerError');
  return (
    typeof providerError === 'object' &&
    providerError !== null &&
    Reflect.get(providerError, 'code') === WEBSOCKET_CONNECTION_LIMIT_CODE
  );
}
