/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  PendingConfirmation,
  ProfileCommandKind,
} from './profileCommands.js';
import {
  isPendingConfirmation,
  isProfileCommandKind,
} from './profileCommands.js';
import {
  isRedactedProfileSnapshot,
  type RedactedProfileSnapshot,
} from './profileViews.js';

/**
 * Result of running a profile command.
 *
 * Every member carries `revision`, the revision the result applies to. Redacted error
 * payloads are plain strings: callers pre-redact anything sensitive before building a
 * result.
 */
export type ProfileCommandResult =
  | { kind: 'committed'; revision: number; snapshot: RedactedProfileSnapshot }
  | { kind: 'no-op'; revision: number; reason: string }
  | { kind: 'queued'; revision: number; baseRevision: number }
  | {
      kind: 'confirmation-required';
      revision: number;
      pending: PendingConfirmation;
    }
  | { kind: 'cancelled'; revision: number; reason: string }
  | { kind: 'busy'; revision: number; activeCommandKind: ProfileCommandKind }
  | {
      kind: 'stale';
      revision: number;
      expectedRevision: number;
      currentRevision: number;
    }
  | { kind: 'conflict'; revision: number; cause: string }
  | { kind: 'invalid'; revision: number; errors: readonly string[] }
  | { kind: 'unverified'; revision: number; constraints: readonly string[] }
  | { kind: 'failed'; revision: number; error: string };

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((entry: unknown) => isString(entry) && entry.trim().length > 0)
  );
}

const RESULT_VALIDATORS = {
  committed: (value): boolean => isRedactedProfileSnapshot(value['snapshot']),
  'no-op': (value): boolean => isString(value['reason']),
  queued: (value): boolean => typeof value['baseRevision'] === 'number',
  'confirmation-required': (value): boolean =>
    isPendingConfirmation(value['pending']),
  cancelled: (value): boolean => isString(value['reason']),
  busy: (value): boolean => isProfileCommandKind(value['activeCommandKind']),
  stale: (value): boolean =>
    typeof value['expectedRevision'] === 'number' &&
    typeof value['currentRevision'] === 'number',
  conflict: (value): boolean => isString(value['cause']),
  invalid: (value): boolean => isNonEmptyStringArray(value['errors']),
  unverified: (value): boolean => isNonEmptyStringArray(value['constraints']),
  failed: (value): boolean => isString(value['error']),
} satisfies Record<
  ProfileCommandResult['kind'],
  (value: Record<string, unknown>) => boolean
>;

function isProfileCommandResultKind(
  value: unknown,
): value is ProfileCommandResult['kind'] {
  return (
    isString(value) &&
    Object.prototype.hasOwnProperty.call(RESULT_VALIDATORS, value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Structural type guard for a profile command result.
 */
export function isProfileCommandResult(
  value: unknown,
): value is ProfileCommandResult {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value['revision'] !== 'number') {
    return false;
  }
  return (
    isProfileCommandResultKind(value['kind']) &&
    RESULT_VALIDATORS[value['kind']](value)
  );
}
