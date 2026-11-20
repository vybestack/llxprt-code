/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { OwnedCredentialFixture } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import type * as acp from '@agentclientprotocol/sdk';
import {
  Config,
  getProjectHash,
  SessionDiscovery,
} from '@vybestack/llxprt-code-core';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { JournalHistoryStore } from '@vybestack/llxprt-code-core/services/history/journalHistoryStore.js';
import { journalFileRows } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { vi } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unusedProfileApplication } from '../../test-profile-application.js';
import type { ChatSessionFileLister } from '../../zed-session-loader.js';
import { ZedAgent } from '../../zedIntegration.js';
import { connectPeer } from './acp-readable-stream-test-helpers.js';

export async function nativeRows(
  path: string,
  limit = Infinity,
): Promise<{ count: number; digest: string }> {
  const hash = createHash('sha256');
  let count = 0;
  for await (const row of journalFileRows(path)) {
    hash.update(JSON.stringify(row));
    if (++count === limit) break;
  }
  return { count, digest: hash.digest('hex') };
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
  const credentials = await OwnedCredentialFixture.create();
  const settings = new SettingsService();
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
        () => new SettingsService({ sessionSource: settings }),
        listFiles,
        { listProfiles: async () => [] },
        undefined,
        { credentialAuthority: credentials.authority },
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
    credentialAuthority: credentials.authority,
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
        await config.dispose();
        await credentials.dispose();
        for (const key of ['LLXPRT_FAKE_RESPONSES', 'LLXPRT_LOG_HOME']) {
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

export function nativeFailureLeaves(error: unknown): unknown[] {
  if (error instanceof AggregateError)
    return error.errors.flatMap(nativeFailureLeaves);
  if (error instanceof Error) {
    if ('errors' in error && Array.isArray(error.errors))
      return error.errors.flatMap(nativeFailureLeaves);
    if (error.cause !== undefined) return nativeFailureLeaves(error.cause);
  }
  return [error];
}
