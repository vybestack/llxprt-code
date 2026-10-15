import { OwnedCredentialFixture } from './helpers/owned-credential-fixture.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
} from '../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../core/subagent-cleanup.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral regression test for Issue #2410 — Bug #2.
 *
 * Isolated-runtime (subagent) provider instances are built by
 * `registerProvidersOntoManager`. Before the fix, that function called
 * `createProviderManager(context, { config })` WITHOUT an `oauthSettings`
 * provider, so — per createProviderManager's contract — the resulting
 * OAuthManager ran without a settings surface and `isOAuthEnabled(provider)`
 * always returned false. OAuth-only providers (codex, claudecode) then reported
 * "auth required" even though the user's settings enabled them.
 *
 * This test drives the REAL production `registerProvidersOntoManager` against a
 * REAL isolated runtime context and a REAL on-disk settings file (via
 * LLXPRT_CONFIG_HOME). It asserts that the registered Claude Code alias exposes
 * its static OAuth model list, while the Anthropic API-key alias does not.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { registerProvidersOntoManager } from '../createAgent.js';

interface ModelLike {
  readonly id: string;
}

interface ProviderLike {
  getModels(): Promise<ModelLike[]>;
}

// Fable 5 is a sentinel for the Claude Code subscription catalog: it is not
// exposed by the Anthropic API-key alias's dynamic model listing.
const OAUTH_ONLY_MODEL_ID = 'claude-fable-5';

function formatCleanupError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function restoreConfigHome(previousConfigHome: string | undefined): void {
  if (previousConfigHome === undefined) {
    delete process.env.LLXPRT_CONFIG_HOME;
    return;
  }
  process.env.LLXPRT_CONFIG_HOME = previousConfigHome;
}

describe('registerProvidersOntoManager OAuth wiring (Issue #2410)', () => {
  let tmpConfigHome: string;
  let previousConfigHome: string | undefined;
  const retiring: Array<() => void | Promise<void>> = [];
  let credentials: OwnedCredentialFixture;

  beforeEach(async () => {
    tmpConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'issue2410-oauth-'));
    previousConfigHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = tmpConfigHome;
    credentials = await OwnedCredentialFixture.create();
  });

  afterEach(async () => {
    const cleanupErrors: unknown[] = [];
    try {
      try {
        await runCleanupSteps(retiring.splice(0).reverse());
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await credentials.dispose();
      } catch (error) {
        cleanupErrors.push(error);
      }
    } finally {
      restoreConfigHome(previousConfigHome);
      try {
        fs.rmSync(tmpConfigHome, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new Error(cleanupErrors.map(formatCleanupError).join('; '));
    }
  });

  function writeSettings(data: Record<string, unknown>): void {
    fs.writeFileSync(
      path.join(tmpConfigHome, 'settings.json'),
      JSON.stringify(data),
      'utf-8',
    );
  }

  async function registerAndGet(providerName: string): Promise<ProviderLike> {
    const runtimeId = `issue2410-oauth-${Math.random().toString(36).slice(2)}`;
    const config = new Config({
      sessionId: runtimeId,
      targetDir: tmpConfigHome,
      cwd: tmpConfigHome,
      model: 'claude-opus-4-8',
      debugMode: false,
    });
    retiring.push(() => config.dispose());
    const release = new AcquisitionRelease();
    let complete = false;
    retiring.push(() => (complete ? release.close() : release.rollback()));
    try {
      const settings = new SettingsService();
      for (const [key, value] of Object.entries(config.getInitialSettings()))
        settings.set(key, value);
      const owner = new SessionSettingsOwner(settings);
      release.acquire('settings', () => owner.dispose());
      owner.initializeProviderSelection(
        config.getProvider(),
        config.getModel(),
      );
      owner.bindTelemetry(config);
      const policy = new RuntimePolicyOwner(config);
      release.acquire('policy', () => policy.dispose());
      const files = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      release.acquire('files', () => releaseAdoptedFileScope(files, runtimeId));
      const manager = acquirePreferredProviderManager(
        config,
        settings,
        owner,
        files,
        runtimeId,
        credentials.authority,
        release,
      );
      const oauth = acquirePreferredOAuth(
        undefined,
        policy.session.messageBus,
        config,
        settings,
        manager,
        runtimeId,
        undefined,
        credentials.authority,
        release,
      );
      await owner.startTelemetry(config);
      registerProvidersOntoManager(manager, settings, config, oauth);
      const provider = manager.getProviderByName(providerName);
      complete = true;
      if (!provider) {
        throw new Error(`${providerName} was not registered onto the manager`);
      }
      return provider;
    } catch (primary) {
      return cleanupAfterFailure(primary, () =>
        runCleanupSteps(retiring.splice(0).reverse()),
      );
    }
  }

  it('registers the Claude Code alias with its subscription model catalog @issue:3531', async () => {
    writeSettings({ oauthEnabledProviders: { claudecode: true } });

    const claudecode = await registerAndGet('claudecode');
    const models = await claudecode.getModels();
    const ids = models.map((m) => m.id);

    expect(ids).toContain(OAUTH_ONLY_MODEL_ID);
    expect(ids).toContain('claude-fable-5-1');
  });

  it('keeps the Anthropic API-key alias separate from subscription models @issue:3531', async () => {
    writeSettings({ oauthEnabledProviders: { claudecode: true } });

    const anthropic = await registerAndGet('anthropic');
    const models = await anthropic.getModels();
    const ids = models.map((m) => m.id);

    expect(ids).not.toContain(OAUTH_ONLY_MODEL_ID);
    expect(ids).not.toContain('claude-fable-5-1');
  });
});
