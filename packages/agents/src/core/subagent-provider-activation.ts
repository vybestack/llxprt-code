/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  RuntimeProviderManager,
  ProfileDefinitionReads,
} from '@vybestack/llxprt-code-core';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { Profile, SettingsService } from '@vybestack/llxprt-code-settings';
import { assembleModelSelection } from '../api/model-selection.js';
import { assembleProfileApplication } from '../api/profileApplicationAssembly.js';
import { executeProviderActivation } from '../api/providerActivationExecutor.js';
import { assembleProviderSwitch } from '../api/providerSwitchAssembly.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import { buildActivationCliOverrides } from './subagentProfileResolution.js';

export async function activateChildProvider(
  config: Config,
  settings: SettingsService,
  providerManager: RuntimeProviderManager,
  oauthManager: OAuthManager,
  settingsOwner: SessionSettingsOwner,
  readRuntimeKind: Parameters<typeof assembleProviderSwitch>[4],
  refreshAuth: SessionClientOwner['clients']['refreshAuth'],
  profileReads: Pick<ProfileDefinitionReads, 'loadProfile'>,
  profile: Profile,
  profileName: string,
  isLoadBalancerActivation: boolean,
): Promise<void> {
  const switchProvider = assembleProviderSwitch(
    config,
    settings,
    providerManager,
    oauthManager,
    readRuntimeKind,
    () => refreshAuth(),
    settingsOwner,
  );
  if (isLoadBalancerActivation) {
    await assembleProfileApplication(
      settings,
      providerManager,
      oauthManager,
      switchProvider,
      settingsOwner,
      profileReads,
    ).applySnapshot(profile, { profileName });
  } else {
    await executeProviderActivation(
      config,
      buildChildActivationIntent(profile),
      switchProvider,
      settings,
      providerManager,
      refreshAuth,
      assembleModelSelection(settingsOwner),
    );
  }
}

function buildChildActivationIntent(
  profile: Profile,
): Parameters<typeof executeProviderActivation>[1] {
  return {
    provider: profile.provider,
    model: profile.model,
    modelParams: profile.modelParams,
    // Carry the profile's credential/endpoint ephemerals into the
    // activation so the isolated provider talks to the RIGHT endpoint
    // with the RIGHT key. Without base-url, a profile like zai
    // (provider 'anthropic', base-url https://api.z.ai/api/anthropic)
    // would fall back to the provider default (api.anthropic.com) and
    // its z.ai key would never authenticate — the request stalls until
    // the 5-minute first-response timeout and the subagent returns an
    // empty result. auth-key-name/auth-keyfile are resolved the same
    // way the CLI bootstrap applies them (Issue #2410).
    cliOverrides: buildActivationCliOverrides(profile),
  };
}
