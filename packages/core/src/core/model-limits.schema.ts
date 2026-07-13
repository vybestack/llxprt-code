/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

/**
 * Zod schema for the data-driven model-limits catalog, validated once at
 * module init. See model-limits.json for the data.
 *
 * Hardening guarantees enforced here:
 * - All match strings (substrings, provider prefixes, prefix-group entries)
 *   must be non-empty so a malformed entry can never silently match every
 *   model.
 * - Prefix groups must contain at least one entry.
 * - Every limit is a positive integer.
 * - The catalog is a strict object: unknown top-level keys are rejected so
 *   typos like "orderedRule" vs "orderedRules" surface immediately.
 */

const PositiveLimit = z.number().int().positive();

/** Non-empty string that survives `.trim()`. */
const NonEmptyString = z.string().refine((value) => value.trim().length > 0);

const SubstringRuleSchema = z
  .object({
    type: z.literal('substring'),
    substring: NonEmptyString,
    limit: PositiveLimit,
  })
  .strict();

const SubstringOrProviderPrefixRuleSchema = z
  .object({
    type: z.literal('substringOrProviderPrefix'),
    substring: NonEmptyString,
    providerPrefix: NonEmptyString,
    limit: PositiveLimit,
  })
  .strict();

const PrefixGroupRuleSchema = z
  .object({
    type: z.literal('prefixGroup'),
    prefixes: z.array(NonEmptyString).min(1),
    limit: PositiveLimit,
  })
  .strict();

/**
 * Case-insensitive substring rule. The configured substring is normalized to
 * lowercase via a schema transform so that the runtime check only needs to
 * lowercase the model id — guaranteeing a symmetric comparison regardless of
 * how the JSON author cased the entry.
 */
const SubstringCaseInsensitiveRuleSchema = z
  .object({
    type: z.literal('substringCaseInsensitive'),
    substring: NonEmptyString.transform((value) => value.toLowerCase()),
    limit: PositiveLimit,
  })
  .strict();

const OrderedRuleSchema = z.discriminatedUnion('type', [
  SubstringRuleSchema,
  SubstringOrProviderPrefixRuleSchema,
  PrefixGroupRuleSchema,
  SubstringCaseInsensitiveRuleSchema,
]);

const PrefixLimitSchema = z
  .object({
    prefix: NonEmptyString,
    limit: PositiveLimit,
  })
  .strict();

export const ModelLimitsCatalogSchema = z
  .object({
    defaultLimit: PositiveLimit,
    exactLimits: z.record(NonEmptyString, PositiveLimit),
    prefixLimits: z.array(PrefixLimitSchema),
    orderedRules: z.array(OrderedRuleSchema),
  })
  .strict();

export type ModelLimitsCatalog = z.infer<typeof ModelLimitsCatalogSchema>;
