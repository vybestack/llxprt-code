/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createProviderKeyStorage } from '../runtime/runtimeSettings.js';
import {
  isResolvedSubProfile,
  type LoadBalancerSubProfile,
  type ResolvedSubProfile,
} from './loadBalancerTypes.js';

interface AuthLogger {
  debug(messageFactory: () => string): void;
  warn(messageFactory: () => string): void;
}

export async function readMemberKeyfile(
  profileName: string,
  authKeyfile: string | undefined,
  logger: AuthLogger,
): Promise<string | undefined> {
  if (authKeyfile === undefined) return undefined;
  try {
    const keyfilePath = authKeyfile.startsWith('~')
      ? path.join(homedir(), authKeyfile.slice(1))
      : authKeyfile;
    const token = (await readFile(keyfilePath, 'utf-8')).trim();
    logger.debug(
      () => `Resolved authToken from keyfile for sub-profile ${profileName}`,
    );
    return token;
  } catch (error) {
    logger.warn(
      () =>
        `Failed to read auth-keyfile for sub-profile ${profileName}: ${error}`,
    );
    return undefined;
  }
}

export async function resolveMemberAuthentication(
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  logger: AuthLogger,
): Promise<ResolvedSubProfile | LoadBalancerSubProfile> {
  if (!isResolvedSubProfile(subProfile) || subProfile.auth?.type === 'oauth') {
    return subProfile;
  }
  const { authKeyName, name } = subProfile;
  if (authKeyName === undefined) {
    if (
      subProfile.authToken !== undefined ||
      subProfile.authKeyfile === undefined
    ) {
      return subProfile;
    }
    return {
      ...subProfile,
      authToken: await readMemberKeyfile(name, subProfile.authKeyfile, logger),
    };
  }
  try {
    const resolvedKey = await createProviderKeyStorage().getKey(authKeyName);
    if (typeof resolvedKey === 'string' && resolvedKey.trim() !== '') {
      logger.debug(
        () => `Resolved auth-key-name '${authKeyName}' for sub-profile ${name}`,
      );
      return { ...subProfile, authToken: resolvedKey.trim() };
    }
    logger.warn(
      () =>
        `Key '${authKeyName}' not found in secure storage for sub-profile ${name}; falling back.`,
    );
  } catch (error) {
    logger.warn(
      () =>
        `Failed to resolve auth-key-name '${authKeyName}' for sub-profile ${name}: ${error}`,
    );
  }
  return {
    ...subProfile,
    authToken: await readMemberKeyfile(name, subProfile.authKeyfile, logger),
  };
}
