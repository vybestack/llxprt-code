/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelLimitsCatalogSchema } from './model-limits.schema.js';
import type { ModelLimitsCatalog } from './model-limits.schema.js';
import catalogData from './model-limits.json' with { type: 'json' };

type Model = string;
type TokenCount = number;

// Catalog corruption is a release/configuration error. Validate eagerly so an
// invalid package fails deterministically instead of silently using stale limits.
const CATALOG = ModelLimitsCatalogSchema.parse(catalogData);

export const DEFAULT_TOKEN_LIMIT: TokenCount = CATALOG.defaultLimit;

function matchesAnyPrefix(model: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => model.startsWith(prefix));
}

function assertUnreachableRule(rule: never): never {
  throw new Error(`Unsupported model-limit rule: ${JSON.stringify(rule)}`);
}

/**
 * Resolve a single catalog's ordered rules against a model id + provider
 * prefix. Exported so that the case-insensitive normalization can be tested
 * with any catalog (including mixed-case fixtures) without type assertions.
 */
export function resolveOrderedRuleFromCatalog(
  catalog: ModelLimitsCatalog,
  modelWithoutPrefix: string,
  providerPrefix: string,
): TokenCount | undefined {
  for (const rule of catalog.orderedRules) {
    switch (rule.type) {
      case 'substring':
        if (modelWithoutPrefix.includes(rule.substring)) {
          return rule.limit;
        }
        break;
      case 'substringOrProviderPrefix':
        if (
          modelWithoutPrefix.includes(rule.substring) ||
          providerPrefix === rule.providerPrefix
        ) {
          return rule.limit;
        }
        break;
      case 'prefixGroup':
        if (matchesAnyPrefix(modelWithoutPrefix, rule.prefixes)) {
          return rule.limit;
        }
        break;
      case 'substringCaseInsensitive':
        if (
          modelWithoutPrefix
            .toLowerCase()
            .includes(rule.substring.toLowerCase())
        ) {
          return rule.limit;
        }
        break;
      default:
        return assertUnreachableRule(rule);
    }
  }
  return undefined;
}

function resolveOrderedRule(
  modelWithoutPrefix: string,
  providerPrefix: string,
): TokenCount | undefined {
  return resolveOrderedRuleFromCatalog(
    CATALOG,
    modelWithoutPrefix,
    providerPrefix,
  );
}

export function tokenLimit(
  model: Model,
  userContextLimit?: number,
): TokenCount {
  // If user has set a context limit, use it
  if (userContextLimit !== undefined && userContextLimit > 0) {
    return userContextLimit;
  }

  // Split provider prefix if present (e.g., "codex:gpt-5.5" -> prefix "codex")
  const colonIndex = model.indexOf(':');
  const providerPrefix = colonIndex !== -1 ? model.slice(0, colonIndex) : '';
  const modelWithoutPrefix =
    colonIndex !== -1 ? model.slice(colonIndex + 1) : model;

  // Check exact model matches first
  const exactLimit = CATALOG.exactLimits[modelWithoutPrefix];
  if (typeof exactLimit === 'number') {
    return exactLimit;
  }

  // Check prefix-based limits
  for (const { prefix, limit } of CATALOG.prefixLimits) {
    if (modelWithoutPrefix.startsWith(prefix)) {
      return limit;
    }
  }

  // Check ordered data-driven rules (codex, OpenAI groups, Claude substrings)
  const orderedLimit = resolveOrderedRule(modelWithoutPrefix, providerPrefix);
  if (orderedLimit !== undefined) {
    return orderedLimit;
  }

  return DEFAULT_TOKEN_LIMIT;
}

/**
 * Returns true when *value* is a positive, finite number suitable as a
 * context-window override.
 */
function isPositiveFiniteLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Single source of truth for the three-tier context-window precedence
 * (issues #2270 / #2527 DRY consolidation):
 *
 * 1. explicit user `context-limit` override (from /set, profile, or settings),
 * 2. the active provider's reported context limit (e.g. a load-balancer pool's
 *    min-across-sub-profiles limit),
 * 3. the model-name lookup via `tokenLimit(model)`.
 *
 * Both `ephemerals.contextLimit()` (core runtime) and
 * `getTokenLimitForConfiguredContext()` (agents layer) delegate to this
 * function so the precedence lives in exactly one place.
 */
export function resolveEffectiveContextLimit(
  model: string,
  userContextLimit?: number,
  providerContextLimit?: number,
): number {
  if (isPositiveFiniteLimit(userContextLimit)) {
    return userContextLimit;
  }
  if (isPositiveFiniteLimit(providerContextLimit)) {
    return providerContextLimit;
  }
  return tokenLimit(model);
}
