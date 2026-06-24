/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P27
 * @requirement:REQ-021
 *
 * Durable profile persistence (REQ-021). Wraps the real `ProfileManager`
 * (`@vybestack/llxprt-code-settings`): `saveProfile`/`listProfiles`/
 * `deleteProfile` round-trip against `~/.llxprt/profiles` (or an explicit
 * directory). These are standalone — they do NOT require a live `Agent`.
 */

import { ProfileManager } from '@vybestack/llxprt-code-settings';
import type {
  SaveProfileInput,
  SaveProfileResult,
  ListProfilesInput,
  ListProfilesResult,
  DeleteProfileInput,
  DeleteProfileResult,
} from './types.js';

function createManager(profilesDir?: string): ProfileManager {
  return new ProfileManager(profilesDir);
}

/**
 * Persist a provided profile under a name. Durable config — not live state.
 */
export async function saveCurrentProfile(
  input: SaveProfileInput,
): Promise<SaveProfileResult> {
  const manager = createManager(input.profilesDir);
  await manager.saveProfile(input.name, input.profile);
  return { name: input.name, saved: true };
}

/**
 * List durable profile names.
 */
export async function listProfiles(
  input: ListProfilesInput = {},
): Promise<ListProfilesResult> {
  const manager = createManager(input.profilesDir);
  const profiles = await manager.listProfiles();
  return { profiles };
}

/**
 * Delete a durable profile.
 */
export async function deleteProfile(
  input: DeleteProfileInput,
): Promise<DeleteProfileResult> {
  const manager = createManager(input.profilesDir);
  await manager.deleteProfile(input.name);
  return { name: input.name, deleted: true };
}
