/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-core';

export type SandboxProfileEngine =
  | 'auto'
  | 'docker'
  | 'podman'
  | 'sandbox-exec'
  | 'none';

export type SandboxProfileNetwork = 'on' | 'off' | 'proxied';

export type SandboxProfileSshAgent = 'auto' | 'on' | 'off';

export interface SandboxProfileResources {
  cpus?: number;
  memory?: string;
  pids?: number;
}

export interface SandboxProfileMount {
  from: string;
  to?: string;
  mode?: 'ro' | 'rw';
}

export interface SandboxProfile {
  engine?: SandboxProfileEngine;
  image?: string;
  resources?: SandboxProfileResources;
  network?: SandboxProfileNetwork;
  sshAgent?: SandboxProfileSshAgent;
  mounts?: SandboxProfileMount[];
  env?: Record<string, string>;
}

export const SANDBOX_PROFILES_DIR_NAME = 'sandboxes';

export function getSandboxProfilesDir(): string {
  return path.join(Storage.getGlobalLlxprtDir(), SANDBOX_PROFILES_DIR_NAME);
}

export function getDefaultSandboxProfiles(
  image: string | undefined,
): Record<string, SandboxProfile> {
  // Only include image field if a valid image is provided
  const imageField = image ? { image } : {};
  return {
    dev: {
      engine: 'auto',
      ...imageField,
      resources: { cpus: 2, memory: '4g', pids: 256 },
      network: 'on',
      sshAgent: 'auto',
      mounts: [],
      env: {},
    },
    safe: {
      engine: 'auto',
      ...imageField,
      resources: { cpus: 2, memory: '4g', pids: 128 },
      network: 'off',
      sshAgent: 'off',
      mounts: [],
      env: {},
    },
    tight: {
      engine: 'auto',
      ...imageField,
      resources: { cpus: 1, memory: '2g', pids: 64 },
      network: 'off',
      sshAgent: 'off',
      mounts: [],
      env: {},
    },
    offline: {
      engine: 'auto',
      ...imageField,
      resources: { cpus: 2, memory: '4g', pids: 128 },
      network: 'off',
      sshAgent: 'off',
      mounts: [],
      env: {},
    },
  };
}

export async function ensureDefaultSandboxProfiles(
  image: string | undefined,
): Promise<void> {
  const profilesDir = getSandboxProfilesDir();
  await fs.mkdir(profilesDir, { recursive: true, mode: 0o755 });

  const defaults = getDefaultSandboxProfiles(image);

  await Promise.all(
    Object.entries(defaults).map(async ([name, profile]) => {
      const profilePath = path.join(profilesDir, `${name}.json`);
      const payload = JSON.stringify(profile, null, 2);

      try {
        await fs.writeFile(profilePath, `${payload}\n`, {
          mode: 0o644,
          flag: 'wx',
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
      }
    }),
  );
}

export async function loadSandboxProfile(
  profileName: string,
): Promise<SandboxProfile> {
  const profilesDir = getSandboxProfilesDir();
  const profilePath = path.join(profilesDir, `${profileName}.json`);
  const raw = await fs.readFile(profilePath, 'utf8');
  return JSON.parse(raw) as SandboxProfile;
}
