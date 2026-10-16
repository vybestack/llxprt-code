/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createProfileSchemas } from './profileSchemas.js';
import {
  saveLoadBalancerProfile,
  saveModelProfile,
} from './profileLoadBalancer.js';
import type { ProfileCommandOperations } from './profileCommand.js';

export function bindProfileCommandOperations(
  listProfiles: ProfileCommandOperations['listProfiles'],
  readProvider: Parameters<typeof saveModelProfile>[1],
  listBuckets: Parameters<typeof saveModelProfile>[3],
  isFuzzyEnabled: () => boolean,
  saveSnapshot: Parameters<typeof saveModelProfile>[2],
  listSavedProfiles: Parameters<typeof saveLoadBalancerProfile>[1],
  readEphemerals: Parameters<typeof saveLoadBalancerProfile>[2],
  saveLoadBalancer: Parameters<typeof saveLoadBalancerProfile>[3],
  loadProfile: ProfileCommandOperations['loadProfile'],
  publishLoadedProfile: ProfileCommandOperations['publishLoadedProfile'],
  recordProviderSwitch: ProfileCommandOperations['recordProviderSwitch'],
  deleteProfile: ProfileCommandOperations['deleteProfile'],
  setDefaultProfileName: ProfileCommandOperations['setDefaultProfileName'],
): ProfileCommandOperations {
  return {
    schemas: createProfileSchemas(
      {
        listProfiles,
        getActiveProviderName: () => readProvider() ?? undefined,
        listBuckets,
      },
      isFuzzyEnabled,
    ),
    saveModelProfile: (parts) =>
      saveModelProfile(parts, readProvider, saveSnapshot, listBuckets),
    saveLoadBalancerProfile: (parts) =>
      saveLoadBalancerProfile(
        parts,
        listSavedProfiles,
        readEphemerals,
        saveLoadBalancer,
      ),
    loadProfile,
    publishLoadedProfile,
    recordProviderSwitch,
    deleteProfile,
    listProfiles,
    setDefaultProfileName,
  };
}
