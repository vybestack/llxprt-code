/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  Config,
  getProjectHash,
  SessionDiscovery,
} from '@vybestack/llxprt-code-core';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { JournalHistoryStore } from '@vybestack/llxprt-code-core/services/history/journalHistoryStore.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ZedAgent } from '../../zedIntegration.js';
import { unusedProfileApplication } from '../../test-profile-application.js';
import { connectPeer } from './acp-readable-stream-test-helpers.js';
import type { ChatSessionFileLister } from '../../zed-session-loader.js';

export async function nativeRows(
  path: string,
  limit = Infinity,
): Promise<{ count: number; digest: string }> {
  const session = await JournalSession.open(path);
  const hash = createHash('sha256');
  let count = 0;
  try {
    for await (const row of session.rows()) {
      hash.update(JSON.stringify(row.content));
      if (++count === limit) break;
    }
    return { count, digest: hash.digest('hex') };
  } finally {
    await session.close();
  }
}

function sessionOperations(
  config: Config,
  root: string,
  peer: ReturnType<typeof connectPeer>,
) {
  return {
    async create(): Promise<string> {
      return (await peer.client.newSession({ cwd: root, mcpServers: [] }))
        .sessionId;
    },
    prompt(
      sessionId: string,
      text = 'Continue native history',
    ): Promise<acp.PromptResponse> {
      return peer.client.prompt({
        sessionId,
        prompt: [{ type: 'text', text }],
      });
    },
    load(sessionId: string): Promise<acp.LoadSessionResponse> {
      return peer.client.loadSession({ sessionId, cwd: root, mcpServers: [] });
    },
    async path(sessionId: string): Promise<string> {
      const found = (
        await SessionDiscovery.listSessions(
          config.projectChatsDir,
          getProjectHash(root),
        )
      ).find((entry) => entry.sessionId === sessionId);
      if (found === undefined) throw new Error('Missing native ACP recording');
      return found.filePath;
    },
    async locks(): Promise<string[]> {
      return (await readdir(config.projectChatsDir)).filter((file) =>
        file.endsWith('.lock'),
      );
    },
  };
}

async function fixtureConfig(): Promise<{ root: string; config: Config }> {
  const root = await mkdtemp(join(tmpdir(), 'w23-acp-fault-'));
  const fixture = join(root, 'responses.jsonl');
  await writeFile(
    fixture,
    Array.from({ length: 12 }, (_, index) =>
      JSON.stringify({
        chunks: [
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: `Native answer ${index}.` }],
          },
        ],
      }),
    ).join('\n') + '\n',
  );
  process.env.LLXPRT_HISTORY_BACKEND = 'journal';
  process.env.LLXPRT_FAKE_RESPONSES = fixture;
  process.env.LLXPRT_LOG_HOME = join(root, 'logs');
  const config = new Config({
    sessionId: 'native-acp-host',
    targetDir: root,
    cwd: root,
    provider: 'fake',
    model: 'fake-model',
    debugMode: false,
    trustedFolder: true,
    coreTools: [],
  });
  await mkdir(config.projectChatsDir, { recursive: true });
  return { root, config };
}

function observeRecordings() {
  const recordings: JournalRecordingService[] = [];
  const eager = vi
    .spyOn(JournalHistoryStore.prototype, 'materialize')
    .mockRejectedValue(
      new Error('Native ACP history materialization forbidden'),
    );
  const create = JournalRecordingService.createLocked;
  const open = JournalRecordingService.open;
  const createSpy = vi
    .spyOn(JournalRecordingService, 'createLocked')
    .mockImplementation(async (input) => {
      const recorder = await create(input);
      recordings.push(recorder);
      return recorder;
    });
  const openSpy = vi
    .spyOn(JournalRecordingService, 'open')
    .mockImplementation(async (input, path) => {
      const recorder = await open(input, path);
      recordings.push(recorder);
      return recorder;
    });
  return {
    recordings,
    restore(): void {
      createSpy.mockRestore();
      openSpy.mockRestore();
      eager.mockRestore();
    },
  };
}

export async function nativeAcpFixture(listFiles?: ChatSessionFileLister) {
  const saved = { ...process.env };
  const { root, config } = await fixtureConfig();
  const settings = new SettingsService();
  const manager = new ProviderManager({ config, settingsService: settings });
  const observed = observeRecordings();
  let zed: ZedAgent;
  let consume: (update: acp.SessionUpdate) => Promise<void> = async () => {};
  const updates: acp.SessionUpdate[] = [];
  const peer = connectPeer(
    'web',
    (connection) => {
      const send = connection.sessionUpdate.bind(connection);
      connection.sessionUpdate = async (params): Promise<void> => {
        await consume(params.update);
        await send(params);
      };
      zed = new ZedAgent(
        config,
        connection,
        unusedProfileApplication,
        manager,
        () => new SettingsService({ sessionSource: settings }),
        listFiles,
        { listProfiles: async () => [] },
      );
      return zed;
    },
    (update) => {
      updates.push(update);
    },
  );
  await peer.client.initialize({ protocolVersion: 1, clientCapabilities: {} });
  return {
    root,
    config,
    peer,
    recordings: observed.recordings,
    updates,
    ...sessionOperations(config, root, peer),
    get zed(): ZedAgent {
      return zed;
    },
    consume(callback: (update: acp.SessionUpdate) => Promise<void>): void {
      consume = callback;
    },
    async finish(): Promise<void> {
      consume = async () => {};
      try {
        await zed.disposeAll();
      } finally {
        observed.restore();
        await peer.finish();
        manager.dispose();
        await config.dispose();
        for (const key of [
          'LLXPRT_HISTORY_BACKEND',
          'LLXPRT_FAKE_RESPONSES',
          'LLXPRT_LOG_HOME',
        ]) {
          if (saved[key] === undefined) delete process.env[key];
          else process.env[key] = saved[key];
        }
      }
    },
  };
}

export function replayText(update: acp.SessionUpdate): boolean {
  return (
    update.sessionUpdate === 'user_message_chunk' ||
    update.sessionUpdate === 'agent_message_chunk'
  );
}
