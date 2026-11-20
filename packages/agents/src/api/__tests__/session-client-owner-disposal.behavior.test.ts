/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import {
  openClientOwner,
  type OpenedClientOwner,
} from './helpers/client-owner-session.js';
import { useConsumerPromptDirectory } from './helpers/consumer-owner-primitives.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

const MODEL_PROFILE = { model: 'fake-model', displayLabel: 'fake-model' };

class ObservedSettingsOwner extends SessionSettingsOwner {
  deliveredNotifications = 0;

  override subscribeModelChanges(
    listener: Parameters<SessionSettingsOwner['subscribeModelChanges']>[0],
  ): () => void {
    return super.subscribeModelChanges((profile) => {
      this.deliveredNotifications += 1;
      listener(profile);
    });
  }
}

describe('SessionClientOwner disposal', () => {
  useConsumerPromptDirectory();
  useFakeResponsesReplay('plain-text.jsonl');
  const credentials = useOwnedCredentials();

  async function withClientOwner(
    scenario: (
      opened: OpenedClientOwner,
      settingsOwner: ObservedSettingsOwner,
    ) => Promise<void>,
  ): Promise<void> {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'session-client-owner-disposal-')),
    );
    let settingsOwner: ObservedSettingsOwner | undefined;
    const opened = await openClientOwner(
      credentials().authority,
      {
        provider: 'fake',
        model: 'fake-model',
        workingDir: directory,
        interactive: true,
        harness: { includeProcessCwd: false },
      },
      { provider: 'fake', model: 'fake-model' },
      {
        createSettingsOwner: (settings) =>
          (settingsOwner = new ObservedSettingsOwner(settings)),
      },
    );
    try {
      if (settingsOwner === undefined) throw new Error('No settings owner');
      await scenario(opened, settingsOwner);
    } finally {
      await runCleanupSteps([
        () => opened.close(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  }

  it('a live client reacts to a model profile publication by dropping its chat', async () => {
    await withClientOwner(async (opened, settingsOwner) => {
      expect(opened.client.hasChatInitialized()).toBe(true);

      const delivered = settingsOwner.deliveredNotifications;
      settingsOwner.publishModelProfile(MODEL_PROFILE);

      expect(opened.client.hasChatInitialized()).toBe(false);
      expect(settingsOwner.deliveredNotifications - delivered).toBeGreaterThan(
        0,
      );
    });
  }, 30000);

  it('SessionClientOwner disposal tears down the client it built: the client no longer reacts to model profile publications', async () => {
    await withClientOwner(async (opened, settingsOwner) => {
      expect(opened.client.hasChatInitialized()).toBe(true);

      await opened.owner.dispose();
      expect(opened.client.hasChatInitialized()).toBe(false);
      const delivered = settingsOwner.deliveredNotifications;
      settingsOwner.publishModelProfile(MODEL_PROFILE);

      expect(settingsOwner.deliveredNotifications - delivered).toBe(0);
      expect(opened.client.hasChatInitialized()).toBe(false);
    });
  }, 30000);
});
