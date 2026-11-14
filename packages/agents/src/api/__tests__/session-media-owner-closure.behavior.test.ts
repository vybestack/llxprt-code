/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import {
  MediaReferenceBlock,
  isMediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { createAgent } from '../createAgent.js';
import type { Agent, AgentMessage } from '../agent.js';
import { collectAgentHistory } from './helpers/collect-agent-history.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { fromConfig } from '../fromConfig.js';
import type { AgentConfig } from '../config-types.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';

const SESSION_LABEL = 'identical-session-label';

interface SameLabelRoots {
  readonly workingDir: string;
  readonly projectTempDir: string;
  readonly firstStore: LocalMediaStore;
  readonly secondStore: LocalMediaStore;
}

async function readProjectMedia(
  workingDir: string,
): Promise<{ projectTempDir: string; quotaBytes: number }> {
  const probe = new Config(
    toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      sessionId: SESSION_LABEL,
      workingDir,
    }),
  );
  try {
    return {
      projectTempDir: probe.projectTempDir,
      quotaBytes: probe.getMediaStoreQuotaByteLimit(),
    };
  } finally {
    await probe.dispose();
  }
}

async function withSameLabelAgents(
  scenario: (
    first: Agent,
    second: Agent,
    roots: SameLabelRoots,
  ) => Promise<void>,
): Promise<void> {
  const workingDir = await realpath(
    await mkdtemp(join(tmpdir(), 'session-media-owner-')),
  );
  const { projectTempDir, quotaBytes } = await readProjectMedia(workingDir);
  const firstMedia = new SessionMediaOwner(projectTempDir, quotaBytes);
  const secondMedia = new SessionMediaOwner(projectTempDir, quotaBytes);
  const sameLabelConfig = (mediaOwner: SessionMediaOwner): AgentConfig => ({
    provider: 'fake',
    model: 'fake-model',
    credentialAuthority: new CredentialAuthority(),
    workingDir,
    sessionId: SESSION_LABEL,
    mediaOwner,
  });
  const first = await createAgent(sameLabelConfig(firstMedia));
  try {
    const second = await createAgent(sameLabelConfig(secondMedia));
    try {
      await scenario(first, second, {
        workingDir,
        projectTempDir,
        firstStore: firstMedia.store,
        secondStore: secondMedia.store,
      });
    } finally {
      await second.dispose();
    }
  } finally {
    try {
      await first.dispose();
    } finally {
      await rm(projectTempDir, { recursive: true, force: true });
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

function firstMedia(history: readonly AgentMessage[]): MediaReferenceBlock {
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
  useFakeResponsesReplay('multi-turn-text.jsonl');

  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  it('rejects an unpersisted sibling reference despite identical project and session labels', async () => {
    await withSameLabelAgents(async (first, second) => {
      await ingest(first, 'AQIDBA==');
      await ingest(second, 'BQYHCA==');
      const firstHistory = await collectAgentHistory(first);
      await expect(second.setHistory(firstHistory)).rejects.toThrow(/media/i);
      expect(firstMedia(await collectAgentHistory(second)).contentId).toBe(
        contentIdFor('BQYHCA=='),
      );
    });
  }, 30000);

  it('isolates physical roots, leases and purge for same-label public Agents', async () => {
    await withSameLabelAgents(async (first, second, roots) => {
      await ingest(first, 'AQIDBA==');
      await ingest(second, 'BQYHCA==');
      const firstStore = roots.firstStore;
      const secondStore = roots.secondStore;
      const reference = firstMedia(await collectAgentHistory(second));
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
    await withSameLabelAgents(async (first, second, roots) => {
      await ingest(first, 'AQIDBA==');
      await ingest(second, 'BQYHCA==');
      const store = roots.firstStore;
      const reference = firstMedia(await collectAgentHistory(first));
      await first.dispose();
      await expect(store.readVerified(reference)).rejects.toThrow(/closed/i);
      await second.setHistory(await collectAgentHistory(second));
    });
  }, 30000);

  it('keeps sibling media available after clearing the first Agent recording', async () => {
    await withSameLabelAgents(async (first, second) => {
      await ingest(first, 'AQIDBA==');
      await ingest(second, 'BQYHCA==');
      const retained = await collectAgentHistory(second);
      await first.session.setRecording({ enabled: true });
      await first.session.clearHistory();
      await first.dispose();
      await second.setHistory(retained);
      expect(firstMedia(await collectAgentHistory(second)).contentId).toBe(
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
      const resumedId = firstMedia(await collectAgentHistory(second)).contentId;
      const fork = await second.session.forkFromCheckpoint(
        checkpoint.checkpointId,
      );
      expect({
        resumedId,
        forkedId: firstMedia(await collectAgentHistory(second)).contentId,
        distinctFork: fork.id !== sessionId,
      }).toStrictEqual({
        resumedId: contentIdFor('AQIDBA=='),
        forkedId: contentIdFor('AQIDBA=='),
        distinctFork: true,
      });
    });
  }, 30000);

  it('preserves the caller Config, client and caller-owned media lifetime on adoption', async () => {
    const built = await buildCliStyleConfig('multi-turn-text.jsonl');
    const client = built.sessionClient.clients.getAgentClient();
    const workingDir = built.config.getWorkingDir();
    await client.startChat();
    const store = client.mediaStore;
    if (store === undefined) throw new Error('Missing caller media store');
    const agent = await fromConfig(
      built.config,
      built.settingsService,
      {},
      new CredentialAuthority(),
    );
    try {
      await ingest(agent, 'AQIDBA==');
      const history = await collectAgentHistory(agent);
      expect(firstMedia(history).contentId).toBe(contentIdFor('AQIDBA=='));
      expect(
        await readdir(join(built.config.projectTempDir, 'media-live')),
      ).toHaveLength(1);
      await agent.dispose();
      await client.setHistory([
        {
          speaker: 'human',
          blocks: [
            {
              type: 'media',
              encoding: 'base64',
              mimeType: 'image/png',
              data: 'AQIDBA==',
            },
          ],
        },
      ]);
      const callerHistory = [];
      for await (const row of client.getHistory()) callerHistory.push(row);
      expect(await store.readVerified(firstMedia(callerHistory))).toStrictEqual(
        new Uint8Array([1, 2, 3, 4]),
      );
      expect(built.sessionClient.clients.getAgentClient()).toBe(client);
      expect(built.config.getWorkingDir()).toBe(workingDir);
    } finally {
      await agent.dispose();
      await built.cleanup();
    }
  }, 30000);

  it('closes failed activation media without closing a same-label sibling', async () => {
    await withSameLabelAgents(async (first, second, roots) => {
      await ingest(first, 'AQIDBA==');
      await ingest(second, 'BQYHCA==');
      const failedOwner = new SessionMediaOwner(
        roots.projectTempDir,
        1024 * 1024,
      );
      const failedStore = failedOwner.store;
      const admitted = await failedStore.admit({
        bytes: new Uint8Array([9, 10, 11, 12]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      expect(await failedStore.readVerified(admitted)).toStrictEqual(
        new Uint8Array([9, 10, 11, 12]),
      );
      await expect(
        createAgent({
          provider: 'fake',
          model: 'fake-model',
          credentialAuthority: new CredentialAuthority(),
          workingDir: roots.workingDir,
          sessionId: SESSION_LABEL,
          mediaOwner: failedOwner,
          activation: {
            provider: 'unregistered-failure-provider',
            providerSwitchPolicy: 'strict',
          },
        }),
      ).rejects.toThrow('createAgent activation failed');
      await expect(failedStore.getStoredByteLength()).rejects.toThrow(
        /closed/i,
      );
      await expect(failedStore.readVerified(admitted)).rejects.toThrow(
        /closed/i,
      );
      await second.setHistory(await collectAgentHistory(second));
      expect(firstMedia(await collectAgentHistory(second)).byteLength).toBe(4);
    });
  }, 30000);
});
