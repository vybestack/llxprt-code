/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import {
  createCodexResponsesWebSocketTransport,
  isStatefulConnectionRenewalError,
  streamOverWebSocketOrFallback,
  WEBSOCKET_CONNECTION_LIMIT_CODE,
  type WebSocketTransport,
} from './openAIResponsesWebSocketTransport.js';
import {
  SocketHarness,
  completingScript,
  connectionLimitErrorFrame,
  connectionLimitScript,
  drain,
  fallbackStream,
  options,
  request,
  textContent,
} from './__tests__/openAIResponsesWebSocketTransport.test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

describe('Codex Responses WebSocket stateful connection scope @issue:3446', () => {
  it('fails a stateful request with the renewal verdict instead of replaying the parent', async () => {
    const harness = new SocketHarness([
      connectionLimitScript(),
      completingScript('recovered'),
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    const statefulRequest = {
      ...request(),
      previous_response_id: 'resp_parent',
    };

    const rejection = await drain(
      transport.streamResponse(statefulRequest, options()),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejection).toBeDefined();
    expect(isStatefulConnectionRenewalError(rejection)).toBe(true);
    expect(
      (rejection as { details?: Record<string, unknown> }).details?.[
        'retiredParentId'
      ],
    ).toBe('resp_parent');
    // The dead socket is the only one opened: the parent-scoped request is
    // never re-sent, so the scripted second socket is never reached.
    expect(harness.sockets).toHaveLength(1);
    expect(harness.sockets[0].closedByClient).toBe(true);
    expect(
      harness.sockets[0].sent.filter((data) => data.length > 0),
    ).toHaveLength(1);
  });

  it('still reconnects and recovers a stateless request on the lifecycle limit', async () => {
    const harness = new SocketHarness([
      connectionLimitScript(),
      completingScript('recovered'),
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    const messages = await drain(
      transport.streamResponse(request(), options()),
    );

    expect(messages).toContainEqual(textContent('recovered'));
    expect(harness.sockets).toHaveLength(2);
    expect(harness.sockets[0].closedByClient).toBe(true);
  });

  it('rethrows a pre-output previous-response-not-found without invoking the HTTP fallback', async () => {
    const failure = Object.assign(
      new Error("Previous response with id 'resp_x' not found."),
      { status: 400 },
    );
    let streamCalls = 0;
    const transport: WebSocketTransport = {
      async *streamResponse() {
        streamCalls += 1;
        throw failure;
        // Pre-output throw: nothing is yielded on this fake stream.
        yield* [] as IContent[];
      },
      close() {},
    };
    const counter = { calls: 0 };
    const onFallback = vi.fn();
    const iterator = streamOverWebSocketOrFallback(
      transport,
      request(),
      options(),
      fallbackStream('HTTP', counter),
      onFallback,
      undefined,
    );

    await expect(drain(iterator)).rejects.toBe(failure);
    expect(streamCalls).toBe(1);
    expect(counter.calls).toBe(0);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('still falls back to HTTP for an unrelated pre-output error', async () => {
    const failure = new Error('connect failed');
    const transport: WebSocketTransport = {
      async *streamResponse() {
        throw failure;
        // Pre-output throw: nothing is yielded on this fake stream.
        yield* [] as IContent[];
      },
      close() {},
    };
    const counter = { calls: 0 };
    const onFallback = vi.fn();
    const iterator = streamOverWebSocketOrFallback(
      transport,
      request(),
      options(),
      fallbackStream('HTTP', counter),
      onFallback,
      undefined,
    );

    const messages = await drain(iterator);

    expect(messages).toContainEqual(textContent('HTTP'));
    expect(counter.calls).toBe(1);
    expect(onFallback).toHaveBeenCalled();
  });

  it('builds the renewal verdict from the lifecycle-limit failure', async () => {
    // The verdict must carry the original lifecycle error as its cause so
    // diagnostics keep the provider error payload.
    const harness = new SocketHarness([
      connectionLimitScript(),
      completingScript('recovered'),
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    const statefulRequest = {
      ...request(),
      previous_response_id: 'resp_parent',
    };

    const rejection = await drain(
      transport.streamResponse(statefulRequest, options()),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejection).toBeDefined();
    expect(
      (
        (rejection as { cause?: unknown }).cause as {
          details?: { providerError?: { code?: unknown } };
        }
      ).details?.providerError?.code,
    ).toBe(WEBSOCKET_CONNECTION_LIMIT_CODE);
  });

  it('lets an abort at the retired-socket handoff win over the renewal verdict', async () => {
    // An abort landing while the dead socket is being dropped must surface as
    // AbortError (the file's contract: abort always wins), not as the
    // stateful renewal verdict, and must never open a second socket. The
    // close listener fires from the client-side invalidation after the
    // attempt reports 'retry' but before the handoff verdict is thrown.
    const controller = new AbortController();
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onClose(() => controller.abort());
        socket.onSend = () => socket.message(connectionLimitErrorFrame());
      },
      completingScript('recovered'),
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    const statefulRequest = {
      ...request(),
      previous_response_id: 'resp_parent',
    };

    const rejection = await drain(
      transport.streamResponse(
        statefulRequest,
        options({ abortSignal: controller.signal }),
      ),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejection).toBeDefined();
    expect(rejection).toMatchObject({ name: 'AbortError' });
    expect(isStatefulConnectionRenewalError(rejection)).toBe(false);
    expect(harness.sockets).toHaveLength(1);
    expect(harness.sockets[0].closedByClient).toBe(true);
  });

  it('surfaces a stateless handoff abort as AbortError without the renewal verdict (stateless control)', async () => {
    // Stateless control: the same abort at the retired-socket handoff wins
    // for a request without a previous_response_id too — the single #2771
    // replay is abandoned before a second socket opens.
    const controller = new AbortController();
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onClose(() => controller.abort());
        socket.onSend = () => socket.message(connectionLimitErrorFrame());
      },
      completingScript('recovered'),
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    const rejection = await drain(
      transport.streamResponse(
        request(),
        options({ abortSignal: controller.signal }),
      ),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejection).toBeDefined();
    expect(rejection).toMatchObject({ name: 'AbortError' });
    expect(isStatefulConnectionRenewalError(rejection)).toBe(false);
    expect(harness.sockets).toHaveLength(1);
  });
});
