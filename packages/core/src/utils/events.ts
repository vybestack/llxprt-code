/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import type { McpClient } from '@vybestack/llxprt-code-mcp';

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
  fileCount: number;
  coreMemoryFileCount?: number;
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

/**
 * Payload for the MCP client update event.
 */
export interface McpClientUpdatePayload {
  readonly clients: ReadonlyMap<string, McpClient>;
}

/**
 * Payload for the 'model-profile-changed' event.
 * Carries enough data for UI footer updates and inline chat notifications.
 */
export interface ModelProfileInfoPayload {
  /** The active model name. */
  model: string;
  /** The active provider name, when available. */
  providerName?: string;
  /** The active profile name, when available; null when no profile is active. */
  profileName?: string | null;
  /** Human-readable display name for the profile, when available. */
  displayName?: string;
  /** Computed label for UI display (profile name, display name, or model). */
  displayLabel: string;
}

/**
 * Payload for the 'load-balancer-selection-changed' event.
 * Emitted by the load-balancer provider when it selects a (new) sub-profile,
 * so the footer can recompute the `lb:<lb>:<sub>:<model>` identity. This is a
 * UI-refresh trigger only; it does not signal an actual model switch.
 */
export interface LoadBalancerSelectionPayload {
  /** The load-balancer profile name. */
  profileName: string;
  /** The newly selected sub-profile name, when available. */
  subProfileName?: string | null;
  /** The model used by the selected sub-profile, when available. */
  model?: string | null;
}

export enum CoreEvent {
  UserFeedback = 'user-feedback',
  MemoryChanged = 'memory-changed',
  ModelChanged = 'model-changed',
  ModelProfileChanged = 'model-profile-changed',
  LoadBalancerSelectionChanged = 'load-balancer-selection-changed',
  ConsoleLog = 'console-log',
  Output = 'output',
  ExternalEditorClosed = 'external-editor-closed',
  McpClientUpdate = 'mcp-client-update',
  SettingsChanged = 'settings-changed',
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
   * Notifies subscribers that settings have been modified.
   */
  emitSettingsChanged(): void {
    this.emit(CoreEvent.SettingsChanged);
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
    event: CoreEvent.ModelProfileChanged,
    listener: (payload: ModelProfileInfoPayload) => void,
  ): this;
  override on(
    event: CoreEvent.LoadBalancerSelectionChanged,
    listener: (payload: LoadBalancerSelectionPayload) => void,
  ): this;
  override on(
    event: CoreEvent.ConsoleLog,
    listener: (payload: ConsoleLogPayload) => void,
  ): this;
  override on(
    event: CoreEvent.Output,
    listener: (payload: OutputPayload) => void,
  ): this;
  override on(event: CoreEvent.SettingsChanged, listener: () => void): this;
  override on(
    event: CoreEvent.McpClientUpdate,
    listener: (payload: McpClientUpdatePayload) => void,
  ): this;
  override on(
    event: string | symbol,
    listener: (...args: never[]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
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
    event: CoreEvent.ModelProfileChanged,
    listener: (payload: ModelProfileInfoPayload) => void,
  ): this;
  override off(
    event: CoreEvent.LoadBalancerSelectionChanged,
    listener: (payload: LoadBalancerSelectionPayload) => void,
  ): this;
  override off(
    event: CoreEvent.ConsoleLog,
    listener: (payload: ConsoleLogPayload) => void,
  ): this;
  override off(
    event: CoreEvent.Output,
    listener: (payload: OutputPayload) => void,
  ): this;
  override off(event: CoreEvent.SettingsChanged, listener: () => void): this;
  override off(
    event: CoreEvent.McpClientUpdate,
    listener: (payload: McpClientUpdatePayload) => void,
  ): this;
  override off(
    event: string | symbol,
    listener: (...args: never[]) => void,
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
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
    event: CoreEvent.ModelProfileChanged,
    payload: ModelProfileInfoPayload,
  ): boolean;
  override emit(
    event: CoreEvent.LoadBalancerSelectionChanged,
    payload: LoadBalancerSelectionPayload,
  ): boolean;
  override emit(
    event: CoreEvent.ConsoleLog,
    payload: ConsoleLogPayload,
  ): boolean;
  override emit(event: CoreEvent.Output, payload: OutputPayload): boolean;
  override emit(event: CoreEvent.ExternalEditorClosed): boolean;
  override emit(event: CoreEvent.SettingsChanged): boolean;
  override emit(
    event: CoreEvent.McpClientUpdate,
    payload: McpClientUpdatePayload,
  ): boolean;
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Emits a model-changed event when the model is updated.
   */
  emitModelChanged(model: string): void {
    this.emit(CoreEvent.ModelChanged, model);
  }

  /**
   * Emits a model-profile-changed event carrying model, provider, profile,
   * and display label data for event-driven UI/footer updates.
   */
  emitModelProfileChanged(payload: ModelProfileInfoPayload): void {
    this.emit(CoreEvent.ModelProfileChanged, payload);
  }

  /**
   * Notifies subscribers (e.g. the footer) that a load-balancer profile has
   * selected a (new) sub-profile, so profile-qualified identity can be
   * recomputed. This is a UI-refresh trigger and is intentionally distinct
   * from {@link emitModelChanged}, which signals an actual model switch.
   */
  emitLoadBalancerSelectionChanged(
    payload: LoadBalancerSelectionPayload,
  ): void {
    this.emit(CoreEvent.LoadBalancerSelectionChanged, payload);
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
