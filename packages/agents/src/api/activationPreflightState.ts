/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ProviderActivationResult } from './providerActivationExecutor.js';
import type { ProviderActivationIntent } from './config-types.js';
import { AgentBootstrapError } from './agentBootstrap.js';

/**
 * An opaque, single-use token that vouches for a completed preflight
 * activation. The token is cryptographically bound (by referential identity
 * AND by the frozen canonical intent + runtime provenance it captures) to the
 * exact {@link ProviderActivationIntent} and runtime identity (Config +
 * ProviderManager) that produced the activation result. Consumption requires
 * ALL of: the same Config, the same ProviderManager, AND an exact-match
 * canonical intent. Any mismatch — wrong Config, swapped ProviderManager,
 * a different intent, an already-consumed token, or a foreign token — fails
 * CLOSED with {@link AgentBootstrapError} so activation is never silently
 * re-run against stale or mismatched state.
 */
export interface ActivationPreflightToken {
  readonly id: symbol;
  readonly intentFingerprint: string;
}

/**
 * The immutable canonical form of a {@link ProviderActivationIntent}, captured
 * at preflight issue time. Two intents produce the same canonical string
 * iff they declare the same provider, model, model params, CLI overrides, and
 * auth mode (deep, order-independent for keys). The fingerprint is what the
 * token is bound to, so a token issued for intent A cannot be consumed against
 * intent B.
 */
export function canonicalProviderActivationIntent(
  intent: ProviderActivationIntent,
): string {
  const provider = intent.provider ?? '';
  const defaultProvider = intent.defaultProvider ?? '';
  const model = intent.model ?? '';
  const authMode = intent.authMode ?? 'auto';
  const modelParams = canonicalRecord(intent.modelParams);
  const cliOverrides = canonicalCliOverrides(intent.cliOverrides);
  return [
    'p',
    provider,
    'd',
    defaultProvider,
    'm',
    model,
    'a',
    authMode,
    'mp',
    modelParams,
    'co',
    cliOverrides,
  ].join('|');
}

function canonicalRecord(
  rec: Readonly<Record<string, unknown>> | undefined,
): string {
  if (rec === undefined) {
    return '';
  }
  const keys = Object.keys(rec).sort();
  return keys.map((k) => `${k}=${stableStringify(rec[k])}`).join(',');
}

function canonicalCliOverrides(
  o: ProviderActivationIntent['cliOverrides'],
): string {
  if (o === undefined) {
    return '';
  }
  const set = Array.isArray(o.set) ? [...o.set].sort() : undefined;
  const normalized: Record<string, unknown> = {};
  if (o.key !== undefined) normalized.key = o.key;
  if (o.keyfile !== undefined) normalized.keyfile = o.keyfile;
  if (o.keyName !== undefined) normalized.keyName = o.keyName;
  if (o.baseUrl !== undefined) normalized.baseUrl = o.baseUrl;
  if (set !== undefined) normalized.set = set;
  return canonicalRecord(normalized);
}

function stableStringify(value: unknown, seen?: WeakSet<object>): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'object') {
    if (seen?.has(value) === true) {
      return '[Circular]';
    }
    const next = seen ?? new WeakSet<object>();
    next.add(value);
    if (Array.isArray(value)) {
      return `[${value.map((v) => stableStringify(v, next)).join(',')}]`;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${k}:${stableStringify(obj[k], next)}`).join(',')}}`;
  }
  return String(value);
}

interface CompletedActivationPreflight {
  readonly config: Config;
  readonly providerManager: ReturnType<Config['getProviderManager']>;
  readonly result: ProviderActivationResult;
  readonly intentFingerprint: string;
  consumed: boolean;
}

// Each token is independently tracked; a new successful preflight for the
// same Config supersedes (deletes) the previous latest token. At most one
// "latest" token per Config is consumable at a time.
const completedPreflights = new WeakMap<
  ActivationPreflightToken,
  CompletedActivationPreflight
>();

// Tracks the most-recent token per Config so clearCompletedActivationPreflight
// can invalidate the LATEST preflight on a new attempt. A new successful
// preflight supersedes (deletes) the previous latest token for the same Config,
// so at most one "latest" token is consumable per Config at a time.
const latestTokenByConfig = new WeakMap<Config, ActivationPreflightToken>();

/**
 * Invalidates the MOST RECENT completed preflight for the given Config, if any.
 * Called at the start of each new preflight attempt so a new attempt does not
 * leave a stale "latest" entry. Only the most-recent token is invalidated;
 * any older tokens that were already superseded are already gone.
 */
export function clearCompletedActivationPreflight(config: Config): void {
  const token = latestTokenByConfig.get(config);
  if (token !== undefined) {
    completedPreflights.delete(token);
    latestTokenByConfig.delete(config);
  }
}

/**
 * Records a successful preflight activation and returns a single-use token bound
 * to the canonical intent + runtime identity. Returns `undefined` when the
 * activation failed (authFailed) — failed activations NEVER produce a token, so
 * no stale ambient adoption is possible from a failed attempt.
 *
 * The returned token captures:
 * - The exact Config reference (referential identity)
 * - The exact ProviderManager reference (referential identity)
 * - The canonical fingerprint of the ProviderActivationIntent
 *
 * All three must match at consume time.
 */
export function recordCompletedActivationPreflight(
  config: Config,
  result: ProviderActivationResult,
  intent: ProviderActivationIntent,
): ActivationPreflightToken | undefined {
  // Failed activations NEVER produce a token (Finding 2: no stale ambient
  // adoption from failed attempts).
  if (result.authFailed) {
    return undefined;
  }

  // A new successful preflight supersedes the previous "latest" token for this
  // Config: the previous token is invalidated so at most one "latest" token is
  // consumable per Config at a time.
  const previousToken = latestTokenByConfig.get(config);
  if (previousToken !== undefined) {
    completedPreflights.delete(previousToken);
  }

  const fingerprint = canonicalProviderActivationIntent(intent);
  const token: ActivationPreflightToken = Object.freeze({
    id: Symbol(),
    intentFingerprint: fingerprint,
  });
  completedPreflights.set(token, {
    config,
    providerManager: config.getProviderManager(),
    result,
    intentFingerprint: fingerprint,
    consumed: false,
  });
  latestTokenByConfig.set(config, token);
  return token;
}

/**
 * Consumes a single-use preflight token, requiring EXACT MATCH on:
 * - The Config reference (the same Config that issued the token)
 * - The ProviderManager reference (the same manager at issue time)
 * - The canonical ProviderActivationIntent fingerprint
 *
 * Fail-closed contract (Finding 1): any mismatch — wrong Config, swapped
 * ProviderManager, a different intent, an already-consumed token, or a foreign
 * token — throws {@link AgentBootstrapError}. Activation is NEVER silently
 * re-run against stale or mismatched state.
 *
 * The token is consumed atomically: a successful consume removes it from the
 * registry, and a second consume of the same token throws.
 *
 * @param config The Config that is expected to have issued the token.
 * @param token The token returned by a successful preflight.
 * @param intent The intent that the caller intends to adopt (must exactly match
 *   the canonical form of the intent that produced the token).
 * @returns The activation result from the original preflight.
 * @throws {AgentBootstrapError} on any mismatch or double-consume.
 */
export function consumeCompletedActivationPreflight(
  config: Config,
  token: ActivationPreflightToken,
  intent: ProviderActivationIntent,
): ProviderActivationResult {
  const expectedFingerprint = canonicalProviderActivationIntent(intent);

  // Foreign/invalid token: no completed preflight is registered for this token.
  if (!completedPreflights.has(token)) {
    throw new AgentBootstrapError(
      'Activation preflight token is invalid, already consumed, or was not issued by a successful preflight for this Config.',
    );
  }

  const completed = completedPreflights.get(token)!;

  // Wrong Config: the token was issued for a different Config instance.
  if (completed.config !== config) {
    throw new AgentBootstrapError(
      'Activation preflight token was issued for a different Config instance.',
    );
  }

  // Wrong ProviderManager: the Config's manager was swapped after the token was
  // issued (e.g. post-Config runtime recomposition replaced the manager).
  if (completed.providerManager !== config.getProviderManager()) {
    throw new AgentBootstrapError(
      'Activation preflight token was issued for a different ProviderManager (the manager was swapped after the token was issued).',
    );
  }

  // Intent mismatch: the token was issued for a different activation intent.
  // The canonical fingerprint captures provider/model/params/overrides/authMode
  // so a token issued for intent A cannot be consumed against intent B.
  if (completed.intentFingerprint !== expectedFingerprint) {
    throw new AgentBootstrapError(
      `Activation preflight token intent mismatch: the token was issued for a different ProviderActivationIntent than the one being consumed.`,
    );
  }

  // Double-consume: the token has already been consumed. This is checked last
  // (after all identity checks pass) to give the most specific error first.
  if (completed.consumed) {
    throw new AgentBootstrapError(
      'Activation preflight token has already been consumed (exactly-once violation).',
    );
  }

  // Atomically consume: mark consumed and remove from registry so a concurrent
  // caller on the same token fails.
  const result = completed.result;
  completed.consumed = true;
  completedPreflights.delete(token);

  // Clear the latest-token pointer only if it still points to THIS token.
  if (latestTokenByConfig.get(config) === token) {
    latestTokenByConfig.delete(config);
  }

  return result;
}

/**
 * Returns the activation result for a token WITHOUT consuming it. Used for
 * diagnostic/inspection purposes only. Requires the same identity checks as
 * consume (Config + ProviderManager + intent fingerprint) but does NOT throw
 * on already-consumed state — instead returns undefined for a consumed or
 * unknown token.
 *
 * This is a READ-ONLY inspection and never mutates token state.
 */
export function inspectCompletedActivationPreflight(
  config: Config,
  token: ActivationPreflightToken,
  intent: ProviderActivationIntent,
): ProviderActivationResult | undefined {
  const completed = completedPreflights.get(token);
  if (completed === undefined) {
    return undefined;
  }
  if (
    completed.config !== config ||
    completed.providerManager !== config.getProviderManager() ||
    completed.intentFingerprint !== canonicalProviderActivationIntent(intent)
  ) {
    return undefined;
  }
  return completed.result;
}
