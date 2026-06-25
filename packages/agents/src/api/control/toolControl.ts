/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 * @requirement:REQ-007
 * @pseudocode tool-confirmation-merge.md steps 10-109
 *
 * The public tool control surface. Surfaces tool listing/enablement,
 * confirmation request/response, live tool-status updates, and editor callback
 * registration. Confirmations and tool-status updates are driven from the SAME
 * projection the eventAdapter produces for the public stream
 * (awaiting_approval ToolCall WITH details), so the public
 * `ToolConfirmation` always carries a structured `details` payload (T3c).
 */

import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type { EditorCallbacks } from '../config-types.js';
import type {
  AgentToolControl,
  AgentToolKeyControl,
  ToolDecision,
  ToolInfo,
  Unsubscribe,
} from '../agent.js';
import type { ToolConfirmation, ToolUpdate } from '../event-types.js';
import { buildToolInfos } from '../agentBootstrap.js';
import { ToolKeysControl } from './toolKeysControl.js';
import type { ToolKeysControlDeps } from './toolKeysControl.js';

/**
 * Typed error thrown by {@link ToolControl.respondToConfirmation} when the
 * caller supplies an unknown confirmationId.
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 * @pseudocode tool-confirmation-merge.md steps 80-91
 */
export class ToolControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolControlError';
    Object.setPrototypeOf(this, ToolControlError.prototype);
  }
}

/**
 * Dependencies injected into {@link ToolControl} by the AgentImpl constructor.
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 */
export interface ToolControlDeps {
  /** The shared confirmation bus (respondToConfirmation publishes here). */
  readonly messageBus: MessageBus;
  /** The Config carrying the tool registry + settings service. */
  readonly config: Config;
  /**
   * The mutable editor-callbacks holder shared with the scheduler factory so
   * `setEditorCallbacks` is observable by the next turn's scheduler.
   */
  readonly editorCallbacksHolder: { editorCallbacks: EditorCallbacks };
  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
  /** The deps bundle for the constructed ToolKeysControl. */
  readonly keysDeps: ToolKeysControlDeps;
}

type ConfirmationCallback = (req: ToolConfirmation) => void;
type ToolUpdateCallback = (u: ToolUpdate) => void;

/**
 * The public tool control surface.
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 * @requirement:REQ-007
 * @pseudocode tool-confirmation-merge.md steps 10-109
 */
export class ToolControl implements AgentToolControl {
  private readonly confirmationCallbacks = new Set<ConfirmationCallback>();
  private readonly toolUpdateCallbacks = new Set<ToolUpdateCallback>();
  private readonly seen = new Set<string>();
  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
  readonly keys: AgentToolKeyControl;

  constructor(private readonly deps: ToolControlDeps) {
    this.keys = new ToolKeysControl(deps.keysDeps);
  }

  /**
   * Returns a frozen snapshot of the registered tools (name/source/enabled),
   * mirroring `AgentImpl.listTools()`.
   *
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   * @requirement:REQ-017
   */
  list(): readonly ToolInfo[] {
    const registry = this.deps.config.getToolRegistry();
    const allTools = registry.getAllTools().map((t) => ({
      name: t.name,
      serverName: (t as { serverName?: string }).serverName,
    }));
    const enabledNames = new Set(registry.getEnabledTools().map((t) => t.name));
    return Object.freeze(buildToolInfos(allTools, enabledNames));
  }

  /**
   * Enables exactly the named tools (and disables all others) by setting the
   * `tools.allowed` ephemeral setting on the Config's settings service — the
   * same mechanism the profile manager uses.
   *
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   */
  async setEnabled(names: readonly string[]): Promise<void> {
    const settingsService = this.deps.config.getSettingsService();
    settingsService.set('tools.allowed', [...names]);
  }

  /**
   * Registers a confirmation-request callback. The callback fires when a tool
   * confirmation surfaces in the public stream. Returns an unsubscribe.
   *
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   * @pseudocode tool-confirmation-merge.md steps 10-31
   */
  onConfirmationRequest(cb: ConfirmationCallback): Unsubscribe {
    this.confirmationCallbacks.add(cb);
    return () => {
      this.confirmationCallbacks.delete(cb);
    };
  }

  /**
   * Responds to a surfaced confirmation by publishing the outcome on the shared
   * MessageBus (keyed by correlationId/confirmationId). Throws
   * {@link ToolControlError} for an unknown confirmationId.
   *
   * For `ModifyWithEditor`, the confirmationId is retired (the coordinator
   * issues a new correlationId).
   *
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   * @pseudocode tool-confirmation-merge.md steps 80-91
   */
  respondToConfirmation(confirmationId: string, decision: ToolDecision): void {
    if (!this.seen.has(confirmationId)) {
      throw new ToolControlError('unknown confirmationId: ' + confirmationId);
    }
    this.deps.messageBus.respondToConfirmation(confirmationId, decision);
    if (decision === ToolConfirmationOutcome.ModifyWithEditor) {
      // editor-modify retires the correlationId; the coordinator issues a new one.
      this.seen.delete(confirmationId);
    }
  }

  /**
   * Registers a tool-update callback. Fires on projected tool-status updates
   * surfaced in the public stream.
   *
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   * @pseudocode tool-confirmation-merge.md steps 40-67
   */
  onToolUpdate(cb: ToolUpdateCallback): Unsubscribe {
    this.toolUpdateCallbacks.add(cb);
    return () => {
      this.toolUpdateCallbacks.delete(cb);
    };
  }

  /**
   * Registers editor callbacks on the shared mutable holder so the next turn's
   * scheduler reads them.
   *
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   */
  setEditorCallbacks(cbs: EditorCallbacks): void {
    this.deps.editorCallbacksHolder.editorCallbacks = cbs;
  }

  // ─── Stream-tap notification (called by AgentImpl.stream) ──────────────────

  /**
   * Notifies the surface of a projected confirmation from the public stream.
   * Deduplicates by confirmationId; fires all registered callbacks.
   *
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   * @pseudocode tool-confirmation-merge.md steps 10-31
   */
  notifyConfirmation(confirmation: ToolConfirmation): void {
    if (this.seen.has(confirmation.confirmationId)) {
      return;
    }
    this.seen.add(confirmation.confirmationId);
    for (const cb of this.confirmationCallbacks) {
      try {
        cb(confirmation);
      } catch {
        // A throwing user callback must not break the stream tap.
      }
    }
  }

  /**
   * Notifies the surface of a projected tool-status update from the public
   * stream. Fires all registered callbacks.
   *
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   * @pseudocode tool-confirmation-merge.md steps 40-67
   */
  notifyToolUpdate(update: ToolUpdate): void {
    for (const cb of this.toolUpdateCallbacks) {
      try {
        cb(update);
      } catch {
        // A throwing user callback must not break the stream tap.
      }
    }
  }
}
