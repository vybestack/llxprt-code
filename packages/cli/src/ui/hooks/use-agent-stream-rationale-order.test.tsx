/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { ToolCallStatus } from '../types.js';
import { withJournalStreamHook } from './agentStream/__tests__/journal-stream-hook-fixture.js';

describe('journal-backed tool rationale ordering', () => {
  it('should flush pending text rationale before scheduling tool calls to ensure correct history order', async () => {
    await withJournalStreamHook(
      [
        [
          {
            speaker: 'ai',
            blocks: [
              { type: 'text', text: 'Rationale rationale.' },
              {
                type: 'tool_call',
                id: 'rationale-read',
                name: 'read_file',
                parameters: {
                  absolute_path: join(process.cwd(), 'package.json'),
                },
              },
            ],
          },
        ],
        [
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Finished reading.' }],
          },
        ],
      ],
      async ({ agent, submit, items }) => {
        expect(agent.tools.get('read_file')).toBeDefined();
        await submit('Read package.json after explaining why.');
        const transcript = await items();
        const rationaleIndex = transcript.findIndex(
          (item) =>
            item.type === 'gemini' && item.text === 'Rationale rationale.',
        );
        const toolGroupIndex = transcript.findIndex(
          (item) =>
            item.type === 'tool_group' &&
            item.tools.some((tool) => tool.callId === 'rationale-read'),
        );

        expect(rationaleIndex).toBeGreaterThan(-1);
        expect(toolGroupIndex).toBeGreaterThan(-1);
        expect(rationaleIndex).toBeLessThan(toolGroupIndex);
        const completed = transcript[toolGroupIndex];
        expect(
          completed.type === 'tool_group' &&
            completed.tools.map((tool) => tool.status),
        ).toStrictEqual([ToolCallStatus.Success]);
        expect(
          transcript
            .filter((item) => item.type === 'gemini')
            .map((item) => item.text),
        ).toStrictEqual(['Rationale rationale.', 'Finished reading.']);
      },
    );
  });
});
