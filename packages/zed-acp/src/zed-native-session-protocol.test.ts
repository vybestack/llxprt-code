/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  Config,
  getProjectHash,
  SessionDiscovery,
} from '@vybestack/llxprt-code-core';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ZedAgent } from './zedIntegration.js';
import { unusedProfileApplication } from './test-profile-application.js';
import { connectPeer } from './__tests__/support/acp-readable-stream-test-helpers.js';

async function transcript(
  path: string,
  limit = Number.POSITIVE_INFINITY,
): Promise<{ count: number; digest: string; toolResult: boolean }> {
  const session = await JournalSession.open(path);
  const hash = createHash('sha256');
  let count = 0;
  let toolResult = false;
  try {
    for await (const row of session.rows()) {
      count++;
      hash.update(JSON.stringify(row.content));
      toolResult ||=
        row.content.speaker === 'tool' &&
        JSON.stringify(row.content).includes('native ACP file evidence');
      if (count === limit) break;
    }
    return { count, digest: hash.digest('hex'), toolResult };
  } finally {
    await session.close();
  }
}

describe('native ACP session protocol', () => {
  it('records a real tool turn, closes, loads over ACP, and continues without duplicating durable rows', async () => {
    const saved = { ...process.env };
    const root = await mkdtemp(join(tmpdir(), 'w23-zed-native-protocol-'));
    const fixture = join(root, 'turns.jsonl');
    await writeFile(join(root, 'input.txt'), 'native ACP file evidence');
    await writeFile(
      fixture,
      [
        {
          chunks: [
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'native-read',
                  name: 'read_file',
                  parameters: { absolute_path: join(root, 'input.txt') },
                },
              ],
            },
          ],
        },
        {
          chunks: [
            {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'Read completed.' }],
            },
          ],
        },
        {
          chunks: [
            {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'Continuation completed.' }],
            },
          ],
        },
      ]
        .map((value) => JSON.stringify(value))
        .join('\n') + '\n',
    );
    process.env.LLXPRT_HISTORY_BACKEND = 'journal';
    process.env.LLXPRT_FAKE_RESPONSES = fixture;
    process.env.LLXPRT_LOG_HOME = join(root, 'logs');
    const config = new Config({
      sessionId: 'acp-host',
      targetDir: root,
      cwd: root,
      provider: 'fake',
      model: 'fake-model',
      debugMode: false,
      trustedFolder: true,
      coreTools: ['read_file'],
    });
    const settings = new SettingsService();
    const manager = new ProviderManager({ config, settingsService: settings });
    let completedTool = false;
    let replayedHumans = 0;
    let replayedTools = 0;
    let zed: ZedAgent | undefined;
    const peer = connectPeer(
      'web',
      (connection) => {
        zed = new ZedAgent(
          config,
          connection,
          unusedProfileApplication,
          manager,
          () => new SettingsService({ sessionSource: settings }),
          undefined,
          { listProfiles: async () => [] },
        );
        return zed;
      },
      (update) => {
        completedTool ||=
          update.sessionUpdate === 'tool_call_update' &&
          update.status === 'completed';
        replayedHumans += Number(update.sessionUpdate === 'user_message_chunk');
        replayedTools += Number(update.sessionUpdate === 'tool_call');
      },
    );
    try {
      await peer.client.initialize({
        protocolVersion: 1,
        clientCapabilities: {},
      });
      const created = await peer.client.newSession({
        cwd: root,
        mcpServers: [],
      });
      expect(
        await peer.client.prompt({
          sessionId: created.sessionId,
          prompt: [{ type: 'text', text: 'Read input.txt' }],
        }),
      ).toMatchObject({ stopReason: 'end_turn' });
      expect(completedTool).toBe(true);
      await peer.client.closeSession({ sessionId: created.sessionId });
      const listed = await peer.client.listSessions({ cwd: root });
      expect(listed.sessions.map((session) => session.sessionId)).toContain(
        created.sessionId,
      );
      const recordings = await SessionDiscovery.listSessions(
        config.projectChatsDir,
        getProjectHash(root),
      );
      const recorded = recordings.find(
        (session) => session.sessionId === created.sessionId,
      );
      if (recorded === undefined)
        throw new Error('Missing native ACP recording');
      const before = await transcript(recorded.filePath);
      expect({
        count: before.count,
        toolResult: before.toolResult,
      }).toStrictEqual({ count: 4, toolResult: true });
      expect(
        (await readdir(config.projectChatsDir)).filter((file) =>
          file.endsWith('.lock'),
        ),
      ).toStrictEqual([]);
      replayedHumans = 0;
      replayedTools = 0;
      await peer.client.loadSession({
        sessionId: created.sessionId,
        cwd: root,
        mcpServers: [],
      });
      expect({ humans: replayedHumans, tools: replayedTools }).toStrictEqual({
        humans: 1,
        tools: 1,
      });
      expect(await transcript(recorded.filePath)).toStrictEqual({ ...before });
      expect(
        (await readdir(config.projectChatsDir)).filter((file) =>
          file.endsWith('.lock'),
        ),
      ).toHaveLength(1);
      await expect(
        peer.client.resumeSession({
          sessionId: created.sessionId,
          cwd: join(root, 'foreign'),
          mcpServers: [],
        }),
      ).rejects.toMatchObject({ code: -32002 });
      expect(
        await peer.client.prompt({
          sessionId: created.sessionId,
          prompt: [{ type: 'text', text: 'Continue reading' }],
        }),
      ).toMatchObject({ stopReason: 'end_turn' });
      await peer.client.closeSession({ sessionId: created.sessionId });
      expect((await transcript(recorded.filePath)).count).toBe(8);
      expect(await transcript(recorded.filePath, 4)).toStrictEqual({
        ...before,
      });
      expect(
        (await readdir(config.projectChatsDir)).filter((file) =>
          file.endsWith('.lock'),
        ),
      ).toStrictEqual([]);
    } finally {
      await zed?.disposeAll();
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
  }, 30000);
});
