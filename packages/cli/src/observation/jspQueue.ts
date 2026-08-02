/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JspBoundDocument } from './jspDocuments.js';

export interface JspQueueSink {
  send(document: JspBoundDocument): Promise<boolean>;
}

export interface JspQueueOptions {
  readonly capacity: number;
  /**
   * Invoked when a document was lost and the observer needs a fresh snapshot.
   * The owner should enqueue one immediately; waiting for the next transition
   * leaves a finished source gapped forever.
   */
  readonly onRecoveryNeeded?: () => void;
}

const DEFAULT_CAPACITY = 256;

export class JspBoundedQueue {
  private readonly capacity: number;
  private readonly buffer: JspBoundDocument[] = [];
  private readonly sink: JspQueueSink;
  private didOverflow = false;
  private snapshotRecoveryNeeded = false;
  private isStopped = false;
  private drainTask: Promise<void> | null = null;
  private recoveryRequested = false;
  private readonly onRecoveryNeeded?: () => void;

  constructor(sink: JspQueueSink, options?: Partial<JspQueueOptions>) {
    this.sink = sink;
    const requested = options?.capacity ?? DEFAULT_CAPACITY;
    // A non-positive capacity would reject every document and latch permanent
    // overflow, silently disabling telemetry. Treat it as a caller error.
    if (!Number.isInteger(requested) || requested <= 0) {
      throw new RangeError('JSP queue capacity must be a positive integer');
    }
    this.capacity = requested;
    this.onRecoveryNeeded = options?.onRecoveryNeeded;
  }

  enqueue(document: JspBoundDocument): boolean {
    if (this.isStopped || this.buffer.length >= this.capacity) {
      if (!this.isStopped) {
        this.didOverflow = true;
        this.snapshotRecoveryNeeded = true;
        // Overflow drops a document, which is exactly the gap condition the
        // recovery callback exists for. Without this the observer stays gapped
        // and rejects everything until some later send also happens to fail.
        this.requestRecovery();
      }
      return false;
    }
    this.buffer.push(document);
    this.scheduleDrain();
    return true;
  }

  /**
   * Enqueue a recovery snapshot, displacing anything still buffered.
   *
   * Once the stream has gapped, the observer rejects every event until a fresh
   * snapshot arrives, so the pre-gap documents still sitting in the buffer can
   * no longer be accepted. Replacing them with the snapshot is both cheaper and
   * the only ordering that can actually be applied, and it guarantees the
   * snapshot has room even though the overflow that triggered it means the
   * buffer was full.
   */
  enqueueRecoverySnapshot(document: JspBoundDocument): boolean {
    if (this.isStopped) {
      return false;
    }
    this.buffer.length = 0;
    this.buffer.push(document);
    this.scheduleDrain();
    return true;
  }

  get overflowed(): boolean {
    return this.didOverflow;
  }

  get stopped(): boolean {
    return this.isStopped;
  }

  needsSnapshotRecovery(): boolean {
    return this.snapshotRecoveryNeeded;
  }

  markSnapshotRecoveryDone(): void {
    this.snapshotRecoveryNeeded = false;
  }

  stop(): void {
    this.isStopped = true;
    this.buffer.length = 0;
  }

  /**
   * Reset the queue to a fresh unstopped state so the owner can restart after
   * a stop/start cycle. Overflow and recovery flags are cleared because the
   * caller must re-register (publishing a fresh snapshot) before enqueuing
   * events again.
   */
  restart(): void {
    this.isStopped = false;
    this.didOverflow = false;
    this.snapshotRecoveryNeeded = false;
    this.recoveryRequested = false;
    this.buffer.length = 0;
  }

  async flush(): Promise<void> {
    while (this.drainTask !== null) {
      await this.drainTask;
    }
  }

  private scheduleDrain(): void {
    if (this.drainTask !== null) {
      return;
    }
    this.drainTask = Promise.resolve().then(() => this.drain());
  }

  private async send(document: JspBoundDocument): Promise<void> {
    let delivered = false;
    try {
      delivered = await this.sink.send(document);
    } catch {
      delivered = false;
    }
    if (delivered) {
      // The transport is working again, so a later gap deserves a fresh
      // recovery request. This is the only place the outstanding flag clears.
      this.recoveryRequested = false;
      return;
    }
    // The document is gone, so the observer now has a sequence gap and will
    // reject everything until a fresh snapshot arrives. Recovery cannot wait
    // for the next transition: a source that has finished its work produces
    // none, and the observation would stay gapped and stale forever.
    this.snapshotRecoveryNeeded = true;
    this.requestRecovery();
  }

  /**
   * Ask the owner to enqueue a fresh snapshot, at most once per gap.
   *
   * The outstanding flag is deliberately NOT cleared when the callback runs.
   * The recovery snapshot is itself sent through this queue, so if the
   * transport is down that send also fails and would request recovery again:
   * clearing the flag eagerly turns a broker outage into an unbounded
   * microtask loop that starves the event loop. The flag is cleared only by a
   * send that actually succeeds, which is the point at which the transport has
   * demonstrably recovered and a further gap is worth reporting.
   */
  private requestRecovery(): void {
    if (this.recoveryRequested || this.isStopped) {
      return;
    }
    this.recoveryRequested = true;
    queueMicrotask(() => {
      if (!this.isStopped) {
        this.onRecoveryNeeded?.();
      }
    });
  }

  private async drain(): Promise<void> {
    try {
      while (!this.isStopped) {
        const document = this.buffer.shift();
        if (document === undefined) {
          return;
        }
        await this.send(document);
      }
    } finally {
      this.drainTask = null;
      if (!this.isStopped && this.buffer.length > 0) {
        this.scheduleDrain();
      }
    }
  }
}
