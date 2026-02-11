/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260130-ASYNCTASK.P05
 * @requirement REQ-ASYNC-001, REQ-ASYNC-002
 * @pseudocode async-task-manager.md lines 30-287
 */

import { EventEmitter } from 'node:events';
import type { OutputObject } from '../core/subagent.js';

export type AsyncTaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface AsyncTaskInfo {
  id: string;
  subagentName: string;
  goalPrompt: string;
  status: AsyncTaskStatus;
  launchedAt: number;
  completedAt?: number;
  notifiedAt?: number;
  output?: OutputObject;
  error?: string;
  abortController?: AbortController;
}

export interface RegisterTaskInput {
  id: string;
  subagentName: string;
  goalPrompt: string;
  abortController: AbortController;
}

/**
 * Manages lifecycle of async tasks launched with `async=true`.
 * Handles task registration, completion tracking, and history limits.
 */
interface PendingReservation {
  timestamp: number;
  expiresAt: number;
}

export class AsyncTaskManager {
  private readonly tasks: Map<string, AsyncTaskInfo> = new Map();
  private readonly emitter: EventEmitter;
  private maxAsyncTasks: number;
  private pendingReservations: Map<string, PendingReservation> = new Map();

  constructor(maxAsyncTasks: number = 5) {
    this.maxAsyncTasks = maxAsyncTasks;
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
  }

  /**
   * @pseudocode lines 045-048
   */
  setMaxAsyncTasks(max: number): void {
    this.maxAsyncTasks = max;
    this.enforceHistoryLimit();
  }

  /**
   * @pseudocode lines 050-052
   */
  getMaxAsyncTasks(): number {
    return this.maxAsyncTasks;
  }

  /**
   * @pseudocode lines 054-056
   */
  getAllTasks(): AsyncTaskInfo[] {
    return Array.from(this.tasks.values());
  }

  /**
   * @pseudocode lines 058-078
   */
  canLaunchAsync(): { allowed: boolean; reason?: string } {
    this.cleanupExpiredReservations();

    // Line 060-062: Unlimited mode
    if (this.maxAsyncTasks === -1) {
      return { allowed: true };
    }

    // Lines 064-070: Count running tasks + pending reservations atomically
    const runningCount = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'running',
    ).length;
    const occupiedSlots = runningCount + this.pendingReservations.size;

    // Lines 072-075: Check limit
    if (occupiedSlots >= this.maxAsyncTasks) {
      return {
        allowed: false,
        reason: `Max async tasks (${this.maxAsyncTasks}) reached`,
      };
    }

    // Line 077: Allow launch
    return { allowed: true };
  }

  /**
   * Atomically check and reserve a slot for task registration
   * Returns a unique booking ID if successful, or null if limit reached
   */
  tryReserveAsyncSlot(): string | null {
    this.cleanupExpiredReservations();

    // Check if we can launch
    const canLaunch = this.canLaunchAsync();
    if (!canLaunch.allowed) {
      return null;
    }

    // Generate a unique booking ID for this reservation
    const bookingId = `reserve_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Store the reservation temporarily to prevent race conditions
    // The actual task will be registered with the same ID during registerTask
    this.pendingReservations.set(bookingId, {
      timestamp: Date.now(),
      // Expire reservations after 5 seconds to prevent leaks
      expiresAt: Date.now() + 5000,
    });

    return bookingId;
  }

  /**
   * Cancel a pending reservation, releasing the slot it occupies.
   * Safe to call with an invalid or already-consumed bookingId (no-op).
   */
  cancelReservation(bookingId: string): boolean {
    return this.pendingReservations.delete(bookingId);
  }

  /**
   * @pseudocode lines 084-097
   */
  registerTask(input: RegisterTaskInput, bookingId?: string): AsyncTaskInfo {
    // If a bookingId is provided, consume that reservation
    if (bookingId) {
      const reservation = this.pendingReservations.get(bookingId);
      if (!reservation) {
        throw new Error(`Invalid or expired reservation: ${bookingId}`);
      }
      // Remove the consumed reservation
      this.pendingReservations.delete(bookingId);
    }

    // Lines 085-092: Create task object
    const task: AsyncTaskInfo = {
      id: input.id,
      subagentName: input.subagentName,
      goalPrompt: input.goalPrompt,
      status: 'running',
      launchedAt: Date.now(),
      abortController: input.abortController,
    };

    // Line 094: Store task
    this.tasks.set(input.id, task);

    // Line 096: Return task (note: design says no event for launch)
    return task;
  }

  /**
   * @pseudocode lines 103-129
   */
  completeTask(id: string, output: OutputObject): boolean {
    // Lines 104-109: Get task and validate exists
    const task = this.tasks.get(id);
    if (task === undefined) {
      return false;
    }

    // Lines 111-115: Idempotent - return false if already terminal
    if (task.status !== 'running') {
      return false;
    }

    // Lines 117-120: Transition to completed
    task.status = 'completed';
    task.completedAt = Date.now();
    task.output = output;

    // Line 123: Emit event AFTER state change
    this.emitter.emit('task-completed', task);

    // Lines 125-126: Enforce history limit
    this.enforceHistoryLimit();

    // Line 128: Return success
    return true;
  }

  /**
   * @pseudocode lines 135-155
   */
  failTask(id: string, error: string): boolean {
    // Lines 136-140: Get task and validate exists
    const task = this.tasks.get(id);
    if (task === undefined) {
      return false;
    }

    // Lines 142-145: Idempotent - return false if already terminal
    if (task.status !== 'running') {
      return false;
    }

    // Lines 147-149: Transition to failed
    task.status = 'failed';
    task.completedAt = Date.now();
    task.error = error;

    // Line 151: Emit event
    this.emitter.emit('task-failed', task);

    // Line 152: Enforce history limit
    this.enforceHistoryLimit();

    // Line 154: Return success
    return true;
  }

  /**
   * @pseudocode lines 161-185
   */
  cancelTask(id: string): boolean {
    // Lines 162-166: Get task and validate exists
    const task = this.tasks.get(id);
    if (task === undefined) {
      return false;
    }

    // Lines 168-171: Idempotent - return false if already terminal
    if (task.status !== 'running') {
      return false;
    }

    // Lines 173-174: Transition to cancelled
    task.status = 'cancelled';
    task.completedAt = Date.now();

    // Lines 176-179: Abort the running subagent
    if (task.abortController) {
      task.abortController.abort();
    }

    // Line 181: Emit event
    this.emitter.emit('task-cancelled', task);

    // Line 182: Enforce history limit
    this.enforceHistoryLimit();

    // Line 184: Return success
    return true;
  }

  /**
   * @pseudocode lines 191-193
   */
  getTask(id: string): AsyncTaskInfo | undefined {
    return this.tasks.get(id);
  }

  /**
   * @pseudocode lines 195-213
   */
  getTaskByPrefix(prefix: string): {
    task?: AsyncTaskInfo;
    candidates?: AsyncTaskInfo[];
  } {
    // Lines 196-202: Find all matching tasks
    const matches = Array.from(this.tasks.values()).filter((t) =>
      t.id.startsWith(prefix),
    );

    // Lines 204-206: No matches
    if (matches.length === 0) {
      return {};
    }

    // Lines 208-210: Unique match
    if (matches.length === 1) {
      return { task: matches[0] };
    }

    // Line 212: Ambiguous - return candidates
    return { candidates: matches };
  }

  /**
   * Clean up expired reservations to prevent memory leaks
   */
  private cleanupExpiredReservations(): void {
    const now = Date.now();

    for (const [bookingId, reservation] of this.pendingReservations.entries()) {
      if (now > reservation.expiresAt) {
        this.pendingReservations.delete(bookingId);
      }
    }
  }

  /**
   * @pseudocode lines 219-221
   */
  getRunningTasks(): AsyncTaskInfo[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === 'running',
    );
  }

  /**
   * @pseudocode lines 223-228
   */
  getPendingNotifications(): AsyncTaskInfo[] {
    return Array.from(this.tasks.values()).filter(
      (t) =>
        (t.status === 'completed' || t.status === 'failed') &&
        t.notifiedAt === undefined,
    );
  }

  /**
   * @pseudocode lines 234-239
   */
  markNotified(id: string): void {
    const task = this.tasks.get(id);
    if (task && task.notifiedAt === undefined) {
      task.notifiedAt = Date.now();
    }
  }

  /**
   * @pseudocode lines 245-267
   */
  private enforceHistoryLimit(): void {
    // Lines 246-247: Calculate limit: 2*max or 10 if unlimited
    const historyLimit =
      this.maxAsyncTasks === -1 ? 10 : this.maxAsyncTasks * 2;

    // Lines 249-252: Get terminal tasks sorted by completedAt (oldest first)
    const terminalTasks = Array.from(this.tasks.values())
      .filter((t) => t.status !== 'running')
      .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));

    // Lines 254-266: Remove oldest until under limit
    while (terminalTasks.length > historyLimit) {
      const oldest = terminalTasks[0];

      // Lines 258-262: ERROR: Never remove unnotified tasks
      if (oldest.notifiedAt === undefined) {
        break; // Stop - can't remove unnotified
      }

      // Lines 264-265: Remove oldest
      this.tasks.delete(oldest.id);
      terminalTasks.shift();
    }
  }

  /**
   * @pseudocode lines 273-276
   */
  onTaskCompleted(handler: (task: AsyncTaskInfo) => void): () => void {
    this.emitter.on('task-completed', handler);
    return () => this.emitter.off('task-completed', handler);
  }

  /**
   * @pseudocode lines 278-281
   */
  onTaskFailed(handler: (task: AsyncTaskInfo) => void): () => void {
    this.emitter.on('task-failed', handler);
    return () => this.emitter.off('task-failed', handler);
  }

  /**
   * @pseudocode lines 283-286
   */
  onTaskCancelled(handler: (task: AsyncTaskInfo) => void): () => void {
    this.emitter.on('task-cancelled', handler);
    return () => this.emitter.off('task-cancelled', handler);
  }
}
