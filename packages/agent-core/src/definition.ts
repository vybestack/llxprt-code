/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { DefinitionError } from './errors.js';
import { normalizePolicyRegex } from './policy-regex.js';
import { validatePolicySourceStacks } from './policy-source-stack.js';
import {
  cloneDataDescriptors,
  hasSafeDescriptors,
  isJsonValue,
  isPlainData,
} from './plain-data.js';
import type {
  AgentDefinition,
  DefinitionProblem,
  JsonValue,
  PolicyDocument,
  PolicyMatch,
  PolicyRule,
  PreparedCall,
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

export function hasCredentialUrlParts(endpoint: string): boolean {
  let candidate = endpoint
    .replaceAll('\t', '')
    .replaceAll('\n', '')
    .replaceAll('\r', '');
  let start = 0;
  let end = candidate.length;
  while (start < end && candidate.charCodeAt(start) <= 0x20) start++;
  while (end > start && candidate.charCodeAt(end - 1) <= 0x20) end--;
  candidate = candidate.slice(start, end);
  if (!/^[a-z][a-z\d+.-]*:/i.test(candidate)) return false;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return true;
  }
  if (url.username !== '' || url.password !== '') return true;
  const parameters = new URLSearchParams(url.search);
  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  for (const [key] of new URLSearchParams(fragment)) parameters.append(key, '');
  const routeQuery = fragment.includes('?')
    ? fragment.slice(fragment.indexOf('?') + 1)
    : fragment;
  for (const [key] of new URLSearchParams(routeQuery))
    parameters.append(key, '');
  return [...parameters.keys()].some((key) =>
    CREDENTIAL_URL_PARAMETER_KEYS.has(normalizeCredentialParameterKey(key)),
  );
}

export const jsonValueSchema: z.ZodType<JsonValue> =
  z.custom<JsonValue>(isJsonValue);
export const nonEmpty = z.string().min(1);
const id = nonEmpty;
export const modelRefSchema = z
  .object({ provider: nonEmpty, model: nonEmpty })
  .strict();
export const instructionSchema = z
  .object({ id, source: nonEmpty, text: z.string() })
  .strict();
export const effectSchema = z.enum([
  'read',
  'write',
  'execute',
  'network',
  'spawn',
]);
const policyRegexInputSchema = z.union([
  z
    .object({
      path: z.enum([
        'directory-argsPattern',
        'single-file-argsPattern',
        'directory-commandRegex',
        'single-file-commandRegex',
        'utils-commandRegex',
        'directory-commandPrefix',
        'single-file-commandPrefix',
        'utils-commandPrefix',
        'dynamic-commandPrefix',
      ]),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      path: z.enum(['utils-argsPattern', 'direct']),
      source: z.string(),
      flags: z.string(),
    })
    .strict(),
]);
const policyRegexSchema = z
  .object({
    flavor: z.literal('ecmascript'),
    source: z.string(),
    flags: z.string(),
    input: policyRegexInputSchema,
  })
  .strict();
const policyMatchSchema: z.ZodType<PolicyMatch> = z.lazy(() =>
  z
    .object({
      tools: z.array(nonEmpty).optional(),
      sourceTool: z
        .object({ exact: nonEmpty.optional(), prefix: nonEmpty.optional() })
        .strict()
        .superRefine((source, context) => {
          if ((source.exact === undefined) === (source.prefix === undefined))
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [],
              message:
                'Exactly one source tool exact or prefix selector is required.',
            });
        })
        .optional(),
      effects: z.array(effectSchema).optional(),
      modes: z.array(z.enum(['default', 'autoEdit', 'yolo'])).optional(),
      args: z
        .array(
          z.union([
            z.object({ arg: nonEmpty, pathUnder: nonEmpty }).strict(),
            z
              .object({ arg: nonEmpty, commandPrefix: z.array(nonEmpty) })
              .strict(),
            z
              .object({
                arg: nonEmpty,
                equals: z.union([z.string(), z.number().finite(), z.boolean()]),
              })
              .strict(),
            z
              .object({ arg: nonEmpty, urlHost: z.array(nonEmpty).min(1) })
              .strict(),
            z.object({ serializedArgs: policyRegexSchema }).strict(),
          ]),
        )
        .optional(),
      unless: z.array(policyMatchSchema).optional(),
    })
    .strict(),
);
export const provenanceSchema = z
  .object({
    source: z.enum([
      'default',
      'user',
      'admin',
      'settings',
      'confirmed',
      'host',
    ]),
    sourceId: nonEmpty,
    ruleIndex: z.number().int().nonnegative(),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    sourcePriority: z.number().finite().optional(),
    expansionIndex: z.number().int().nonnegative(),
  })
  .strict();
const policyRuleSchema = z
  .object({
    id,
    match: policyMatchSchema,
    outcome: z.enum(['allow', 'deny', 'ask']),
    priority: z.number().finite(),
    order: z.number().int().nonnegative(),
    allowRedirection: z.boolean().optional(),
    provenance: provenanceSchema,
    reason: z.string().optional(),
  })
  .strict();
export const policyLayerSchema = z
  .object({ name: nonEmpty, rules: z.array(policyRuleSchema) })
  .strict();
export const restrictionRuleSchema = policyRuleSchema.extend({
  outcome: z.enum(['deny', 'ask']),
});
export const policySourceStackSchema = z
  .object({
    id: nonEmpty,
    restrictions: z.array(restrictionRuleSchema),
    preferences: z.array(policyLayerSchema),
  })
  .strict();
const policySchema = z
  .object({
    authority: z.array(restrictionRuleSchema),
    preferences: z.array(policyLayerSchema),
    sourceStacks: z.array(policySourceStackSchema),
    approvalMode: z.enum(['default', 'autoEdit', 'yolo']),
    fallback: z.enum(['allow', 'deny', 'ask']),
  })
  .strict();
export const modelParametersSchema = z
  .object({
    temperature: z.number().finite().min(0).max(2).optional(),
    topP: z.number().finite().min(0).max(1).optional(),
    responseJsonSchema: z.record(jsonValueSchema).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    reasoning: z
      .object({
        effort: z.enum(['low', 'medium', 'high']).optional(),
        budgetTokens: z.number().int().positive().optional(),
        includeInOutput: z.boolean().optional(),
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
export const modelSelectionSchema = z
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
export const limitsSchema = z
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

const shellPolicySegmentSchema = z
  .object({ text: nonEmpty, hasRedirection: z.boolean() })
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
    .object({
      parsed: z.literal(false),
      rawCommand: nonEmpty,
      hasRedirection: z.boolean(),
      policySplit: z.array(shellPolicySegmentSchema),
      error: nonEmpty,
    })
    .strict(),
  z
    .object({
      parsed: z.literal(true),
      rawCommand: nonEmpty,
      hasRedirection: z.boolean(),
      policySplit: z.array(shellPolicySegmentSchema),
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

function validatePolicyRegexes(policy: PolicyDocument): void {
  const problems: DefinitionProblem[] = [];
  const visitMatch = (
    match: PolicyMatch,
    rule: PolicyRule,
    path: ReadonlyArray<string | number>,
  ): void => {
    for (const [index, matcher] of (match.args ?? []).entries()) {
      if (!('serializedArgs' in matcher)) continue;
      const regex = matcher.serializedArgs;
      try {
        const normalized = normalizePolicyRegex(regex.input);
        if (
          normalized.source !== regex.source ||
          normalized.flags !== regex.flags
        )
          throw new Error(
            `Effective source or flags differ from evidence at ${regex.input.path}.`,
          );
      } catch (error) {
        problems.push({
          code: 'invalid-policy-regex',
          path: [...path, 'match', 'args', index, 'serializedArgs'],
          message: `sourceId=${rule.provenance.sourceId} ruleIndex=${rule.provenance.ruleIndex} field=serializedArgs: ${error instanceof Error ? error.message : 'Native RegExp construction failed.'}`,
        });
      }
    }
    for (const [index, exception] of (match.unless ?? []).entries())
      visitMatch(exception, rule, [...path, 'unless', index]);
  };
  const collect = (
    rules: readonly PolicyRule[],
    path: ReadonlyArray<string | number>,
  ): void =>
    rules.forEach((rule, index) =>
      visitMatch(rule.match, rule, [...path, index]),
    );
  collect(policy.authority, ['policy', 'authority']);
  policy.preferences.forEach((layer, index) =>
    collect(layer.rules, ['policy', 'preferences', index, 'rules']),
  );
  policy.sourceStacks.forEach((stack, index) => {
    collect(stack.restrictions, [
      'policy',
      'sourceStacks',
      index,
      'restrictions',
    ]);
    stack.preferences.forEach((layer, layerIndex) =>
      collect(layer.rules, [
        'policy',
        'sourceStacks',
        index,
        'preferences',
        layerIndex,
        'rules',
      ]),
    );
  });
  if (problems.length > 0) throw new DefinitionError(problems);
}

export function validatePolicyContract(policy: PolicyDocument): void {
  const problems: DefinitionProblem[] = [];
  for (const validate of [
    () => validatePolicyRegexes(policy),
    () => validatePolicySourceStacks(policy.sourceStacks),
  ]) {
    try {
      validate();
    } catch (error) {
      if (!(error instanceof DefinitionError)) throw error;
      problems.push(...error.problems);
    }
  }
  if (problems.length > 0) throw new DefinitionError(problems);
}

export function validateEmbeddedPolicyDocuments(
  documents: ReadonlyArray<{
    readonly value: unknown;
    readonly path: ReadonlyArray<string | number>;
  }>,
): DefinitionProblem[] {
  const problems: DefinitionProblem[] = [];
  for (const document of documents) {
    const parsed = policySchema.safeParse(document.value);
    if (!parsed.success) continue;
    try {
      validatePolicyContract(parsed.data);
    } catch (error) {
      if (!(error instanceof DefinitionError)) throw error;
      problems.push(
        ...error.problems.map((problem) => ({
          ...problem,
          path: [
            ...document.path,
            ...(problem.path[0] === 'policy'
              ? problem.path.slice(1)
              : problem.path),
          ],
        })),
      );
    }
  }
  return problems;
}

function embeddedPolicies(value: unknown): ReadonlyArray<{
  readonly value: unknown;
  readonly path: ReadonlyArray<string | number>;
}> {
  if (!isStringRecord(value)) return [];
  const documents: Array<{
    readonly value: unknown;
    readonly path: ReadonlyArray<string | number>;
  }> = [];
  if (Object.hasOwn(value, 'policy'))
    documents.push({ value: value.policy, path: ['policy'] });
  if (Array.isArray(value.subagents)) {
    for (const [index, subagent] of value.subagents.entries()) {
      if (isStringRecord(subagent) && Object.hasOwn(subagent, 'policy'))
        documents.push({
          value: subagent.policy,
          path: ['subagents', index, 'policy'],
        });
    }
  }
  return documents;
}

export function validateDefinition(value: unknown): AgentDefinition {
  const plainData = isPlainData(value, new Set(), true);
  if (!plainData) {
    throw new DefinitionError([
      {
        code: 'invalid-plain-data',
        path: [],
        message:
          'Agent definitions must contain only plain JSON-compatible data.',
      },
    ]);
  }
  const cloned = cloneDataDescriptors(value);
  const result = AgentDefinitionSchema.safeParse(cloned);
  const problems = result.success ? [] : problemsFrom(result.error);
  problems.push(...validateEmbeddedPolicyDocuments(embeddedPolicies(cloned)));
  if (problems.length > 0) throw new DefinitionError(problems);
  if (!result.success)
    throw new Error('Definition parsing failed without diagnostics.');
  return result.data;
}

export function assertSafeDefinitionValue(value: unknown, label: string): void {
  if (hasSafeDescriptors(value)) return;
  throw new DefinitionError([
    {
      code: 'invalid-plain-data',
      path: [],
      message: `${label}: values must use plain data descriptors.`,
    },
  ]);
}

export function labelledDefinitionProblems(
  error: z.ZodError,
  label: string,
): DefinitionProblem[] {
  return problemsFrom(error).map((problem) => ({
    ...problem,
    message: `${label}: ${problem.message}`,
  }));
}

export function parseDefinitionValue<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  assertSafeDefinitionValue(value, label);
  const result = schema.safeParse(value);
  if (!result.success)
    throw new DefinitionError(labelledDefinitionProblems(result.error, label));
  return result.data;
}

export function validateJsonValue(value: unknown): JsonValue {
  return parseDefinitionValue(jsonValueSchema, value, 'Invalid JSON value');
}

export function validateAdapterFormat(
  format: unknown,
  supportedFormats: readonly string[],
): string {
  const parsedFormat = parseDefinitionValue(
    nonEmpty,
    format,
    'Invalid adapter format',
  );
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
  const prepared = parseDefinitionValue(
    preparedCallSchema,
    value,
    'Invalid prepared call',
  );
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
    if (typeof command !== 'string' || command !== prepared.shell.rawCommand) {
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
