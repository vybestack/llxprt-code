/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import {
  contentSchema,
  transcriptPartSchema,
  TranscriptEntrySchema,
  UsageReportSchema,
} from './definition-replay-usage.js';
import {
  effectSchema,
  instructionSchema,
  jsonValueSchema,
  limitsSchema,
  modelParametersSchema,
  modelRefSchema,
  modelSelectionSchema,
  nonEmpty,
  parseDefinitionValue,
  policyLayerSchema,
  provenanceSchema,
  policySourceStackSchema,
  restrictionRuleSchema,
  validatePolicyContract,
} from './definition.js';
import type {
  AgentCommand,
  HookError,
  HookEventResult,
  HookModelResponse,
  HookRequestPatch,
  ImportNotice,
  JournalRecord,
  ModelToolChoice,
  PolicyEvaluationError,
  StoreError,
  ToolDescriptor,
} from './types.js';

export const ToolDescriptorSchema = z
  .object({
    id: nonEmpty,
    description: z.string(),
    inputSchema: z.record(jsonValueSchema),
    policyIdentity: z
      .object({ name: nonEmpty, server: z.string().optional() })
      .strict(),
    effects: z.array(effectSchema),
    concurrency: z.enum(['parallel', 'exclusive']),
    resources: z.array(z.string()).optional(),
    shell: z.object({ commandArg: nonEmpty }).strict().optional(),
  })
  .strict();
export const ModelToolChoiceSchema = z
  .object({
    mode: z.enum(['auto', 'required', 'none']),
    allowedToolIds: z.array(nonEmpty).optional(),
  })
  .strict();
const requestBoundarySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('absent') }).strict(),
  z
    .object({
      status: z.literal('valid'),
      boundary: z
        .object({
          version: z.literal(2).optional(),
          pendingMessageStartIndex: z.number().int().nonnegative(),
          pendingMessageCount: z.number().int().nonnegative().optional(),
          onInvalidBoundary: z.enum(['skip-compression', 'throw']).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      status: z.literal('malformed'),
      onInvalidBoundary: z.enum(['skip-compression', 'throw']),
    })
    .strict(),
]);
export const HookRequestPatchSchema = z
  .object({
    messages: z.array(TranscriptEntrySchema).optional(),
    instructions: z.array(instructionSchema).optional(),
    toolIds: z.array(nonEmpty).optional(),
    model: modelRefSchema.optional(),
    parameters: modelParametersSchema.partial().strict().optional(),
    toolChoice: ModelToolChoiceSchema.optional(),
    boundary: requestBoundarySchema,
  })
  .strict();
const hookProvenanceSchema = z
  .object({
    id: nonEmpty,
    event: nonEmpty,
    source: nonEmpty,
    order: z.number().int().nonnegative(),
  })
  .strict();
const hookAuditEntrySchema = z
  .object({
    provenance: hookProvenanceSchema,
    status: z.enum(['success', 'timeout', 'process-error', 'cancelled']),
    output: jsonValueSchema.optional(),
    diagnostic: z.string().optional(),
  })
  .strict();
const hookProducerSchema = z
  .object({ path: nonEmpty, provenance: hookProvenanceSchema })
  .strict();
const hookControlSchema = z.union([
  z.object({ action: z.literal('continue') }).strict(),
  z
    .object({
      action: z.literal('block'),
      reason: z.string(),
      systemMessage: z.string().optional(),
      response: z.lazy(() => HookModelResponseSchema).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('stop'),
      reason: z.string(),
      systemMessage: z.string().optional(),
    })
    .strict(),
]);
const hookEventEnvelopeSchema = z
  .object({
    effective: z
      .object({
        control: hookControlSchema,
        value: z.unknown().optional(),
        reason: z.string().optional(),
        stopReason: z.string().optional(),
        systemMessage: z.string().optional(),
        suppressOutput: z.boolean().optional(),
        addContext: z
          .array(
            z
              .object({
                id: nonEmpty,
                source: nonEmpty,
                trust: z.enum(['trusted', 'untrusted']),
                lifetime: z.enum(['next-turn', 'until-replaced', 'session']),
                parts: z.array(contentSchema),
              })
              .strict(),
          )
          .optional(),
        producers: z.array(hookProducerSchema),
      })
      .strict(),
    audit: z.array(hookAuditEntrySchema),
  })
  .strict();
export const AgentCommandSchema = z.object({ id: nonEmpty.optional() }).and(
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('set-model'),
        selection: modelSelectionSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal('set-preferences'),
        layers: z.array(policyLayerSchema),
        approvalMode: z.enum(['default', 'autoEdit', 'yolo']),
      })
      .strict(),
    z
      .object({
        type: z.literal('set-authority'),
        rules: z.array(restrictionRuleSchema),
      })
      .strict(),
    z
      .object({
        type: z.literal('set-source-stacks'),
        stacks: z.array(policySourceStackSchema),
      })
      .strict(),
    z.object({ type: z.literal('set-limits'), limits: limitsSchema }).strict(),
    z
      .object({
        type: z.literal('set-mode'),
        mode: z.enum(['normal', 'plan']),
      })
      .strict(),
    z
      .object({
        type: z.literal('set-instructions'),
        instructions: z.array(instructionSchema),
      })
      .strict(),
    z
      .object({
        type: z.literal('set-context'),
        items: z.array(
          z
            .object({
              id: nonEmpty,
              source: nonEmpty,
              trust: z.enum(['trusted', 'untrusted']),
              lifetime: z.enum(['next-turn', 'until-replaced', 'session']),
              parts: z.array(contentSchema),
            })
            .strict(),
        ),
      })
      .strict(),
    z
      .object({ type: z.literal('remove-context'), ids: z.array(nonEmpty) })
      .strict(),
    z.object({ type: z.literal('revoke-grant'), grant: nonEmpty }).strict(),
    z.object({ type: z.literal('compact') }).strict(),
    z.object({ type: z.literal('rewind'), to: nonEmpty }).strict(),
    z.object({ type: z.literal('clear') }).strict(),
  ]),
);
export const PolicyEvaluationErrorSchema = z
  .object({
    code: z.literal('authority-overrides-preference'),
    authority: z
      .object({
        rule: nonEmpty,
        provenance: provenanceSchema,
        priority: z.number().finite(),
        outcome: z.enum(['deny', 'ask']),
      })
      .strict(),
    preference: z
      .object({
        rule: nonEmpty,
        provenance: provenanceSchema,
        priority: z.number().finite(),
        outcome: z.enum(['allow', 'ask']),
      })
      .strict(),
    mode: z.enum(['default', 'autoEdit', 'yolo']),
    revision: z.number().int().nonnegative(),
    message: z.string(),
  })
  .strict();
export const HookErrorSchema = z
  .object({
    kind: z.enum([
      'model-not-allowed',
      'tool-set-widened',
      'invalid-request-boundary',
      'invalid-hook-output',
    ]),
    provenance: z
      .object({
        id: nonEmpty,
        event: nonEmpty,
        source: nonEmpty,
        order: z.number().int().nonnegative(),
      })
      .strict(),
    message: z.string(),
  })
  .strict();
const hookResponsePartSchema = z
  .object({
    value: transcriptPartSchema,
    accumulation: z.enum(['append', 'replace']),
    stream: z
      .object({ id: nonEmpty, status: z.enum(['delta', 'complete']) })
      .strict()
      .optional(),
    hookFields: z
      .object({ format: nonEmpty, data: jsonValueSchema })
      .strict()
      .optional(),
  })
  .strict();
export const HookModelResponseSchema = z
  .object({
    parts: z.array(hookResponsePartSchema),
    finishReason: z.enum(['stop', 'tool-calls', 'length', 'other']).optional(),
    rawStopReason: z.string().optional(),
    declaredUsage: UsageReportSchema.optional(),
  })
  .strict();
export const StoreErrorSchema = z
  .object({
    kind: z.enum(['unavailable', 'corrupt', 'aborted', 'import-required']),
    message: z.string(),
  })
  .strict();
export const ImportedHistoryRecordSchema = z
  .object({
    kind: z.literal('imported-history'),
    sourceDigest: nonEmpty,
    format: nonEmpty,
    audit: nonEmpty.optional(),
    notices: z.array(
      z
        .object({
          code: z.enum([
            'indeterminate-effect',
            'grants-dropped',
            'replay-excluded',
            'compressed-history',
          ]),
          sourceSequence: z.number().int().nonnegative().optional(),
          call: nonEmpty.optional(),
          message: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export const ImportNoticeSchema = z
  .object({
    code: z.enum([
      'indeterminate-effect',
      'grants-dropped',
      'replay-excluded',
      'compressed-history',
    ]),
    sourceSequence: z.number().int().nonnegative().optional(),
    call: nonEmpty.optional(),
    message: z.string(),
  })
  .strict();

export function validateAgentCommand(value: unknown): AgentCommand {
  const command = parseDefinitionValue(
    AgentCommandSchema,
    value,
    'Invalid agent command',
  );
  if (
    command.type === 'set-source-stacks' ||
    command.type === 'set-preferences' ||
    command.type === 'set-authority'
  ) {
    validatePolicyContract({
      authority: command.type === 'set-authority' ? command.rules : [],
      preferences: command.type === 'set-preferences' ? command.layers : [],
      sourceStacks: command.type === 'set-source-stacks' ? command.stacks : [],
      approvalMode: 'default',
      fallback: 'deny',
    });
  }
  return command;
}

export function validatePolicyEvaluationError(
  value: unknown,
): PolicyEvaluationError {
  return parseDefinitionValue(
    PolicyEvaluationErrorSchema,
    value,
    'Invalid policy evaluation error',
  );
}

export function validateHookError(value: unknown): HookError {
  return parseDefinitionValue(HookErrorSchema, value, 'Invalid hook error');
}

export function validateStoreError(value: unknown): StoreError {
  return parseDefinitionValue(StoreErrorSchema, value, 'Invalid store error');
}

export function validateImportedHistoryRecord(
  value: unknown,
): Extract<JournalRecord, { kind: 'imported-history' }> {
  return parseDefinitionValue(
    ImportedHistoryRecordSchema,
    value,
    'Invalid imported history record',
  );
}

export function validateModelToolChoice(value: unknown): ModelToolChoice {
  return parseDefinitionValue(
    ModelToolChoiceSchema,
    value,
    'Invalid model tool choice',
  );
}

export function validateHookRequestPatch(value: unknown): HookRequestPatch {
  return parseDefinitionValue(
    HookRequestPatchSchema,
    value,
    'Invalid hook request patch',
  );
}

export function validateHookEventResult<T>(
  value: unknown,
  valueSchema: z.ZodType<T>,
): HookEventResult<T> {
  const envelope = parseDefinitionValue(
    hookEventEnvelopeSchema,
    value,
    'Invalid hook event result',
  );
  const { value: effectiveValue, ...effective } = envelope.effective;
  if (effectiveValue === undefined) return { effective, audit: envelope.audit };
  return {
    effective: {
      ...effective,
      value: parseDefinitionValue(
        valueSchema,
        effectiveValue,
        'Invalid hook event value',
      ),
    },
    audit: envelope.audit,
  };
}

export function validateToolDescriptor(value: unknown): ToolDescriptor {
  return parseDefinitionValue(
    ToolDescriptorSchema,
    value,
    'Invalid tool descriptor',
  );
}
export function validateHookModelResponse(value: unknown): HookModelResponse {
  return parseDefinitionValue(
    HookModelResponseSchema,
    value,
    'Invalid hook model response',
  );
}
export function validateImportNotice(value: unknown): ImportNotice {
  return parseDefinitionValue(
    ImportNoticeSchema,
    value,
    'Invalid import notice',
  );
}
