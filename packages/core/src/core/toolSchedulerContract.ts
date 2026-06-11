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
 * Stays in core when CoreToolScheduler class moves to @vybestack/llxprt-code-agents.
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
import type { ToolRegistry } from '../tools/tool-registry.js';
import type { ToolCallRequestInfo } from './turn.js';
import type { ToolConfirmationOutcome } from '../tools/tool-confirmation-types.js';
import type { ToolConfirmationPayload } from '../tools/tools.js';
import type { EditorType } from '../utils/editor.js';

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
  config: Config;
  messageBus: MessageBus;
  toolRegistry: ToolRegistry;
  outputUpdateHandler?: OutputUpdateHandler;
  onAllToolCallsComplete?: AllToolCallsCompleteHandler;
  onToolCallsUpdate?: ToolCallsUpdateHandler;
  getPreferredEditor: () => EditorType | undefined;
  onEditorClose: () => void;
  onEditorOpen?: () => void;
  toolContextInteractiveMode?: boolean;
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
  ): Promise<void>;
  cancelAll(): void;
  dispose(): void;
  setCallbacks(options: {
    config: Config;
    messageBus: MessageBus;
    toolRegistry: ToolRegistry;
    outputUpdateHandler?: OutputUpdateHandler;
    onAllToolCallsComplete?: AllToolCallsCompleteHandler;
    onToolCallsUpdate?: ToolCallsUpdateHandler;
    getPreferredEditor: () => EditorType | undefined;
    onEditorClose: () => void;
    onEditorOpen?: () => void;
  }): void;
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
 * Injected into Config via ConfigParameters.toolSchedulerFactory.
 * @plan PLAN-20260610-ISSUE1592.P01
 * @requirement REQ-INV-002
 */
export type ToolSchedulerFactory = (
  options: ToolSchedulerFactoryOptions,
) => ToolSchedulerContract;
