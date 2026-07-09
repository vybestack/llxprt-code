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
 * always returned false. OAuth-only providers (codex, anthropic) then reported
 * "auth required" even though the user's settings enabled them.
 *
 * This test drives the REAL production `registerProvidersOntoManager` against a
 * REAL isolated runtime context and a REAL on-disk settings file (via
 * LLXPRT_CONFIG_HOME). It asserts the registered Anthropic provider recognizes
 * OAuth enablement, observed token-free through `getModels()`: when OAuth is
 * enabled the provider returns its curated OAuth model list (which uniquely
 * contains `claude-fable-5`); when disabled it returns the default list, which
 * does not.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createIsolatedRuntimeContext,
  type IsolatedRuntimeContextHandle,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { registerProvidersOntoManager } from '../createAgent.js';

interface ModelLike {
  readonly id: string;
}

interface ProviderLike {
  getModels(): Promise<ModelLike[]>;
}

/**
 * `claude-fable-5` appears ONLY in Anthropic's OAuth model list, never in the
 * default (non-OAuth) list. Its presence therefore proves the provider resolved
 * OAuth as enabled — i.e. its OAuthManager consulted a wired settings provider.
 */
const OAUTH_ONLY_MODEL_ID = 'claude-fable-5';

function formatCleanupError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function cleanupHandle(
  handle: IsolatedRuntimeContextHandle | undefined,
  cleanupErrors: unknown[],
): Promise<void> {
  if (!handle) {
    return;
  }
  try {
    await handle.cleanup();
  } catch (error) {
    cleanupErrors.push(error);
  }
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
  const handles: IsolatedRuntimeContextHandle[] = [];

  beforeEach(() => {
    tmpConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'issue2410-oauth-'));
    previousConfigHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = tmpConfigHome;
  });

  afterEach(async () => {
    const cleanupErrors: unknown[] = [];
    try {
      while (handles.length > 0) {
        await cleanupHandle(handles.pop(), cleanupErrors);
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

  async function registerAndGetAnthropic(): Promise<ProviderLike> {
    const handle = createIsolatedRuntimeContext({
      runtimeId: `issue2410-oauth-${Math.random().toString(36).slice(2)}`,
      model: 'claude-opus-4-8',
      metadata: { source: 'issue2410-test' },
    });
    handles.push(handle);
    await handle.activate();

    // The exact production seam under test.
    registerProvidersOntoManager(
      handle.providerManager,
      {
        settingsService: handle.settingsService,
        runtimeId: handle.runtimeId,
        metadata: handle.metadata,
      },
      handle.config,
    );

    const provider = handle.providerManager.getProviderByName('anthropic') as
      | ProviderLike
      | undefined;
    if (!provider) {
      throw new Error('Anthropic provider was not registered onto the manager');
    }
    return provider;
  }

  it('wires oauthSettings so an OAuth-enabled Anthropic provider resolves OAuth (returns the OAuth model list)', async () => {
    writeSettings({ oauthEnabledProviders: { anthropic: true } });

    const anthropic = await registerAndGetAnthropic();
    const models = await anthropic.getModels();
    const ids = models.map((m) => m.id);

    // OAuth was recognized as enabled: the curated OAuth model list is returned.
    expect(ids).toContain(OAUTH_ONLY_MODEL_ID);
  });

  it('does not surface the OAuth-only model when the provider is NOT OAuth-enabled', async () => {
    // A settings file that explicitly disables anthropic OAuth. With the fix,
    // the settings provider is still wired, but the provider correctly reports
    // OAuth disabled, so the OAuth-only model must NOT appear. This guards
    // against a false positive where getModels() always returns the OAuth list.
    writeSettings({ oauthEnabledProviders: { anthropic: false } });

    const anthropic = await registerAndGetAnthropic();
    const models = await anthropic.getModels();
    const ids = models.map((m) => m.id);

    expect(ids).not.toContain(OAUTH_ONLY_MODEL_ID);
  });
});
