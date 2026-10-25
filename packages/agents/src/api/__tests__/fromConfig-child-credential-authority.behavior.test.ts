/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { withDisposalJoinFixture } from './helpers/async-child-disposal-join-fixture.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

function completionResponse(): Response {
  const chunks = [
    {
      id: 'child-completion',
      object: 'chat.completion.chunk',
      model: 'child-model',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'child completed' },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'child-completion',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    },
  ];
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') +
      'data: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

describe('child launched from an agent adopted through fromConfig', () => {
  const credentials = useOwnedCredentials();

  it('runs the child with the credential authority passed to fromConfig', async () => {
    await withDisposalJoinFixture(
      async (fixture) => {
        const task = fixture.agent.tools.get('task');
        if (!task) throw new Error('Public Agent has no task tool');
        const parentKeyStorages = credentials().keySnapshot().length;
        fixture.scriptChildRequests(async () => completionResponse());
        const result = await task
          .build({
            subagent_name: 'disposal-child',
            goal_prompt: 'Return the word completed.',
            async: false,
          })
          .execute(new AbortController().signal);
        expect(result.error).toBeUndefined();
        expect(String(result.llmContent)).toContain('child completed');
        expect(credentials().keySnapshot().length).toBe(parentKeyStorages + 1);
      },
      undefined,
      [],
      credentials().authority,
    );
  }, 30000);
});
