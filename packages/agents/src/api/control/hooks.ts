/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P23
 * @requirement:REQ-015
 *
 * Hooks/lifecycle control surface. Observes hook execution through the SHARED
 * MessageBus (HOOK_EXECUTION_REQUEST/RESPONSE) and fires the session-lifecycle
 * hooks (SessionStart / SessionEnd) through the core lifecycle triggers.
 *
 * The public `onHookExecution` callback receives a {@link HookExecutionRequest}
 * /{@link HookExecutionResponse} pair for every hook the Agent executes. Two
 * sources feed observers:
 *  - Lifecycle triggers (`triggerSessionStart` / `triggerSessionEnd`): these
 *    fire the corresponding core hook and emit an observable request/response
 *    pair so callers can render the lifecycle transition even when no command
 *    hooks are registered.
 *  - Bus-mediated executions: HOOK_EXECUTION_REQUEST/RESPONSE messages crossing
 *    the shared MessageBus during a turn are correlated and forwarded to
 *    observers.
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type HookExecutionRequest as BusHookExecutionRequest,
  type HookExecutionResponse as BusHookExecutionResponse,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import {
  triggerSessionStartHook,
  triggerSessionEndHook,
} from '@vybestack/llxprt-code-core/core/lifecycleHookTriggers.js';
import {
  HookEventName,
  SessionStartSource,
  SessionEndReason,
  type HookInput,
  type HookOutput,
  type SessionStartInput,
  type SessionEndInput,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import type {
  AgentHookControl,
  HookExecutionRequest,
  HookExecutionResponse,
  HookInfo,
  Unsubscribe,
} from '../agent.js';

/**
 * The public observer callback shape (mirrors {@link AgentHookControl}).
 */
type HookObserver = (
  req: HookExecutionRequest,
  resp: HookExecutionResponse,
) => void;

/**
 * Dependency bundle injected into {@link HookControl} by AgentImpl. The control
 * reads the live Config for lifecycle triggers and the SHARED MessageBus to
 * observe bus-mediated hook executions.
 *
 * @plan:PLAN-20260617-COREAPI.P23
 * @requirement:REQ-015
 */
export interface HookControlDeps {
  /** The agent's live Config (carries the HookSystem + enable flag). */
  readonly config: Config;
  /** The single shared MessageBus the runtime threads through every surface. */
  readonly messageBus: MessageBus;
  /**
   * Resolves the per-agent session id used to populate the hook input. Read
   * lazily so a session id assigned after construction is observed.
   */
  readonly sessionId: () => string;
  /** Resolves the agent working directory used to populate the hook input. */
  readonly cwd: () => string;
}

/**
 * Real hooks/lifecycle control. Maintains the set of registered observers and
 * forwards both lifecycle-trigger executions and bus-mediated executions.
 *
 * @plan:PLAN-20260617-COREAPI.P23
 * @requirement:REQ-015
 */
export class HookControl implements AgentHookControl {
  /**
   * Upper bound on buffered HOOK_EXECUTION_REQUEST correlations. A request whose
   * matching RESPONSE never arrives would otherwise grow the buffer unbounded;
   * when the cap is exceeded the OLDEST entry (Map preserves insertion order) is
   * evicted. Deterministic — no timer-based eviction.
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-015
   */
  private static readonly MAX_PENDING_CORRELATIONS = 1000;

  private readonly observers = new Set<HookObserver>();
  private readonly pendingByCorrelation = new Map<
    string,
    BusHookExecutionRequest
  >();
  private busUnsubscribeRequest?: () => void;
  private busUnsubscribeResponse?: () => void;

  constructor(private readonly deps: HookControlDeps) {
    this.subscribeToBus();
  }

  /**
   * Registers a public observer for hook executions. Returns an unsubscribe fn
   * that removes exactly this observer.
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-015
   */
  onHookExecution(cb: HookObserver): Unsubscribe {
    this.observers.add(cb);
    return () => {
      this.observers.delete(cb);
    };
  }

  /**
   * Fires the SessionStart lifecycle hook and emits an observable
   * request/response pair to registered observers.
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-015
   */
  async triggerSessionStart(): Promise<void> {
    const input = this.buildSessionStartInput();
    const result = await triggerSessionStartHook(
      this.deps.config,
      SessionStartSource.Startup,
    );
    const output = this.toHookOutput(HookEventName.SessionStart, result);
    this.emit(HookEventName.SessionStart, input, output);
  }

  /**
   * Fires the SessionEnd lifecycle hook and emits an observable
   * request/response pair to registered observers.
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-015
   */
  async triggerSessionEnd(): Promise<void> {
    const input = this.buildSessionEndInput();
    const result = await triggerSessionEndHook(
      this.deps.config,
      SessionEndReason.Exit,
    );
    const output = this.toHookOutput(HookEventName.SessionEnd, result);
    this.emit(HookEventName.SessionEnd, input, output);
  }

  /**
   * Resets every registered observer. After clear(), a fresh onHookExecution
   * registration still returns a working unsubscribe (the control remains
   * subscribed to the bus for the agent's lifetime).
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-015
   */
  clear(): void {
    this.observers.clear();
    this.pendingByCorrelation.clear();
  }

  /**
   * @plan:PLAN-20260622-COREAPIGAP.P10 @requirement:REQ-004 @pseudocode lines 1-19
   */
  listHooks(): readonly HookInfo[] {
    const system = this.deps.config.getHookSystem();
    if (!system) return [];
    if (!system.isInitialized()) return [];
    const registry = system.getRegistry();
    return registry.getAllHooks().map((entry) => ({
      name: registry.getHookName(entry),
      eventName: String(entry.eventName),
      enabled: entry.enabled,
      source: String(entry.source),
    }));
  }

  /**
   * @plan:PLAN-20260622-COREAPIGAP.P10 @requirement:REQ-004 @pseudocode lines 30-32
   */
  getDisabledHooks(): readonly string[] {
    return [...this.deps.config.getDisabledHooks()];
  }

  /**
   * @plan:PLAN-20260622-COREAPIGAP.P10 @requirement:REQ-004 @pseudocode lines 40-42
   */
  setDisabledHooks(names: readonly string[]): void {
    this.deps.config.setDisabledHooks([...names]);
  }

  /**
   * @plan:PLAN-20260622-COREAPIGAP.P10 @requirement:REQ-004 @pseudocode lines 50-54
   */
  disable(name: string): void {
    const current = this.deps.config.getDisabledHooks();
    if (current.includes(name)) return;
    this.deps.config.setDisabledHooks([...current, name]);
  }

  /**
   * @plan:PLAN-20260622-COREAPIGAP.P10 @requirement:REQ-004 @pseudocode lines 57-61
   */
  enable(name: string): void {
    const current = this.deps.config.getDisabledHooks();
    this.deps.config.setDisabledHooks(current.filter((n) => n !== name));
  }

  /**
   * Detaches the control from the shared MessageBus. Called by Agent.dispose()
   * so the control's bus subscriptions do not outlive the agent.
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-015
   */
  detach(): void {
    this.busUnsubscribeRequest?.();
    this.busUnsubscribeResponse?.();
    this.busUnsubscribeRequest = undefined;
    this.busUnsubscribeResponse = undefined;
    this.pendingByCorrelation.clear();
  }

  /**
   * Subscribes to the HOOK_EXECUTION_REQUEST/RESPONSE messages on the shared
   * MessageBus. Requests are buffered by correlationId; when the matching
   * response arrives the correlated pair is forwarded to observers.
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-015
   */
  private subscribeToBus(): void {
    this.busUnsubscribeRequest =
      this.deps.messageBus.subscribe<BusHookExecutionRequest>(
        MessageBusType.HOOK_EXECUTION_REQUEST,
        (message) => {
          this.pendingByCorrelation.set(message.payload.correlationId, message);
          // Bound the buffer: if a response never arrives the map would grow
          // unbounded. Evict the oldest insertion-ordered entry past the cap.
          if (
            this.pendingByCorrelation.size >
            HookControl.MAX_PENDING_CORRELATIONS
          ) {
            const oldest = this.pendingByCorrelation.keys().next().value;
            if (oldest !== undefined) {
              this.pendingByCorrelation.delete(oldest);
            }
          }
        },
      );
    this.busUnsubscribeResponse =
      this.deps.messageBus.subscribe<BusHookExecutionResponse>(
        MessageBusType.HOOK_EXECUTION_RESPONSE,
        (message) => {
          this.handleBusResponse(message);
        },
      );
  }

  /**
   * Correlates a bus response with its buffered request and forwards the pair
   * to observers. The bus payload carries only the event name + correlationId,
   * so the public input/output are built from the documented base fields.
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-015
   */
  private handleBusResponse(message: BusHookExecutionResponse): void {
    const correlationId = message.payload.correlationId;
    const request = this.pendingByCorrelation.get(correlationId);
    if (request === undefined) {
      return;
    }
    this.pendingByCorrelation.delete(correlationId);
    const event = this.toHookEventName(request.payload.eventName);
    const input = this.buildBaseInput(event);
    const output = this.toHookOutput(event, undefined);
    this.emit(event, input, output);
  }

  /**
   * Forwards a (event, input, output) triple to every registered observer as
   * the public request/response pair.
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-015
   */
  private emit(
    event: HookEventName,
    input: HookInput,
    output: HookOutput,
  ): void {
    const req: HookExecutionRequest = { event, input };
    const resp: HookExecutionResponse = { event, output };
    for (const observer of [...this.observers]) {
      observer(req, resp);
    }
  }

  /**
   * Builds the base HookInput common to every lifecycle event.
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-015
   */
  private buildBaseInput(event: HookEventName): HookInput {
    return {
      session_id: this.deps.sessionId(),
      transcript_path: '',
      cwd: this.deps.cwd(),
      hook_event_name: event,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Builds the SessionStart HookInput carrying the startup source.
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-015
   */
  private buildSessionStartInput(): SessionStartInput {
    return {
      ...this.buildBaseInput(HookEventName.SessionStart),
      source: SessionStartSource.Startup,
    };
  }

  /**
   * Builds the SessionEnd HookInput carrying the exit reason.
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-015
   */
  private buildSessionEndInput(): SessionEndInput {
    return {
      ...this.buildBaseInput(HookEventName.SessionEnd),
      reason: SessionEndReason.Exit,
    };
  }

  /**
   * Projects an aggregated lifecycle HookOutput (or undefined when no command
   * hook ran) onto the public HookOutput shape, defaulting to a continue=true
   * allow output so the observed pair is always well-formed.
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-015
   */
  private toHookOutput(
    event: HookEventName,
    result: Partial<HookOutput> | undefined,
  ): HookOutput {
    const base: HookOutput = {
      continue: true,
      suppressOutput: false,
      decision: 'allow',
      hookSpecificOutput: { hookEventName: event },
    };
    if (result === undefined) {
      return base;
    }
    return {
      continue: result.continue ?? base.continue,
      suppressOutput: result.suppressOutput ?? base.suppressOutput,
      decision: result.decision ?? base.decision,
      ...(result.stopReason !== undefined
        ? { stopReason: result.stopReason }
        : {}),
      ...(result.systemMessage !== undefined
        ? { systemMessage: result.systemMessage }
        : {}),
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
      hookSpecificOutput: result.hookSpecificOutput ?? base.hookSpecificOutput,
    };
  }

  /**
   * Narrows a bus-carried event-name string to a {@link HookEventName},
   * defaulting to Notification when the string is not a known member.
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-015
   */
  private toHookEventName(eventName: string): HookEventName {
    for (const member of Object.values(HookEventName)) {
      if (member === eventName) {
        return member;
      }
    }
    return HookEventName.Notification;
  }
}
