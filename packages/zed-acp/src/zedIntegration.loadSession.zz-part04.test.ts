/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import type { IContent } from '@vybestack/llxprt-code-core';
import { RecordingConnection } from './zed-test-helpers.js';
import {
  mockFromConfig,
  buildStubAgent,
  makeZedAgent,
} from './zedIntegration.loadSession.test-helpers.js';

describe('ZedAgent.loadSession orchestration (issue #1604)', () => {
  // FINDING F2: reset the module-level fromConfig mock before EVERY test so no
  // test inherits queued mockResolvedValueOnce implementations or accumulated
  // call counts from a prior test. Each test then establishes its OWN
  // resolved-value expectation (single mockResolvedValue or ordered
  // mockResolvedValueOnce chain), so the strict build-count / call-order
  // assertions are self-contained and order-independent. This replaces the
  // scattered inline mockFromConfig.mockReset() calls the individual tests used
  // to need.
  beforeEach(() => {
    mockFromConfig.mockReset();
  });

  it('streams the restored conversation as ordered session/update notifications and returns modes', async () => {
    const history: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'earlier question' }],
      },
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'recalling' },
          { type: 'text', text: 'earlier answer' },
          {
            type: 'tool_call',
            id: 'tc-1',
            name: 'read_file',
            parameters: { absolute_path: '/project/x.ts' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'tc-1',
            toolName: 'read_file',
            result: 'the file text',
          },
        ],
      },
    ];
    const stub = buildStubAgent({ resumeHistory: history });
    mockFromConfig.mockResolvedValue(stub.agent);

    const connection = new RecordingConnection();
    const zedAgent = await makeZedAgent(connection);

    const response = await zedAgent.loadSession({
      sessionId: 'session-abc',
      cwd: '/project',
      mcpServers: [],
    } as acp.LoadSessionRequest);

    // resume was called with the requested session id.
    expect(stub.resume).toHaveBeenCalledWith('session-abc');

    // The restored transcript was streamed in order BEFORE loadSession resolved.
    expect(connection.sessionUpdateKinds()).toStrictEqual([
      'user_message_chunk',
      'agent_thought_chunk',
      'agent_message_chunk',
      'tool_call',
      'tool_call_update',
    ]);

    // The response advertises the available modes + current mode.
    expect(response.modes?.currentModeId).toBe('default');
    expect(response.modes?.availableModes.map((m) => m.id)).toContain(
      'default',
    );
  });
});
