/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Discriminant of a profile command.
 */
export type ProfileCommandKind = ProfileCommand['kind'];

/**
 * Pending confirmation payload used by `confirm-discard`.
 */
export interface PendingConfirmation {
  token: string;
  commandKind: ProfileCommandKind;
  description: string;
}

/**
 * Commands the profile controller accepts.
 *
 * Every member carries `kind` as its discriminant and `expectedRevision` so the
 * controller can reject commands aimed at a stale workspace state.
 */
export type ProfileCommand =
  | { kind: 'model'; model: string; member?: string; expectedRevision: number }
  | {
      kind: 'provider';
      provider: string;
      discardUnsaved?: boolean;
      expectedRevision: number;
    }
  | {
      kind: 'load';
      name: string;
      discardUnsaved?: boolean;
      expectedRevision: number;
    }
  | { kind: 'setup'; discardUnsaved?: boolean; expectedRevision: number }
  | {
      kind: 'set';
      patch: Readonly<Record<string, unknown>>;
      expectedRevision: number;
    }
  | { kind: 'save'; name?: string; expectedRevision: number }
  | {
      kind: 'startup';
      discardUnsaved?: boolean;
      profileName?: string;
      model?: string;
      provider?: string;
      member?: string;
      expectedRevision: number;
    }
  | {
      kind: 'confirm-discard';
      pending: PendingConfirmation;
      expectedRevision: number;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

const COMMAND_VALIDATORS = {
  model: (value): boolean => isString(value['model']),
  provider: (value): boolean =>
    isString(value['provider']) &&
    (value['discardUnsaved'] === undefined ||
      typeof value['discardUnsaved'] === 'boolean'),
  load: (value): boolean => isString(value['name']),
  setup: (value): boolean =>
    value['discardUnsaved'] === undefined ||
    typeof value['discardUnsaved'] === 'boolean',
  set: (value): boolean => {
    const patch = value['patch'];
    return (
      isRecord(patch) &&
      (Object.getPrototypeOf(patch) === Object.prototype ||
        Object.getPrototypeOf(patch) === null)
    );
  },
  save: (value): boolean =>
    value['name'] === undefined || isString(value['name']),
  startup: (value): boolean =>
    (value['discardUnsaved'] === undefined ||
      typeof value['discardUnsaved'] === 'boolean') &&
    ['profileName', 'provider', 'model', 'member'].every(
      (key) => value[key] === undefined || isString(value[key]),
    ),
  'confirm-discard': (value): boolean =>
    isPendingConfirmation(value['pending']),
} satisfies Record<
  ProfileCommandKind,
  (value: Record<string, unknown>) => boolean
>;

function isProfileCommandKind(value: unknown): value is ProfileCommandKind {
  return (
    isString(value) &&
    Object.prototype.hasOwnProperty.call(COMMAND_VALIDATORS, value)
  );
}

function isPendingConfirmation(value: unknown): value is PendingConfirmation {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isString(value['token']) &&
    isProfileCommandKind(value['commandKind']) &&
    isString(value['description'])
  );
}

/**
 * Structural type guard for a profile command.
 */
export function isProfileCommand(value: unknown): value is ProfileCommand {
  if (!isRecord(value)) {
    return false;
  }
  if (
    !isProfileCommandKind(value['kind']) ||
    typeof value['expectedRevision'] !== 'number'
  ) {
    return false;
  }
  return COMMAND_VALIDATORS[value['kind']](value);
}
