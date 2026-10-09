/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeBodyFile } from '../lib/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { accountingRow } from '../../packages/core/src/services/history/token-accounting-stream-test-helpers.js';
import { withAgentCarry } from '../../packages/agents/src/api/__tests__/helpers/agent-carry-fixture.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';

async function verifyBodies(size: number): Promise<void> {
  await withAgentCarry(size, async (agent) => {
    await agent.setModel('body-carried-model');
    const expectedRows = Array.from({ length: size }, (_, index) =>
      accountingRow(index),
    );
    for (const provider of ['anthropic', 'openai-responses', 'gemini']) {
      for (const caching of [false, true]) {
        const expected = await captureCuratedBody(
          provider,
          expectedRows,
          caching,
        );
        const actual = await captureCuratedBody(
          provider,
          agent.streamHistory(),
          caching,
          true,
          true,
        );
        const output = process.env.AGENT_CARRY_BODY_OUTPUT;
        if (output !== undefined) {
          mkdirSync(output, { recursive: true });
          const prefix = `${size}-${provider}-${caching}`;
          await writeBodyFile(
            join(output, `${prefix}-expected.json`),
            expected,
          );
          await writeBodyFile(join(output, `${prefix}-actual.json`), actual);
        }
        expect(actual).toBe(expected);
      }
    }
  });
}

describe('AgentImpl carried startup BODY oracle', () => {
  it.each([512, 8192])(
    'preserves %i-row provider bytes, cache settings and transport retries',
    verifyBodies,
    180000,
  );
});
