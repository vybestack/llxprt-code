/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unix domain socket client for credential proxy protocol.
 *
 * @plan PLAN-20250214-CREDPROXY.P03
 * @requirement R6.1-R6.5, R24.1, R24.2
 * @pseudocode analysis/pseudocode/001-framing-protocol.md
 */

import * as net from 'node:net';
import * as crypto from 'node:crypto';
import { encodeFrame, FrameDecoder } from './framing.js';

export const REQUEST_TIMEOUT_MS = 30000;
export const IDLE_TIMEOUT_MS = 300000;
export const PROTOCOL_VERSION = 1;

export type ProxyResponse = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  code?: string;
  retryAfter?: number;
};

interface PendingRequest {
  resolve: (value: ProxyResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ProxySocketClient {
  private readonly socketPath: string;
  private socket: net.Socket | null = null;
  private decoder: FrameDecoder = new FrameDecoder({
    onPartialFrameTimeout: () => this.handlePartialFrameTimeout(),
  });
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private handshakeComplete: boolean = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private connectingPromise: Promise<void> | null = null;
  private handshakeResolver: {
    resolve: (value: Record<string, unknown>) => void;
    reject: (reason: Error) => void;
  } | null = null;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async ensureConnected(): Promise<void> {
    if (this.socket !== null && this.handshakeComplete) {
      this.resetIdleTimer();
      return;
    }
    if (this.connectingPromise) {
      await this.connectingPromise;
      return;
    }
    this.connectingPromise = this.connectAndHandshake();
    try {
      await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  private isConnected(): boolean {
    return this.socket !== null && this.handshakeComplete;
  }

  async request(
    op: string,
    payload: Record<string, unknown>,
  ): Promise<ProxyResponse> {
    if (!this.isConnected()) {
      await this.ensureConnected();
    } else {
      this.resetIdleTimer();
    }
    return this.sendRequest(op, payload);
  }

  private sendRequest(
    op: string,
    payload: Record<string, unknown>,
  ): Promise<ProxyResponse> {
    const id = crypto.randomUUID();
    const frame = { v: PROTOCOL_VERSION, id, op, payload };

    const promise = new Promise<ProxyResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
      this.pendingRequests.set(id, { resolve, reject, timer });
    });

    this.socket!.write(encodeFrame(frame));
    this.resetIdleTimer();
    return promise;
  }

  close(): void {
    this.cancelIdleTimer();
    this.destroy('Client closed');
  }

  gracefulClose(): void {
    this.handshakeComplete = false;
    // Reject any pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection closing'));
    }
    this.pendingRequests.clear();
    if (this.handshakeResolver) {
      const resolver = this.handshakeResolver;
      this.handshakeResolver = null;
      resolver.reject(new Error('Connection closing'));
    }
    if (this.socket !== null) {
      // Remove listeners to prevent stale close events from affecting new connections
      this.socket.removeAllListeners();
      this.socket.end();
      this.socket = null;
    }
    this.decoder.reset();
  }

  private async connectAndHandshake(): Promise<void> {
    await this.connect();
    await this.handshake();
  }

  private async connect(): Promise<void> {
    this.socket = net.createConnection(this.socketPath);
    this.decoder = new FrameDecoder({
      onPartialFrameTimeout: () => this.handlePartialFrameTimeout(),
    });
    this.socket.on('data', (chunk: Buffer) => this.onData(chunk));
    this.socket.on('error', (err: Error) => this.onError(err));
    this.socket.on('close', () => this.onClose());
    await new Promise<void>((resolve, reject) => {
      this.socket!.once('connect', resolve);
      this.socket!.once('error', reject);
    });
  }

  private async handshake(): Promise<void> {
    const request = {
      v: PROTOCOL_VERSION,
      op: 'handshake',
      payload: { minVersion: 1, maxVersion: 1 },
    };
    this.socket!.write(encodeFrame(request));

    const response = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        this.handshakeResolver = { resolve, reject };
        const timer = setTimeout(() => {
          this.handshakeResolver = null;
          reject(
            new Error(`Handshake timed out after ${REQUEST_TIMEOUT_MS}ms`),
          );
        }, REQUEST_TIMEOUT_MS);

        const originalResolve = this.handshakeResolver.resolve;
        this.handshakeResolver.resolve = (value) => {
          clearTimeout(timer);
          originalResolve(value);
        };
        const originalReject = this.handshakeResolver.reject;
        this.handshakeResolver.reject = (reason) => {
          clearTimeout(timer);
          originalReject(reason);
        };
      },
    );

    if (response.ok !== true) {
      throw new Error(
        'Version mismatch: ' + (response.error ?? 'unknown error'),
      );
    }
    this.handshakeComplete = true;
    this.resetIdleTimer();
  }

  private onData(chunk: Buffer): void {
    try {
      const frames = this.decoder.feed(chunk);
      for (const frame of frames) {
        if (this.handshakeResolver) {
          const resolver = this.handshakeResolver;
          this.handshakeResolver = null;
          resolver.resolve(frame);
          continue;
        }

        const id = frame.id as string | undefined;
        if (id) {
          const pending = this.pendingRequests.get(id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(id);
            pending.resolve(frame as unknown as ProxyResponse);
          }
        }
      }
    } catch {
      this.destroy('Frame decode error');
    }
  }

  private onError(_err: Error): void {
    this.destroy('Credential proxy connection lost. Restart the session.');
  }

  private onClose(): void {
    if (this.handshakeComplete || this.handshakeResolver) {
      this.destroy('Credential proxy connection lost. Restart the session.');
    }
  }

  private handlePartialFrameTimeout(): void {
    this.destroy(
      'Credential proxy partial frame timeout. Connection will be reset.',
    );
  }

  private destroy(message: string): void {
    this.cancelIdleTimer();

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pendingRequests.clear();

    this.handshakeComplete = false;

    if (this.socket !== null) {
      this.socket.destroy();
      this.socket = null;
    }
    this.decoder.reset();

    if (this.handshakeResolver) {
      const resolver = this.handshakeResolver;
      this.handshakeResolver = null;
      resolver.reject(new Error(message));
    }
  }

  private resetIdleTimer(): void {
    this.cancelIdleTimer();
    this.idleTimer = setTimeout(() => this.gracefulClose(), IDLE_TIMEOUT_MS);
    if (this.idleTimer.unref) {
      this.idleTimer.unref();
    }
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
