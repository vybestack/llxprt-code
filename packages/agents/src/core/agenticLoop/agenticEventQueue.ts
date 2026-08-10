/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ACQUISITION_HARD_MAX_BYTES,
  DEFAULT_ACQUISITION_BUDGET_BYTES,
} from '@vybestack/llxprt-code-tools/acquisition.js';
import type { AgenticLoopEvent } from './types.js';

const DEFAULT_MAX_BUFFERED_EVENTS = 1024;
const MIN_BUFFERED_OUTPUT_BYTES = 1024;
const MIN_BUFFERED_EVENTS = 4;
const MAX_OMISSION_NOTICES = 128;
const MAX_OMISSION_NOTICE_BYTES = 96;
const COMPACTION_THRESHOLD = 4096;
const LIVE_OUTPUT_OMISSION_NOTICE = 'LLXPRT live tool output omitted';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface AgenticEventQueueOptions {
  maxBufferedOutputBytes?: number;
  maxBufferedEvents?: number;
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function saturatingAdd(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

function retainUtf8Prefix(
  text: string,
  maxBytes: number,
): { retained: string; retainedBytes: number; omittedBytes: number } {
  const observedBytes = Buffer.byteLength(text, 'utf8');
  if (observedBytes <= maxBytes) {
    return { retained: text, retainedBytes: observedBytes, omittedBytes: 0 };
  }
  if (maxBytes === 0) {
    return { retained: '', retainedBytes: 0, omittedBytes: observedBytes };
  }

  const target = new Uint8Array(maxBytes);
  const { written } = textEncoder.encodeInto(text, target);
  return {
    retained: textDecoder.decode(target.subarray(0, written)),
    retainedBytes: written,
    omittedBytes: observedBytes - written,
  };
}

/**
 * Bounded callback-to-generator bridge for agentic-loop events.
 *
 * Scheduler callbacks can outpace an async-generator consumer. Replace-style
 * snapshots are coalesced to the latest pending snapshot, while append-style
 * live output is bounded by both bytes and queue items. Durable tool results
 * still arrive through `tools_complete`; when live preview bytes are dropped,
 * one explicit notice per affected call is queued before completion.
 */
export class AgenticEventQueue {
  private buffered: AgenticLoopEvent[] = [];
  private head = 0;
  private resolveWait: (() => void) | null = null;
  private closed = false;
  private pendingToolUpdateIndex: number | null = null;
  private bufferedOutputBytes = 0;
  private readonly omittedOutputBytes = new Map<string, number>();
  private aggregateOmission: { callId: string; omittedBytes: number } | null =
    null;
  private readonly maxBufferedOutputBytes: number;
  private readonly maxBufferedEvents: number;
  private readonly maxOmissionNotices: number;
  private readonly retainedOutputByteLimit: number;
  private readonly bufferedEventLimitBeforeNotices: number;

  constructor(options: AgenticEventQueueOptions = {}) {
    this.maxBufferedOutputBytes = Math.min(
      ACQUISITION_HARD_MAX_BYTES,
      Math.max(
        MIN_BUFFERED_OUTPUT_BYTES,
        normalizePositiveInteger(
          options.maxBufferedOutputBytes,
          DEFAULT_ACQUISITION_BUDGET_BYTES,
        ),
      ),
    );
    this.maxBufferedEvents = Math.max(
      MIN_BUFFERED_EVENTS,
      normalizePositiveInteger(
        options.maxBufferedEvents,
        DEFAULT_MAX_BUFFERED_EVENTS,
      ),
    );
    this.maxOmissionNotices = Math.min(
      MAX_OMISSION_NOTICES,
      Math.max(1, Math.floor(this.maxBufferedEvents / 4)),
      Math.floor(this.maxBufferedOutputBytes / MAX_OMISSION_NOTICE_BYTES),
    );
    this.retainedOutputByteLimit =
      this.maxBufferedOutputBytes -
      this.maxOmissionNotices * MAX_OMISSION_NOTICE_BYTES;
    this.bufferedEventLimitBeforeNotices =
      this.maxBufferedEvents - this.maxOmissionNotices - 1;
  }

  get bufferedEventCount(): number {
    return this.buffered.length - this.head;
  }

  get bufferedLiveOutputBytes(): number {
    return this.bufferedOutputBytes;
  }

  /**
   * Enqueue a scheduler event.
   *
   * @throws When a semantic event would consume capacity reserved for reporting
   * output omission and terminal completion, or when the hard queue bound is
   * exhausted. Scheduler callback adapters must contain this failure.
   */
  push(event: AgenticLoopEvent): void {
    if (this.closed) {
      return;
    }
    if (event.kind === 'tool_update') {
      this.pushToolUpdate(event);
    } else if (event.kind === 'tool_output') {
      this.pushToolOutput(event);
    } else if (event.kind === 'tools_complete') {
      this.flushOutputOmissionNotices(
        this.maxBufferedEvents - this.bufferedEventCount - 1,
      );
      this.enqueue(event);
    } else {
      this.ensureCompletionCapacity();
      this.enqueue(event);
    }
    this.wakeConsumer();
  }

  popBuffered(): AgenticLoopEvent | undefined {
    if (this.head >= this.buffered.length) {
      return undefined;
    }
    const event = this.buffered[this.head];
    if (this.pendingToolUpdateIndex === this.head) {
      this.pendingToolUpdateIndex = null;
    }
    if (event.kind === 'tool_output') {
      this.bufferedOutputBytes -= Buffer.byteLength(event.chunk, 'utf8');
    }
    this.head += 1;
    this.compactIfNeeded();
    return event;
  }

  waitForNext(signal: AbortSignal): Promise<void> {
    if (this.bufferedEventCount > 0 || this.closed || signal.aborted) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener('abort', onAbort);
        this.resolveWait = null;
        resolve();
      };
      const onAbort = () => {
        settle();
      };
      this.resolveWait = settle;
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        settle();
      }
    });
  }

  close(): void {
    this.closed = true;
    this.wakeConsumer();
  }

  private pushToolUpdate(
    event: Extract<AgenticLoopEvent, { kind: 'tool_update' }>,
  ): void {
    const index = this.pendingToolUpdateIndex;
    if (index !== null && index >= this.head) {
      const pending = this.buffered[index];
      const canCoalesce =
        pending.kind === 'tool_update' &&
        pending.toolCalls.length > 0 &&
        event.toolCalls.length > 0;
      if (canCoalesce) {
        this.buffered[index] = event;
        return;
      }
    }
    this.ensureCompletionCapacity();
    this.enqueue(event);
    this.pendingToolUpdateIndex = this.buffered.length - 1;
  }

  private pushToolOutput(
    event: Extract<AgenticLoopEvent, { kind: 'tool_output' }>,
  ): void {
    const remainingBytes = Math.max(
      0,
      this.retainedOutputByteLimit - this.bufferedOutputBytes,
    );
    if (this.bufferedEventCount >= this.bufferedEventLimitBeforeNotices) {
      this.recordOmission(event.callId, Buffer.byteLength(event.chunk, 'utf8'));
      return;
    }

    const bounded = retainUtf8Prefix(event.chunk, remainingBytes);
    if (bounded.retainedBytes > 0) {
      this.enqueue({ ...event, chunk: bounded.retained });
      this.bufferedOutputBytes += bounded.retainedBytes;
    }
    this.recordOmission(event.callId, bounded.omittedBytes);
  }

  private recordOmission(callId: string, omittedBytes: number): void {
    if (omittedBytes === 0) {
      return;
    }
    this.ensureOmissionReportCapacity();
    const existing = this.omittedOutputBytes.get(callId);
    if (existing !== undefined) {
      this.omittedOutputBytes.set(
        callId,
        saturatingAdd(existing, omittedBytes),
      );
      return;
    }
    if (this.omittedOutputBytes.size < this.maxOmissionNotices - 1) {
      this.omittedOutputBytes.set(callId, omittedBytes);
      return;
    }
    if (this.aggregateOmission === null) {
      this.aggregateOmission = { callId, omittedBytes };
      return;
    }
    this.aggregateOmission.omittedBytes = saturatingAdd(
      this.aggregateOmission.omittedBytes,
      omittedBytes,
    );
  }

  private hasPendingOmissions(): boolean {
    return this.omittedOutputBytes.size > 0 || this.aggregateOmission !== null;
  }

  private ensureOmissionReportCapacity(): void {
    if (this.bufferedEventCount > this.maxBufferedEvents - 2) {
      throw new Error(
        'Agentic event queue cannot report omitted output and completion within its event limit',
      );
    }
  }

  private ensureCompletionCapacity(): void {
    if (
      this.hasPendingOmissions() &&
      this.bufferedEventCount >= this.maxBufferedEvents - 2
    ) {
      throw new Error(
        'Agentic event queue reserved its remaining capacity for omitted output and completion',
      );
    }
  }

  flushOutputOmissionNotices(
    maxNotices: number = this.maxOmissionNotices,
  ): void {
    const omissions = Array.from(
      this.omittedOutputBytes,
      ([callId, omittedBytes]) => ({
        callId,
        omittedBytes,
        aggregatesCalls: false,
      }),
    );
    if (this.aggregateOmission !== null) {
      omissions.push({
        ...this.aggregateOmission,
        aggregatesCalls: true,
      });
    }
    if (omissions.length === 0) {
      return;
    }
    const noticeLimit = Math.min(
      this.maxOmissionNotices,
      Math.floor(maxNotices),
    );
    if (!Number.isFinite(noticeLimit) || noticeLimit < 1) {
      throw new Error(
        'Agentic event queue has no capacity to report omitted output before completion',
      );
    }

    const notices = omissions.slice(0, noticeLimit);
    if (omissions.length > noticeLimit) {
      const aggregateIndex = noticeLimit - 1;
      const aggregated = omissions.slice(aggregateIndex);
      const firstAggregate = aggregated[0];
      notices[aggregateIndex] = {
        callId: firstAggregate.callId,
        omittedBytes: aggregated.reduce(
          (total, omission) => saturatingAdd(total, omission.omittedBytes),
          0,
        ),
        aggregatesCalls: true,
      };
    }

    const preparedNotices = notices.map((notice) =>
      this.prepareOmissionNotice(
        notice.callId,
        notice.omittedBytes,
        notice.aggregatesCalls,
      ),
    );
    const preparedBytes = preparedNotices.reduce(
      (total, notice) => total + notice.chunkBytes,
      0,
    );
    if (
      this.bufferedEventCount + preparedNotices.length >
        this.maxBufferedEvents ||
      this.bufferedOutputBytes + preparedBytes > this.maxBufferedOutputBytes
    ) {
      throw new Error(
        'Agentic output omission notices exceeded their reservation',
      );
    }

    // Preparation and capacity checks above are the only failure points. Clear
    // accounting before the now-infallible enqueue loop so an internal enqueue
    // regression cannot cause the same omission to be reported twice.
    this.omittedOutputBytes.clear();
    this.aggregateOmission = null;
    for (const notice of preparedNotices) {
      this.enqueue(notice.event);
      this.bufferedOutputBytes += notice.chunkBytes;
    }
  }

  private prepareOmissionNotice(
    callId: string,
    omittedBytes: number,
    aggregatesCalls: boolean,
  ): {
    event: Extract<AgenticLoopEvent, { kind: 'tool_output' }>;
    chunkBytes: number;
  } {
    const scope = aggregatesCalls ? ' across additional tool calls' : '';
    const chunk = `[${LIVE_OUTPUT_OMISSION_NOTICE}: ${omittedBytes.toLocaleString('en-US')} bytes${scope}]`;
    const chunkBytes = Buffer.byteLength(chunk, 'utf8');
    if (chunkBytes > MAX_OMISSION_NOTICE_BYTES) {
      throw new Error(
        'Agentic output omission notice exceeded its reservation',
      );
    }
    return { event: { kind: 'tool_output', callId, chunk }, chunkBytes };
  }

  private enqueue(event: AgenticLoopEvent): void {
    if (this.bufferedEventCount >= this.maxBufferedEvents) {
      throw new Error(
        `Agentic event queue exceeded ${this.maxBufferedEvents.toLocaleString('en-US')} buffered events`,
      );
    }
    this.buffered.push(event);
  }

  private wakeConsumer(): void {
    this.resolveWait?.();
    this.resolveWait = null;
  }

  private compactIfNeeded(): void {
    if (
      this.head < COMPACTION_THRESHOLD ||
      this.head * 2 < this.buffered.length
    ) {
      return;
    }
    const oldHead = this.head;
    this.buffered = this.buffered.slice(oldHead);
    if (this.pendingToolUpdateIndex !== null) {
      this.pendingToolUpdateIndex -= oldHead;
    }
    this.head = 0;
  }
}
