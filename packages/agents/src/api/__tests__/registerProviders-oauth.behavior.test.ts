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

// Fable 5 is a sentinel for the Claude Code subscription catalog: it is not
// exposed by the Anthropic API-key alias's dynamic model listing.
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

  async function registerAndGet(providerName: string): Promise<ProviderLike> {
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

    const provider = handle.providerManager.getProviderByName(providerName) as
      | ProviderLike
      | undefined;
    if (!provider) {
      throw new Error(`${providerName} was not registered onto the manager`);
    }
    return provider;
  }

  it('registers the Claude Code alias with its subscription model catalog', async () => {
    writeSettings({ oauthEnabledProviders: { claudecode: true } });

    const claudecode = await registerAndGet('claudecode');
    const models = await claudecode.getModels();
    const ids = models.map((m) => m.id);

    expect(ids).toContain(OAUTH_ONLY_MODEL_ID);
  });

  it('keeps the Anthropic API-key alias separate from subscription models', async () => {
    writeSettings({ oauthEnabledProviders: { claudecode: true } });

    const anthropic = await registerAndGet('anthropic');
    const models = await anthropic.getModels();
    const ids = models.map((m) => m.id);

    expect(ids).not.toContain(OAUTH_ONLY_MODEL_ID);
  });
});
