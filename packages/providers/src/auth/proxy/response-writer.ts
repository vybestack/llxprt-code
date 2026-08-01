/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Version-aware response writer for the credential proxy server. Encodes
 * response frames as exactly one socket.write() call, enforcing the v1
 * frame-size guard so a v2 server never bricks a v1 client.
 *
 * The one-write shape is load-bearing: concurrent dispatch means multiple
 * handlers may call send/sendError simultaneously, and Node's
 * stream.Duplex guarantees whole-buffer writes cannot interleave
 * mid-buffer. Each response must remain a single write so the client's
 * FrameDecoder never sees a truncated or interleaved frame.
 *
 * @plan PLAN-20260731-GHBROKER.P05
 * @requirement REQ-005, REQ-006
 * @pseudocode 001-concurrent-dispatch.md lines 991/1001 I1, 002-frame-and-cancel.md lines 67-76
 */

import type * as net from 'node:net';
import {
  encodeFrame,
  V1_MAX_FRAME_SIZE,
} from '@vybestack/llxprt-code-auth/proxy/framing.js';

/**
 * Callback type for the audit-log function passed from the server.
 */
export type AuditLogFn = (
  level: 'INFO' | 'WARN' | 'ERROR',
  connectionId: number,
  operation: string,
  details?: Record<string, unknown>,
) => void;

/**
 * Provides version-negotiated frame writing for a single connection.
 *
 * @plan PLAN-20260731-GHBROKER.P05
 * @requirement REQ-006
 * @pseudocode 002-frame-and-cancel.md lines 67-76
 */
export class ResponseWriter {
  /**
   * @param socket The connection's socket.
   * @param connectionId Audit-log connection id.
   * @param auditLog Server audit-log callback.
   * @param getNegotiatedVersion Returns the version negotiated at handshake.
   */
  constructor(
    private readonly socket: net.Socket,
    private readonly connectionId: number,
    private readonly auditLog: AuditLogFn,
    private getNegotiatedVersion: () => number,
  ) {}

  /**
   * Emits a success response as exactly one socket.write() of one complete
   * frame.
   *
   * @plan PLAN-20260731-GHBROKER.P05
   * @requirement REQ-006
   * @pseudocode 002-frame-and-cancel.md lines 67-76
   */
  sendOk(id: string, data: Record<string, unknown>): void {
    this.writeResponse(id, { ok: true, data });
  }

  /**
   * Emits an error response as exactly one socket.write() of one complete
   * frame.
   *
   * @plan PLAN-20260731-GHBROKER.P05
   * @requirement REQ-006
   * @pseudocode 002-frame-and-cancel.md lines 67-76
   */
  sendError(id: string, code: string, error: string): void {
    this.writeResponse(id, { ok: false, code, error });
  }

  /**
   * Encodes and writes a response frame, enforcing the v1 frame-size guard.
   * For a v1 client whose negotiated version is 1, if the encoded frame
   * would exceed V1_MAX_FRAME_SIZE (64 KiB), sends RESPONSE_TOO_LARGE instead
   * so the v1 client does not receive a frame it cannot decode. Without this,
   * a v2 server silently bricks a v1 client.
   *
   * @plan PLAN-20260731-GHBROKER.P05
   * @requirement REQ-006
   * @pseudocode 002-frame-and-cancel.md lines 75-76
   */
  private writeResponse(id: string, response: Record<string, unknown>): void {
    if (this.socket.destroyed || !this.socket.writable) return;
    const negotiatedVersion = this.getNegotiatedVersion();
    const frame = encodeFrame({ id, ...response });
    // V1_MAX_FRAME_SIZE is the total frame budget a v1 peer accepts, and
    // frame.length already includes the 4-byte length header encodeFrame
    // prepends. The earlier `+ 4` let four bytes past what a v1 decoder
    // will take.
    if (negotiatedVersion === 1 && frame.length > V1_MAX_FRAME_SIZE) {
      this.auditLog('WARN', this.connectionId, 'response_too_large', {
        version: negotiatedVersion,
        frameSize: frame.length,
      });
      const fallback = encodeFrame({
        id,
        ok: false,
        code: 'RESPONSE_TOO_LARGE',
        error: 'Response exceeds maximum frame size for protocol version 1',
      });
      this.socket.write(fallback);
      return;
    }
    this.socket.write(frame);
  }
}
