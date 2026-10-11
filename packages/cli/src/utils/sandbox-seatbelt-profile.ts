/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { SETTINGS_DIRECTORY_NAME } from '../config/settings.js';

const BUILTIN_SEATBELT_PROFILES = [
  'permissive-open',
  'permissive-closed',
  'permissive-proxied',
  'restrictive-open',
  'restrictive-closed',
  'restrictive-proxied',
];
export function resolveSeatbeltProfile(): {
  profile: string;
  profileFile: string;
} {
  const explicitProfile = process.env.SEATBELT_PROFILE;
  const networkMode =
    process.env.LLXPRT_SANDBOX_NETWORK ?? process.env.SANDBOX_NETWORK;
  let automaticProfile = 'permissive-open';
  if (networkMode === 'off') {
    automaticProfile = 'permissive-closed';
  } else if (networkMode === 'proxied') {
    automaticProfile = 'permissive-proxied';
  }
  const profile =
    explicitProfile !== undefined && explicitProfile.length > 0
      ? explicitProfile
      : automaticProfile;
  process.env.SEATBELT_PROFILE = profile;
  if (
    (profile === 'permissive-proxied' || profile === 'restrictive-proxied') &&
    !process.env.LLXPRT_SANDBOX_PROXY_COMMAND?.trim()
  ) {
    throw new FatalSandboxError(
      'Seatbelt proxied profile requires a non-empty LLXPRT_SANDBOX_PROXY_COMMAND.',
    );
  }
  let profileFile = fileURLToPath(
    new URL(`./sandbox-macos-${profile}.sb`, import.meta.url),
  );
  if (!BUILTIN_SEATBELT_PROFILES.includes(profile)) {
    profileFile = path.join(
      SETTINGS_DIRECTORY_NAME,
      `sandbox-macos-${profile}.sb`,
    );
  }
  if (!fs.existsSync(profileFile)) {
    throw new FatalSandboxError(
      `Missing macos seatbelt profile file '${profileFile}'`,
    );
  }
  return { profile, profileFile };
}
