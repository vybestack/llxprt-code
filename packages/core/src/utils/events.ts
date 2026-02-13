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

export interface ConsoleLogPayload {
  type: string;
  content: string;
}

export interface OutputPayload {
  chunk: string | Uint8Array;
  encoding?: BufferEncoding;
  isStderr: boolean;
}

export enum CoreEvent {
  UserFeedback = 'user-feedback',
  MemoryChanged = 'memory-changed',
  ModelChanged = 'model-changed',
  ConsoleLog = 'console-log',
  Output = 'output',
}

export class CoreEventEmitter extends EventEmitter {
  private _feedbackBacklog: UserFeedbackPayload[] = [];
  private _outputBacklog: OutputPayload[] = [];
  private _consoleLogBacklog: ConsoleLogPayload[] = [];
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
    event: CoreEvent.ConsoleLog,
    listener: (payload: ConsoleLogPayload) => void,
  ): this;
  override on(
    event: CoreEvent.Output,
    listener: (payload: OutputPayload) => void,
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
    event: CoreEvent.ConsoleLog,
    listener: (payload: ConsoleLogPayload) => void,
  ): this;
  override off(
    event: CoreEvent.Output,
    listener: (payload: OutputPayload) => void,
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
  override emit(
    event: CoreEvent.ConsoleLog,
    payload: ConsoleLogPayload,
  ): boolean;
  override emit(event: CoreEvent.Output, payload: OutputPayload): boolean;
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

  /**
   * Emits a console log event. Buffers if no listener is attached.
   */
  emitConsoleLog(type: string, content: string): void {
    const payload: ConsoleLogPayload = { type, content };
    if (this.listenerCount(CoreEvent.ConsoleLog) === 0) {
      if (this._consoleLogBacklog.length >= CoreEventEmitter.MAX_BACKLOG_SIZE) {
        this._consoleLogBacklog.shift();
      }
      this._consoleLogBacklog.push(payload);
    } else {
      this.emit(CoreEvent.ConsoleLog, payload);
    }
  }

  /**
   * Emits an output event. Buffers if no listener is attached.
   */
  emitOutput(payload: OutputPayload): void {
    if (this.listenerCount(CoreEvent.Output) === 0) {
      if (this._outputBacklog.length >= CoreEventEmitter.MAX_BACKLOG_SIZE) {
        this._outputBacklog.shift();
      }
      this._outputBacklog.push(payload);
    } else {
      this.emit(CoreEvent.Output, payload);
    }
  }

  /**
   * Drains the output backlog, emitting all buffered events.
   */
  drainOutputBacklog(): void {
    const backlog = [...this._outputBacklog];
    this._outputBacklog.length = 0;
    for (const payload of backlog) {
      this.emit(CoreEvent.Output, payload);
    }
  }

  /**
   * Drains the console log backlog, emitting all buffered events.
   */
  drainConsoleLogBacklog(): void {
    const backlog = [...this._consoleLogBacklog];
    this._consoleLogBacklog.length = 0;
    for (const payload of backlog) {
      this.emit(CoreEvent.ConsoleLog, payload);
    }
  }

  /**
   * Drains all backlogs (feedback, output, console log).
   */
  drainBacklogs(): void {
    this.drainFeedbackBacklog();
    this.drainOutputBacklog();
    this.drainConsoleLogBacklog();
  }
}

export const coreEvents = new CoreEventEmitter();
