/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250214-CREDPROXY.P04
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encodeFrame,
  FrameDecoder,
  MAX_FRAME_SIZE,
  PARTIAL_FRAME_TIMEOUT_MS,
} from '../framing.js';

describe('encodeFrame', () => {
  /**
   * @requirement R5.1
   * @scenario Encode a JSON payload with correct length prefix
   */
  it('produces a 4-byte uint32 BE length prefix', () => {
    const payload = { hello: 'world' };
    const frame = encodeFrame(payload);

    const expectedJson = JSON.stringify(payload);
    const expectedLength = Buffer.byteLength(expectedJson, 'utf8');

    expect(frame.readUInt32BE(0)).toBe(expectedLength);
  });

  /**
   * @requirement R5.1
   * @scenario Payload bytes after the 4-byte header are valid UTF-8 JSON
   */
  it('writes correct UTF-8 JSON payload after the prefix', () => {
    const payload = { key: 'value', num: 42 };
    const frame = encodeFrame(payload);

    const payloadLength = frame.readUInt32BE(0);
    const jsonBytes = frame.subarray(4, 4 + payloadLength);
    const parsed = JSON.parse(jsonBytes.toString('utf8'));

    expect(parsed).toEqual(payload);
  });

  /**
   * @requirement R5.1
   * @scenario Roundtrip encode then decode returns original payload
   */
  it('roundtrips encode → decode to produce the original object', () => {
    const payload = { action: 'getCredential', token: 'abc123' };
    const frame = encodeFrame(payload);

    const decoder = new FrameDecoder();
    const results = decoder.feed(frame);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(payload);
  });

  /**
   * @requirement R5.1
   * @scenario Empty object payload encodes and decodes correctly
   */
  it('handles empty payload {}', () => {
    const frame = encodeFrame({});

    const payloadLength = frame.readUInt32BE(0);
    expect(payloadLength).toBe(2); // "{}" is 2 bytes
    expect(frame.length).toBe(6); // 4 header + 2 payload

    const jsonBytes = frame.subarray(4);
    expect(JSON.parse(jsonBytes.toString('utf8'))).toEqual({});
  });

  /**
   * @requirement R5.1
   * @scenario Payload with newlines and unicode encodes correctly
   */
  it('handles payload with newlines and unicode characters', () => {
    const payload = { text: 'line1\nline2\ttab', emoji: '', kanji: '漢字' };
    const frame = encodeFrame(payload);

    const payloadLength = frame.readUInt32BE(0);
    const jsonBytes = frame.subarray(4, 4 + payloadLength);
    const parsed = JSON.parse(jsonBytes.toString('utf8'));

    expect(parsed).toEqual(payload);
    expect(parsed.emoji).toBe('');
    expect(parsed.kanji).toBe('漢字');
  });

  /**
   * @requirement R5.2
   * @scenario Oversized payload exceeding MAX_FRAME_SIZE throws
   */
  it('throws when payload exceeds MAX_FRAME_SIZE bytes', () => {
    // Build a payload whose JSON representation exceeds 65536 bytes
    const bigString = 'x'.repeat(MAX_FRAME_SIZE + 1);
    const payload = { data: bigString };

    expect(() => encodeFrame(payload)).toThrow();
  });

  /**
   * @requirement R5.1
   * @scenario Total frame length is exactly 4 + JSON byte length
   */
  it('produces a frame whose total length is 4 + JSON byte length', () => {
    const payload = { nested: { a: [1, 2, 3] } };
    const frame = encodeFrame(payload);

    const expectedJsonLength = Buffer.byteLength(
      JSON.stringify(payload),
      'utf8',
    );
    expect(frame.length).toBe(4 + expectedJsonLength);
  });
});

describe('FrameDecoder', () => {
  let decoder: FrameDecoder;

  beforeEach(() => {
    decoder = new FrameDecoder();
  });

  /**
   * @requirement R5.3
   * @scenario Feed a single complete frame and get one parsed result
   */
  it('decodes a single complete frame', () => {
    const payload = { op: 'handshake', v: 1 };
    const frame = encodeFrame(payload);

    const results = decoder.feed(frame);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(payload);
  });

  /**
   * @requirement R5.3
   * @scenario Feed returns parsed JSON objects, not raw buffers
   */
  it('returns parsed JSON objects from feed', () => {
    const payload = { status: 'ok', count: 99 };
    const frame = encodeFrame(payload);

    const results = decoder.feed(frame);

    expect(results[0]).toEqual(payload);
    expect(typeof results[0]).toBe('object');
    expect((results[0] as Record<string, unknown>).status).toBe('ok');
    expect((results[0] as Record<string, unknown>).count).toBe(99);
  });

  /**
   * @requirement R5.3
   * @scenario Multiple frames concatenated in a single chunk
   */
  it('decodes multiple frames from one chunk', () => {
    const payload1 = { id: '1', op: 'req' };
    const payload2 = { id: '2', op: 'res' };
    const frame1 = encodeFrame(payload1);
    const frame2 = encodeFrame(payload2);

    const combined = Buffer.concat([frame1, frame2]);
    const results = decoder.feed(combined);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(payload1);
    expect(results[1]).toEqual(payload2);
  });

  /**
   * @requirement R5.3
   * @scenario Frame split across two chunks reassembles correctly
   */
  it('reassembles a frame split across two chunks', () => {
    const payload = { split: 'test', value: 12345 };
    const frame = encodeFrame(payload);

    const splitPoint = Math.floor(frame.length / 2);
    const chunk1 = frame.subarray(0, splitPoint);
    const chunk2 = frame.subarray(splitPoint);

    const results1 = decoder.feed(chunk1);
    expect(results1).toHaveLength(0);

    const results2 = decoder.feed(chunk2);
    expect(results2).toHaveLength(1);
    expect(results2[0]).toEqual(payload);
  });

  /**
   * @requirement R5.3
   * @scenario Frame split across three chunks including a header split
   */
  it('reassembles a frame split across three chunks with header split', () => {
    const payload = { three: 'chunks' };
    const frame = encodeFrame(payload);

    // Split inside the 4-byte header
    const chunk1 = frame.subarray(0, 2);
    const chunk2 = frame.subarray(2, 6);
    const chunk3 = frame.subarray(6);

    const r1 = decoder.feed(chunk1);
    expect(r1).toHaveLength(0);

    const r2 = decoder.feed(chunk2);
    expect(r2).toHaveLength(0);

    const r3 = decoder.feed(chunk3);
    expect(r3).toHaveLength(1);
    expect(r3[0]).toEqual(payload);
  });

  /**
   * @requirement R5.2
   * @scenario Oversized length prefix in incoming data throws before allocation
   */
  it('throws on oversized length prefix before allocating buffer', () => {
    // Craft a buffer with a length prefix exceeding MAX_FRAME_SIZE
    const header = Buffer.alloc(4);
    header.writeUInt32BE(MAX_FRAME_SIZE + 1, 0);

    expect(() => decoder.feed(header)).toThrow();
  });

  /**
   * @requirement R5.3
   * @scenario Zero-length payload representing empty JSON "{}"
   */
  it('decodes a zero-length-ish frame with empty JSON "{}"', () => {
    // Encode an empty object — its JSON is "{}" which is 2 bytes, not zero
    // This tests the smallest valid payload
    const frame = encodeFrame({});
    const results = decoder.feed(frame);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({});
  });
});

describe('FrameDecoder partial frame timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * @requirement R5.3
   * @scenario Partial frame timer starts when incomplete frame is received
   */
  it('starts a timer when an incomplete frame is received', () => {
    const decoder = new FrameDecoder();
    const payload = { timer: 'test' };
    const frame = encodeFrame(payload);

    // Feed only part of the frame (just the header + partial payload)
    const partial = frame.subarray(0, 6);
    decoder.feed(partial);

    // After PARTIAL_FRAME_TIMEOUT_MS the decoder should signal a timeout.
    // The exact mechanism (callback, event, error) depends on implementation,
    // but we verify time advances without completing the frame.
    // For now, verify the decoder accepted partial data without throwing
    // and that feeding the rest completes the frame.
    const rest = frame.subarray(6);
    const results = decoder.feed(rest);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(payload);
  });

  /**
   * @requirement R5.3
   * @scenario Partial frame timer is cancelled when the frame completes
   */
  it('cancels timer when frame completes before timeout', () => {
    const decoder = new FrameDecoder();
    const payload = { cancel: 'timer' };
    const frame = encodeFrame(payload);

    // Feed partial frame
    const partial = frame.subarray(0, 5);
    decoder.feed(partial);

    // Advance time partway (not enough to trigger timeout)
    vi.advanceTimersByTime(PARTIAL_FRAME_TIMEOUT_MS / 2);

    // Complete the frame — timer should be cancelled
    const rest = frame.subarray(5);
    const results = decoder.feed(rest);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(payload);

    // Advancing past the original timeout should NOT cause any error
    // because the timer was cancelled when the frame completed
    expect(() => {
      vi.advanceTimersByTime(PARTIAL_FRAME_TIMEOUT_MS);
    }).not.toThrow();
  });

  /**
   * @requirement R5.3
   * @scenario Partial frame timeout triggers the onPartialFrameTimeout callback
   */
  it('calls onPartialFrameTimeout callback when partial frame times out', () => {
    const onTimeout = vi.fn();
    const decoder = new FrameDecoder({ onPartialFrameTimeout: onTimeout });
    const payload = { timeout: 'test' };
    const frame = encodeFrame(payload);

    // Feed only part of the frame
    const partial = frame.subarray(0, 6);
    decoder.feed(partial);

    // Callback should not have been called yet
    expect(onTimeout).not.toHaveBeenCalled();

    // Advance time past the timeout
    vi.advanceTimersByTime(PARTIAL_FRAME_TIMEOUT_MS);

    // Now the callback should have been called
    expect(onTimeout).toHaveBeenCalledTimes(1);

    // Buffer should be reset - feeding new complete frame should work
    const newPayload = { new: 'frame' };
    const newFrame = encodeFrame(newPayload);
    const results = decoder.feed(newFrame);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(newPayload);
  });
});
