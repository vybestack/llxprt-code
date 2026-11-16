/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Versioned, newline-delimited JSON frames exchanged between the host runtime
 * and the trusted QuickJS wrapper subprocess. Every frame carries the protocol
 * version and the run ID; each frame type has an exact key set. Anything else
 * is a protocol violation.
 */

import {
  GUEST_FAILURE_CODES,
  isCodeModeLimits,
  isJsonObject,
  isJsonValue,
  isPlainRecord,
  type CodeModeLimits,
  type GuestFailureCode,
  type JsonObject,
  type JsonValue,
} from './runtime-contract.js';

export const PROTOCOL_VERSION = 1;

interface FrameEnvelope {
  readonly version: number;
  readonly runId: string;
}

export interface StartFrame extends FrameEnvelope {
  readonly type: 'start';
  readonly source: string;
  readonly tools: readonly string[];
  readonly limits: CodeModeLimits;
}

export interface ResultFrame extends FrameEnvelope {
  readonly type: 'result';
  readonly callId: number;
  readonly value: JsonValue;
}

export interface CallFrame extends FrameEnvelope {
  readonly type: 'call';
  readonly callId: number;
  readonly tool: string;
  readonly args: JsonObject;
}

export interface LogFrame extends FrameEnvelope {
  readonly type: 'log';
  readonly text: string;
}

export interface CompleteFrame extends FrameEnvelope {
  readonly type: 'complete';
  readonly value: JsonValue;
  readonly callCount: number;
}

export interface FailureFrame extends FrameEnvelope {
  readonly type: 'failure';
  readonly code: GuestFailureCode;
  readonly message: string;
}

/** Frames written by the wrapper (child) and read by the host. */
export type ChildFrame = CallFrame | LogFrame | CompleteFrame | FailureFrame;

const FRAME_KEYS: ReadonlyMap<string, string> = new Map([
  ['start', 'limits|runId|source|tools|type|version'],
  ['result', 'callId|runId|type|value|version'],
  ['call', 'args|callId|runId|tool|type|version'],
  ['log', 'runId|text|type|version'],
  ['complete', 'callCount|runId|type|value|version'],
  ['failure', 'code|message|runId|type|version'],
]);

const failureCodes: ReadonlySet<string> = new Set(GUEST_FAILURE_CODES);

export function encodeFrame(
  frame: StartFrame | ResultFrame | ChildFrame,
): string {
  return `${JSON.stringify(frame)}\n`;
}

function parseEnvelope(
  line: string,
  runId: string | undefined,
): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isPlainRecord(parsed)) return undefined;
  if (parsed['version'] !== PROTOCOL_VERSION) return undefined;
  if (typeof parsed['runId'] !== 'string') return undefined;
  if (runId !== undefined && parsed['runId'] !== runId) return undefined;
  const type = parsed['type'];
  const keys = typeof type === 'string' ? FRAME_KEYS.get(type) : undefined;
  if (keys === undefined || Object.keys(parsed).sort().join('|') !== keys)
    return undefined;
  return parsed;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isChildFrame(frame: Record<string, unknown>): boolean {
  switch (frame['type']) {
    case 'call':
      return (
        isPositiveInteger(frame['callId']) &&
        typeof frame['tool'] === 'string' &&
        isJsonObject(frame['args'])
      );
    case 'log':
      return typeof frame['text'] === 'string';
    case 'complete':
      return (
        typeof frame['callCount'] === 'number' &&
        Number.isSafeInteger(frame['callCount']) &&
        frame['callCount'] >= 0 &&
        isJsonValue(frame['value'])
      );
    case 'failure':
      return (
        typeof frame['code'] === 'string' &&
        failureCodes.has(frame['code']) &&
        typeof frame['message'] === 'string'
      );
    default:
      return false;
  }
}

/** Parses a wrapper frame; returns undefined for any protocol violation. */
export function parseChildFrame(
  line: string,
  runId: string,
): ChildFrame | undefined {
  const frame = parseEnvelope(line, runId);
  if (frame === undefined || !isChildFrame(frame)) return undefined;
  return frame as unknown as ChildFrame;
}

export function parseStartFrame(line: string): StartFrame | undefined {
  const frame = parseEnvelope(line, undefined);
  if (frame?.['type'] !== 'start') return undefined;
  const tools = frame['tools'];
  if (typeof frame['source'] !== 'string') return undefined;
  if (!Array.isArray(tools) || !tools.every((tool) => typeof tool === 'string'))
    return undefined;
  if (!isCodeModeLimits(frame['limits'])) return undefined;
  return frame as unknown as StartFrame;
}

export function parseResultFrame(
  line: string,
  runId: string,
): ResultFrame | undefined {
  const frame = parseEnvelope(line, runId);
  if (frame?.['type'] !== 'result') return undefined;
  if (!isPositiveInteger(frame['callId']) || !isJsonValue(frame['value']))
    return undefined;
  return frame as unknown as ResultFrame;
}

/**
 * Splits a byte stream into newline-terminated UTF-8 lines while bounding the
 * size of every line, including one that has not been terminated yet.
 */
export class LineFramer {
  private partial: Buffer[] = [];
  private partialBytes = 0;

  constructor(private readonly maxLineBytes: number) {}

  /** Returns the completed lines, or 'oversized' once a line exceeds the cap. */
  push(chunk: Buffer): string[] | 'oversized' {
    const lines: string[] = [];
    let start = 0;
    for (
      let newline = chunk.indexOf(10, start);
      newline !== -1;
      newline = chunk.indexOf(10, start)
    ) {
      const piece = chunk.subarray(start, newline);
      if (this.partialBytes + piece.length > this.maxLineBytes)
        return 'oversized';
      lines.push(Buffer.concat([...this.partial, piece]).toString('utf8'));
      this.partial = [];
      this.partialBytes = 0;
      start = newline + 1;
    }
    const rest = chunk.subarray(start);
    this.partialBytes += rest.length;
    if (this.partialBytes > this.maxLineBytes) return 'oversized';
    if (rest.length > 0) this.partial.push(rest);
    return lines;
  }
}
