/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type {
  ToolExecutionPolicy,
  ToolLookup,
} from '@vybestack/llxprt-code-tools';
import type { EditorType } from '@vybestack/llxprt-code-core/utils/editor.js';
import type {
  OutputUpdateHandler,
  AllToolCallsCompleteHandler,
  ToolCallsUpdateHandler,
} from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { ToolGovernance } from './toolGovernance.js';
import type { ApprovalLifecycleWriter } from '@vybestack/llxprt-code-core/scheduler/approval-lifecycle.js';

/**
 * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P05
 * @requirement REQ-D01-001.1
 * @requirement REQ-D01-001.2
 * @pseudocode lines 56-72
 */
export interface CoreToolSchedulerOptions {
  telemetry: RootTelemetry;
  readApprovalMode?: () => ApprovalMode;
  getToolGovernance: () => ToolGovernance;
  readExecutionPolicy: () => ToolExecutionPolicy;
  config: Config;
  messageBus: MessageBus;
  toolRegistry: ToolLookup;
  outputUpdateHandler?: OutputUpdateHandler;
  onAllToolCallsComplete?: AllToolCallsCompleteHandler;
  onToolCallsUpdate?: ToolCallsUpdateHandler;
  persistApproval?: ApprovalLifecycleWriter;
  getPreferredEditor: () => EditorType | undefined;
  onEditorClose: () => void;
  onEditorOpen?: () => void;
  toolContextInteractiveMode?: boolean;
}
