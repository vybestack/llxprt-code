/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, it } from 'bun:test';
import { scanInstalled } from './runtime-service-shape-test-helpers.js';

it.each([
  `const TodoStatus = z.enum(['pending', 'in_progress', 'completed']);`,
  `const DoneReasonSchema = z.enum(['stop', 'aborted', 'max-turns', 'context-overflow', 'loop-detected', 'error', 'hook-stopped', 'refusal']);`,
  `const ProviderAuthSchema = z.object({ apiKey: z.string().optional(), apiKeyFile: z.string().optional(), keyName: z.string().optional(), baseUrl: z.string().optional(), oauth: z.boolean().optional() }).strict();`,
  `const schema = z.object({ interleaved: z.union([z.literal(true), z.object({ field: z.enum(['reasoning_content', 'reasoning_details']) })]).optional() });`,
  `const schema = z.discriminatedUnion('type', [z.object({ type: z.literal('text'), text: z.string() }), z.object({ type: z.literal('done'), reason: z.enum(['stop', 'error']) })]);`,
])('completes actual schema expression families: %s', (source) => {
  expect(scanInstalled(`import { z } from 'zod'; ${source}`)).toEqual([]);
});

it.each([
  `z.object({ services: z.custom<{ clock: Clock; session: Session }>() }).strict();`,
  `z.discriminatedUnion('type', [z.object({ type: z.literal('text'), text: z.string() }), z.object({ type: z.literal('done'), services: z.custom<{ clock: Clock; session: Session }>() })]);`,
  `z.enum(['pending', 'in_progress', 'completed']).refine((value): value is typeof value & { clock: Clock; session: Session } => true);`,
  `declare const schema: z.ZodType<unknown, z.ZodTypeDef, { clock: Clock; session: Session }>; z.object({ schema }).strict();`,
  `declare const schema: z.ZodType<unknown, z.ZodTypeDef & { clock: Clock; session: Session }, unknown>; z.object({ schema });`,
  `declare module 'zod' { interface ZodEnum<T extends [string, ...string[]]> { clock: Clock; session: Session } } z.enum(['pending', 'in_progress', 'completed']);`,
  `declare global { interface Array<T> { clock: Clock; session: Session } } z.enum(['pending', 'in_progress', 'completed']);`,
  `declare function get<T>(): T; const value: { clock: Clock; session: Session } = get();`,
  `declare function get<T>(): T; get<{ clock: Clock; session: Session }>();`,
  `const get = () => ({ clock: new Clock(), session: new Session() }); z.object({ services: z.custom<ReturnType<typeof get>>() });`,
])('retains service-bearing schema substitutions: %s', (source) => {
  expect(scanInstalled(`import { z } from 'zod'; ${source}`)).toContainEqual(
    expect.objectContaining({ rule: 'runtime-service-bundle' }),
  );
});

it('completes the isolated todo persistence family', () => {
  expect(
    scanInstalled(`import { z } from 'zod';
export const TodoStatus = z.enum(['pending', 'in_progress', 'completed']);
const IdSchema = z
    .union([z.string(), z.number()])
    .transform((val) => String(val));
export const TodoToolCallSchema = z.object({
    id: IdSchema,
    name: z.string(),
    parameters: z.record(z.unknown()),
    timestamp: z.date(),
});
export const SubtaskSchema = z.object({
    id: IdSchema,
    content: z.string().min(1),
    toolCalls: z.array(TodoToolCallSchema).optional(),
});
export const TodoSchema = z.object({
    id: IdSchema,
    content: z.string().min(1),
    status: TodoStatus,
    subtasks: z.array(SubtaskSchema).optional(),
    toolCalls: z.array(TodoToolCallSchema).optional(),
});
export const TodoArraySchema = z.array(TodoSchema);
export const PersistedTodoToolCallSchema = TodoToolCallSchema.extend({
    timestamp: z
        .string()
        .datetime()
        .transform((timestamp) => new Date(timestamp)),
});
export const PersistedSubtaskSchema = SubtaskSchema.extend({
    toolCalls: z.array(PersistedTodoToolCallSchema).optional(),
});
export const PersistedTodoSchema = TodoSchema.extend({
    subtasks: z.array(PersistedSubtaskSchema).optional(),
    toolCalls: z.array(PersistedTodoToolCallSchema).optional(),
});
export const PersistedTodoArraySchema = z.array(PersistedTodoSchema);
export type TodoToolCall = z.infer<typeof TodoToolCallSchema>;
export type Subtask = z.infer<typeof SubtaskSchema>;
export type Todo = z.infer<typeof TodoSchema>;
export type TodoStatus = z.infer<typeof TodoStatus>;
`),
  ).toEqual([]);
});

it('completes the isolated models source and enriched schemas', () => {
  expect(
    scanInstalled(`import { z } from 'zod';
export const ModelsDevModelSchema = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    attachment: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    tool_call: z.boolean().optional(),
    temperature: z.boolean().optional(),
    structured_output: z.boolean().optional(),
    interleaved: z
        .union([
        z.literal(true),
        z.object({
            field: z.enum(['reasoning_content', 'reasoning_details']),
        }),
    ])
        .optional(),
    cost: z
        .object({
        input: z.number(),
        output: z.number(),
        reasoning: z.number().optional(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
        context_over_200k: z
            .object({
            input: z.number(),
            output: z.number(),
            cache_read: z.number().optional(),
            cache_write: z.number().optional(),
        })
            .optional(),
    })
        .optional(),
    limit: z.object({
        context: z.number(),
        output: z.number(),
    }),
    modalities: z
        .object({
        input: z.array(z.enum(['text', 'audio', 'image', 'video', 'pdf'])),
        output: z.array(z.enum(['text', 'audio', 'image', 'video', 'pdf'])),
    })
        .optional(),
    knowledge: z.string().optional(),
    release_date: z.string(),
    last_updated: z.string().optional(),
    open_weights: z.boolean(),
    status: z.enum(['alpha', 'beta', 'deprecated']).optional(),
    experimental: z.boolean().optional(),
    options: z.record(z.string(), z.unknown()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.object({ npm: z.string() }).optional(),
    variants: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});
export const ModelsDevProviderSchema = z.object({
    id: z.string(),
    name: z.string(),
    env: z.array(z.string()),
    api: z.string().optional(),
    npm: z.string().optional(),
    doc: z.string().optional(),
    models: z.record(z.string(), ModelsDevModelSchema),
});
export const ModelsDevApiResponseSchema = z.record(z.string(), ModelsDevProviderSchema);
export type ModelsDevModel = z.infer<typeof ModelsDevModelSchema>;
export type ModelsDevProvider = z.infer<typeof ModelsDevProviderSchema>;
export type ModelsDevApiResponse = z.infer<typeof ModelsDevApiResponseSchema>;
export const LlxprtModelCapabilitiesSchema = z.object({
    vision: z.boolean(),
    audio: z.boolean(),
    pdf: z.boolean(),
    toolCalling: z.boolean(),
    reasoning: z.boolean(),
    temperature: z.boolean(),
    structuredOutput: z.boolean(),
    attachment: z.boolean(),
});
export const LlxprtModelPricingSchema = z.object({
    input: z.number(),
    output: z.number(),
    reasoning: z.number().optional(),
    cacheRead: z.number().optional(),
    cacheWrite: z.number().optional(),
});
export const LlxprtModelLimitsSchema = z.object({
    contextWindow: z.number(),
    maxOutput: z.number(),
});
export const LlxprtModelMetadataSchema = z.object({
    knowledgeCutoff: z.string().optional(),
    releaseDate: z.string(),
    lastUpdated: z.string().optional(),
    openWeights: z.boolean(),
    status: z.enum(['stable', 'beta', 'alpha', 'deprecated']).optional(),
});
export const LlxprtDefaultProfileSchema = z.object({
    temperature: z.number().optional(),
    topP: z.number().optional(),
    topK: z.number().optional(),
    thinkingBudget: z.number().optional(),
    thinkingEnabled: z.boolean().optional(),
});
export const LlxprtModelSchema = z.object({
    id: z.string(),
    name: z.string(),
    provider: z.string(),
    providerId: z.string(),
    providerName: z.string(),
    modelId: z.string(),
    family: z.string().optional(),
    supportedToolFormats: z.array(z.string()),
    contextWindow: z.number().optional(),
    maxOutputTokens: z.number().optional(),
    capabilities: LlxprtModelCapabilitiesSchema,
    pricing: LlxprtModelPricingSchema.optional(),
    limits: LlxprtModelLimitsSchema,
    metadata: LlxprtModelMetadataSchema,
    defaultProfile: LlxprtDefaultProfileSchema.optional(),
    envVars: z.array(z.string()),
    apiEndpoint: z.string().optional(),
    npmPackage: z.string().optional(),
    docUrl: z.string().optional(),
});
export const LlxprtProviderSchema = z.object({
    id: z.string(),
    name: z.string(),
    envVars: z.array(z.string()),
    apiEndpoint: z.string().optional(),
    npmPackage: z.string().optional(),
    docUrl: z.string().optional(),
    modelCount: z.number(),
});
export type LlxprtModelCapabilities = z.infer<typeof LlxprtModelCapabilitiesSchema>;
export type LlxprtModelPricing = z.infer<typeof LlxprtModelPricingSchema>;
export type LlxprtModelLimits = z.infer<typeof LlxprtModelLimitsSchema>;
export type LlxprtModelMetadata = z.infer<typeof LlxprtModelMetadataSchema>;
export type LlxprtDefaultProfile = z.infer<typeof LlxprtDefaultProfileSchema>;
export type LlxprtModel = z.infer<typeof LlxprtModelSchema>;
export type LlxprtProvider = z.infer<typeof LlxprtProviderSchema>;
export const ModelCacheMetadataSchema = z.object({
    fetchedAt: z.string(),
    version: z.string(),
    providerCount: z.number(),
    modelCount: z.number(),
});
export type ModelCacheMetadata = z.infer<typeof ModelCacheMetadataSchema>;
`),
  ).toEqual([]);
});

it('completes isolated complete AgentEventSchema discriminated union', () => {
  expect(
    scanInstalled(`import { z } from 'zod';
export const STRUCTURED_ERROR_CATEGORIES = [
    'rate_limit',
    'quota',
    'authentication',
    'server_error',
    'network',
    'client_error',
] as const;
export const STRUCTURED_ERROR_REASONS = [
    'retries_exhausted',
    'all_buckets_exhausted',
] as const;
export const DoneReasonSchema = z.enum([
    'stop',
    'aborted',
    'max-turns',
    'context-overflow',
    'loop-detected',
    'error',
    'hook-stopped',
    'refusal',
]);
const StructuredErrorCategorySchema = z.enum(STRUCTURED_ERROR_CATEGORIES);
const StructuredErrorReasonSchema = z.enum(STRUCTURED_ERROR_REASONS);
export const StructuredErrorSchema = z.object({
    message: z.string(),
    status: z.number().optional(),
    category: StructuredErrorCategorySchema.optional(),
    reason: StructuredErrorReasonSchema.optional(),
});
export const ThoughtSummarySchema = z.object({
    subject: z.string(),
    description: z.string(),
    streamId: z.string().optional(),
    streamStatus: z.enum(['delta', 'complete']).optional(),
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
    stopReason: z.string().optional(),
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
]);`),
  ).toEqual([]);
});

it('completes isolated provider auth and activation chains', () => {
  expect(
    scanInstalled(`import { z } from 'zod';
export const ProviderAuthSchema = z
    .object({
    apiKey: z.string().optional(),
    apiKeyFile: z.string().optional(),
    keyName: z.string().optional(),
    baseUrl: z.string().optional(),
    oauth: z.boolean().optional(),
})
    .strict();
export const ProviderActivationIntentSchema = z
    .object({
    provider: z.string().optional(),
    defaultProvider: z.string().optional(),
    model: z.string().optional(),
    modelParams: z.record(z.unknown()).optional(),
    cliOverrides: z
        .object({
        key: z.string().optional(),
        keyfile: z.string().optional(),
        keyName: z.string().optional(),
        baseUrl: z.string().optional(),
        set: z.array(z.string()).optional(),
    })
        .strict()
        .optional(),
    authMode: z.enum(['auto', 'provider-or-oauth', 'none']).optional(),
    authMethod: z.string().optional(),
    providerSwitchPolicy: z.enum(['strict', 'best-effort']).optional(),
})
    .strict();
export const AgentAuthSchema = ProviderAuthSchema.extend({
    profile: z.string().optional(),
    perProvider: z.record(ProviderAuthSchema).optional(),
}).strict();`),
  ).toEqual([]);
});
