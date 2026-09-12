/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileDocument } from './profileDocument.js';
import type { WorkingProfileIdentity } from './profileState.js';

/**
 * Ephemeral setting keys that hold raw secret material and must be masked before a
 * document leaves the process.
 *
 * Only value-bearing credential keys are listed. Reference keys stay readable on
 * purpose: `auth-key-name` names a stored credential and `auth-keyfile` points at
 * a key file on disk, so neither carries the secret itself. Other v1 ephemeral
 * keys hold references or tuning values (base-url, temperature, context-limit, ...)
 * rather than raw secrets.
 */
export const SECRET_SETTING_KEYS: readonly string[] = [
  // Raw provider credential material carried on the document itself.
  'auth-key',
  // Provider API key value (dashed spelling used in ephemeral settings).
  'api-key',
  // Provider API key value (solid alias used by settings/providers).
  'apikey',
  // Raw Authorization header value (bearer/basic schemes).
  'authorization',
  // Gateway header credential value (e.g. Anthropic-style headers).
  'x-api-key',
  // Bearer/session token value.
  'auth-token',
];

/**
 * Mask secret values embedded in free-form text.
 *
 * A value is masked when it appears as a `key: value` fragment or as a quoted
 * JSON member (`"key": "value"`) for any {@link SECRET_SETTING_KEYS} key. Values
 * are replaced with `[redacted]`; key names stay so the message remains
 * diagnosable. Reference keys (auth-key-name, auth-keyfile) are never masked.
 */
export function redactSecrets(message: string): string {
  let redacted = message;
  for (const key of SECRET_SETTING_KEYS) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    redacted = redacted.replace(
      new RegExp(`("${escaped}")\\s*:\\s*"[^"]*"`, 'gi'),
      '$1: "[redacted]"',
    );
    redacted = redacted.replace(
      new RegExp(`(${escaped}\\s*:\\s*)[^\\n]*`, 'gi'),
      '$1[redacted]',
    );
  }
  return redacted;
}

/**
 * Deep copy of a profile document with every secret setting value replaced by
 * `[redacted]`.
 *
 * The input is never mutated; the returned document preserves the original kind and shape.
 */
export function redactProfileDocument(
  document: ProfileDocument,
): ProfileDocument {
  const cloned = structuredClone(document);
  const settings = Object.fromEntries(
    Object.entries(cloned.ephemeralSettings).map(([key, value]) => [
      key,
      SECRET_SETTING_KEYS.includes(key.toLowerCase()) ? '[redacted]' : value,
    ]),
  );
  return {
    ...cloned,
    ephemeralSettings: settings,
  };
}

/**
 * Redacted snapshot of the active profile workspace, safe to emit in results.
 *
 * The base surface (identity, revision, provider, model, isLoadBalancer, memberCount)
 * is what the repository/save path emits via {@link buildRedactedSnapshot}. The live
 * runtime path adds the optional summary fields: `identityKind` and
 * `providerOrLbSummary` redact the working identity into log-safe strings (null when
 * the workspace is unconfigured), and `health` reports the observed runtime health of
 * a bound runtime. They are optional because a snapshot without a live runtime does
 * not carry them.
 */
export interface RedactedProfileSnapshot {
  identity: WorkingProfileIdentity;
  revision: number;
  provider: string;
  model: string;
  isLoadBalancer: boolean;
  memberCount?: number;
  identityKind?: string | null;
  providerOrLbSummary?: string | null;
  health?: ProfileHealth;
  roleRuntimeCount?: number;
}

/**
 * Build a redacted snapshot from configured workspace state.
 */
export function buildRedactedSnapshot(state: {
  revision: number;
  identity: WorkingProfileIdentity;
  document: ProfileDocument;
}): RedactedProfileSnapshot {
  const base = {
    identity: state.identity,
    revision: state.revision,
    provider: state.document.provider,
    model: state.document.model,
  };
  if (state.document.type === 'loadbalancer') {
    return {
      ...base,
      isLoadBalancer: true,
      memberCount: state.document.profiles.length,
    };
  }
  return { ...base, isLoadBalancer: false };
}

/**
 * Redacted diff between two profile documents: changed, added, and removed key names
 * across the top-level surface plus `ephemeralSettings` and `modelParams`
 * surfaces. Only key names appear, never values.
 */
export interface RedactedProfileDiff {
  changedKeys: readonly string[];
  adds: readonly string[];
  removes: readonly string[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structural equality of two setting values: primitives compare by identity,
 * arrays element-wise, and plain records by having the same key set with equal
 * values per key. Mirrors JSON comparison semantics, so no value ever has to
 * leave the process to decide whether a document changed.
 */
function valuesEqual(before: unknown, after: unknown): boolean {
  if (before === after) {
    return true;
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    return (
      Array.isArray(before) &&
      Array.isArray(after) &&
      before.length === after.length &&
      before.every((entry, index) => valuesEqual(entry, after[index]))
    );
  }
  if (isPlainRecord(before) && isPlainRecord(after)) {
    const beforeKeys = Object.keys(before);
    const afterKeys = Object.keys(after);
    if (beforeKeys.length !== afterKeys.length) {
      return false;
    }
    return beforeKeys.every(
      (key) => key in after && valuesEqual(before[key], after[key]),
    );
  }
  return false;
}

function diffKeyRecords(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  changedKeys: string[],
  adds: string[],
  removes: string[],
  prefix?: string,
): void {
  const afterSet = new Set(Object.keys(after));
  const label = (key: string): string =>
    prefix === undefined ? key : `${prefix}.${key}`;
  for (const key of Object.keys(before)) {
    if (afterSet.has(key)) {
      if (!valuesEqual(before[key], after[key])) {
        changedKeys.push(label(key));
      }
    } else {
      removes.push(label(key));
    }
  }
  for (const key of afterSet) {
    if (!(key in before)) {
      adds.push(label(key));
    }
  }
}

/**
 * Diff two profile documents by key name across every compared surface: the top-level
 * surface plus `ephemeralSettings` and `modelParams` sub-keys. A key present in both
 * documents is reported as changed only when its values differ structurally; a key
 * present on one side only is an add or a remove. The diff carries key names only,
 * never values.
 */
export function diffProfileDocuments(
  before: ProfileDocument,
  after: ProfileDocument,
): RedactedProfileDiff {
  const changedKeys: string[] = [];
  const adds: string[] = [];
  const removes: string[] = [];
  diffKeyRecords({ ...before }, { ...after }, changedKeys, adds, removes);
  diffKeyRecords(
    before.ephemeralSettings,
    after.ephemeralSettings,
    changedKeys,
    adds,
    removes,
    'ephemeralSettings',
  );
  diffKeyRecords(
    before.modelParams,
    after.modelParams,
    changedKeys,
    adds,
    removes,
    'modelParams',
  );
  return { changedKeys, adds, removes };
}

/**
 * Observed health of the active profile workspace.
 */
export type ProfileHealth = {
  status: 'ok' | 'degraded' | 'failed';
  degradedAspects: readonly string[];
};
