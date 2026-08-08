/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3130 slice 2: subagent identity (AC-1, AC-8) and empty-history
 * boundary on the token-usage join keys.
 *
 * These tests prove:
 * - A subagent turn record carries its own `runtime_id`, the parent's
 *   `parent_runtime_id`, and its `subagent_name` (AC-8).
 * - A main-agent turn record carries `null` for both `parent_runtime_id`
 *   and `subagent_name`.
 * - When history has no chronology yet, `turn_id`/`user_turn`/`step` are
 *   `null` — never invented, never 0-as-unknown (AC-1 boundary).
 *
 * These use the real `recordTurnJoinContext` helper (the same function
 * called at the send seams) so they exercise the actual wiring.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TokenUsageLogger } from './TokenUsageLogger.js';
import { recordTurnJoinContext } from './tokenUsageEstimateLogger.js';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { findCurrentTurnMarker } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';

function makeTempLogPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'token-usage-subagent-')),
    'usage.jsonl',
  );
}

interface TurnRecordFields {
  runtime_id?: string;
  parent_runtime_id?: string | null;
  subagent_name?: string | null;
  session_id?: string;
  turn_id?: string | null;
  user_turn?: number | null;
  step?: number | null;
}

function readTurnRecords(filePath: string): TurnRecordFields[] {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (raw.length === 0) return [];
  return raw.split('\n').map((line) => JSON.parse(line) as TurnRecordFields);
}

function driveTurn(
  logger: TokenUsageLogger,
  logFile: string,
  runtimeState: AgentRuntimeState,
  historyService: HistoryService,
  promptId: string,
  turnId: string | null = 'turn-under-test',
): void {
  logger.recordEstimate(promptId, {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    estimatedTokens: 100,
    estimator: 'anthropic-char',
    tiktokenTokens: 90,
  });
  recordTurnJoinContext(logger, promptId, runtimeState, historyService, turnId);
  // recordActual is async — flush synchronously via the internal write chain
  void logger.recordActual(promptId, {
    actualPromptTokens: 500,
    cachedTokens: 0,
  });
}

describe('Token usage subagent identity and boundary (issue #3130)', () => {
  let logFile: string;
  let logger: TokenUsageLogger;

  beforeEach(() => {
    logFile = makeTempLogPath();
    logger = new TokenUsageLogger(true, logFile);
  });

  afterEach(() => {
    const dir = path.dirname(logFile);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      process.stderr.write(`Failed to clean up temp dir: ${String(error)}\n`);
    }
  });

  it('subagent turn record carries own runtime_id, parent runtime_id, and subagent_name', async () => {
    const parentRuntimeId = 'main-runtime-001';
    const subagentRuntimeId = 'main-runtime-001#coder#abc12345';

    const subagentState = createAgentRuntimeState({
      runtimeId: subagentRuntimeId,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      sessionId: 'subagent-session',
      parentRuntimeId,
      subagentName: 'coder',
    });

    const historyService = new HistoryService();
    // Add a user message so the chronology has a marker
    historyService.add(
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Write code' }],
        metadata: { turnId: 'turn-sub-1' },
      },
      'claude-3-5-sonnet-20241022',
    );

    const promptId = 'subagent-prompt-1';
    driveTurn(logger, logFile, subagentState, historyService, promptId);

    // Wait for the async write to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    const records = readTurnRecords(logFile);
    expect(records).toHaveLength(1);
    const record = records[0];

    expect(record.runtime_id).toBe(subagentRuntimeId);
    expect(record.parent_runtime_id).toBe(parentRuntimeId);
    expect(record.subagent_name).toBe('coder');
    expect(record.session_id).toBe('subagent-session');
  });

  it('main-agent turn record carries null for parent_runtime_id and subagent_name', async () => {
    const mainRuntimeId = 'main-runtime-002';

    const mainState = createAgentRuntimeState({
      runtimeId: mainRuntimeId,
      provider: 'openai',
      model: 'gpt-4',
      sessionId: 'main-session',
    });

    const historyService = new HistoryService();
    historyService.add(
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello' }],
        metadata: { turnId: 'turn-main-1' },
      },
      'gpt-4',
    );

    const promptId = 'main-prompt-1';
    driveTurn(logger, logFile, mainState, historyService, promptId);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const records = readTurnRecords(logFile);
    expect(records).toHaveLength(1);
    const record = records[0];

    expect(record.runtime_id).toBe(mainRuntimeId);
    expect(record.parent_runtime_id).toBeNull();
    expect(record.subagent_name).toBeNull();
    expect(record.session_id).toBe('main-session');
  });

  it('empty-history boundary: user_turn/step are null, never 0 or invented', async () => {
    const state = createAgentRuntimeState({
      runtimeId: 'empty-history-rt',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      sessionId: 'empty-session',
    });

    // No history items — no chronology marker exists
    const historyService = new HistoryService();

    // findCurrentTurnMarker must return null for empty history
    expect(findCurrentTurnMarker(historyService.getRawHistory())).toBeNull();

    const promptId = 'empty-history-prompt';
    driveTurn(logger, logFile, state, historyService, promptId, 'minted-turn');

    await new Promise((resolve) => setTimeout(resolve, 50));

    const records = readTurnRecords(logFile);
    expect(records).toHaveLength(1);
    const record = records[0];

    // turn_id is minted before the send, so it survives an empty history —
    // that is precisely what stops the first turn of a session being unjoinable.
    expect(record.turn_id).toBe('minted-turn');
    // The chronology-derived fields describe the state the request was built
    // from. There is none, so they are null — never 0, never invented.
    expect(record.user_turn).toBeNull();
    expect(record.step).toBeNull();

    // Runtime identity keys are still present (they don't depend on history)
    expect(record.session_id).toBe('empty-session');
    expect(record.runtime_id).toBe('empty-history-rt');
    expect(record.parent_runtime_id).toBeNull();
    expect(record.subagent_name).toBeNull();
  });

  it('disabled logger writes nothing', async () => {
    const disabledLogger = new TokenUsageLogger(false, logFile);

    const state = createAgentRuntimeState({
      runtimeId: 'disabled-rt',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      sessionId: 'disabled-session',
    });

    const historyService = new HistoryService();

    recordTurnJoinContext(
      disabledLogger,
      'disabled-prompt',
      state,
      historyService,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    // When the logger is disabled, nothing is written — the file does not
    // even exist (AC-1 boundary: logger disabled → nothing written).
    expect(fs.existsSync(logFile)).toBe(false);
  });
});
