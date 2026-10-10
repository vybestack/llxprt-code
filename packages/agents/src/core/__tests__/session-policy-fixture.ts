/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createProviderAdapterFromManager } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

interface SessionPolicyFixture {
  readonly settings: SettingsService;
  readonly owner: SessionSettingsOwner;
  readonly readRuntimeSettings: SessionSettingsOwner['readRuntimePolicy'];
  readonly readToolGovernance: () => ReturnType<
    SessionSettingsOwner['readToolGovernance']
  >;
  readonly readExecutionPolicy: SessionSettingsOwner['readToolExecutionPolicy'];
  readonly readLoopDetectionPolicy: SessionSettingsOwner['readLoopDetectionPolicy'];
  readonly readTaskPolicy: SessionSettingsOwner['readTaskPolicy'];
  readonly readSubagentRunPolicy: SessionSettingsOwner['readSubagentRunPolicy'];
  readonly prepareProviderInvocation: (
    provider: string,
    parameters?: AdmittedModelParameters,
    signal?: AbortSignal,
  ) => ReturnType<SessionSettingsOwner['prepareProviderInvocation']>;
}

let owners: readonly SessionSettingsOwner[] = [];
afterEach(async () => {
  const retiring = owners;
  owners = [];
  for (const owner of retiring) await owner.dispose();
});

export function createSessionPolicyFixture(
  settings: SettingsService = new SettingsService(),
  runtimeId: string = 'session-policy-fixture',
): SessionPolicyFixture {
  const owner = new SessionSettingsOwner(settings);
  owners = [...owners, owner];
  return {
    settings,
    owner,
    readRuntimeSettings: () => owner.readRuntimePolicy(),
    readToolGovernance: () => owner.readToolGovernance([]),
    readExecutionPolicy: () => owner.readToolExecutionPolicy(),
    readLoopDetectionPolicy: () => owner.readLoopDetectionPolicy(),
    readTaskPolicy: () => owner.readTaskPolicy(),
    readSubagentRunPolicy: () => owner.readSubagentRunPolicy(),
    prepareProviderInvocation: (
      provider: string,
      parameters?: AdmittedModelParameters,
      signal?: AbortSignal,
    ) =>
      owner.prepareProviderInvocation(runtimeId, provider, parameters, signal),
  };
}

export function createOwnerPolicyFixture(
  values: Readonly<Record<string, unknown>> = {},
): SessionPolicyFixture & {
  readonly runtime: ReturnType<typeof createAgentRuntimeContext>;
} {
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(values)) settings.set(key, value);
  const fixture = createSessionPolicyFixture(settings, 'owner-policy-fixture');
  const state = createAgentRuntimeState({
    runtimeId: 'owner-policy-fixture',
    provider: 'openai',
    model: 'gpt-4o',
    sessionId: 'owner-policy-fixture',
  });
  const runtime = createAgentRuntimeContext({
    state,
    history: new HistoryService(),
    settings: fixture.owner.readRuntimePolicy(),
    readRuntimeSettings: fixture.readRuntimeSettings,
    prepareProviderInvocation: fixture.prepareProviderInvocation,
    provider: createProviderAdapterFromManager(undefined),
    telemetry: {
      logApiRequest: () => {},
      logApiResponse: () => {},
      logApiError: () => {},
    },
    tools: { listToolNames: () => [], getToolMetadata: () => undefined },
    providerRuntime: createProviderRuntimeContext({
      settingsService: settings,
      runtimeId: state.runtimeId,
    }),
  });
  return { ...fixture, runtime };
}

export function createTurnStreamPolicy(
  values: Readonly<Record<string, unknown>> = {},
): () => ReturnType<
  SessionSettingsOwner['readRuntimePolicy']
>['streamTimeoutPolicy'] {
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(values)) settings.set(key, value);
  const fixture = createSessionPolicyFixture(settings);
  return () => fixture.owner.readRuntimePolicy().streamTimeoutPolicy;
}

export function createTurnCitationPolicy(): () => boolean {
  const fixture = createSessionPolicyFixture();
  return () => fixture.owner.readRuntimePolicy().showCitations === true;
}

export function createChatPolicyFixture(
  values: Readonly<Record<string, unknown>> = {},
): {
  getStreamTimeoutPolicy: () => ReturnType<
    SessionSettingsOwner['readRuntimePolicy']
  >['streamTimeoutPolicy'];
  shouldShowCitations: () => boolean;
  getResolvedBaseUrl: () => string | undefined;
} {
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(values)) settings.set(key, value);
  const fixture = createSessionPolicyFixture(settings);
  return {
    getStreamTimeoutPolicy: () =>
      fixture.owner.readRuntimePolicy().streamTimeoutPolicy,
    shouldShowCitations: () =>
      fixture.owner.readRuntimePolicy().showCitations === true,
    getResolvedBaseUrl: () => fixture.owner.readSelectedEndpoint(),
  };
}
