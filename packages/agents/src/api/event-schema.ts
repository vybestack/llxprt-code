/**
 * @plan:PLAN-20260617-COREAPI.P04
 * @requirement:REQ-003
 */

import { z } from 'zod';

export const DoneReasonSchema = z.enum([
  'stop',
  'aborted',
  'max-turns',
  'context-overflow',
  'loop-detected',
  'error',
  'hook-stopped',
]);

export const StructuredErrorSchema = z.object({
  message: z.string(),
  status: z.number().optional(),
});

export const ThoughtSummarySchema = z.object({
  subject: z.string(),
  description: z.string(),
});

export const UsageMetadataValueSchema = z.object({
  promptTokenCount: z.number().optional(),
  candidatesTokenCount: z.number().optional(),
  totalTokenCount: z.number().optional(),
  cachedContentTokenCount: z.number().optional(),
});

export const FinishedValueSchema = z.object({
  reason: z.string(),
  usageMetadata: UsageMetadataValueSchema.optional(),
});

export const AgentStopInfoSchema = z.object({
  reason: z.string(),
  systemMessage: z.string().optional(),
  contextCleared: z.boolean().optional(),
});

export const ModelInfoSchema = z.object({
  model: z.string(),
  providerName: z.string().optional(),
  profileName: z.string().nullable().optional(),
  displayLabel: z.string().optional(),
});

export const ChatCompressionInfoSchema = z.object({
  originalTokenCount: z.number(),
  newTokenCount: z.number(),
  compressionStatus: z.number(),
});

export const AgentToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
});

export const AgentToolResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  output: z.unknown().optional(),
  isError: z.boolean().optional(),
  display: z.unknown().optional(),
  suppressDisplay: z.boolean().optional(),
  errorType: z.string().optional(),
});

export const ToolConfirmationSchema = z.object({
  confirmationId: z.string(),
  toolCallId: z.string(),
  name: z.string(),
  details: z.unknown(),
});

export const ToolUpdateStatusSchema = z.enum([
  'validating',
  'scheduled',
  'awaiting-approval',
  'executing',
  'success',
  'error',
  'cancelled',
]);

export const ToolUpdateSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: ToolUpdateStatusSchema,
  output: z.unknown().optional(),
  agentId: z.string().optional(),
});

export const AgentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('thinking'), thought: ThoughtSummarySchema }),
  z.object({ type: z.literal('tool-call'), call: AgentToolCallSchema }),
  z.object({ type: z.literal('tool-result'), result: AgentToolResultSchema }),
  z.object({
    type: z.literal('tool-confirmation'),
    confirmation: ToolConfirmationSchema,
  }),
  z.object({ type: z.literal('tool-status'), update: ToolUpdateSchema }),
  z.object({ type: z.literal('usage'), usage: UsageMetadataValueSchema }),
  z.object({ type: z.literal('model-info'), info: ModelInfoSchema }),
  z.object({ type: z.literal('notice'), message: z.string() }),
  z.object({
    type: z.literal('compression'),
    info: ChatCompressionInfoSchema.nullable(),
  }),
  z.object({
    type: z.literal('context-warning'),
    estimatedRequestTokenCount: z.number(),
    remainingTokenCount: z.number(),
  }),
  z.object({ type: z.literal('retry') }),
  z.object({ type: z.literal('citation'), citation: z.string() }),
  z.object({ type: z.literal('loop-detected') }),
  z.object({ type: z.literal('idle-timeout'), error: StructuredErrorSchema }),
  z.object({ type: z.literal('invalid-stream') }),
  z.object({ type: z.literal('hook-blocked'), info: AgentStopInfoSchema }),
  z.object({ type: z.literal('error'), error: StructuredErrorSchema }),
  z.object({
    type: z.literal('done'),
    reason: DoneReasonSchema,
    finished: FinishedValueSchema.optional(),
    stop: AgentStopInfoSchema.optional(),
  }),
]);
