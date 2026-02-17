/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Length-prefixed framing protocol for credential proxy IPC.
 *
 * @plan PLAN-20250214-CREDPROXY.P03
 * @requirement R5.1, R5.2, R5.3
 * @pseudocode analysis/pseudocode/001-framing-protocol.md
 */

// ─── Constants ───────────────────────────────────────────────────────────────

export const MAX_FRAME_SIZE = 65536;
export const PARTIAL_FRAME_TIMEOUT_MS = 5000;

// ─── Errors ──────────────────────────────────────────────────────────────────

export class FrameError extends Error {
  constructor(message: string) {
    super(message);
  }
}

// ─── Functions ───────────────────────────────────────────────────────────────

export function encodeFrame(payload: Record<string, unknown>): Buffer {
  const json = JSON.stringify(payload);
  const jsonBytes = Buffer.from(json, 'utf8');
  if (jsonBytes.length > MAX_FRAME_SIZE) {
    throw new FrameError('Frame exceeds maximum size');
  }
  const header = Buffer.alloc(4);
  header.writeUInt32BE(jsonBytes.length, 0);
  return Buffer.concat([header, jsonBytes]);
}

// ─── FrameDecoder Class ──────────────────────────────────────────────────────

export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  private partialFrameTimer: ReturnType<typeof setTimeout> | null = null;

  feed(chunk: Buffer): Array<Record<string, unknown>> {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Array<Record<string, unknown>> = [];

    while (this.buffer.length >= 4) {
      const payloadLength = this.buffer.readUInt32BE(0);
      if (payloadLength > MAX_FRAME_SIZE) {
        throw new FrameError('Frame exceeds maximum size');
      }
      if (this.buffer.length < 4 + payloadLength) {
        this.startPartialFrameTimer();
        break;
      }
      this.cancelPartialFrameTimer();
      const jsonBytes = this.buffer.subarray(4, 4 + payloadLength);
      this.buffer = this.buffer.subarray(4 + payloadLength);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(jsonBytes.toString('utf8')) as Record<
          string,
          unknown
        >;
      } catch (e) {
        throw new FrameError(`Invalid JSON in frame: ${(e as Error).message}`);
      }
      frames.push(parsed);
    }

    return frames;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
    this.cancelPartialFrameTimer();
  }

  private startPartialFrameTimer(): void {
    if (this.partialFrameTimer !== null) return;
    this.partialFrameTimer = setTimeout(() => {
      this.partialFrameTimer = null;
      this.buffer = Buffer.alloc(0);
    }, PARTIAL_FRAME_TIMEOUT_MS);
  }

  private cancelPartialFrameTimer(): void {
    if (this.partialFrameTimer !== null) {
      clearTimeout(this.partialFrameTimer);
      this.partialFrameTimer = null;
    }
  }
}
