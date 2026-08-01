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
      }
      return false;
    }
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
      return;
    }
    // The document is gone, so the observer now has a sequence gap and will
    // reject everything until a fresh snapshot arrives. Recovery cannot wait
    // for the next transition: a source that has finished its work produces
    // none, and the observation would stay gapped and stale forever.
    this.snapshotRecoveryNeeded = true;
    this.requestRecovery();
  }

  /** Ask the owner to enqueue a fresh snapshot, at most once per gap. */
  private requestRecovery(): void {
    if (this.recoveryRequested || this.isStopped) {
      return;
    }
    this.recoveryRequested = true;
    queueMicrotask(() => {
      this.recoveryRequested = false;
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
