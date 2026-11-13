/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { DefinitionError } from './errors.js';
import {
  cloneDataDescriptors,
  hasSafeDescriptors,
  isJsonValue,
  isPlainData,
} from './plain-data.js';
import type {
  AgentDefinition,
  ContentPart,
  DefinitionProblem,
  JsonValue,
  ModelRecovery,
  PreparedCall,
  TranscriptEntry,
  Usage,
  UsageReport,
} from './types.js';

function normalizeCredentialParameterKey(key: string): string {
  return key.toLowerCase().replaceAll(/[_-]/g, '');
}

const CREDENTIAL_URL_PARAMETER_KEYS = new Set(
  [
    'access_token',
    'api_key',
    'api_secret',
    'apikey',
    'auth',
    'authorization',
    'bearer',
    'client_secret',
    'credential',
    'credentials',
    'key',
    'password',
    'private_key',
    'refresh_token',
    'secret',
    'token',
  ].map(normalizeCredentialParameterKey),
);

function hasCredentialUrlParts(endpoint: string): boolean {
  if (!endpoint.includes('://')) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return true;
  }
  if (url.username !== '' || url.password !== '') return true;
  const parameters = new URLSearchParams(url.search);
  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  for (const [key] of new URLSearchParams(fragment)) parameters.append(key, '');
  return [...parameters.keys()].some((key) =>
    CREDENTIAL_URL_PARAMETER_KEYS.has(normalizeCredentialParameterKey(key)),
  );
}

const nonEmpty = z.string().min(1);
const id = nonEmpty;
const modelRefSchema = z
  .object({ provider: nonEmpty, model: nonEmpty })
  .strict();
const instructionSchema = z
  .object({ id, source: nonEmpty, text: z.string() })
  .strict();
const effectSchema = z.enum(['read', 'write', 'execute', 'network', 'spawn']);
const argMatcherSchema = z.union([
  z.object({ arg: nonEmpty, pathUnder: nonEmpty }).strict(),
  z.object({ arg: nonEmpty, commandPrefix: z.array(nonEmpty) }).strict(),
  z
    .object({
      arg: nonEmpty,
      equals: z.union([z.string(), z.number(), z.boolean()]),
    })
    .strict(),
  z.object({ arg: nonEmpty, urlHost: z.array(nonEmpty).min(1) }).strict(),
]);
const policyMatchSchema = z
  .object({
    tools: z.array(nonEmpty).optional(),
    effects: z.array(effectSchema).optional(),
    args: z.array(argMatcherSchema).optional(),
  })
  .strict();
const policyRuleSchema = z
  .object({
    id,
    match: policyMatchSchema,
    outcome: z.enum(['allow', 'deny', 'ask']),
    reason: z.string().optional(),
  })
  .strict();
const policyLayerSchema = z
  .object({ name: nonEmpty, rules: z.array(policyRuleSchema) })
  .strict();
const authorityRuleSchema = policyRuleSchema.extend({
  outcome: z.enum(['deny', 'ask']),
});
const policySchema = z
  .object({
    authority: z.array(authorityRuleSchema),
    preferences: z.array(policyLayerSchema),
    fallback: z.enum(['allow', 'deny', 'ask']),
  })
  .strict();
const modelParametersSchema = z
  .object({
    temperature: z.number().finite().min(0).max(2).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    reasoning: z
      .object({
        effort: z.enum(['low', 'medium', 'high']).optional(),
        budgetTokens: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    extra: z
      .record(z.union([z.string(), z.number().finite(), z.boolean()]))
      .optional(),
  })
  .strict();
const modelChoiceSchema = z
  .object({ ref: modelRefSchema, parameters: modelParametersSchema })
  .strict();
const modelSelectionSchema = z
  .object({
    primary: modelChoiceSchema,
    fallbacks: z.array(modelChoiceSchema),
    fallbackOn: z.array(
      z.enum([
        'auth',
        'quota',
        'rate-limit',
        'overloaded',
        'invalid-request',
        'context-length',
        'network',
        'aborted',
        'other',
      ]),
    ),
  })
  .strict();
const limitsSchema = z
  .object({
    maxStepsPerTurn: z.number().int().positive(),
    turnTokenBudget: z.number().int().positive().optional(),
    turnCostBudget: z.number().finite().positive().optional(),
    turnTimeoutMs: z.number().int().positive().optional(),
    maxParallelChildren: z.number().int().nonnegative(),
    decisionTimeoutMs: z.number().int().positive().optional(),
  })
  .strict();
const contextStrategySchema = z
  .object({
    compactAtRatio: z.number().finite().gt(0).lt(1),
    keepRecentTurns: z.number().int().nonnegative(),
    summarizer: z.union([
      z.literal('active-model'),
      z.object({ ref: modelRefSchema }).strict(),
    ]),
  })
  .strict();
const retrySchema = z
  .object({
    maxAttempts: z.number().int().positive(),
    backoffMs: z.array(z.number().int().nonnegative()),
  })
  .strict();
const loopSchema = z
  .object({
    maxIdenticalCalls: z.number().int().positive(),
    maxStepsWithoutProgress: z.number().int().positive(),
  })
  .strict();
const outputSchema = z
  .object({
    maxResultBytes: z.number().int().positive(),
    maxStepResultBytes: z.number().int().positive(),
    truncation: z.enum(['head', 'tail', 'head-and-tail']),
  })
  .strict()
  .superRefine((limits, context) => {
    if (limits.maxStepResultBytes < limits.maxResultBytes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxStepResultBytes'],
        message: 'The step result cap cannot be smaller than the per-call cap.',
      });
    }
  });
const subagentSchema = z
  .object({
    name: nonEmpty,
    instructions: z.array(instructionSchema),
    tools: z.array(nonEmpty),
    policy: policySchema,
    limits: limitsSchema,
  })
  .strict();
export const AgentDefinitionSchema = z
  .object({
    name: nonEmpty,
    instructions: z.array(instructionSchema),
    model: modelSelectionSchema,
    tools: z.array(nonEmpty),
    policy: policySchema,
    limits: limitsSchema,
    context: contextStrategySchema,
    retry: retrySchema,
    loop: loopSchema,
    subagents: z.array(subagentSchema),
    toolOutput: outputSchema,
  })
  .strict();

const jsonValueSchema: z.ZodType<JsonValue> = z.custom<JsonValue>(isJsonValue);
const replayScopeSchema = z
  .object({
    provider: nonEmpty,
    model: nonEmpty,
    endpoint: nonEmpty,
    principal: nonEmpty,
    connection: nonEmpty.optional(),
  })
  .strict()
  .superRefine((scope, context) => {
    if (hasCredentialUrlParts(scope.endpoint)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endpoint'],
        message:
          'Replay endpoint URLs must not contain user information or credential parameters.',
      });
    }
  });
const usageFields: ReadonlyArray<keyof Usage> = [
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'cacheReadInputTokens',
  'cacheWriteInputTokens',
];
const usageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    cacheReadInputTokens: z.number().int().nonnegative(),
    cacheWriteInputTokens: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((usage, context) => {
    if (
      usage.cacheReadInputTokens > usage.inputTokens ||
      usage.cacheWriteInputTokens > usage.inputTokens ||
      usage.cacheReadInputTokens + usage.cacheWriteInputTokens >
        usage.inputTokens
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message:
          'Cache input counters are non-overlapping subsets of input tokens.',
      });
    }
  });
export const UsageReportSchema = z
  .object({
    totals: z
      .object({
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        reasoningTokens: z.number().int().nonnegative().optional(),
        cacheReadInputTokens: z.number().int().nonnegative().optional(),
        cacheWriteInputTokens: z.number().int().nonnegative().optional(),
      })
      .strict(),
    complete: z.boolean(),
  })
  .strict()
  .superRefine((report, context) => {
    if (
      report.complete &&
      usageFields.some((field) => report.totals[field] === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totals'],
        message: 'A complete usage report must include every usage counter.',
      });
    }
    const input = report.totals.inputTokens;
    if (input !== undefined) {
      const cacheRead = report.totals.cacheReadInputTokens ?? 0;
      const cacheWrite = report.totals.cacheWriteInputTokens ?? 0;
      if (
        cacheRead > input ||
        cacheWrite > input ||
        cacheRead + cacheWrite > input
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['totals'],
          message:
            'Cache input counters are non-overlapping subsets of input tokens.',
        });
      }
    }
  });
const providerReplaySchema = z
  .object({
    id: nonEmpty,
    scope: replayScopeSchema,
    format: nonEmpty,
    target: z.union([
      z.object({ kind: z.literal('entry') }).strict(),
      z.object({ kind: z.literal('part'), id: nonEmpty }).strict(),
    ]),
    data: jsonValueSchema,
  })
  .strict();
const contentSchema: z.ZodType<ContentPart> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal('text'), text: z.string() }).strict(),
    z
      .object({
        kind: z.literal('image'),
        mediaType: nonEmpty,
        data: z.union([
          z.instanceof(Uint8Array),
          z.object({ ref: nonEmpty }).strict(),
        ]),
      })
      .strict(),
    z
      .object({
        kind: z.literal('audio'),
        mediaType: nonEmpty,
        data: z.union([
          z.instanceof(Uint8Array),
          z.object({ ref: nonEmpty }).strict(),
        ]),
      })
      .strict(),
    z
      .object({
        kind: z.literal('file'),
        name: nonEmpty,
        mediaType: nonEmpty,
        text: z.string().optional(),
        ref: nonEmpty.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('resource'),
        uri: nonEmpty,
        title: z.string().optional(),
        parts: z.array(contentSchema),
      })
      .strict(),
  ]),
);
const toolErrorSchema = z
  .object({
    kind: z.enum([
      'invalid-args',
      'failed',
      'aborted',
      'revoked',
      'unavailable',
    ]),
    message: z.string(),
  })
  .strict();
const toolResultSchema = z
  .object({
    parts: z.array(contentSchema),
    truncated: z
      .object({
        originalBytes: z.number().int().nonnegative(),
        kept: z.enum(['head', 'tail', 'head-and-tail']),
      })
      .strict()
      .optional(),
    raw: nonEmpty.optional(),
  })
  .strict();
const toolOutcomeSchema = z.union([
  z.object({ status: z.literal('ok'), result: toolResultSchema }).strict(),
  z
    .object({
      status: z.literal('error'),
      error: toolErrorSchema,
      result: toolResultSchema.optional(),
    })
    .strict(),
  z.object({ status: z.literal('stale') }).strict(),
]);
const transcriptPartSchema = z.union([
  z.object({ id: nonEmpty, content: contentSchema }).strict(),
  z.object({ id: nonEmpty, thinking: z.string() }).strict(),
  z
    .object({
      id: nonEmpty,
      call: z
        .object({ id: nonEmpty, tool: nonEmpty, args: jsonValueSchema })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: nonEmpty,
      result: z.object({ call: nonEmpty, outcome: toolOutcomeSchema }).strict(),
    })
    .strict(),
]);
export const TranscriptEntrySchema = z
  .object({
    id: nonEmpty,
    role: z.enum(['user', 'model', 'tool']),
    parts: z.array(transcriptPartSchema),
    replay: z.array(providerReplaySchema).optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (
      entry.role !== 'model' &&
      entry.replay !== undefined &&
      entry.replay.length > 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['replay'],
        message: 'Replay envelopes may appear only on model entries.',
      });
    }
    const partIds = new Set<string>();
    entry.parts.forEach((part, index) => {
      if (partIds.has(part.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['parts', index, 'id'],
          message: `Transcript part id ${part.id} is duplicated.`,
        });
      }
      partIds.add(part.id);
      if ('call' in part && part.id !== part.call.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['parts', index, 'id'],
          message: 'A tool-call transcript part id must equal its call id.',
        });
      }
    });
    const replayIds = new Set<string>();
    for (const [index, replay] of (entry.replay ?? []).entries()) {
      if (replayIds.has(replay.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['replay', index, 'id'],
          message: `Replay envelope id ${replay.id} is duplicated in this entry.`,
        });
      }
      replayIds.add(replay.id);
      if (replay.target.kind === 'part' && !partIds.has(replay.target.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['replay', index, 'target', 'id'],
          message: `Replay target ${replay.target.id} does not identify a part in this entry.`,
        });
      }
    }
  });
export const ModelRecoverySchema = z
  .object({
    scope: replayScopeSchema,
    invalidates: z.array(
      z.object({ entry: nonEmpty, replay: nonEmpty }).strict(),
    ),
    format: nonEmpty,
    data: jsonValueSchema,
  })
  .strict();
const shellSegmentSchema = z
  .object({
    command: nonEmpty,
    argv: z
      .array(z.string())
      .min(1)
      .superRefine((argv, context) => {
        if (argv[0] === '') {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [0],
            message: 'The executable argument must not be empty.',
          });
        }
      }),
    hasRedirection: z.boolean(),
  })
  .strict();
const preparedShellSchema = z.union([
  z
    .object({ parsed: z.literal(false), command: nonEmpty, error: nonEmpty })
    .strict(),
  z
    .object({
      parsed: z.literal(true),
      command: nonEmpty,
      segments: z.array(shellSegmentSchema).min(1),
    })
    .strict(),
]);
const preparedCallSchema = z
  .object({
    token: nonEmpty,
    args: jsonValueSchema,
    preview: z
      .object({ title: z.string().optional(), content: z.string().optional() })
      .strict()
      .optional(),
    preconditions: z
      .array(z.object({ kind: nonEmpty, value: nonEmpty }).strict())
      .optional(),
    shell: preparedShellSchema.optional(),
  })
  .strict();

function problemsFrom(error: z.ZodError): DefinitionProblem[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.map((part) =>
      typeof part === 'string' || typeof part === 'number'
        ? part
        : String(part),
    ),
    message: issue.message,
  }));
}

export function validateDefinition(value: unknown): AgentDefinition {
  const plainData = isPlainData(value, new Set(), true);
  const result = AgentDefinitionSchema.safeParse(cloneDataDescriptors(value));
  const problems = result.success ? [] : problemsFrom(result.error);
  if (!plainData) {
    problems.unshift({
      code: 'invalid-plain-data',
      path: [],
      message:
        'Agent definitions must contain only plain JSON-compatible data.',
    });
  }
  if (problems.length > 0) throw new DefinitionError(problems);
  if (!result.success)
    throw new Error('Definition parsing failed without diagnostics.');
  return result.data;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  if (!hasSafeDescriptors(value)) {
    throw new DefinitionError([
      {
        code: 'invalid-plain-data',
        path: [],
        message: `${label}: values must use plain data descriptors.`,
      },
    ]);
  }
  const result = schema.safeParse(value);
  if (!result.success)
    throw new DefinitionError(
      problemsFrom(result.error).map((problem) => ({
        ...problem,
        message: `${label}: ${problem.message}`,
      })),
    );
  return result.data;
}

export function validateTranscriptEntry(value: unknown): TranscriptEntry {
  return parse(TranscriptEntrySchema, value, 'Invalid transcript entry');
}

export function validateUsageReport(value: unknown): UsageReport {
  return parse(UsageReportSchema, value, 'Invalid usage report');
}

export function validateModelRecovery(value: unknown): ModelRecovery {
  return parse(ModelRecoverySchema, value, 'Invalid model recovery');
}

export function validateJsonValue(value: unknown): JsonValue {
  return parse(jsonValueSchema, value, 'Invalid JSON value');
}

export function validateUsage(value: unknown): Usage {
  return parse(usageSchema, value, 'Invalid usage');
}

export function mergeUsageReports(
  previousValue: unknown,
  nextValue: unknown,
): UsageReport {
  const previous = validateUsageReport(previousValue);
  const next = validateUsageReport(nextValue);
  for (const field of usageFields) {
    const before = previous.totals[field];
    const after = next.totals[field];
    if (before !== undefined && after !== undefined && after < before) {
      throw new DefinitionError([
        {
          code: 'usage-decreased',
          path: ['totals', field],
          message: `Cumulative usage counter ${field} decreased from ${before} to ${after}.`,
        },
      ]);
    }
  }
  const totals: { -readonly [Field in keyof Usage]?: Usage[Field] } = {
    ...previous.totals,
  };
  for (const field of usageFields) {
    const value = next.totals[field];
    if (value !== undefined) totals[field] = value;
  }
  return validateUsageReport({
    totals,
    complete: previous.complete || next.complete,
  });
}

export function validateAdapterFormat(
  format: unknown,
  supportedFormats: readonly string[],
): string {
  const parsedFormat = parse(nonEmpty, format, 'Invalid adapter format');
  if (!supportedFormats.includes(parsedFormat)) {
    throw new DefinitionError([
      {
        code: 'unsupported-format',
        path: ['format'],
        message: `Adapter format ${parsedFormat} is not supported.`,
      },
    ]);
  }
  return parsedFormat;
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validatePreparedCall(
  value: unknown,
  shellCommandArg?: string,
): PreparedCall {
  const prepared = parse(preparedCallSchema, value, 'Invalid prepared call');
  if (shellCommandArg !== undefined) {
    if (!prepared.shell) {
      throw new DefinitionError([
        {
          code: 'missing-shell-facts',
          path: ['shell'],
          message: 'A shell descriptor requires trusted prepared shell facts.',
        },
      ]);
    }
    if (
      !isStringRecord(prepared.args) ||
      !Object.hasOwn(prepared.args, shellCommandArg)
    ) {
      throw new DefinitionError([
        {
          code: 'missing-shell-command',
          path: ['args', shellCommandArg],
          message:
            'Prepared shell facts must bind to the declared command argument.',
        },
      ]);
    }
    const command = prepared.args[shellCommandArg];
    if (typeof command !== 'string' || command !== prepared.shell.command) {
      throw new DefinitionError([
        {
          code: 'shell-command-mismatch',
          path: ['shell', 'command'],
          message:
            'Prepared shell facts must describe the final command argument.',
        },
      ]);
    }
  }
  return prepared;
}
