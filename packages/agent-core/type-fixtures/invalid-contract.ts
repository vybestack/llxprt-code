/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AfterTurnView,
  ModelRecovery,
  ProviderReplayData,
} from '../index.js';

const viewWithAgent: AfterTurnView = {
  result: {
    outcome: 'done',
    finalText: '',
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    },
    checkpoint: 'checkpoint-1',
    droppedSteers: 0,
  },
  continuationPass: 0,
  thinkingOnly: false,
  tools: [],
  agent: {}, // @expect-agent-property
};

const replayWithExecutableData: ProviderReplayData = {
  id: 'replay-1',
  scope: {
    provider: 'provider',
    model: 'model',
    endpoint: 'endpoint',
    principal: 'principal',
  },
  format: 'provider/v1',
  target: { kind: 'entry' },
  data: () => null, // @expect-replay-data
};

export { replayWithExecutableData, viewWithAgent };

const viewWithCallback: AfterTurnView = {
  result: {
    outcome: 'done',
    finalText: '',
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    },
    checkpoint: 'checkpoint-1',
    droppedSteers: 0,
  },
  continuationPass: 0,
  thinkingOnly: false,
  tools: [],
  callback: () => undefined, // @expect-callback-property
};
const recoveryWithExecutableData: ModelRecovery = {
  scope: {
    provider: 'provider',
    model: 'model',
    endpoint: 'endpoint',
    principal: 'principal',
  },
  invalidates: [],
  format: 'provider/v1',
  data: () => null, // @expect-recovery-data
};
export { viewWithCallback, recoveryWithExecutableData };

import type {
  ImportNotice,
  ModelToolChoice,
  PolicyDocument,
  PreparedShell,
  ToolDescriptor,
} from '../index.js';

const oldPolicyShape: PolicyDocument = {
  authority: [],
  preferences: [],
  sourceStacks: [],
  approvalMode: 'yolo',
  fallback: 'deny',
  obsolete: true, // @expect-policy-closed
};
const badToolChoice: ModelToolChoice = { mode: 'sometimes' }; // @expect-tool-choice
const descriptorWithoutIdentity: Omit<ToolDescriptor, 'policyIdentity'> = {
  id: 'tool',
  description: 'tool',
  inputSchema: {},
  effects: [],
  concurrency: 'parallel',
};
const missingPolicyIdentity: ToolDescriptor = descriptorWithoutIdentity; // @expect-policy-identity
const oldShellShape: PreparedShell = {
  parsed: true,
  command: 'echo old', // @expect-shell-shape
  segments: [],
};
const invalidImportNotice: ImportNotice = {
  code: 'grant-restored', // @expect-import-notice
  message: 'invalid',
};
export {
  badToolChoice,
  invalidImportNotice,
  missingPolicyIdentity,
  oldPolicyShape,
  oldShellShape,
};

import type {
  HookRequestPatch,
  HookResponsePart,
  PolicyRegex,
} from '../index.js';

const missingRegexEvidence: PolicyRegex = /* @expect-regex-evidence */ {
  flavor: 'ecmascript',
  source: 'match',
  flags: '',
};
const missingRequestBoundary: HookRequestPatch = {}; // @expect-request-boundary
const executableHookFields: HookResponsePart = {
  value: { id: 'part', thinking: 'text' },
  accumulation: 'replace',
  hookFields: { format: 'host/v1', data: () => 'not JSON' }, // @expect-hook-fields
};
export { executableHookFields, missingRegexEvidence, missingRequestBoundary };

import type {
  AgentCommand,
  ApprovalMode,
  HookEventResult,
  JournalRecord,
  ModelAttemptSource,
  PolicyRule,
  RestrictionRule,
} from '../index.js';

const obsoleteApprovalMode: ApprovalMode = 'plan'; // @expect-approval-mode
const invalidAttemptSource: ModelAttemptSource = { source: 'extension' }; // @expect-attempt-source
const policyRuleWithInvalidPriority: PolicyRule = {
  id: 'rule',
  match: {},
  outcome: 'deny',
  priority: 'high', // @expect-policy-priority
  order: 0,
  provenance: {
    source: 'user',
    sourceId: 'user-file',
    ruleIndex: 0,
    expansionIndex: 0,
  },
};
const restrictionAllow: RestrictionRule = {
  id: 'restriction',
  match: {},
  outcome: 'allow', // @expect-restriction-allow
  priority: 0,
  order: 0,
  provenance: {
    source: 'host',
    sourceId: 'host',
    ruleIndex: 0,
    expansionIndex: 0,
  },
};
const hookResultWithInvalidAudit: HookEventResult<{
  readonly request: string;
}> = {
  effective: {
    control: { action: 'continue' },
    value: { request: 'replacement' },
    producers: [],
  },
  audit: 'not-an-array', // @expect-hook-audit
};
const sourceStackCommandWithOldField: AgentCommand = {
  type: 'set-source-stacks',
  sourceStacks: [], // @expect-source-stack-command
};
type AfterModelJournalRecord = Extract<JournalRecord, { kind: 'hook-change' }>;
const afterModelWithoutReplayInvalidation: AfterModelJournalRecord =
  // @expect-replay-invalidation
  {
    kind: 'hook-change',
    attempt: 'attempt-1',
    frame: 'frame-1',
    provenance: { id: 'hook', event: 'after-model', source: 'test', order: 0 },
    point: 'after-model',
    audit: 'audit-1',
    disposition: { kind: 'effective' },
    changed: 'change-1',
    aggregate: 'aggregate-1',
  };
// @expect-hook-change-outcome
const hookChangeWithoutOutcome: AfterModelJournalRecord = {
  kind: 'hook-change',
  attempt: 'attempt-2',
  frame: 'frame-2',
  provenance: { id: 'hook', event: 'after-model', source: 'test', order: 0 },
  point: 'after-model',
  audit: 'audit-2',
  invalidatedReplay: [],
};
export {
  afterModelWithoutReplayInvalidation,
  hookChangeWithoutOutcome,
  hookResultWithInvalidAudit,
  invalidAttemptSource,
  obsoleteApprovalMode,
  policyRuleWithInvalidPriority,
  restrictionAllow,
  sourceStackCommandWithOldField,
};
