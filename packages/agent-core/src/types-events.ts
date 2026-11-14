/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AgentCommand,
  AgentEventBase,
  AgentId,
  AgentSnapshot,
  AttemptId,
  CallId,
  CheckpointId,
  CloseReport,
  CommandId,
  DecidedBy,
  DecisionRequest,
  FinishReason,
  Grant,
  GrantId,
  ModelErrorKind,
  ModelRecovery,
  ModelRef,
  PreparedToken,
  RequestId,
  Resolution,
  RuleId,
  ToolCall,
  ToolOutcome,
  ToolProgress,
  ToolResult,
  TranscriptEntry,
  TurnResult,
  Usage,
  UsageReport,
  UserInput,
} from './types-contracts.js';

export type AgentEvent = AgentEventBase &
  (
    | { readonly type: 'turn.started'; readonly input: UserInput }
    | {
        readonly type: 'model.attempt';
        readonly step: number;
        readonly attempt: AttemptId;
        readonly model: ModelRef;
        readonly tokens: number;
      }
    | {
        readonly type: 'model.text' | 'model.thinking';
        readonly attempt: AttemptId;
        readonly delta: string;
      }
    | {
        readonly type: 'model.attempt.discarded';
        readonly attempt: AttemptId;
        readonly error: ModelErrorKind;
      }
    | {
        readonly type: 'model.response';
        readonly attempt: AttemptId;
        readonly usage: Usage;
        readonly finish: FinishReason;
      }
    | {
        readonly type: 'tool.proposed';
        readonly call: ToolCall;
      }
    | {
        readonly type: 'policy.evaluated';
        readonly call: CallId;
        readonly outcome: 'allow' | 'deny' | 'ask';
        readonly rule: RuleId;
        readonly layer: string;
      }
    | { readonly type: 'decision.requested'; readonly request: DecisionRequest }
    | {
        readonly type: 'decision.resolved';
        readonly request: RequestId;
        readonly resolution: Resolution;
        readonly by: DecidedBy;
      }
    | { readonly type: 'grant.added' | 'grant.revoked'; readonly grant: Grant }
    | { readonly type: 'tool.started'; readonly call: CallId }
    | {
        readonly type: 'tool.progress';
        readonly call: CallId;
        readonly progress: ToolProgress;
      }
    | {
        readonly type: 'tool.finished';
        readonly call: CallId;
        readonly result: ToolResult;
      }
    | { readonly type: 'steer.applied'; readonly input: UserInput }
    | {
        readonly type: 'command.applied' | 'command.rejected';
        readonly command: CommandId;
        readonly reason?: string;
      }
    | {
        readonly type: 'context.compacted';
        readonly before: number;
        readonly after: number;
        readonly checkpoint: CheckpointId;
      }
    | { readonly type: 'mode.changed'; readonly mode: 'normal' | 'plan' }
    | {
        readonly type: 'child.started' | 'child.finished';
        readonly child: AgentId;
        readonly template: string;
      }
    | { readonly type: 'turn.completed'; readonly result: TurnResult }
    | { readonly type: 'state.changed'; readonly snapshot: AgentSnapshot }
    | { readonly type: 'agent.closed'; readonly report: CloseReport }
    | {
        readonly type: 'attempt.usage';
        readonly attempt: AttemptId;
        readonly report: UsageReport;
      }
    | {
        readonly type: 'attempt.budget.reserved';
        readonly attempt: AttemptId;
        readonly reported: UsageReport;
        readonly charged: Usage;
        readonly estimated: boolean;
      }
    | {
        readonly type: 'attempt.budget.settled';
        readonly attempt: AttemptId;
        readonly reported: UsageReport;
        readonly charged: Usage;
        readonly estimated: boolean;
      }
    | {
        readonly type: 'model.recovery';
        readonly attempt: AttemptId;
        readonly recovery: ModelRecovery;
      }
  );

export type JournalRecord =
  | {
      readonly kind: 'entry';
      readonly checkpoint: CheckpointId;
      readonly entry: TranscriptEntry;
    }
  | {
      readonly kind: 'tool-started';
      readonly call: CallId;
      readonly prepared: PreparedToken;
    }
  | {
      readonly kind: 'tool-finished';
      readonly call: CallId;
      readonly outcome: ToolOutcome;
    }
  | { readonly kind: 'decision-pending'; readonly request: DecisionRequest }
  | {
      readonly kind: 'decision-resolved';
      readonly request: RequestId;
      readonly resolution: Resolution;
    }
  | { readonly kind: 'grant'; readonly grant: Grant }
  | { readonly kind: 'grant-revoked'; readonly grant: GrantId }
  | { readonly kind: 'command-applied'; readonly command: AgentCommand }
  | {
      readonly kind: 'compacted';
      readonly replaces: {
        readonly from: CheckpointId;
        readonly to: CheckpointId;
      };
      readonly summary: TranscriptEntry;
    }
  | {
      readonly kind: 'attempt-budget';
      readonly attempt: string;
      readonly phase: 'reserved' | 'settled';
      readonly reported: UsageReport;
      readonly charged: Usage;
      readonly estimated: boolean;
    }
  | {
      readonly kind: 'model-recovery';
      readonly attempt: string;
      readonly recovery: ModelRecovery;
    }
  | { readonly kind: 'turn-ended'; readonly result: TurnResult };
