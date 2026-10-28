/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';
import type { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { createOwnerPolicyEvaluation } from '@vybestack/llxprt-code-core/policy/owner-policy-evaluation.js';
import { createSessionMessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type {
  ProviderManager,
  ProviderFileLifecycle,
} from '@vybestack/llxprt-code-providers';
import type {
  CredentialAuthority,
  OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  type ProviderContributionRegistry,
  populateProviderManager,
  NodeFileSystem,
  createPreflightOAuthProfileReads,
  createSessionAuthPolicyReader,
} from '@vybestack/llxprt-code-providers/composition.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  acquireProviderFiles,
  acquireRuntimeProviderManager,
  acquireRuntimeOAuth,
  readProviderAuthIdentity,
  retainOAuthSettings,
} from './provider-runtime-acquisition.js';
import {
  capturePreflightRuntimeContext,
  type AgentPreflightHostInput,
} from './preflight-host-input.js';

export interface PreflightResources {
  readonly release: AcquisitionRelease;
  readonly decisions: ReturnType<typeof createOwnerPolicyEvaluation>;
  readonly bus: ReturnType<typeof createSessionMessageBus>;
  readonly files: ProviderFileLifecycle;
  readonly profileReads: ReturnType<typeof createPreflightOAuthProfileReads>;
}

export interface PreflightProviders {
  readonly manager: ProviderManager;
  readonly oauth: OAuthManager;
}

export function acquirePreflightResources(
  release: AcquisitionRelease,
  host: AgentPreflightHostInput,
): PreflightResources {
  const decisions = createOwnerPolicyEvaluation();
  const bus = createSessionMessageBus(decisions);
  release.acquire('bus', () => bus.cancelPendingConfirmations());
  const files = acquireProviderFiles(release, {
    proxy: host.proxy,
    scopeIds: [host.runtimeId],
  });
  return {
    release,
    decisions,
    bus,
    files,
    profileReads: createPreflightOAuthProfileReads(),
  };
}

export function acquirePreflightProviders(
  resources: PreflightResources,
  inputs: {
    readonly host: AgentPreflightHostInput;
    readonly settings: SettingsService;
    readonly authority: CredentialAuthority;
    readonly contributions: ProviderContributionRegistry | undefined;
    readonly oauthSettings: IOAuthSettingsProvider | undefined;
    readonly fakeResponses: string | undefined;
  },
): PreflightProviders {
  const {
    host,
    settings,
    authority,
    contributions,
    oauthSettings,
    fakeResponses,
  } = inputs;
  const manager = acquireRuntimeProviderManager(resources.release, {
    files: resources.files,
    proxy: host.proxy,
    settings,
    config: undefined,
    settingsOwner: undefined,
    context: capturePreflightRuntimeContext(host, 'pre-config'),
    authority,
  });
  const oauth = acquireRuntimeOAuth(resources.release, {
    provider: manager,
    readPolicy: createSessionAuthPolicyReader(settings),
    authority,
    oauth: {
      suppliedStore: undefined,
      readSettings: retainOAuthSettings(oauthSettings),
      messageBus: resources.bus,
      profileReads: resources.profileReads,
      readIdentity: readProviderAuthIdentity,
      requestInteractiveAuth: undefined,
    },
  });
  populateProviderManager({
    manager,
    oauthManager: oauth,
    tokenStore: oauth.getTokenStore(),
    settings,
    fileSystem: new NodeFileSystem(),
    configuration: { kind: 'pre-config' },
    contributions:
      contributions === undefined
        ? { kind: 'none' }
        : { kind: 'supplied', registry: contributions },
    messages: { kind: 'none' },
    allowBrowser: false,
    activateConfiguredProvider: true,
    fakeResponses:
      fakeResponses === undefined
        ? { kind: 'disabled' }
        : { kind: 'replay', path: fakeResponses },
  });
  return { manager, oauth };
}
