/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import type { MediaReferenceBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildAgent, internalConfig } from './helpers/agentHarness.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { isMediaReferenceBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import {
  LocalMediaStore,
  requireMediaStore,
} from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { createRuntimeActivationBindings } from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import { fromConfig } from '../fromConfig.js';
import type { Agent } from '../agent.js';

async function withSameLabelAgents(
  scenario: (first: Agent, second: Agent) => Promise<void>,
): Promise<void> {
  const workingDir = await mkdtemp(join(tmpdir(), 'session-media-owner-'));
  const first = await buildAgent('multi-turn-text.jsonl', {
    workingDir,
    sessionId: 'identical-session-label',
  });
  const projectTemp = internalConfig(first.agent).projectTempDir;
  try {
    const second = await buildAgent('multi-turn-text.jsonl', {
      workingDir,
      sessionId: 'identical-session-label',
    });
    try {
      await scenario(first.agent, second.agent);
    } finally {
      await second.cleanup();
    }
  } finally {
    try {
      await first.cleanup();
    } finally {
      await rm(projectTemp, { recursive: true, force: true });
      await rm(workingDir, { recursive: true, force: true });
    }
  }
}

async function ingest(agent: Agent, data: string): Promise<void> {
  await agent.setHistory([
    {
      speaker: 'human',
      blocks: [
        { type: 'media', encoding: 'base64', mimeType: 'image/png', data },
      ],
    },
  ]);
}

function firstMedia(
  history: Awaited<ReturnType<Agent['getHistory']>>,
): MediaReferenceBlock {
  const reference = history
    .flatMap((content) => content.blocks)
    .find(isMediaReferenceBlock);
  if (reference === undefined) throw new Error('Missing admitted media');
  return reference;
}

function contentIdFor(data: string): string {
  return `sha256:${createHash('sha256').update(data, 'base64').digest('hex')}`;
}

describe('public Agent session media ownership closure', () => {
  it('rejects an unpersisted sibling reference despite identical project and session labels', async () => {
    await withSameLabelAgents(async (first, second) => {
      await ingest(first, 'AQIDBA==');
      await ingest(second, 'BQYHCA==');
      const firstHistory = await first.getHistory();
      await expect(second.setHistory(firstHistory)).rejects.toThrow(/media/i);
      expect(firstMedia(await second.getHistory()).contentId).toBe(
        contentIdFor('BQYHCA=='),
      );
    });
  }, 30000);

  it('isolates physical roots, leases and purge for same-label public Agents', async () => {
    await withSameLabelAgents(async (first, second) => {
      await ingest(first, 'AQIDBA==');
      await ingest(second, 'BQYHCA==');
      const firstStore = requireMediaStore(first.agentClient);
      const secondStore = requireMediaStore(second.agentClient);
      const reference = firstMedia(await second.getHistory());
      await secondStore.reserve(reference, 'external-test-lease');
      await first.setHistory([]);
      await first.dispose();
      const probe = new LocalMediaStore({
        rootDirectory: firstStore.rootDirectory,
        quotaBytes: firstStore.quotaBytes,
      });
      try {
        await probe.reclaimUnreferenced(new Set(), Date.now());
        expect(await secondStore.readVerified(reference)).toStrictEqual(
          new Uint8Array([5, 6, 7, 8]),
        );
        await secondStore.release(reference.contentId, 'external-test-lease');
        await second.setHistory([]);
        expect(await secondStore.hasReservations(reference.contentId)).toBe(
          false,
        );
        const reclaimed = await secondStore.reclaimUnreferenced(
          new Set(),
          Date.now(),
        );
        expect(reclaimed.objectsRemoved).toBe(1);
        expect(firstStore.rootDirectory).not.toBe(secondStore.rootDirectory);
      } finally {
        await probe.close();
      }
    });
  }, 30000);

  it('closes an owned media store after disposing its public Agent', async () => {
    await withSameLabelAgents(async (first, second) => {
      await ingest(first, 'AQIDBA==');
      await ingest(second, 'BQYHCA==');
      const store = requireMediaStore(first.agentClient);
      const reference = firstMedia(await first.getHistory());
      await first.dispose();
      await expect(store.readVerified(reference)).rejects.toThrow(/closed/i);
      await second.setHistory(await second.getHistory());
    });
  }, 30000);

  it('keeps sibling media available after clearing the first Agent recording', async () => {
    await withSameLabelAgents(async (first, second) => {
      await ingest(first, 'AQIDBA==');
      await ingest(second, 'BQYHCA==');
      const retained = await second.getHistory();
      await first.session.setRecording({ enabled: true });
      await first.session.clearHistory();
      await first.dispose();
      await second.setHistory(retained);
      expect(firstMedia(await second.getHistory()).contentId).toBe(
        contentIdFor('BQYHCA=='),
      );
      await second.session.setRecording({ enabled: true });
      expect(
        (await second.session.createCheckpoint('surviving-media')).name,
      ).toBe('surviving-media');
    });
  }, 30000);

  it('restores ordinary durable JSONL media and forks a checkpoint into a fresh Agent owner', async () => {
    await withSameLabelAgents(async (first, second) => {
      await ingest(first, 'AQIDBA==');
      await first.session.setRecording({ enabled: true });
      const checkpoint = await first.session.createCheckpoint('durable-media');
      const sessions = await first.session.listSessions();
      const sessionId = sessions[0].id;
      await first.dispose();
      await second.session.resume(sessionId);
      const resumedId = firstMedia(await second.getHistory()).contentId;
      const fork = await second.session.forkFromCheckpoint(
        checkpoint.checkpointId,
      );
      expect({
        resumedId,
        forkedId: firstMedia(await second.getHistory()).contentId,
        distinctFork: fork.id !== sessionId,
      }).toStrictEqual({
        resumedId: contentIdFor('AQIDBA=='),
        forkedId: contentIdFor('AQIDBA=='),
        distinctFork: true,
      });
    });
  }, 30000);

  it('preserves the adopted Config, client and caller-owned media lifetime', async () => {
    const built = await buildCliStyleConfig('multi-turn-text.jsonl');
    await built.sessionClient.refreshAuth(undefined);
    const client = built.agentClient;
    await client.startChat();
    const store = requireMediaStore(built.agentClient);
    const agent = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      config: built.config,
      messageBus: built.messageBus,
      mcpRuntime: built.mcpRuntime,
    });
    try {
      expect({
        retainedConfig: internalConfig(agent) === built.config,
        retainedClient: built.agentClient === client,
      }).toStrictEqual({ retainedConfig: true, retainedClient: true });
      await ingest(agent, 'AQIDBA==');
      const history = await agent.getHistory();
      await agent.dispose();
      await client.setHistory(history);
      expect(await store.readVerified(firstMedia(history))).toStrictEqual(
        new Uint8Array([1, 2, 3, 4]),
      );
    } finally {
      await agent.dispose();
      await built.cleanup();
      await store.close();
    }
  }, 30000);

  it('closes failed activation media without closing a same-label sibling', async () => {
    await withSameLabelAgents(async (first, second) => {
      await ingest(first, 'AQIDBA==');
      await ingest(second, 'BQYHCA==');
      const real = createRuntimeActivationBindings();
      const failedOwner = new SessionMediaOwner(
        internalConfig(first).projectTempDir,
        1024 * 1024,
      );
      let failedStore: LocalMediaStore | undefined;
      await expect(
        buildAgent('multi-turn-text.jsonl', {
          workingDir: internalConfig(first).getWorkingDir(),
          sessionId: 'identical-session-label',
          mediaOwner: failedOwner,
          activation: {
            provider: 'unregistered-failure-provider',
            providerSwitchPolicy: 'strict',
          },
          runtimeActivationBindings: {
            ...real,
            registerInfrastructure: async (manager, oauth, options) => {
              await real.registerInfrastructure(manager, oauth, options);
              if (!options.config) throw new Error('Missing activation Config');
              failedStore = failedOwner.store;
              await failedStore.admit({
                bytes: new Uint8Array([9, 10, 11, 12]),
                mimeType: 'image/png',
                semanticMetadata: {},
              });
            },
          },
        }),
      ).rejects.toThrow('createAgent activation failed');
      if (failedStore === undefined) throw new Error('Missing failed owner');
      await expect(failedStore.getStoredByteLength()).rejects.toThrow(
        /closed/i,
      );
      await second.setHistory(await second.getHistory());
      expect(firstMedia(await second.getHistory()).byteLength).toBe(4);
    });
  }, 30000);
});
