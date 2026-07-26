/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for runZedIntegration signal-driven disposal.
 *
 * These tests exercise the REAL `@agentclientprotocol/sdk` path:
 * `Readable.toWeb(ownedSource)` → `ndJsonStream(stdout, stdin)` →
 * `AgentSideConnection`. No mocks of the transport. The goal is to prove the
 * ownership-based lifecycle fix end-to-end:
 *
 * 1. The web `stdin` is LOCKED by `ndJsonStream` (so `.cancel()` would fail).
 * 2. Destroying the owned source resolves `connection.closed` (the signal path).
 * 3. The disposal handler built by {@link buildSignalDisposalHandler} closes the
 *    connection.
 * 4. {@link installDisposalSignalHandlers} fires the callback on signals and
 *    removes listeners on dispose (no leak).
 * 5. A full signal-to-cleanup lifecycle completes (signal → connection.closed →
 *    cleanup ran).
 */

import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import * as acp from '@agentclientprotocol/sdk';
import type { Agent as AcpAgent } from '@agentclientprotocol/sdk';
import {
  buildSignalDisposalHandler,
  installDisposalSignalHandlers,
} from './runZedIntegration.js';

/**
 * Minimal ACP Agent that accepts initialize/newSession but never produces prompt
 * output, so the connection stays open until the transport is torn down —
 * mirroring the real idle-before-signal state.
 */
class IdleTestAgent implements AcpAgent {
  async initialize(
    _params: acp.InitializeRequest,
  ): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: 1,
      agentCapabilities: { loadSession: false },
      authMethods: [],
    };
  }
  async newSession(
    _params: acp.NewSessionRequest,
  ): Promise<acp.NewSessionResponse> {
    return { sessionId: 'test-session' };
  }
  async authenticate(_params: acp.AuthenticateRequest): Promise<void> {}
  async prompt(_params: acp.PromptRequest): Promise<acp.PromptResponse> {
    return { stopReason: 'end_turn' };
  }
  async cancel(_params: acp.CancelNotification): Promise<void> {}
}

/**
 * Wires up the real ACP transport the same way runZedIntegration does:
 * owned Node `Readable` → `Readable.toWeb` → `ndJsonStream` →
 * `AgentSideConnection`. Returns the owned source, the web input stream, and the
 * connection for assertions.
 */
function buildRealAcpTransport(): {
  ownedSource: Readable;
  webInput: ReadableStream<Uint8Array>;
  connection: acp.AgentSideConnection;
} {
  // A Readable that never produces data on its own (simulates idle stdin).
  const ownedSource = new Readable({ read() {} });
  const stdoutSink = new Writable({
    write(_c, _e, cb) {
      cb();
    },
  });
  const webInput = Readable.toWeb(ownedSource) as ReadableStream<Uint8Array>;
  const webOutput = Writable.toWeb(stdoutSink) as WritableStream<Uint8Array>;
  const stream = acp.ndJsonStream(webOutput, webInput);
  const connection = new acp.AgentSideConnection(
    () => new IdleTestAgent(),
    stream,
  );
  return { ownedSource, webInput, connection };
}

/**
 * Races `connection.closed` against a timeout, returning whether it settled.
 */
async function closedSettled(
  connection: acp.AgentSideConnection,
  timeoutMs = 1000,
): Promise<boolean> {
  const sentinel = Symbol('settled');
  const result = await Promise.race([
    connection.closed.then(() => sentinel),
    new Promise<typeof sentinel>((resolve) =>
      setTimeout(
        () => resolve(undefined as unknown as typeof sentinel),
        timeoutMs,
      ),
    ),
  ]);
  return result === sentinel;
}

describe('runZedIntegration signal-driven disposal (real ACP path)', () => {
  it('ndJsonStream locks the web input stream so .cancel() is not viable', async () => {
    const { webInput } = buildRealAcpTransport();
    expect(webInput.locked).toBe(true);
    // Confirm that cancel() rejects on the locked stream — this is the exact
    // failure mode of the prior staged handler.
    await expect(webInput.cancel()).rejects.toThrow(/locked/);
  });

  it('destroying the owned source resolves connection.closed', async () => {
    const { ownedSource, connection } = buildRealAcpTransport();
    // Sanity: not closed before destroy
    expect(await closedSettled(connection, 200)).toBe(false);
    // Destroy the OWNED transport source (what buildSignalDisposalHandler does)
    ownedSource.destroy();
    // connection.closed must now settle
    expect(await closedSettled(connection, 1000)).toBe(true);
  });

  it('buildSignalDisposalHandler destroys the owned source without throwing', () => {
    const logger = { debug: vi.fn() };
    const { ownedSource } = buildRealAcpTransport();
    const handler = buildSignalDisposalHandler(ownedSource, logger);
    expect(() => handler()).not.toThrow();
    expect(ownedSource.destroyed).toBe(true);
    // destroy is idempotent — second call must not throw
    expect(() => handler()).not.toThrow();
    // Logger should not have been called (no error path)
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('buildSignalDisposalHandler triggers connection closure via the real transport', async () => {
    const logger = { debug: vi.fn() };
    const { ownedSource, connection } = buildRealAcpTransport();
    const handler = buildSignalDisposalHandler(ownedSource, logger);
    // Fire the handler as a signal listener would
    handler();
    expect(await closedSettled(connection, 1000)).toBe(true);
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('installDisposalSignalHandlers invokes the callback on SIGINT and SIGTERM', () => {
    const onSignal = vi.fn();
    const fakeProcess = new EventEmitter();
    installDisposalSignalHandlers(onSignal, ['SIGINT', 'SIGTERM'], fakeProcess);
    fakeProcess.emit('SIGINT');
    expect(onSignal).toHaveBeenCalledTimes(1);
    fakeProcess.emit('SIGTERM');
    expect(onSignal).toHaveBeenCalledTimes(2);
  });

  it('installDisposalSignalHandlers removes listeners on dispose (no leak)', () => {
    const onSignal = vi.fn();
    const fakeProcess = new EventEmitter();
    const dispose = installDisposalSignalHandlers(
      onSignal,
      ['SIGINT', 'SIGTERM'],
      fakeProcess,
    );
    expect(fakeProcess.listenerCount('SIGINT')).toBe(1);
    expect(fakeProcess.listenerCount('SIGTERM')).toBe(1);
    dispose();
    expect(fakeProcess.listenerCount('SIGINT')).toBe(0);
    expect(fakeProcess.listenerCount('SIGTERM')).toBe(0);
    // Emitting after dispose must not call the handler
    fakeProcess.emit('SIGINT');
    expect(onSignal).not.toHaveBeenCalled();
  });

  it('full lifecycle: signal → handler → connection.closed → cleanup', async () => {
    const logger = { debug: vi.fn() };
    const fakeProcess = new EventEmitter();
    const { ownedSource, connection } = buildRealAcpTransport();
    const handler = buildSignalDisposalHandler(ownedSource, logger);
    const dispose = installDisposalSignalHandlers(
      handler,
      ['SIGINT', 'SIGTERM'],
      fakeProcess,
    );

    // Simulate cleanup tracking (mirrors the finally block in runZedIntegration)
    let cleanupRan = false;
    const cleanupPromise = connection.closed.then(async () => {
      dispose();
      cleanupRan = true;
    });

    // Fire the signal
    fakeProcess.emit('SIGINT');

    await cleanupPromise;
    expect(cleanupRan).toBe(true);
    // Listeners removed after cleanup
    expect(fakeProcess.listenerCount('SIGINT')).toBe(0);
    expect(fakeProcess.listenerCount('SIGTERM')).toBe(0);
  });
});
