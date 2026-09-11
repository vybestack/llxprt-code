/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ActiveImageProfile,
  ImageProfileRuntimeState,
} from '@vybestack/llxprt-code-core';
import type {
  ImageProfile,
  Profile,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';

export class NoActiveImageProfileError extends Error {
  constructor() {
    super('No active image profile to save');
    this.name = 'NoActiveImageProfileError';
  }
}

export async function loadAndApplyProfileTransition<TResult>(
  manager: ProfileManager,
  imageProfileState: ImageProfileRuntimeState,
  profileName: string,
  applyProfile: (profile: Profile) => Promise<TResult>,
): Promise<TResult> {
  const profile = await manager.loadProfile(profileName);
  const imageProfileName =
    'imageProfile' in profile && typeof profile.imageProfile === 'string'
      ? profile.imageProfile
      : undefined;
  const imageProfile =
    imageProfileName === undefined
      ? undefined
      : await manager.loadImageProfile(imageProfileName);

  const result = await applyProfile(profile);
  if (imageProfileName === undefined || imageProfile === undefined) {
    imageProfileState.reset();
  } else {
    imageProfileState.select({ name: imageProfileName, profile: imageProfile });
  }
  return result;
}

export async function saveAndSelectImageProfile(
  manager: ProfileManager,
  imageProfileState: ImageProfileRuntimeState,
  profileName: string,
): Promise<ImageProfile> {
  const activeProfile = imageProfileState.getActive();
  if (activeProfile === undefined) {
    throw new NoActiveImageProfileError();
  }

  await manager.saveImageProfile(profileName, activeProfile.profile);
  imageProfileState.select({
    name: profileName,
    profile: activeProfile.profile,
  });
  return activeProfile.profile;
}

/** Load fully before replacing the runtime's image selection. */
export async function loadAndSelectImageProfile(
  manager: ProfileManager,
  state: ImageProfileRuntimeState,
  name: string,
): Promise<ActiveImageProfile> {
  const selection = { name, profile: await manager.loadImageProfile(name) };
  state.select(selection);
  return selection;
}
