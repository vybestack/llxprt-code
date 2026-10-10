/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { MemoryTokenStore } from '../../../../agents/src/api/__tests__/helpers/provider-auth-fixtures.js';
import { buildCliStyleConfig } from '../../../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import { fixturesDir } from '../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { runNonInteractive } from '../../nonInteractiveCli.js';
import { LoadedSettings } from '../../config/settings.js';

class FailingOAuthRelease extends OAuthManager {
  override async dispose(): Promise<void> {
    throw new Error('oauth cleanup failed');
  }
}

class FailingLocalProvider extends FakeProvider {
  override async *generateChatCompletion(): AsyncIterableIterator<IContent> {
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'accepted before primary failure' }],
    };
    throw new Error('local provider primary failure');
  }
}

export function cleanupLeaves(error: unknown): string[] {
  if (
    error instanceof Error &&
    'errors' in error &&
    Array.isArray(error.errors)
  ) {
    return error.errors.flatMap((nested: unknown) => cleanupLeaves(nested));
  }
  return [String(error)];
}

export async function runCleanupFailure(primary: boolean): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'public-cli-cleanup-'));
  const outfile = join(directory, 'caller-root.jsonl');
  const cli = await buildCliStyleConfig('plain-text.jsonl', {
    sessionId: 'public-cli-cleanup',
    model: 'fake-model',
    tools: [],
    coreTools: [],
    mcpEnabled: false,
    extensionsEnabled: false,
    interactive: false,
    harness: {
      forceInteractive: false,
      forceConfirmations: false,
      includeProcessCwd: false,
    },
    telemetry: { enabled: true, outfile, logPrompts: false },
  });
  const settingFile = { path: join(directory, 'settings.json'), settings: {} };
  const settings = new LoadedSettings(
    settingFile,
    settingFile,
    settingFile,
    settingFile,
    true,
  );
  if (primary) {
    cli.providerManager.registerProvider(
      new FailingLocalProvider(
        join(fixturesDir, 'plain-text.jsonl'),
        directory,
      ),
    );
    await cli.providerManager.setActiveProvider('fake');
    unlinkSync(outfile);
    mkdirSync(outfile);
  }
  const directPolicy = new RuntimePolicyOwner(cli.config);
  let failure: unknown;
  try {
    await runNonInteractive({
      config: cli.config,
      settings,
      input: 'exercise public CLI cleanup',
      prompt_id: 'cleanup-proof',
      providerManager: cli.providerManager,
      runtimeSettings: { owner: cli.settingsOwner, store: cli.settingsService },
      runtimeMessageBus: directPolicy.session.messageBus,
      policyOwner: directPolicy,
      oauthManager: new FailingOAuthRelease(new MemoryTokenStore()),
    });
  } catch (error) {
    failure = error;
  }
  try {
    if (primary) rmSync(outfile, { recursive: true });
    cli.settingsOwner.telemetry.events.record(() => ({
      body: 'caller root survives facade release',
    }));
    await cli.settingsOwner.telemetry.flush();
    if (
      !readFileSync(outfile, 'utf8').includes(
        'caller root survives facade release',
      )
    )
      throw new Error(
        'Caller-owned telemetry retired during direct Agent disposal',
      );
  } finally {
    await cli.cleanup();
    rmSync(directory, { recursive: true, force: true });
  }
  if (failure !== undefined) throw failure;
}

if (import.meta.main) {
  try {
    await runCleanupFailure(true);
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(cleanupLeaves(error).join('\n') + '\n');
    process.exitCode = 1;
  }
}
