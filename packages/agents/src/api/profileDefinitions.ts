/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ProfileDefinitionReads,
  ProfileDefinitionWrites,
} from '@vybestack/llxprt-code-core';
import type {
  LoadBalancerProfile,
  Profile,
} from '@vybestack/llxprt-code-settings';
import { getProfileByName } from './profileSnapshot.js';

export interface AgentProfileDefinitions {
  listSavedProfiles(): Promise<string[]>;
  getProfileByName(name: string): Promise<Profile>;
  saveProfileDefinition(name: string, profile: unknown): Promise<void>;
  saveLoadBalancerProfile(
    name: string,
    profile: LoadBalancerProfile,
  ): Promise<void>;
}

export function assembleProfileDefinitions(
  reads: Pick<ProfileDefinitionReads, 'listProfiles' | 'loadProfile'>,
  writes: Pick<ProfileDefinitionWrites, 'saveProfile'>,
): AgentProfileDefinitions {
  return {
    listSavedProfiles: () => reads.listProfiles(),
    getProfileByName: (name) => getProfileByName(name, reads),
    saveProfileDefinition: (name, profile) =>
      writes.saveProfile(name, structuredClone(profile)),
    saveLoadBalancerProfile: (name, profile) =>
      writes.saveProfile(name, structuredClone(profile)),
  };
}
