/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import { beforeEach, afterEach, describe, expect, it } from 'bun:test';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { Profile, SettingsService } from '@vybestack/llxprt-code-settings';
import { assembleModelSelection } from '../../../agents/src/api/model-selection.js';
import { buildRuntimeProfileSnapshot } from '../../../agents/src/api/profileSnapshot.js';
import {
  setActiveModelParam,
  clearActiveModelParam,
} from '../../../agents/src/api/model-parameters.js';
import { setActiveModel } from '../../../agents/src/api/providerMutations.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import type { RouteBPreflight } from '../../../agents/src/api/__tests__/helpers/route-b-preflight.js';
import {
  createModelParamsStubProvider,
  openModelParamsRoot,
  type ModelParamsRoot,
} from './__tests__/model-params-route.js';

describe('Runtime model parameter isolation', () => {
  const credentials = useOwnedCredentials();
  let root: ModelParamsRoot;
  let settingsOwner: SessionSettingsOwner;
  let sessionRoot: Agent;
  let settingsService: SettingsService;
  let preflight: RouteBPreflight['preflight'];
  let switchProvider: ProviderSwitcher;

  beforeEach(async () => {
    const alpha = createModelParamsStubProvider('alpha');
    root = await openModelParamsRoot(
      credentials().authority,
      'model-params-isolation',
      'model-params-isolation-test',
      [
        alpha,
        createModelParamsStubProvider('beta'),
        createModelParamsStubProvider('gamma'),
      ],
    );
    settingsOwner = root.settingsOwner;
    settingsService = root.route.settings;
    preflight = root.route.preflight;
    switchProvider = root.switchProvider;
    sessionRoot = root.agent;

    await preflight.setActiveProvider('alpha');
    await setActiveModel(
      'alpha-model',
      assembleModelSelection(settingsOwner),
      settingsService,
      alpha,
    );
  });

  afterEach(async () => {
    await root.close();
  });

  it('keeps model parameters scoped to the active provider', async () => {
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({});

    setActiveModelParam(
      'temperature',
      0.8,
      settingsService,
      preflight.getActiveProviderName(),
    );
    setActiveModelParam(
      'max_tokens',
      2048,
      settingsService,
      preflight.getActiveProviderName(),
    );

    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({
      temperature: 0.8,
      max_tokens: 2048,
    });
    expect(settingsService.getProviderSettings('alpha').temperature).toBe(0.8);

    await switchProvider('beta', {});
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({});
    // Switching providers clears the previous provider's settings by design
    // (clearPreviousProviderSettings, PLAN-20260603-ISSUE1584.P14), so alpha no
    // longer retains its temperature.
    expect(
      settingsService.getProviderSettings('alpha').temperature,
    ).toBeUndefined();

    setActiveModelParam(
      'temperature',
      0.35,
      settingsService,
      preflight.getActiveProviderName(),
    );
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({
      temperature: 0.35,
    });

    await switchProvider('alpha', {});
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({});
    expect(
      settingsService.getProviderSettings('alpha').temperature,
    ).toBeUndefined();
    // beta's settings are cleared in turn when switching away from it.
    expect(
      settingsService.getProviderSettings('beta').temperature,
    ).toBeUndefined();
  });

  it('builds runtime profile snapshots with provider-scoped params', () => {
    setActiveModelParam(
      'top_p',
      0.91,
      settingsService,
      preflight.getActiveProviderName(),
    );
    setActiveModelParam(
      'response_format',
      { type: 'json_object' },
      settingsService,
      preflight.getActiveProviderName(),
    );

    const snapshot = buildRuntimeProfileSnapshot({
      providerName: preflight.getActiveProviderName() ?? '',
      modelName: sessionRoot.getModel(),
      providerSettings: settingsService.getProviderSettings(
        preflight.getActiveProviderName() ?? '',
      ),
      ephemeralSettings: sessionRoot.getEphemeralSettings(),
    });
    expect(snapshot.provider).toBe('alpha');
    expect(snapshot.model).toBe('alpha-model');
    expect(snapshot.modelParams).toStrictEqual({
      top_p: 0.91,
      response_format: { type: 'json_object' },
    });
  });

  it('applies profile snapshots and refreshes runtime state', async () => {
    const profile: Profile = {
      version: 1,
      provider: 'beta',
      model: 'beta-model',
      modelParams: {
        temperature: 0.55,
        top_p: 0.88,
      },
      ephemeralSettings: {
        'context-limit': 64000,
      },
    };

    await sessionRoot.profiles.applySnapshot(profile, {
      profileName: 'beta-profile',
    });

    expect(settingsService.get('activeProvider')).toBe('beta');
    expect(settingsOwner.readSelectedModel()).toBe('beta-model');
    expect(settingsService.getProviderSettings('beta').temperature).toBe(0.55);
    expect(settingsService.getProviderSettings('beta').top_p).toBe(0.88);
    expect(sessionRoot.getEphemeralSetting('context-limit')).toBe(64000);
  });

  it('clears individual model params via helper', () => {
    setActiveModelParam(
      'temperature',
      0.42,
      settingsService,
      preflight.getActiveProviderName(),
    );
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({
      temperature: 0.42,
    });

    clearActiveModelParam(
      'temperature',
      settingsService,
      preflight.getActiveProviderName(),
    );
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({});
  });
});
