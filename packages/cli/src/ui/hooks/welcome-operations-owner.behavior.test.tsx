/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { createMockSettings, renderHook } from '../../__tests__/render.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';

let conflictingOwner: Agent;
const conflictingRuntime = {
  listProviders: () =>
    conflictingOwner.listProviders().map((provider) => provider.name),
  setActiveModel: (model: string) => conflictingOwner.setModel(model),
  providerStatus: () => ({ providerName: conflictingOwner.getProvider() }),
};
const selectedRuntimeMock1 = (() =>
  (() => {
    const useSelectedTestRuntime = () => conflictingRuntime;
    return {
      useListProviders: () => useSelectedTestRuntime().listProviders,

      useProviderStatus: () => useSelectedTestRuntime().providerStatus,

      useSetActiveModel: () => useSelectedTestRuntime().setActiveModel,

      useRuntimeApi: useSelectedTestRuntime,
    };
  })())();
void vi.mock('../contexts/RuntimeContext.js', () => selectedRuntimeMock1);
void vi.mock(
  '../../__tests__/runtime-context-fixture.js',
  () => selectedRuntimeMock1,
);
void vi.mock('../contexts/OAuthControlContext.js', () => ({
  useOAuthControl: () => ({ authenticate: async () => {} }),
}));
const { useWelcomeOnboarding } = await import('./useWelcomeOnboarding.js');

function ownerOptions(owner: Agent, decoy: Agent) {
  return {
    ...{ agent: decoy },
    settings: createMockSettings({}),
    isFolderTrustComplete: true,
    suppressStartup: true,
    listProviders: () => owner.listProviders().map((provider) => provider.name),
    listAvailableModels: () => owner.listAvailableModels(),
    setActiveModel: (model: string) => owner.setModel(model),
    readProviderStatus: () => ({ providerName: owner.getProvider() }),
    listSavedProfiles: async () =>
      owner.profiles.list().map((profile) => profile.name),
    saveProfileSnapshot: (name: string) => owner.saveProfileSnapshot(name),
    setDefaultProfileName: (name: string) => owner.setDefaultProfileName(name),
    loadProfileByName: (name: string) => owner.profiles.load(name),
    switchProviderAfterAuth: (provider: string) =>
      owner.setProvider(provider, undefined, { autoOAuth: false }),
    updateActiveProviderApiKey: async (key: string) => {
      await owner.auth.keys.setRaw(key);
      return { message: '', providerName: owner.getProvider() };
    },
    authenticate: async () => {},
  };
}

describe('welcome model ownership', () => {
  const makeOwner = useCommandOwners();
  it('selects on the captured owner and follows a mounted owner replacement after retirement', async () => {
    const owner = await makeOwner('welcome-owner');
    const sibling = await makeOwner('welcome-sibling');
    conflictingOwner = sibling;
    const options = ownerOptions(owner, sibling);
    const hook = renderHook(
      (props: typeof options) => useWelcomeOnboarding(props),
      { initialProps: options },
    );
    try {
      await act(async () => {
        await hook.result.current.actions.selectModel('welcome-selected');
      });
      expect(owner.getModel()).toBe('welcome-selected');
      expect(sibling.getModel()).toBe('welcome-sibling-initial');
      await owner.dispose();
      conflictingOwner = owner;
      hook.rerender(ownerOptions(sibling, owner));
      await act(async () => {
        await hook.result.current.actions.selectModel('sibling-selected');
      });
      expect(sibling.getModel()).toBe('sibling-selected');
      expect(hook.result.current.state.error).toBeUndefined();
    } finally {
      hook.unmount();
    }
  });
});
