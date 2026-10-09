/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import { ZedAgent } from './zedIntegration.js';
import {
  connectPeer,
  type InputKind,
} from './acp-readable-stream-test-helpers.js';
import {
  buildBaseConfig,
  buildStubAgent,
  emptyChatsLister,
  mockFromConfig,
  modelMessage,
} from './zedIntegration.loadSession.test-helpers.js';

const kinds: InputKind[] = ['node', 'web'];
for (const kind of kinds) {
  describe(`${kind} readable live Zed session resume`, () => {
    it('reattaches a live session without replay and settles owned transport termination', async () => {
      const stub = buildStubAgent({
        liveHistory: [modelMessage('unrequested replay sentinel')],
      });
      mockFromConfig.mockReset();
      mockFromConfig.mockResolvedValue(stub.agent);
      const updates: acp.SessionUpdate[] = [];
      const agents: ZedAgent[] = [];
      const peer = connectPeer(
        kind,
        (connection) => {
          const agent = new ZedAgent(
            buildBaseConfig(),
            connection,
            emptyChatsLister,
          );
          agents.push(agent);
          return agent;
        },
        (update) => {
          updates.push(update);
        },
      );
      try {
        await peer.client.initialize({
          protocolVersion: 1,
          clientCapabilities: {},
        });
        const created = await peer.client.newSession({
          cwd: '/project',
          mcpServers: [],
        });
        const advertised = updates.length;
        const resumed = await peer.client.resumeSession({
          sessionId: created.sessionId,
          cwd: '/project',
          mcpServers: [],
        });
        expect(resumed.modes?.currentModeId).toBe('default');
        expect(
          updates.slice(advertised).map((update) => update.sessionUpdate),
        ).toStrictEqual(['available_commands_update']);
        expect(JSON.stringify(updates)).not.toContain(
          'unrequested replay sentinel',
        );
        peer.input.terminate();
        await peer.connection.closed;
        expect(peer.input.input.locked).toBe(false);
      } finally {
        await peer.finish();
        await Promise.all(agents.map((agent) => agent.disposeAll()));
      }
    });
  });
}
