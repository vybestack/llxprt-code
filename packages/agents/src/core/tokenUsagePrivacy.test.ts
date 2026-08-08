/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3130 — AC-10 privacy regression test.
 *
 * Drives a turn whose prompt text, tool ARGUMENTS, and tool RESULT bodies all
 * contain distinct known sentinel strings, then asserts NO sentinel appears
 * anywhere in the written JSONL file. This must cover the new fields added by
 * slice 4 (tool attribution, request-shape buckets, prefix fingerprint).
 *
 * The privacy argument: counts, identifiers (callId, toolName), and hashes are
 * stored — never prompt text, tool arguments, or tool result bodies.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TokenUsageLogger } from './TokenUsageLogger.js';
import { recordRequestShapeContext } from './tokenUsageEstimateLogger.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

const PROMPT_SENTINEL = 'PROMPT_SECRET_xyz789';
const ARGS_SENTINEL = 'ARGS_SECRET_abc456';
const RESULT_SENTINEL = 'RESULT_SECRET_def012';
const INSTRUCTIONS_SENTINEL = 'INSTRUCTIONS_SECRET_qrs345';
const TOOL_SCHEMA_SENTINEL = 'SCHEMA_SECRET_tuv678';

const ALL_SENTINELS = [
  PROMPT_SENTINEL,
  ARGS_SENTINEL,
  RESULT_SENTINEL,
  INSTRUCTIONS_SENTINEL,
  TOOL_SCHEMA_SENTINEL,
];

function makeTempLogPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'token-usage-priv-')),
    'usage.jsonl',
  );
}

describe('tokenUsagePrivacy (AC-10) — no sensitive content in JSONL', () => {
  let logFile: string;

  beforeEach(() => {
    logFile = makeTempLogPath();
  });

  afterEach(() => {
    const dir = path.dirname(logFile);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('does not leak prompt text, tool arguments, or tool result bodies', async () => {
    const logger = new TokenUsageLogger(true, logFile);

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: `user wrote ${PROMPT_SENTINEL}` }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-priv-1',
            name: 'read_file',
            parameters: { path: `/secret/${ARGS_SENTINEL}.txt` },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call-priv-1',
            toolName: 'read_file',
            result: `file body contains ${RESULT_SENTINEL}`,
          },
        ],
      },
    ];

    const tools = [
      { name: 'read_file', description: `tool desc ${TOOL_SCHEMA_SENTINEL}` },
    ];
    const instructionsText = `system instructions with ${INSTRUCTIONS_SENTINEL}`;

    // Compute and attach the request-shape context (slice 4 fields).
    recordRequestShapeContext(
      logger,
      'prompt-priv',
      contents,
      tools,
      instructionsText,
    );

    // Complete the estimate + actual to write the record.
    logger.recordEstimate('prompt-priv', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-priv', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    // Read the raw JSONL file contents.
    const raw = fs.readFileSync(logFile, 'utf-8');

    // Assert NO sentinel appears anywhere in the file.
    for (const sentinel of ALL_SENTINELS) {
      expect(raw).not.toContain(sentinel);
    }

    // Sanity: the record WAS written and carries the new slice-4 fields.
    const record = JSON.parse(raw.trim()) as Record<string, unknown>;
    expect(record.record_type).toBe('turn');
    expect(record.tool_calls).toBeDefined();
    expect(record.instructions_tokens).toBeDefined();
    expect(resultTokenField(record, 'tool_calls'));
    expect(record.prefix_fingerprint).toBeDefined();
    expect(record.new_tool_result_tokens).toBeDefined();
  });

  it('the prefix fingerprint is a hash, not prompt text', async () => {
    const logger = new TokenUsageLogger(true, logFile);

    recordRequestShapeContext(
      logger,
      'prompt-fp',
      [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: PROMPT_SENTINEL }],
        },
      ],
      [],
      INSTRUCTIONS_SENTINEL,
    );

    logger.recordEstimate('prompt-fp', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-fp', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    const raw = fs.readFileSync(logFile, 'utf-8');
    const record = JSON.parse(raw.trim()) as Record<string, unknown>;
    const fp = record.prefix_fingerprint;
    expect(typeof fp).toBe('string');
    // The fingerprint must be a short hex string — not the prompt.
    expect((fp as string).length).toBeLessThanOrEqual(64);
    expect(raw).not.toContain(PROMPT_SENTINEL);
    expect(raw).not.toContain(INSTRUCTIONS_SENTINEL);
  });

  it('tool_calls array carries only call_id, tool_name, result_tokens, was_truncated — never bodies or args', async () => {
    const logger = new TokenUsageLogger(true, logFile);

    recordRequestShapeContext(
      logger,
      'prompt-tc',
      [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call-tc',
              name: 'search',
              parameters: { query: ARGS_SENTINEL },
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call-tc',
              toolName: 'search',
              result: RESULT_SENTINEL,
            },
          ],
        },
      ],
      [],
      undefined,
    );

    logger.recordEstimate('prompt-tc', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-tc', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    const raw = fs.readFileSync(logFile, 'utf-8');
    expect(raw).not.toContain(ARGS_SENTINEL);
    expect(raw).not.toContain(RESULT_SENTINEL);

    const record = JSON.parse(raw.trim()) as Record<string, unknown>;
    const toolCalls = record.tool_calls as Array<Record<string, unknown>>;
    expect(toolCalls).toHaveLength(1);
    const entry = toolCalls[0];
    // Only these four keys are permitted per entry.
    expect(Object.keys(entry).sort()).toEqual(
      ['call_id', 'result_tokens', 'tool_name', 'was_truncated'].sort(),
    );
    expect(entry.call_id).toBe('call-tc');
    expect(entry.tool_name).toBe('search');
    expect(typeof entry.result_tokens).toBe('number');
    expect(entry.was_truncated).toBe(false);
  });
});

/** Asserts that a field is defined; helper to keep the test readable. */
function resultTokenField(
  record: Record<string, unknown>,
  field: string,
): void {
  expect(record[field]).toBeDefined();
}
