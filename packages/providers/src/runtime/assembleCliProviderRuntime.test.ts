/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20270110-ISSUE2378.P04
 * @requirement:REQ-2378-004
 *
 * BEHAVIORAL tests for {@link assembleCliProviderRuntime} (#2378).
 *
 * The pre-Config CLI profile bootstrap used to construct the session
 * MessageBus itself (via core's `createSessionMessageBus`) and then thread it
 * into `createProviderManager` + `registerCliProviderInfrastructure`. That is
 * runtime assembly the providers package must OWN — the CLI is a client that
 * supplies declarative context, not a co-owner of the bus.
 *
 * `assembleCliProviderRuntime` owns the full ordered assembly:
 *   1. bind the CLI runtime identity (setCliRuntimeContext) FIRST (issue #2300)
 *   2. build the ONE session MessageBus internally (from the Config's policy
 *      engine, or a default when no Config exists yet)
 *   3. construct the ProviderManager + OAuthManager on that bus
 *   4. register the CLI provider infrastructure on the SAME bus
 *
 * These assertions observe the RESULTING STATE (the returned bus is a real
 * MessageBus, the OAuthManager is bound to that exact bus, the manager has the
 * standard providers registered) — not mock call counts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MessageBus,
  PolicyDecision,
  type PolicyEngineConfig,
} from '@vybestack/llxprt-code-core';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OAuthManager } from '../auth/index.js';
import { assembleCliProviderRuntime } from './assembleCliProviderRuntime.js';
import {
  resetCliProviderInfrastructure,
  resetCliRuntimeRegistryForTesting,
  resetDefaultCliRuntimeIdForTesting,
} from './runtimeSettings.js';

describe('assembleCliProviderRuntime @plan:PLAN-20270110-ISSUE2378.P04 @requirement:REQ-2378-004', () => {
  beforeEach(() => {
    resetCliProviderInfrastructure();
    resetCliRuntimeRegistryForTesting();
    resetDefaultCliRuntimeIdForTesting();
  });

  afterEach(() => {
    resetCliProviderInfrastructure();
    resetCliRuntimeRegistryForTesting();
    resetDefaultCliRuntimeIdForTesting();
  });

  it('owns session-bus construction internally and binds the OAuth manager to that exact bus', () => {
    const settingsService = new SettingsService();

    const result = assembleCliProviderRuntime({
      settingsService,
      config: undefined,
      runtimeId: 'assemble-test-no-config',
      metadata: { source: 'assemble-test' },
    });

    // The helper built a real session MessageBus (the CLI never constructed it).
    expect(result.runtimeMessageBus).toBeInstanceOf(MessageBus);
    // The OAuth manager the helper created is bound to the SAME bus it built —
    // the real signal that bus ownership lives inside the assembly, not the CLI.
    expect(
      (result.oauthManager as unknown as { runtimeMessageBus?: MessageBus })
        .runtimeMessageBus,
    ).toBe(result.runtimeMessageBus);
  });

  it('returns a provider manager registered with the standard providers', () => {
    const settingsService = new SettingsService();

    const result = assembleCliProviderRuntime({
      settingsService,
      config: undefined,
      runtimeId: 'assemble-test-providers',
      metadata: { source: 'assemble-test' },
    });

    const registered = result.providerManager.listProviders().sort();
    expect(registered).toStrictEqual(
      expect.arrayContaining(['anthropic', 'gemini', 'openai']),
    );
  });

  it('produces an OAuth manager the CLI can adopt without constructing one itself', () => {
    const settingsService = new SettingsService();

    const result = assembleCliProviderRuntime({
      settingsService,
      config: undefined,
      runtimeId: 'assemble-test-oauth',
      metadata: { source: 'assemble-test' },
    });

    // The helper constructs the OAuth manager as part of the owned assembly, so
    // the CLI never builds one. It is a real OAuthManager wired to the session
    // bus (bus binding asserted above), not a stub the caller must complete.
    expect(result.oauthManager).toBeInstanceOf(OAuthManager);
    expect(result.oauthManager?.getSupportedProviders().sort()).toStrictEqual(
      expect.arrayContaining(['anthropic']),
    );
  });
});

/**
 * @plan:PLAN-20270110-ISSUE2378.P04
 * @requirement:REQ-2378-004
 *
 * BEHAVIORAL coverage for the OAuth-settings carry-through the providers
 * package OWNS (#2378). The regression this pins: the post-Config CLI runtime
 * recomposition (`setupRuntimeContext` in postConfigRuntime.ts) re-invokes
 * `assembleCliProviderRuntime` to rebuild the ONE runtime on the final
 * Config-derived bus, but it does NOT thread an OAuth-settings adapter. If the
 * helper does not supply its own fallback, the recomposed OAuthManager has no
 * settings provider, so `isOAuthEnabled(<configured provider>)` collapses to
 * `false` and every configured OAuth provider is silently disabled on the
 * runtime the session actually adopts (same class of bug as Issue #2410 on the
 * isolated-runtime path).
 *
 * These tests drive the REAL file-backed provider via an on-disk settings file
 * (selected through `LLXPRT_CONFIG_HOME`, which `Storage.getGlobalSettingsPath`
 * honors) — no module mocking, no spies — and assert the resulting OAuth
 * enablement STATE, plus the OAuth bus identity/policy on a real Config.
 */
describe('assembleCliProviderRuntime OAuth-settings carry-through @plan:PLAN-20270110-ISSUE2378.P04 @requirement:REQ-2378-004', () => {
  let tmpConfigHome: string;
  let previousConfigHome: string | undefined;

  const writeUserSettings = (settings: Record<string, unknown>): void => {
    fs.writeFileSync(
      path.join(tmpConfigHome, 'settings.json'),
      JSON.stringify(settings),
      'utf-8',
    );
  };

  beforeEach(() => {
    resetCliProviderInfrastructure();
    resetCliRuntimeRegistryForTesting();
    resetDefaultCliRuntimeIdForTesting();
    previousConfigHome = process.env['LLXPRT_CONFIG_HOME'];
    tmpConfigHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'assemble-oauth-carry-'),
    );
    process.env['LLXPRT_CONFIG_HOME'] = tmpConfigHome;
  });

  afterEach(() => {
    resetCliProviderInfrastructure();
    resetCliRuntimeRegistryForTesting();
    resetDefaultCliRuntimeIdForTesting();
    if (previousConfigHome === undefined) {
      delete process.env['LLXPRT_CONFIG_HOME'];
    } else {
      process.env['LLXPRT_CONFIG_HOME'] = previousConfigHome;
    }
    fs.rmSync(tmpConfigHome, { recursive: true, force: true });
  });

  it('keeps a configured OAuth provider ENABLED on the post-Config recomposition even when the caller omits oauthSettings', () => {
    // A user who enabled anthropic OAuth in their global settings file.
    writeUserSettings({ oauthEnabledProviders: { anthropic: true } });

    const settingsService = new SettingsService();
    const config = new Config({
      targetDir: process.cwd(),
      settingsService,
    });

    // This mirrors postConfigRuntime.setupRuntimeContext EXACTLY: a Config now
    // exists and the CLI recomposes the runtime WITHOUT passing oauthSettings.
    const result = assembleCliProviderRuntime({
      settingsService,
      config,
      runtimeId: 'assemble-oauth-postconfig-enabled',
      metadata: { stage: 'post-config' },
    });

    // The adopted runtime's OAuth manager must honor the user's setting. Before
    // the providers-owned fallback this returned `false` (settings-less
    // manager), silently disabling the configured provider.
    expect(result.oauthManager?.isOAuthEnabled('anthropic')).toBe(true);
  });

  it('reports a NOT-configured provider as disabled through the same owned fallback', () => {
    writeUserSettings({ oauthEnabledProviders: { anthropic: true } });

    const settingsService = new SettingsService();
    const config = new Config({
      targetDir: process.cwd(),
      settingsService,
    });

    const result = assembleCliProviderRuntime({
      settingsService,
      config,
      runtimeId: 'assemble-oauth-postconfig-disabled',
      metadata: { stage: 'post-config' },
    });

    // Same manager, same file-backed provider: gemini was never enabled, so it
    // stays disabled. This proves enablement tracks the file, not a blanket
    // "everything enabled" default.
    expect(result.oauthManager?.isOAuthEnabled('gemini')).toBe(false);
  });

  it('honors an explicit null opt-out by producing a settings-less OAuth manager', () => {
    writeUserSettings({ oauthEnabledProviders: { anthropic: true } });

    const settingsService = new SettingsService();

    const result = assembleCliProviderRuntime({
      settingsService,
      config: undefined,
      runtimeId: 'assemble-oauth-null-optout',
      metadata: { stage: 'opt-out' },
      oauthSettings: null,
    });

    // Explicit null means "no settings provider" — enablement falls back to the
    // registry default (false) even though the file says anthropic is enabled.
    expect(result.oauthManager?.isOAuthEnabled('anthropic')).toBe(false);
  });

  it('binds the OAuth manager to the final Config-derived bus identity and policy', async () => {
    writeUserSettings({ oauthEnabledProviders: { anthropic: true } });

    // A real Config whose policy engine DENIES a specific tool. The recomposed
    // session bus must be built from THIS engine, so the deny rule is observable
    // through the returned bus — proving bus identity/policy, not just "a bus".
    const policyEngineConfig: PolicyEngineConfig = {
      rules: [
        {
          toolName: 'assemble-oauth-denied-tool',
          decision: PolicyDecision.DENY,
          priority: 100,
        },
      ],
    };
    const settingsService = new SettingsService();
    const config = new Config({
      targetDir: process.cwd(),
      settingsService,
      policyEngineConfig,
    });

    const result = assembleCliProviderRuntime({
      settingsService,
      config,
      runtimeId: 'assemble-oauth-bus-identity',
      metadata: { stage: 'post-config' },
    });

    // Identity: the OAuth manager is wired to the SAME bus the helper returned.
    expect(
      (result.oauthManager as unknown as { runtimeMessageBus?: MessageBus })
        .runtimeMessageBus,
    ).toBe(result.runtimeMessageBus);

    // Policy: the returned bus enforces the Config's engine (DENY → not
    // confirmed), so the bus really carries the final Config's policy.
    await expect(
      result.runtimeMessageBus.requestConfirmation(
        { name: 'assemble-oauth-denied-tool' },
        {},
      ),
    ).resolves.toBe(false);

    // And enablement is still honored on that same recomposed runtime.
    expect(result.oauthManager?.isOAuthEnabled('anthropic')).toBe(true);
  });
});
