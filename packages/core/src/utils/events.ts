/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';

/**
 * Defines the severity level for user-facing feedback.
 * This maps loosely to UI `MessageType`
 */
export type FeedbackSeverity = 'info' | 'warning' | 'error';

/**
 * Payload for the 'user-feedback' event.
 */
export interface UserFeedbackPayload {
  /**
   * The severity level determines how the message is rendered in the UI
   * (e.g. colored text, specific icon).
   */
  severity: FeedbackSeverity;
  /**
   * The main message to display to the user in the chat history or stdout.
   */
  message: string;
  /**
   * The original error object, if applicable.
   * Listeners can use this to extract stack traces for debug logging
   * or verbose output, while keeping the 'message' field clean for end users.
   */
  error?: unknown;
}

/**
 * Payload for the 'memory-changed' event.
 */
export interface MemoryChangedPayload {
  memoryContent: string;
  fileCount: number;
  filePaths: string[];
}

export enum CoreEvent {
  UserFeedback = 'user-feedback',
  MemoryChanged = 'memory-changed',
  ModelChanged = 'model-changed',
}

export class CoreEventEmitter extends EventEmitter {
  private _feedbackBacklog: UserFeedbackPayload[] = [];
  private static readonly MAX_BACKLOG_SIZE = 10000;

  constructor() {
    super();
  }

  /**
   * Sends actionable feedback to the user.
   * Buffers automatically if the UI hasn't subscribed yet.
   */
  emitFeedback(
    severity: FeedbackSeverity,
    message: string,
    error?: unknown,
  ): void {
    const payload: UserFeedbackPayload = { severity, message, error };

    if (this.listenerCount(CoreEvent.UserFeedback) === 0) {
      if (this._feedbackBacklog.length >= CoreEventEmitter.MAX_BACKLOG_SIZE) {
        this._feedbackBacklog.shift();
      }
      this._feedbackBacklog.push(payload);
    } else {
      this.emit(CoreEvent.UserFeedback, payload);
    }
  }

  /**
   * Flushes buffered messages. Call this immediately after primary UI listener
   * subscribes.
   */
  drainFeedbackBacklog(): void {
    const backlog = [...this._feedbackBacklog];
    this._feedbackBacklog.length = 0; // Clear in-place
    for (const payload of backlog) {
      this.emit(CoreEvent.UserFeedback, payload);
    }
  }

  override on(
    event: CoreEvent.UserFeedback,
    listener: (payload: UserFeedbackPayload) => void,
  ): this;
  override on(
    event: CoreEvent.MemoryChanged,
    listener: (payload: MemoryChangedPayload) => void,
  ): this;
  override on(
    event: CoreEvent.ModelChanged,
    listener: (model: string) => void,
  ): this;
  override on(
    event: string | symbol,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listener: (...args: any[]) => void,
  ): this {
    return super.on(event, listener);
  }

  override off(
    event: CoreEvent.UserFeedback,
    listener: (payload: UserFeedbackPayload) => void,
  ): this;
  override off(
    event: CoreEvent.MemoryChanged,
    listener: (payload: MemoryChangedPayload) => void,
  ): this;
  override off(
    event: CoreEvent.ModelChanged,
    listener: (model: string) => void,
  ): this;
  override off(
    event: string | symbol,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listener: (...args: any[]) => void,
  ): this {
    return super.off(event, listener);
  }

  override emit(
    event: CoreEvent.UserFeedback,
    payload: UserFeedbackPayload,
  ): boolean;
  override emit(
    event: CoreEvent.MemoryChanged,
    payload: MemoryChangedPayload,
  ): boolean;
  override emit(event: CoreEvent.ModelChanged, model: string): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Emits a model-changed event when the model is updated.
   */
  emitModelChanged(model: string): void {
    this.emit(CoreEvent.ModelChanged, model);
  }
}

export const coreEvents = new CoreEventEmitter();
