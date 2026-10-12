/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { debugLogger } from '../utils/debugLogger.js';

export interface AsyncNoticeUnsubscribe {
  (): void;
  drain(): Promise<void>;
}

export class AsyncNoticeSubscription {
  active = true;
  private immediate: ReturnType<typeof setImmediate> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly deliveries = new Set<Promise<void>>();
  private readonly errors: unknown[] = [];

  constructor(private readonly deliver: () => Promise<void>) {}

  schedule(): void {
    if (!this.active || this.immediate !== undefined) return;
    this.immediate = setImmediate(() => {
      this.immediate = undefined;
      this.startDelivery();
    });
  }

  debounce(delay: number): void {
    if (!this.active) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.startDelivery();
    }, delay);
  }

  retire(): void {
    this.active = false;
    if (this.immediate !== undefined) clearImmediate(this.immediate);
    clearTimeout(this.timer);
    this.immediate = undefined;
    this.timer = undefined;
  }

  async drain(): Promise<void> {
    await Promise.allSettled(this.deliveries);
    if (this.errors.length > 0) {
      throw new AggregateError(this.errors, 'Async notice delivery failed');
    }
  }

  private startDelivery(): void {
    if (!this.active) return;
    const delivery = this.deliver();
    this.deliveries.add(delivery);
    void delivery.then(
      () => this.deliveries.delete(delivery),
      (error: unknown) => {
        this.deliveries.delete(delivery);
        this.errors.push(error);
        debugLogger.error(
          '[AsyncTaskAutoTrigger] Failed to auto-trigger:',
          error,
        );
      },
    );
  }
}
