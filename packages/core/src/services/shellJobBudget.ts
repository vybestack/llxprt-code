/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_MAX_BACKGROUND_JOBS } from './shellJobTypes.js';

/**
 * Atomic budget tracker for background shell jobs. A reservation is created
 * before any I/O and consumed when the job is registered. If the launch fails,
 * the reservation is released so the slot is immediately available again.
 */
export class ShellJobBudget {
  private max: number;
  private active = 0;
  private pending = 0;

  constructor(max: number = DEFAULT_MAX_BACKGROUND_JOBS) {
    this.max = max;
  }

  setMax(max: number): void {
    this.max = max;
  }

  getMax(): number {
    return this.max;
  }

  /**
   * Reserve a slot atomically. Returns true if a slot was reserved, false if
   * the budget is exhausted. On success the slot is counted immediately.
   */
  reserve(): boolean {
    if (this.max === -1) {
      this.pending++;
      return true;
    }
    if (this.active + this.pending >= this.max) {
      return false;
    }
    this.pending++;
    return true;
  }

  /** Consume a reservation, converting it from pending to active. */
  consume(): void {
    if (this.pending > 0) {
      this.pending--;
    }
    this.active++;
  }

  /** Release a reservation without consuming it (launch failed before spawn). */
  release(): void {
    if (this.pending > 0) {
      this.pending--;
    }
  }

  /** Release an active slot (job reached terminal state). */
  releaseActive(): void {
    if (this.active > 0) {
      this.active--;
    }
  }

  getActiveCount(): number {
    return this.active;
  }

  hasCapacity(): boolean {
    if (this.max === -1) {
      return true;
    }
    return this.active + this.pending < this.max;
  }
}
