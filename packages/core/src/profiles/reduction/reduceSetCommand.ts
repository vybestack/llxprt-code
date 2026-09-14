/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileCommand } from '../contracts/profileCommands.js';
import type { ProfileDocument } from '../contracts/profileDocument.js';
import type { ProfileReductionOutcome } from './reductionOutcome.js';
import { toDraftIdentity } from './reductionOutcome.js';
import type { ProfileReductionEnvironment } from './reductionEnvironment.js';
import type { ConfiguredProfile } from './reduceModelCommand.js';

type SetCommand = Extract<ProfileCommand, { kind: 'set' }>;

/**
 * Reduce a profile `/set` command for a configured profile.
 *
 * The patch applies only to `ephemeralSettings`. Every key the caller flags as
 * application-owned is invalid up front with `/settings` guidance; a patch that
 * changes no key is a no-op. Otherwise the candidate is the cloned document with the
 * patched settings, a draft identity derived from the current one, and the current
 * active member preserved for a load balancer.
 */
export function reduceSetCommand(
  state: ConfiguredProfile,
  command: SetCommand,
  env: ProfileReductionEnvironment,
): ProfileReductionOutcome {
  const ownedKeys: string[] = [];
  for (const key of Object.keys(command.patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return {
        kind: 'invalid',
        errors: [`unsafe setting key ${key}`],
        revision: state.revision,
      };
    }
    if (env.isApplicationOwnedKey(key)) {
      ownedKeys.push(key);
    }
  }
  if (ownedKeys.length > 0) {
    ownedKeys.sort();
    return {
      kind: 'invalid',
      errors: ownedKeys.map(
        (owned) =>
          `key ${owned} is application-owned; configure it via /settings`,
      ),
      revision: state.revision,
    };
  }
  const patchedSettings: Record<string, unknown> = {
    ...state.document.ephemeralSettings,
  };
  for (const [key, value] of Object.entries(command.patch)) {
    if (value === null) {
      delete patchedSettings[key];
    } else {
      patchedSettings[key] = value;
    }
  }
  const identical =
    Object.keys(patchedSettings).length ===
      Object.keys(state.document.ephemeralSettings).length &&
    Object.entries(patchedSettings).every(
      ([key, value]) => state.document.ephemeralSettings[key] === value,
    );
  if (identical) {
    return {
      kind: 'no-op',
      reason: 'patch changes nothing',
      revision: state.revision,
    };
  }
  const document: ProfileDocument = {
    ...state.document,
    ephemeralSettings: patchedSettings,
  };
  const activeMember =
    state.document.type === 'loadbalancer' ? state.activeMember : undefined;
  const identity = toDraftIdentity(state.identity);
  const candidate: ProfileReductionOutcome = {
    kind: 'candidate',
    document,
    identity,
    ...(activeMember === undefined ? {} : { activeMember }),
    baseRevision: state.revision,
    nextRevision: state.revision + 1,
  };
  return candidate;
}
