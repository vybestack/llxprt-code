import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260610-ISSUE1592.P01
 * @requirement REQ-API-001
 * @requirement REQ-INV-002
 *
 * Core-owned structural contract for the tool scheduler surface.
 * Stays in core when CoreToolScheduler class moves to the agents package.
 * Concrete CoreToolScheduler implements this interface.
 *
 * Re-exports scheduler result types from scheduler/types.ts (which stays in core)
 * so downstream type-only consumers import from one location.
 */

import type {
  OutputUpdateHandler,
  AllToolCallsCompleteHandler,
  ToolCallsUpdateHandler,
} from '../scheduler/types.js';
import type { Config } from '../config/config.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type {
  ToolExecutionPolicy,
  ToolGovernance,
  ToolLookup,
} from '@vybestack/llxprt-code-tools';
import type { ToolCallRequestInfo } from './turn.js';
import type { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type { ToolConfirmationPayload } from '@vybestack/llxprt-code-tools';
import type { EditorType } from '../utils/editor.js';
import type { HookExecutionOwner } from '../hooks/hookEventHandler.js';

// Re-export types that staying consumers need
export type {
  ToolCall,
  CompletedToolCall,
  SuccessfulToolCall,
  ErroredToolCall,
  Status,
  OutputUpdateHandler,
  AllToolCallsCompleteHandler,
  ToolCallsUpdateHandler,
} from '../scheduler/types.js';

/**
 * Options for creating a scheduler via the ToolSchedulerFactory.
 * Mirrors CoreToolSchedulerOptions fields that the factory needs.
 * @plan PLAN-20260610-ISSUE1592.P01
 * @requirement REQ-INV-002
 */
export interface ToolSchedulerFactoryOptions {
  readonly telemetry: RootTelemetry;
  readonly readExecutionPolicy: () => ToolExecutionPolicy;
  readonly getToolGovernance: () => ToolGovernance;
  config: Config;
  messageBus: MessageBus;
  toolRegistry: ToolLookup;
  outputUpdateHandler?: OutputUpdateHandler;
  onAllToolCallsComplete?: AllToolCallsCompleteHandler;
  onToolCallsUpdate?: ToolCallsUpdateHandler;
  getPreferredEditor: () => EditorType | undefined;
  onEditorClose: () => void;
  onEditorOpen?: () => void;
  toolContextInteractiveMode?: boolean;
}

/**
 * Callback refresh payload for ToolSchedulerContract.setCallbacks. Only
 * the five UI callbacks (plus the config identity) can be swapped after
 * construction; the messageBus and toolRegistry construction deps are
 * bound at creation time and cannot be refreshed here.
 */
export interface ToolSchedulerCallbackPayload {
  config: Config;
  outputUpdateHandler?: OutputUpdateHandler;
  onAllToolCallsComplete?: AllToolCallsCompleteHandler;
  onToolCallsUpdate?: ToolCallsUpdateHandler;
  getPreferredEditor: () => EditorType | undefined;
  onEditorClose: () => void;
  onEditorOpen?: () => void;
}

/**
 * Structural contract for the tool scheduler.
 * Core-owned; the concrete CoreToolScheduler class implements this.
 * @plan PLAN-20260610-ISSUE1592.P01
 * @requirement REQ-INV-002
 */
export interface ToolSchedulerContract {
  schedule(
    request: ToolCallRequestInfo | ToolCallRequestInfo[],
    signal: AbortSignal,
    hookOwner?: HookExecutionOwner,
  ): Promise<void>;
  cancelAll(): void;
  dispose(): void;
  setCallbacks(options: ToolSchedulerCallbackPayload): void;
  handleConfirmationResponse(
    callId: string,
    originalOnConfirm: (
      outcome: ToolConfirmationOutcome,
      payload?: ToolConfirmationPayload,
    ) => Promise<void>,
    outcome: ToolConfirmationOutcome,
    signal: AbortSignal,
    payload?: ToolConfirmationPayload,
    skipBusPublish?: boolean,
  ): Promise<void>;
}

/**
 * Factory type for creating ToolScheduler instances.
 * Used by agents-owned scheduler composition.
 * @plan PLAN-20260610-ISSUE1592.P01
 * @requirement REQ-INV-002
 */
export type ToolSchedulerFactory = (
  options: ToolSchedulerFactoryOptions,
) => ToolSchedulerContract;

export interface SchedulerCallbacks {
  outputUpdateHandler?: OutputUpdateHandler;
  onAllToolCallsComplete?: AllToolCallsCompleteHandler;
  onToolCallsUpdate?: ToolCallsUpdateHandler;
  getPreferredEditor: () => EditorType | undefined;
  onEditorClose: () => void;
  onEditorOpen?: () => void;
}
