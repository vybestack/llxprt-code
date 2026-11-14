/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { DefinitionError } from './errors.js';
import {
  hasCredentialUrlParts,
  jsonValueSchema,
  nonEmpty,
  parseDefinitionValue,
} from './definition.js';
import type {
  ContentPart,
  ModelRecovery,
  TranscriptEntry,
  Usage,
  UsageReport,
} from './types.js';

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
export const contentSchema: z.ZodType<ContentPart> = z.lazy(() =>
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
export const transcriptPartSchema = z.union([
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
export function validateTranscriptEntry(value: unknown): TranscriptEntry {
  return parseDefinitionValue(
    TranscriptEntrySchema,
    value,
    'Invalid transcript entry',
  );
}

export function validateUsageReport(value: unknown): UsageReport {
  return parseDefinitionValue(UsageReportSchema, value, 'Invalid usage report');
}

export function validateModelRecovery(value: unknown): ModelRecovery {
  return parseDefinitionValue(
    ModelRecoverySchema,
    value,
    'Invalid model recovery',
  );
}

export function validateUsage(value: unknown): Usage {
  return parseDefinitionValue(usageSchema, value, 'Invalid usage');
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
