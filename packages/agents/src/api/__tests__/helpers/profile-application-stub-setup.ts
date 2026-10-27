/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stub surface for the profile-application rejection tests. The moved cases
 * assert that no provider mutation runs before `selectAvailableProvider`
 * rejects, so the mutation stubs exist to be inspected for calls rather than
 * to substitute production behavior.
 */

import { vi } from 'bun:test';
import type { Profile } from '@vybestack/llxprt-code-settings';

export const setActiveModelMock = vi.fn();
export const updateActiveProviderBaseUrlMock = vi.fn();
export const updateActiveProviderApiKeyMock = vi.fn();

export const keyStorageStub = {
  getKey: vi.fn<(name: string) => Promise<string | null>>(),
};

export function createProviderKeyStorage(): typeof keyStorageStub {
  return keyStorageStub;
}

export const providerManagerStub = {
  getProviderKeys: () => keyStorageStub,
  available: [] as string[],
  activeProviderName: 'openai',
  providerLookup: new Map<
    string,
    { name: string; getDefaultModel?: () => string }
  >(),
  listProviders() {
    return this.available.slice();
  },
  getProviderByName(name: string) {
    return this.providerLookup.get(name) ?? null;
  },
  getActiveProviderName() {
    return this.activeProviderName;
  },
  getActiveProvider() {
    return (
      this.getProviderByName(this.activeProviderName) ?? {
        name: this.activeProviderName,
        getDefaultModel: () => 'default-model',
      }
    );
  },
  registerProvider(provider: { name: string }) {
    this.providerLookup.set(provider.name, provider);
    if (!this.available.includes(provider.name)) {
      this.available.push(provider.name);
    }
  },
};

export const mockProfileManager = {
  loadProfile: vi.fn<(profileName: string) => Promise<Profile>>(),
};

const SHARED_STUBS = [
  setActiveModelMock,
  updateActiveProviderBaseUrlMock,
  updateActiveProviderApiKeyMock,
  keyStorageStub.getKey,
  mockProfileManager.loadProfile,
];

export function resetProfileApplicationStubs(): {
  savedGcpProject: string | undefined;
  savedGcpLocation: string | undefined;
} {
  const savedGcpProject = process.env.GOOGLE_CLOUD_PROJECT;
  const savedGcpLocation = process.env.GOOGLE_CLOUD_LOCATION;
  for (const stub of SHARED_STUBS) {
    stub.mockClear();
  }
  providerManagerStub.available = ['openai', 'anthropic'];
  providerManagerStub.activeProviderName = 'openai';
  providerManagerStub.providerLookup = new Map([
    ['openai', { name: 'openai' }],
    ['anthropic', { name: 'anthropic' }],
  ]);
  keyStorageStub.getKey.mockResolvedValue(null);
  return { savedGcpProject, savedGcpLocation };
}

export function restoreGcpEnvVars(
  savedGcpProject?: string,
  savedGcpLocation?: string,
): void {
  if (savedGcpProject === undefined) {
    delete process.env.GOOGLE_CLOUD_PROJECT;
  } else {
    process.env.GOOGLE_CLOUD_PROJECT = savedGcpProject;
  }

  if (savedGcpLocation === undefined) {
    delete process.env.GOOGLE_CLOUD_LOCATION;
  } else {
    process.env.GOOGLE_CLOUD_LOCATION = savedGcpLocation;
  }
}
