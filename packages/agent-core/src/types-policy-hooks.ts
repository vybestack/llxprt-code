/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Block,
  ContextItem,
  Continue,
  Effect,
  FinishReason,
  InstructionBlock,
  JsonValue,
  ModelParameters,
  ModelRef,
  ModelRequest,
  ModelToolChoice,
  RuleId,
  ToolId,
  TranscriptEntry,
  TranscriptPart,
  UsageReport,
} from './types-contracts.js';

export type ToolPattern = string;
export type ApprovalMode = 'default' | 'autoEdit' | 'yolo';
export interface PolicyRegex {
  readonly flavor: 'ecmascript';
  readonly source: string;
  readonly flags: string;
  readonly input: PolicyRegexInput;
}
export type PolicyRegexInput =
  | {
      readonly path: 'directory-argsPattern' | 'single-file-argsPattern';
      readonly text: string;
    }
  | {
      readonly path:
        | 'directory-commandRegex'
        | 'single-file-commandRegex'
        | 'utils-commandRegex';
      readonly text: string;
    }
  | {
      readonly path:
        | 'directory-commandPrefix'
        | 'single-file-commandPrefix'
        | 'utils-commandPrefix'
        | 'dynamic-commandPrefix';
      readonly text: string;
    }
  | {
      readonly path: 'utils-argsPattern' | 'direct';
      readonly source: string;
      readonly flags: string;
    };
export interface PolicyProvenance {
  readonly source:
    | 'default'
    | 'user'
    | 'admin'
    | 'settings'
    | 'confirmed'
    | 'host';
  readonly sourceId: string;
  readonly ruleIndex: number;
  readonly tier?: 1 | 2 | 3;
  readonly sourcePriority?: number;
  readonly expansionIndex: number;
}
export interface PolicyMatch {
  readonly tools?: readonly ToolPattern[];
  readonly sourceTool?: { readonly exact?: string; readonly prefix?: string };
  readonly effects?: readonly Effect[];
  readonly modes?: readonly ApprovalMode[];
  readonly args?: readonly ArgMatcher[];
  readonly unless?: readonly PolicyMatch[];
}
export type ArgMatcher =
  | { readonly arg: string; readonly pathUnder: string }
  | { readonly arg: string; readonly commandPrefix: readonly string[] }
  | {
      readonly arg: string;
      readonly equals: string | number | boolean;
    }
  | { readonly arg: string; readonly urlHost: readonly string[] }
  | { readonly serializedArgs: PolicyRegex };
export interface PolicyRule {
  readonly id: RuleId;
  readonly match: PolicyMatch;
  readonly outcome: 'allow' | 'deny' | 'ask';
  readonly priority: number;
  readonly order: number;
  readonly allowRedirection?: boolean;
  readonly provenance: PolicyProvenance;
  readonly reason?: string;
}
export interface PolicyLayer {
  readonly name: string;
  readonly rules: readonly PolicyRule[];
}
export type RestrictionRule = PolicyRule & { readonly outcome: 'deny' | 'ask' };
export interface PolicySourceStack {
  readonly id: string;
  readonly restrictions: readonly RestrictionRule[];
  readonly preferences: readonly PolicyLayer[];
}
export interface PolicyEvaluationError {
  readonly code: 'authority-overrides-preference';
  readonly authority: {
    readonly rule: RuleId;
    readonly provenance: PolicyProvenance;
    readonly priority: number;
    readonly outcome: 'deny' | 'ask';
  };
  readonly preference: {
    readonly rule: RuleId;
    readonly provenance: PolicyProvenance;
    readonly priority: number;
    readonly outcome: 'allow' | 'ask';
  };
  readonly mode: ApprovalMode;
  readonly revision: number;
  readonly message: string;
}
export interface PolicyDocument {
  readonly authority: readonly RestrictionRule[];
  readonly preferences: readonly PolicyLayer[];
  readonly sourceStacks: readonly PolicySourceStack[];
  readonly approvalMode: ApprovalMode;
  readonly fallback: 'allow' | 'deny' | 'ask';
}
export interface HookProvenance {
  readonly id: string;
  readonly event: string;
  readonly source: string;
  readonly order: number;
}
export type ModelAttemptSource =
  | { readonly source: 'provider' }
  | { readonly source: 'hook'; readonly hook: HookProvenance };
export type RequestBoundary =
  | { readonly status: 'absent' }
  | {
      readonly status: 'valid';
      readonly boundary: {
        readonly version?: 2;
        readonly pendingMessageStartIndex: number;
        readonly pendingMessageCount?: number;
        readonly onInvalidBoundary?: 'skip-compression' | 'throw';
      };
    }
  | {
      readonly status: 'malformed';
      readonly onInvalidBoundary: 'skip-compression' | 'throw';
    };
export interface HookRequestPatch {
  readonly messages?: readonly TranscriptEntry[];
  readonly instructions?: readonly InstructionBlock[];
  readonly toolIds?: readonly ToolId[];
  readonly model?: ModelRef;
  readonly parameters?: Partial<ModelParameters>;
  readonly toolChoice?: ModelToolChoice;
  readonly boundary: RequestBoundary;
}
export interface HookResponsePart {
  readonly value: TranscriptPart;
  readonly accumulation: 'append' | 'replace';
  readonly stream?: {
    readonly id: string;
    readonly status: 'delta' | 'complete';
  };
  readonly hookFields?: { readonly format: string; readonly data: JsonValue };
}
export interface HookModelResponse {
  readonly parts: readonly HookResponsePart[];
  readonly finishReason?: FinishReason;
  readonly rawStopReason?: string;
  readonly declaredUsage?: UsageReport;
}
export interface ModelResponseFrame {
  readonly id: string;
  readonly response: HookModelResponse;
}
export interface BeforeModelEffect {
  readonly request?: HookRequestPatch;
  readonly synthetic?: HookModelResponse;
}
export interface AfterModelEffect {
  readonly replacement?: HookModelResponse;
}
export type HookToolSelection = { readonly toolChoice: ModelToolChoice };
export type HookStop = {
  readonly action: 'stop';
  readonly reason: string;
  readonly systemMessage?: string;
};
export interface HookAuditEntry {
  readonly provenance: HookProvenance;
  readonly status: 'success' | 'timeout' | 'process-error' | 'cancelled';
  readonly output?: JsonValue;
  readonly diagnostic?: string;
}
export interface HookEventResult<T> {
  readonly effective: {
    readonly control: Continue | Block | HookStop;
    readonly value?: T;
    readonly reason?: string;
    readonly stopReason?: string;
    readonly systemMessage?: string;
    readonly suppressOutput?: boolean;
    readonly addContext?: readonly ContextItem[];
    readonly producers: ReadonlyArray<{
      readonly path: string;
      readonly provenance: HookProvenance;
    }>;
  };
  readonly audit: readonly HookAuditEntry[];
}
export interface HookError {
  readonly kind:
    | 'model-not-allowed'
    | 'tool-set-widened'
    | 'invalid-request-boundary'
    | 'invalid-hook-output';
  readonly provenance: HookProvenance;
  readonly message: string;
}
export interface ModelRequestView extends ModelRequest {
  readonly model: ModelRef;
}
export interface ModelResponseView {
  readonly attempt: string;
  readonly origin: ModelAttemptSource;
  readonly request: ModelRequestView;
  readonly frame: ModelResponseFrame;
}
