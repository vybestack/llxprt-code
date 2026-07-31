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

  constructor(sink: JspQueueSink, options?: Partial<JspQueueOptions>) {
    this.sink = sink;
    this.capacity = options?.capacity ?? DEFAULT_CAPACITY;
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
    try {
      if (!(await this.sink.send(document))) {
        this.snapshotRecoveryNeeded = true;
      }
    } catch {
      this.snapshotRecoveryNeeded = true;
    }
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
