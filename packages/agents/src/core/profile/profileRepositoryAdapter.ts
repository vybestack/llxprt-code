/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agents-side implementation of {@link ProfileRepositoryPort} backed by the
 * settings-owned {@link ProfileManager}.
 *
 * Documents are converted between the settings `Profile` shape and the implementation-
 * neutral core `ProfileDocument` contract field by field. The persisted file's stat
 * is the source fingerprint for optimistic-concurrency checks, and `delete` prefers the
 * manager's own delete path so load-balancer reference checks still apply.
 */

import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  writeProfileFile,
  type ProfileManager,
} from '@vybestack/llxprt-code-settings';
import {
  ProfileRepositoryConflictError,
  fingerprintsMatch,
  type ProfileAuthConfig,
  type ProfileDocument,
  type ProfileRepositoryPort,
  type SourceFingerprint,
} from '@vybestack/llxprt-code-core';
import type {
  AuthConfig,
  Profile,
  ModelParams,
} from '@vybestack/llxprt-code-settings';

/**
 * Convert a settings profile into a core profile document.
 *
 * Every nested record is copied so the returned document shares no mutable state with
 * the settings profile that produced it.
 */
export function toProfileDocument(profile: Profile): ProfileDocument {
  const modelParams: ModelParams = structuredClone(profile.modelParams);
  const ephemeralSettings: Record<string, unknown> = structuredClone({
    ...profile.ephemeralSettings,
  });
  if (profile.type === 'loadbalancer') {
    return {
      version: 1,
      type: 'loadbalancer',
      policy: profile.policy,
      profiles: [...profile.profiles],
      provider: profile.provider,
      model: profile.model,
      modelParams,
      ephemeralSettings,
      ...(profile.contextLimit !== undefined
        ? { contextLimit: profile.contextLimit }
        : {}),
    };
  }
  if (profile.auth !== undefined) {
    return {
      version: 1,
      provider: profile.provider,
      model: profile.model,
      modelParams,
      ephemeralSettings,
      auth: copyAuthConfig(profile.auth),
    };
  }
  return {
    version: 1,
    provider: profile.provider,
    model: profile.model,
    modelParams,
    ephemeralSettings,
  };
}

/**
 * Copy an auth config between the settings and core document shapes.
 *
 * The settings {@link AuthConfig} and core {@link ProfileAuthConfig} are
 * structurally compatible once narrowed, so a single copy serves both
 * conversion directions. The buckets array is always freshly allocated so the
 * result shares no state with its input.
 */
function copyAuthConfig(
  auth: AuthConfig | ProfileAuthConfig,
): { type: 'oauth'; buckets: string[] } | { type: 'apikey' } {
  if (auth.type === 'oauth') {
    return { type: 'oauth', buckets: auth.buckets ? [...auth.buckets] : [] };
  }
  return { type: 'apikey' };
}

/**
 * Convert a core profile document into a settings profile.
 */
export function toSettingsProfile(document: ProfileDocument): Profile {
  const modelParams: ModelParams = structuredClone(document.modelParams);
  const ephemeralSettings = structuredClone(document.ephemeralSettings);
  if (document.type === 'loadbalancer') {
    return {
      version: 1,
      type: 'loadbalancer',
      policy: document.policy,
      profiles: [...document.profiles],
      provider: document.provider,
      model: document.model,
      modelParams,
      ephemeralSettings,
      ...(document.contextLimit !== undefined
        ? { contextLimit: document.contextLimit }
        : {}),
    };
  }
  return {
    version: 1,
    provider: document.provider,
    model: document.model,
    modelParams,
    ephemeralSettings,
    auth:
      document.auth !== undefined ? copyAuthConfig(document.auth) : undefined,
  };
}

/**
 * Persistence boundary over a settings {@link ProfileManager}.
 *
 * The stat fingerprint is derived from the managed profiles directory (the same
 * directory the manager writes to), so optimistic-concurrency checks observe external
 * edits to the underlying file.
 */
export class ProfileManagerProfileRepository implements ProfileRepositoryPort {
  readonly profilesDir: string;
  private profileManager: ProfileManager;

  constructor(profileManager: ProfileManager, profilesDir: string) {
    this.profileManager = profileManager;
    this.profilesDir = profilesDir;
  }

  private validateName(name: string): void {
    if (
      ['', '.', '..'].includes(name.trim()) ||
      name.trim() !== name ||
      /[/\\\0]/u.test(name)
    ) {
      throw new RangeError(`Invalid profile name: ${JSON.stringify(name)}`);
    }
  }

  private filePath(name: string): string {
    this.validateName(name);
    return path.join(this.profilesDir, `${name}.json`);
  }

  private async statFingerprint(
    name: string,
  ): Promise<SourceFingerprint | null> {
    const filePath = this.filePath(name);
    try {
      const info = await fs.stat(filePath);
      return { kind: 'stat', mtimeMs: info.mtimeMs, size: info.size };
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['ENOENT', 'ENOTDIR'].includes(String(error.code))
      ) {
        return null;
      }
      throw error;
    }
  }

  async load(
    name: string,
  ): Promise<{ document: ProfileDocument; fingerprint: SourceFingerprint }> {
    this.validateName(name);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = await this.statFingerprint(name);
      if (before === null) {
        throw new Error(`Profile '${name}' not found`);
      }
      const profile = await this.profileManager.loadProfile(name);
      const fingerprint = await this.statFingerprint(name);
      if (fingerprint !== null && fingerprintsMatch(before, fingerprint)) {
        return { document: toProfileDocument(profile), fingerprint };
      }
    }
    throw new ProfileRepositoryConflictError(
      `Profile '${name}' changed while loading`,
    );
  }

  async save(
    name: string,
    document: ProfileDocument,
    expected?: SourceFingerprint,
    opts?: { mustCreate?: boolean },
  ): Promise<SourceFingerprint> {
    this.validateName(name);
    const profile = toSettingsProfile(document);
    if (profile.type === 'loadbalancer') {
      await this.profileManager.validateLoadBalancerProfile(name, profile);
    }
    if (opts?.mustCreate === true) {
      const created = await writeProfileFile(
        this.profilesDir,
        name,
        JSON.stringify(profile, null, 2),
        'create',
      );
      if (created.kind === 'exists') {
        throw new ProfileRepositoryConflictError(
          `Profile '${name}' already exists`,
        );
      }
    } else if (expected !== undefined) {
      if (
        expected.kind !== 'stat' ||
        !(await this.profileManager.saveProfileIfUnchanged(
          name,
          profile,
          expected,
        ))
      ) {
        throw new ProfileRepositoryConflictError(
          `Profile '${name}' changed on disk`,
        );
      }
    } else {
      await this.profileManager.saveProfile(name, profile);
    }
    const fingerprint = await this.statFingerprint(name);
    if (fingerprint === null) {
      throw new Error(`Profile '${name}' was not persisted`);
    }
    return fingerprint;
  }

  async list(): Promise<ReadonlyArray<{ name: string }>> {
    const names = await this.profileManager.listProfiles();
    return names.map((name) => {
      this.validateName(name);
      return { name };
    });
  }

  async delete(name: string): Promise<void> {
    this.validateName(name);
    await this.profileManager.deleteProfile(name);
  }

  async stat(name: string): Promise<SourceFingerprint | null> {
    return this.statFingerprint(name);
  }
}
