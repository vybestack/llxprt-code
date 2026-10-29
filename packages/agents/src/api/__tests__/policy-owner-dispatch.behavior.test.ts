/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import { ApprovalMode, PolicyDecision } from '@vybestack/llxprt-code-policy';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';

async function turn(agent: Agent): Promise<void> {
  const errors: unknown[] = [];
  for await (const event of agent.stream('Perform the requested write.')) {
    if (event.type === 'error') errors.push(event);
  }
  expect(errors).toStrictEqual([]);
}

async function fixture(
  directory: string,
  prefix: string,
  grantFirst = false,
): Promise<Agent> {
  const responses = join(directory, `${prefix}.jsonl`);
  const grantLines = grantFirst
    ? [
        {
          chunks: [
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: `${prefix}-grant`,
                  name: 'write_file',
                  parameters: {
                    absolute_path: join(directory, 'granted.txt'),
                    content: 'written grant',
                  },
                },
              ],
            },
          ],
        },
        {
          chunks: [
            {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'Write complete.' }],
            },
          ],
        },
      ]
    : [];
  const lines = Array.from({ length: 5 }, (_, index) => [
    {
      chunks: [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: `${prefix}-${index}`,
              name: 'write_file',
              parameters: {
                absolute_path: join(directory, `${prefix}-${index}.txt`),
                content: `written ${index}`,
              },
            },
          ],
        },
      ],
    },
    ...(index === 0
      ? []
      : [
          {
            chunks: [
              {
                speaker: 'ai',
                blocks: [{ type: 'text', text: 'Write complete.' }],
              },
            ],
          },
        ]),
  ]).flat();
  await writeFile(
    responses,
    [...grantLines, ...lines].map((line) => JSON.stringify(line)).join('\n'),
  );
  process.env.LLXPRT_FAKE_RESPONSES = responses;
  return createAgent({
    provider: 'fake',
    model: 'fake-model',
    workingDir: directory,
    sessionId: 'same-label',
    interactive: true,
    harness: { forceConfirmations: false, includeProcessCwd: false },
    policy: {
      rules: [
        {
          toolName: 'write_file',
          decision: PolicyDecision.ALLOW,
          modes: [ApprovalMode.AUTO_EDIT],
          priority: 1,
        },
        {
          toolName: 'write_file',
          decision: PolicyDecision.DENY,
          argsPattern: /blocked/,
          priority: 3,
        },
      ],
    },
  });
}

describe('Policy ownership through public tool dispatch', () => {
  it('retains tool denial after a session grant and a privileged mode change', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'policy-denial-'));
    const previous = process.env.LLXPRT_FAKE_RESPONSES;
    let agent: Agent | undefined;
    try {
      const blocked = await fixture(directory, 'blocked', true);
      agent = blocked;
      let asks = 0;
      blocked.tools.onConfirmationRequest((request) => {
        asks++;
        queueMicrotask(() =>
          blocked.tools.respondToConfirmation(
            request.confirmationId,
            ToolConfirmationOutcome.ProceedAlways,
          ),
        );
      });
      await turn(blocked);
      expect(await readFile(join(directory, 'granted.txt'), 'utf8')).toBe(
        'written grant',
      );
      asks = 0;
      blocked.setApprovalMode(ApprovalMode.YOLO);
      await turn(blocked);
      expect(existsSync(join(directory, 'blocked-0.txt'))).toBe(false);
      expect(asks).toBe(0);
    } finally {
      await agent?.dispose();
      if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('writes only after session grants and mode decisions, without granting a same-label sibling', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'policy-dispatch-'));
    const previous = process.env.LLXPRT_FAKE_RESPONSES;
    const agents: Agent[] = [];
    try {
      const first = await fixture(directory, 'first');
      agents.push(first);
      const sibling = await fixture(directory, 'sibling');
      agents.push(sibling);
      let asks = 0;
      let outcome = ToolConfirmationOutcome.Cancel;
      first.tools.onConfirmationRequest((request) => {
        asks++;
        queueMicrotask(() =>
          first.tools.respondToConfirmation(request.confirmationId, outcome),
        );
      });
      await turn(first);
      expect(existsSync(join(directory, 'first-0.txt'))).toBe(false);
      first.setApprovalMode(ApprovalMode.AUTO_EDIT);
      await turn(first);
      expect(await readFile(join(directory, 'first-1.txt'), 'utf8')).toBe(
        'written 1',
      );
      first.setApprovalMode(ApprovalMode.DEFAULT);
      outcome = ToolConfirmationOutcome.ProceedAlways;
      await turn(first);
      await turn(first);
      expect(await readFile(join(directory, 'first-3.txt'), 'utf8')).toBe(
        'written 3',
      );
      expect(asks).toBe(2);
      sibling.tools.onConfirmationRequest((request) =>
        queueMicrotask(() =>
          sibling.tools.respondToConfirmation(
            request.confirmationId,
            ToolConfirmationOutcome.Cancel,
          ),
        ),
      );
      await turn(sibling);
      expect(existsSync(join(directory, 'sibling-0.txt'))).toBe(false);
      await first.dispose();
      sibling.setApprovalMode(ApprovalMode.AUTO_EDIT);
      await turn(sibling);
      expect(await readFile(join(directory, 'sibling-1.txt'), 'utf8')).toBe(
        'written 1',
      );
    } finally {
      for (const agent of agents) await agent.dispose();
      if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
